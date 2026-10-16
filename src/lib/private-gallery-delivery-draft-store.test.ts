import { describe, expect, it, vi } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore, getPrivateGalleryDeliveryDraftMemoryStore,
  PRIVATE_GALLERY_DELIVERY_DRAFT_CAPACITY } from "./private-gallery-delivery-draft-store";
const NOW = new Date("2026-10-16T09:00:00Z");
describe("private delivery drafts", () => {
  it("creates distinct private setup records without issuing customer access", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    const first = await store.create({ customerReference: "customer-1", jobReference: "job-1" }, NOW);
    const second = await store.create({}, NOW);
    expect(first).toMatchObject({ gallery: { kind: "delivery", state: "draft", capabilityGeneration: 0, createdAt: NOW }, revision: 0 });
    expect(first.gallery.galleryHandle).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.gallery.galleryId).not.toBe(second.gallery.galleryId);
    expect(first.gallery.galleryHandle).not.toBe(second.gallery.galleryHandle);
    expect(Object.keys(first.gallery).sort()).toEqual(["capabilityGeneration", "createdAt", "galleryHandle", "galleryId", "kind", "state"]);
    first.gallery.createdAt.setFullYear(2001);
    expect((await store.list(100)).items.every((row) => row.gallery.createdAt.getTime() === NOW.getTime())).toBe(true);
  });
  it("orders newest first with deterministic identity ties and bounded listing", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    await store.create({}, NOW); await store.create({}, NOW);
    const latest = await store.create({}, new Date(NOW.getTime() + 1000));
    const all = await store.list(100);
    expect(all.items[0].gallery.galleryId).toBe(latest.gallery.galleryId);
    expect(all.items.slice(1).map((row) => row.gallery.galleryId)).toEqual(all.items.slice(1).map((row) => row.gallery.galleryId).sort());
    expect((await store.list(1)).hasMore).toBe(true);
    expect((await store.list(100)).hasMore).toBe(false);
  });
  it.each([null, [], { pricing: {} }, { state: "published" }, { customerReference: "" }, { customerReference: " " },
    { customerReference: "x\ny" }, { jobReference: "\u2028" }, { customerReference: "ä".repeat(65) }, { jobReference: 12 }])("refuses malformed setup %j without creating a row", async (input) => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    await expect(store.create(input as never, NOW)).rejects.toMatchObject({ reason: "invalid-input" });
    expect((await store.list(100)).items).toEqual([]);
  });
  it("accepts the exact UTF-8 byte reference boundary", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    expect((await store.create({ customerReference: "ä".repeat(64) }, NOW)).customerReference).toBe("ä".repeat(64));
  });
  it.each([0, -1, 101, 1.1, NaN])("refuses invalid list bound %s", async (limit) => {
    await expect(createPrivateGalleryDeliveryDraftMemoryStore().list(limit)).rejects.toMatchObject({ reason: "invalid-limit" });
  });
  it("rejects invalid time and keeps fixture resets and separate stores isolated", async () => {
    const owner = {};
    const store = getPrivateGalleryDeliveryDraftMemoryStore(owner);
    expect(getPrivateGalleryDeliveryDraftMemoryStore(owner)).toBe(store);
    await expect(store.create({}, new Date(NaN))).rejects.toMatchObject({ reason: "invalid-time" });
    await store.create({}, NOW);
    expect((await getPrivateGalleryDeliveryDraftMemoryStore({}).list(100)).items).toEqual([]);
  });
  it("bounds total development storage without deleting existing rows", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    for (let n = 0; n < PRIVATE_GALLERY_DELIVERY_DRAFT_CAPACITY; n++) await store.create({}, NOW);
    await expect(store.create({}, NOW)).rejects.toMatchObject({ reason: "capacity" });
    expect(await store.list(100)).toMatchObject({ hasMore: true, items: expect.any(Array) });
    expect((await store.list(100)).items).toHaveLength(100);
  });
  it("rejects identity collisions rather than overwriting a draft", async () => {
    // Inject the crypto implementation through Vitest's module boundary only.
    vi.resetModules();
    vi.doMock("node:crypto", async (original) => ({ ...await original<typeof import("node:crypto")>(), randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
    try {
      const draftModule = await import("./private-gallery-delivery-draft-store");
      const store = draftModule.createPrivateGalleryDeliveryDraftMemoryStore();
      await store.create({}, NOW);
      await expect(store.create({}, NOW)).rejects.toMatchObject({ reason: "identity-collision" });
      expect((await store.list(100)).items).toHaveLength(1);
    } finally { vi.doUnmock("node:crypto"); vi.resetModules(); }
  });
});
