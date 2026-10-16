import { describe, expect, it } from "vitest";
import { createPrivateGalleryProofDraftMemoryStore } from "./private-gallery-proof-draft-store";
import { createPrivateGalleryDeliveryDraftMemoryStore } from "./private-gallery-delivery-draft-store";
import { appendPrivateDraftRows } from "./private-gallery-draft-list";

for (const kind of ["proof", "delivery"] as const) {
  describe(kind + " bounded draft pagination", () => {
    const createStore = () => kind === "proof" ? createPrivateGalleryProofDraftMemoryStore() : createPrivateGalleryDeliveryDraftMemoryStore();
    const input = { pricing: { includedCount: 1, extraUnitPriceMinor: 0, currency: "EUR" } };
    it("traverses >200 equal-date rows once and returns detached pages while newer rows arrive", async () => {
      const store = createStore();
      const now = new Date("2026-10-16T12:00:00Z");
      for (let i = 0; i < 201; i++) await (kind === "proof" ? store.create(input, now) : (store as ReturnType<typeof createPrivateGalleryDeliveryDraftMemoryStore>).create({}, now));
      const first = await store.list(100);
      expect(first.items).toHaveLength(100); expect(first.hasMore).toBe(true);
      const original = (await store.list(100)).items.map((r) => r.gallery.galleryHandle);
      first.items[0].gallery.createdAt.setFullYear(2000);
      expect((await store.list(100)).items.map((r) => r.gallery.galleryHandle)).toEqual(original);
      const inserted = await (kind === "proof" ? store.create(input, new Date("2026-10-17")) : (store as ReturnType<typeof createPrivateGalleryDeliveryDraftMemoryStore>).create({}, new Date("2026-10-17")));
      const second = await store.list(100, first.items.at(-1)!.gallery.galleryHandle);
      const third = await store.list(100, second.items.at(-1)!.gallery.galleryHandle);
      expect(second.items).toHaveLength(100); expect(second.hasMore).toBe(true);
      expect(third.items).toHaveLength(1); expect(third.hasMore).toBe(false);
      const all = [...first.items, ...second.items, ...third.items].map((r) => r.gallery.galleryHandle);
      expect(new Set(all).size).toBe(201); expect(all).not.toContain(inserted.gallery.galleryHandle);
      expect((await store.list(100)).items[0].gallery.galleryHandle).toBe(inserted.gallery.galleryHandle);
      expect(await store.list(100, third.items[0].gallery.galleryHandle)).toEqual({ items: [], hasMore: false });
    });
    it("supports arbitrary valid page sizes and refuses unknown anchors and invalid bounds", async () => {
      const store = createStore();
      for (const limit of [0, -1, 101, 1.5, NaN]) await expect(store.list(limit)).rejects.toMatchObject({ reason: "invalid-limit" });
      for (const anchor of ["", "bad", "A".repeat(22)]) await expect(store.list(100, anchor)).rejects.toMatchObject({ reason: "invalid-cursor" });
      await (kind === "proof" ? store.create(input, new Date()) : (store as ReturnType<typeof createPrivateGalleryDeliveryDraftMemoryStore>).create({}, new Date()));
      expect((await store.list(1)).items).toHaveLength(1);
    });
  });
}
describe("page overlap merge", () => {
  it("deduplicates by handle without replacing newer acknowledged revisions", () => {
    const first = { handle: "one", revision: 2, customerReference: "saved" };
    const next = appendPrivateDraftRows([first], [{ handle: "one", revision: 1, customerReference: "stale" }, { handle: "two", revision: 0 }]);
    expect(next).toEqual([first, { handle: "two", revision: 0 }]);
    expect(appendPrivateDraftRows(next, [{ handle: "one", revision: 3 }])[0]).toEqual({ handle: "one", revision: 3 });
    expect(appendPrivateDraftRows(next, [{ ...first, customerReference: "same-revision" }])[0]).toBe(first);
  });
});
