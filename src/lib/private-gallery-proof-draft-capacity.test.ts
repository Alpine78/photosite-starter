import { describe, expect, it } from "vitest";
import { createPrivateGalleryProofDraftMemoryStore, PRIVATE_GALLERY_PROOF_DRAFT_CAPACITY } from "./private-gallery-proof-draft-store";
const NOW = new Date("2026-10-16T12:00:00Z");
const INPUT = { pricing: { includedCount: 2, extraUnitPriceMinor: 100, currency: "EUR" }, customerReference: "private-customer-canary" };
describe("development proof draft capacity", () => {
  it("admits exactly one final concurrent create and never evicts an older gallery", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const first = await store.create(INPUT, NOW);
    for (let index = 1; index < PRIVATE_GALLERY_PROOF_DRAFT_CAPACITY - 1; index++) await store.create(INPUT, NOW);
    const outcomes = await Promise.allSettled([store.create(INPUT, NOW), store.create(INPUT, NOW)]);
    expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((value) => value.status === "rejected")).toMatchObject([{ reason: { reason: "capacity" } }]);
    const before = await store.list(100);
    await expect(store.create(INPUT, NOW)).rejects.toMatchObject({ reason: "capacity" });
    expect(await store.list(100)).toEqual(before);
    // At capacity existing records still progress, including the oldest row.
    const plan = await store.openFirstPreparation({ handle: first.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private",
      manifest: [{ kind: "derivative", derivativeKind: "watermarked-proof", nominalBytes: 1000, width: 800, height: 1200,
        filename: "IMG_0001.JPG", mediaId: "media-1" }], now: NOW });
    expect((await store.completeFirstPreparation({ handle: first.gallery.galleryHandle, expectedRevision: 1,
      preparationId: plan.preparation.preparationId, receipts: [],
      observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })), now: NOW })).ready).toBe(true);
    expect(await createPrivateGalleryProofDraftMemoryStore().create(INPUT, NOW)).toMatchObject({ revision: 0 });
  });
  it("does not charge rejected input against capacity and redacts the refusal", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    await expect(store.create({ ...INPUT, pricing: { ...INPUT.pricing, includedCount: -1 } }, NOW)).rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.create(INPUT, new Date(NaN))).rejects.toMatchObject({ reason: "invalid-time" });
    for (let index = 0; index < PRIVATE_GALLERY_PROOF_DRAFT_CAPACITY; index++) await store.create(INPUT, NOW);
    try {
      await store.create(INPUT, NOW);
      throw new Error("expected capacity refusal");
    } catch (error) {
      expect(error).toMatchObject({ reason: "capacity" });
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(INPUT.customerReference);
      expect(String(error)).not.toContain("1000");
    }
  });
});
