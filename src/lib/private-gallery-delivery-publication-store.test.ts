import { describe, expect, it, vi } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore } from "./private-gallery-delivery-draft-store";
import { buildFirstDeliveryPublicationCandidate, type PrivateGalleryDeliveryPublicationInput } from "./private-gallery-delivery-publication-store";
import { openCapability } from "./private-gallery-capability";
import { listDeliveryDraftsAsAdmin } from "./private-gallery-delivery-draft-admin";
import * as notification from "./private-gallery-delivery-notification";
const NOW = new Date("2026-10-16T12:00:00Z");
const keyring = { activeKeyId: "key-1", keyIds: ["key-1"], getKey: () => Buffer.alloc(32, 17) };
async function setup(now = NOW, factory = createPrivateGalleryDeliveryDraftMemoryStore) {
  const store = factory();
  const draft = await store.create({ customerReference: "client-ref", jobReference: "job-ref" }, now);
  const plan = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private", now,
    manifest: [{ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1000, width: 1200, height: 800 }, { kind: "zip", nominalBytes: 100000 }] });
  const complete = await store.completeFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 1, now,
    preparationId: plan.preparation.preparationId, receipts: [], observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })) });
  if (!complete.ready) throw new Error("fixture not ready");
  const input: PrivateGalleryDeliveryPublicationInput = { handle: draft.gallery.galleryHandle, expectedRevision: 2, recipient: "client@example.test",
    locale: "fi", canonicalOrigin: "https://photo.example.test", routePrefix: "client", now: new Date(now), keyring };
  return { store, input, ready: complete.setup, plan };
}
describe("atomic development-memory delivery publication", () => {
  it("continues a draft page when its cursor row was published between reads", async () => {
    const { store, input, ready } = await setup();
    const older = await store.create({}, new Date(NOW.getTime() - 1000));
    const newer = await store.create({}, new Date(NOW.getTime() + 1000));
    const first = await store.list(2);
    expect(first.items.map((row) => row.gallery.galleryHandle)).toEqual([newer.gallery.galleryHandle, ready.gallery.galleryHandle]);
    expect(first.hasMore).toBe(true);
    await store.publishFirstDelivery(input);
    const next = await store.list(2, ready.gallery.galleryHandle);
    expect(next.items.map((row) => row.gallery.galleryHandle)).toEqual([older.gallery.galleryHandle]);
    expect(next.hasMore).toBe(false);
    expect((await store.list(2)).items.map((row) => row.gallery.galleryHandle)).toEqual([newer.gallery.galleryHandle, older.gallery.galleryHandle]);
    expect(await store.list(2, older.gallery.galleryHandle)).toEqual({ items: [], hasMore: false });
  });
  it("commits published state, the current encrypted capability and exactly one initial pending record", async () => {
    const { store, input, ready } = await setup();
    const render = vi.spyOn(notification, "buildPrivateGalleryDeliveryNotification");
    try {
      const result = await store.publishFirstDelivery(input);
      expect(result).toMatchObject({ revision: 3, sourceRevision: 2,
        gallery: { state: "published", publishedAt: NOW, accessExpiresAt: new Date("2027-04-16T12:00:00Z"), activeZipObjectKey: ready.gallery.activeZipObjectKey },
        outbox: { kind: "delivery-notification", state: "pending", attempts: 0, galleryId: ready.gallery.galleryId, createdAt: NOW },
        notification: { recipient: "client@example.test", locale: "fi" }, capability: { capabilityGeneration: 0, keyId: "key-1", createdAt: NOW } });
      expect(result.outbox.idempotencyKey).toBe(`delivery-initial:${ready.gallery.galleryId}:0`);
      const context = { galleryId: result.gallery.galleryId, handle: input.handle, generation: 0 };
      const secret = openCapability(keyring, context, result.capability.envelope);
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(result)).not.toContain(secret);
      for (const changes of [{ galleryId: "other" }, { handle: "A".repeat(22) }, { generation: 1 }]) {
        expect(() => openCapability(keyring, { ...context, ...changes }, result.capability.envelope)).toThrow();
      }
      expect(render).not.toHaveBeenCalled();
      expect(await store.readPublication(input.handle)).toEqual(result);
      expect((await store.list(100)).items).toEqual([]);
      expect(await listDeliveryDraftsAsAdmin({ store, authorize: async () => true }, { cookieHeader: null, now: NOW }))
        .toEqual({ ok: true, value: { items: [], hasMore: false } });
    } finally { render.mockRestore(); }
  });
  it("serializes eight publication requests into one commit and seven identical replays", async () => {
    const { store, input } = await setup();
    const results = await Promise.all(Array.from({ length: 8 }, () => store.publishFirstDelivery(input)));
    expect(results.every((value) => JSON.stringify(value) === JSON.stringify(results[0]))).toBe(true);
    expect(results.every((value) => value.revision === 3 && value.outbox.attempts === 0)).toBe(true);
    const broken = { activeKeyId: "broken", keyIds: [], getKey() { throw new Error("must not read replay keyring"); } };
    expect(await store.publishFirstDelivery({ ...input, now: new Date("2028-01-01Z"), keyring: broken })).toEqual(results[0]);
  });
  it.each([{ recipient: "other@example.test" }, { locale: "en" }, { canonicalOrigin: "https://other.example.test" },
    { routePrefix: "other" }, { expectedRevision: 3 }])("refuses changed replay intent %j without updating the winner", async (changes) => {
    const { store, input } = await setup();
    const original = await store.publishFirstDelivery(input);
    await expect(store.publishFirstDelivery({ ...input, ...changes })).rejects.toMatchObject({ reason: "conflict" });
    expect(await store.readPublication(input.handle)).toEqual(original);
  });
  it("detaches input and privileged snapshots, and refuses all prepublication writes after publication", async () => {
    const { store, input, plan } = await setup();
    const result = await store.publishFirstDelivery(input);
    const saved = structuredClone(result);
    input.now.setFullYear(1999); result.gallery.accessExpiresAt!.setFullYear(1999);
    result.capability.createdAt.setFullYear(1999); result.outbox.createdAt.setFullYear(1999);
    (result.notification as { recipient: string }).recipient = "changed@example.test";
    expect(await store.readPublication(input.handle)).toEqual(saved);
    await expect(store.updateReferences({ handle: input.handle, expectedRevision: 3, references: {} })).rejects.toMatchObject({ reason: "conflict" });
    await expect(store.openFirstPreparation({ handle: input.handle, expectedRevision: 3, keyPrefix: "private", manifest: [], now: NOW })).rejects.toMatchObject({ reason: "conflict" });
    await expect(store.completeFirstPreparation({ handle: input.handle, expectedRevision: 3, preparationId: plan.preparation.preparationId,
      now: NOW, receipts: [], observations: [] })).rejects.toMatchObject({ reason: "conflict" });
    expect(await store.readPublication(input.handle)).toEqual(saved);
  });
  it.each(["2023-08-31T08:30:00Z", "2024-08-31T08:30:00Z", "2026-09-30T08:30:00Z"])("reuses UTC calendar-month clamp at %s exactly once", async (date) => {
    const { store, input } = await setup(new Date(date));
    const expected = date.startsWith("2023") ? "2024-02-29T08:30:00Z" : date.startsWith("2024") ? "2025-02-28T08:30:00Z" : "2027-03-30T08:30:00Z";
    const first = await store.publishFirstDelivery(input);
    expect(first.gallery.accessExpiresAt).toEqual(new Date(expected));
    expect(await store.publishFirstDelivery({ ...input, now: new Date(input.now.getTime() + 100000) })).toEqual(first);
  });
  it("leaves the canonical ready row unchanged on stale, expired or corrupt-keyring refusals", async () => {
    const { store, input, ready, plan } = await setup();
    for (const candidate of [
      { ...input, expectedRevision: 1 },
      { ...input, now: plan.preparation.deadline },
      { ...input, keyring: { ...keyring, getKey: () => new Uint8Array(1) } },
      { ...input, keyring: { ...keyring, getKey: () => { throw new Error("private-keyring-secret"); } } },
    ]) {
      let error: unknown;
      try { await store.publishFirstDelivery(candidate); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(String(error) + JSON.stringify(error)).not.toContain("private-keyring-secret");
      expect((error as Error).cause).toBeUndefined();
      expect((await store.list(100)).items).toEqual([ready]);
      expect(await store.readPublication(input.handle)).toBeUndefined();
    }
  });
  it("rolls back a detached-result failure and redacts its exception before canonical commit", async () => {
    const { store, input, ready } = await setup();
    const clone = vi.spyOn(globalThis, "structuredClone").mockImplementationOnce(() => { throw new Error("private snapshot canary"); });
    try {
      await expect(store.publishFirstDelivery(input)).rejects.toThrow("[private-gallery-delivery-publication] snapshot-unavailable");
      expect((await store.list(100)).items).toEqual([ready]);
      expect(await store.readPublication(input.handle)).toBeUndefined();
    } finally { clone.mockRestore(); }
  });
  it("rolls back an outbox identity failure after capability sealing without a partial row", async () => {
    vi.resetModules();
    vi.doMock("node:crypto", async () => {
      const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
    });
    try {
      const draftStoreModule = await import("./private-gallery-delivery-draft-store");
      const { store, input, ready } = await setup(NOW, draftStoreModule.createPrivateGalleryDeliveryDraftMemoryStore);
      const crypto = await import("node:crypto");
      vi.mocked(crypto.randomUUID).mockImplementationOnce(() => { throw new Error("private outbox canary"); });
      await expect(store.publishFirstDelivery(input)).rejects.toThrow("[private-gallery-delivery-publication] outbox-unavailable");
      expect((await store.list(100)).items).toEqual([ready]);
      expect(await store.readPublication(input.handle)).toBeUndefined();
    } finally { vi.doUnmock("node:crypto"); vi.resetModules(); }
  });
  it.each([null, [], {}, { extra: true }, { expectedRevision: -1 }, { now: new Date(NaN) }, { locale: "zz" },
    { recipient: "invalid\n@example.test" }, { canonicalOrigin: "http://photo.example.test" }, { routePrefix: "../other" },
    { handle: "invalid" }])("refuses malformed publication input %j before mutation", async (invalid) => {
    const { store, input, ready } = await setup();
    const value = invalid === null || Array.isArray(invalid) || Object.keys(invalid).length === 0 ? invalid : { ...input, ...invalid };
    await expect(store.publishFirstDelivery(value as never)).rejects.toMatchObject({ reason: "invalid-input" });
    expect((await store.list(100)).items).toEqual([ready]);
  });
  it("refuses accessors and proxies without executing their traps", async () => {
    const { store, input } = await setup();
    const getter = vi.fn(() => input.handle);
    const candidate = { ...input }; Object.defineProperty(candidate, "handle", { get: getter, enumerable: true });
    await expect(store.publishFirstDelivery(candidate)).rejects.toMatchObject({ reason: "invalid-input" });
    const trap = vi.fn(() => { throw new Error("trap"); });
    await expect(store.publishFirstDelivery(new Proxy(input, { ownKeys: trap }))).rejects.toMatchObject({ reason: "invalid-input" });
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it.each([false, true])("preserves the winner of a synchronous reentrant keyring callback (same=%s)", async (same) => {
    const { store, input } = await setup();
    let winner: ReturnType<typeof store.publishFirstDelivery> | undefined;
    const reentrant = { ...keyring, getKey: () => {
      winner = store.publishFirstDelivery(same ? input : { ...input, recipient: "winner@example.test" });
      return Buffer.alloc(32, 17);
    } };
    const outer = store.publishFirstDelivery({ ...input, keyring: reentrant });
    if (same) expect(await outer).toEqual(await winner);
    else await expect(outer).rejects.toMatchObject({ reason: "conflict" });
    expect(await store.readPublication(input.handle)).toEqual(await winner);
    expect((await store.readPublication(input.handle))?.revision).toBe(3);
  });
  it("rechecks the complete frozen child set and ZIP pointer before building publication", async () => {
    const { ready, input } = await setup();
    for (const row of [
      { ...ready, gallery: { ...ready.gallery, activeZipObjectKey: "wrong" } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, placements: [] } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, verifiedObjects: ready.readyDelivery!.verifiedObjects.slice(1) } },
      { ...ready, preparation: { ...ready.preparation!, preparation: { ...ready.preparation!.preparation, objectKeys: [] } } },
    ]) expect(() => buildFirstDeliveryPublicationCandidate(row, input)).toThrow("readiness-failed");
    const candidate = buildFirstDeliveryPublicationCandidate(ready, input);
    expect(candidate.readyDelivery).toBe(ready.readyDelivery); expect(candidate.preparation).toBe(ready.preparation);
    expect(Object.isFrozen(candidate.publication)).toBe(true); expect(Object.isFrozen(candidate.publication!.outbox)).toBe(true);
  });
});
