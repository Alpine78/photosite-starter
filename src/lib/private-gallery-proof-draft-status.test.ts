import { describe, expect, it } from "vitest";
import { createPrivateGalleryProofDraftMemoryStore } from "./private-gallery-proof-draft-store";
import { projectPrivateGalleryProofDraftStatus } from "./private-gallery-proof-draft-status";

const NOW = new Date("2026-10-16T12:00:00Z");
async function setup() {
  const store = createPrivateGalleryProofDraftMemoryStore();
  const draft = await store.create({ pricing: { includedCount: 2, extraUnitPriceMinor: 100, currency: "EUR" } }, NOW);
  const plan = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private-objects",
    manifest: [{ kind: "derivative", derivativeKind: "watermarked-proof", nominalBytes: 10000, width: 800, height: 1200,
      filename: "SYNTHETIC-PRIVATE-FILENAME.JPG", mediaId: "private-media-id" }], now: NOW });
  return { store, draft, plan, preparing: (await store.list(1)).items[0] };
}
describe("proof preparation administrator status", () => {
  it("projects only the allowlisted state and upload counts/dates", async () => {
    const { draft, preparing, plan } = await setup();
    expect(projectPrivateGalleryProofDraftStatus(draft, NOW)).toEqual({ state: "draft" });
    const status = projectPrivateGalleryProofDraftStatus(preparing, NOW);
    expect(status).toEqual({ state: "preparing", upload: { objectCount: 1, openedAt: NOW.toISOString(), deadline: plan.preparation.deadline.toISOString(), expired: false } });
    const json = JSON.stringify(status);
    for (const secret of [draft.gallery.galleryId, plan.preparation.preparationId, plan.objects[0].objectKey,
      "private-objects", "SYNTHETIC-PRIVATE-FILENAME.JPG", "private-media-id", "keyPrefix", "pricingSnapshot", "verifiedObjects"]) expect(json).not.toContain(secret);
  });
  it("retains ready as unpublished and reports the publication window independently", async () => {
    const { store, draft, plan } = await setup();
    const completed = await store.completeFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 1,
      preparationId: plan.preparation.preparationId, now: NOW, receipts: [],
      observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })) });
    expect(completed.ready).toBe(true);
    if (!completed.ready) throw new Error("fixture completion failed");
    const row = completed.setup;
    expect(projectPrivateGalleryProofDraftStatus(row, NOW)).toMatchObject({ state: "ready", upload: { expired: false } });
    for (const [offset, expired] of [[-1, false], [0, true], [1, true]] as const) {
      expect(projectPrivateGalleryProofDraftStatus(row, new Date(plan.preparation.deadline.getTime() + offset))).toMatchObject({ state: "ready", upload: { expired } });
    }
    expect(row.gallery).not.toHaveProperty("publishedAt");
  });
  it("fails closed on malformed store state, date or count without leaking data", async () => {
    const { preparing } = await setup();
    const badRows = [
      { ...preparing, gallery: { ...preparing.gallery, state: "published" } },
      { ...preparing, preparation: undefined },
      { ...preparing, readyProof: {} },
      { ...preparing, preparation: { ...preparing.preparation!, objects: [] } },
      { ...preparing, preparation: { ...preparing.preparation!, preparation: { ...preparing.preparation!.preparation, deadline: NOW } } },
    ];
    for (const row of badRows) {
      expect(() => projectPrivateGalleryProofDraftStatus(row as never, NOW)).toThrow("[private-gallery-proof-draft-status] invalid-record");
    }
    expect(() => projectPrivateGalleryProofDraftStatus(preparing, new Date(NaN))).toThrow("invalid-record");
    // A concurrent creation/preparation may finish after this list request's
    // clock snapshot while its administrator authorization is awaiting IO.
    expect(projectPrivateGalleryProofDraftStatus(preparing, new Date(NOW.getTime() - 1))).toMatchObject({ state: "preparing", upload: { expired: false } });
  });
});
