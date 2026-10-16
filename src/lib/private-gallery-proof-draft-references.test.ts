import { describe, expect, it } from "vitest";
import { createPrivateGalleryProofDraftMemoryStore } from "./private-gallery-proof-draft-store";
const pricing = { includedCount: 2, extraUnitPriceMinor: 100, currency: "EUR" };
const now = new Date("2026-10-16T10:00:00Z");
const manifest = [{ kind: "derivative" as const, derivativeKind: "watermarked-proof" as const,
  filename: "IMG_0001.JPG", mediaId: "media-1", width: 1200, height: 800, nominalBytes: 1000 }];
describe("proof draft reference replacement", () => {
  it("replaces/clears references, bumps even no-op revisions and preserves other data", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const row = await store.create({ pricing, customerReference: "old", jobReference: "old-job" }, now);
    const input = { handle: row.gallery.galleryHandle, expectedRevision: 0, references: { customerReference: "ä".repeat(64) } };
    const edited = await store.updateReferences(input);
    expect(edited).toEqual({ ...row, revision: 1, customerReference: input.references.customerReference, jobReference: undefined });
    expect(edited).not.toHaveProperty("jobReference");
    edited.gallery.createdAt.setFullYear(2000);
    expect((await store.list(100)).items[0].gallery.createdAt).toEqual(now);
    const results = await Promise.allSettled([store.updateReferences({ ...input, expectedRevision: 1, references: {} }),
      store.updatePricing({ handle: input.handle, expectedRevision: 1, pricing: { ...pricing, includedCount: 3 } })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const cleared = (await store.list(100)).items[0];
    expect(cleared).not.toHaveProperty("customerReference");
    expect(cleared).not.toHaveProperty("jobReference");
    expect((await store.updateReferences({ handle: input.handle, expectedRevision: 2, references: {} })).revision).toBe(3);
  });
  it("preserves preparation through editing, freezes at ready and rejects stale completion", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const row = await store.create({ pricing }, now);
    const handle = row.gallery.galleryHandle;
    const plan = await store.openFirstPreparation({ handle, expectedRevision: 0, keyPrefix: "private/proofs", manifest, now });
    const updated = await store.updateReferences({ handle, expectedRevision: 1, references: { jobReference: "current-job" } });
    expect(updated.preparation).toEqual(plan); expect(updated.preparationKeyPrefix).toBe("private/proofs");
    const completion = { handle, expectedRevision: 1, now, preparationId: plan.preparation.preparationId, receipts: [],
      observations: plan.objects.map((o) => ({ objectKey: o.objectKey, sizeBytes: o.nominalBytes })) };
    await expect(store.completeFirstPreparation(completion)).rejects.toMatchObject({ reason: "conflict" });
    expect((await store.completeFirstPreparation({ ...completion, expectedRevision: 2 })).ready).toBe(true);
    const before = await store.list(100);
    await expect(store.updateReferences({ handle, expectedRevision: 3, references: {} })).rejects.toMatchObject({ reason: "conflict" });
    expect(await store.list(100)).toEqual(before);
  });
  it.each(["", " ", "ä".repeat(65), "x\nx", "x\u2028x", "x\u0085x"])("rejects invalid reference without changing state", async (value) => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const row = await store.create({ pricing }, now);
    await expect(store.updateReferences({ handle: row.gallery.galleryHandle, expectedRevision: 0, references: { customerReference: value } })).rejects.toMatchObject({ reason: "invalid-input" });
    expect((await store.list(100)).items).toEqual([row]);
  });
});
