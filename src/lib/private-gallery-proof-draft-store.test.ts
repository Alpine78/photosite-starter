import { describe, expect, it } from "vitest";

import {
  createPrivateGalleryProofDraftMemoryStore,
  PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT,
} from "@/lib/private-gallery-proof-draft-store";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const INPUT = {
  pricing: { includedCount: 2, extraUnitPriceMinor: 1200, currency: "EUR" },
  customerReference: "customer-1",
  jobReference: "job-1",
};

describe("private proof draft memory store", () => {
  it("creates distinct inaccessible draft identities without a capability or publication", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const first = await store.create(INPUT, NOW);
    const second = await store.create(INPUT, NOW);
    expect(first.gallery.galleryId).not.toBe(second.gallery.galleryId);
    expect(first.gallery.galleryHandle).not.toBe(second.gallery.galleryHandle);
    for (const draft of [first, second]) {
      expect(draft.gallery).toMatchObject({ kind: "proof", state: "draft", capabilityGeneration: 0 });
      expect(draft.gallery).not.toHaveProperty("publishedAt");
      expect(draft.gallery).not.toHaveProperty("accessExpiresAt");
      expect(draft).not.toHaveProperty("capability");
    }
    (first.pricing as { currency: string }).currency = "USD";
    expect((await store.list(2)).items[0].pricing.currency).toBe("EUR");
  });

  it("validates pricing, references, time and list bound before mutation", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    await expect(store.create({ ...INPUT, pricing: { ...INPUT.pricing, extraUnitPriceMinor: -1 } }, NOW))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.create({ ...INPUT, customerReference: "a\n" }, NOW))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.create(INPUT, new Date("invalid")))
      .rejects.toMatchObject({ reason: "invalid-time" });
    await expect(store.list(0)).rejects.toMatchObject({ reason: "invalid-limit" });
    await expect(store.list(101)).rejects.toMatchObject({ reason: "invalid-limit" });
    expect((await store.list(1)).items).toEqual([]);
  });

  it("returns only the latest bounded page and reports truncation", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    for (let index = 0; index <= PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT; index += 1) {
      await store.create(INPUT, new Date(NOW.getTime() + index * 1000));
    }
    const list = await store.list(PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT);
    expect(list.items).toHaveLength(100);
    expect(list.hasMore).toBe(true);
    expect(list.items[0].gallery.createdAt.toISOString()).toBe(new Date(NOW.getTime() + 100000).toISOString());
    expect(list.items.at(-1)?.gallery.createdAt.toISOString()).toBe(new Date(NOW.getTime() + 1000).toISOString());
  });

  it("edits the whole pricing candidate atomically and preserves external references", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const created = await store.create(INPUT, NOW);
    const next = await store.updatePricing({
      handle: created.gallery.galleryHandle,
      expectedRevision: 0,
      pricing: { includedCount: 4, extraUnitPriceMinor: 1500, currency: "USD" },
    });
    expect(next).toMatchObject({
      revision: 1,
      pricing: { includedCount: 4, extraUnitPriceMinor: 1500, currency: "USD" },
      customerReference: INPUT.customerReference,
      jobReference: INPUT.jobReference,
    });
    expect(next.gallery).toEqual(created.gallery);
    expect((await store.list(1)).items[0].revision).toBe(1);
  });

  it("lets only one simultaneous edit win a draft revision", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const created = await store.create(INPUT, NOW);
    const input = {
      handle: created.gallery.galleryHandle,
      expectedRevision: 0,
      pricing: { includedCount: 3, extraUnitPriceMinor: 800, currency: "EUR" },
    };
    const outcomes = await Promise.allSettled([
      store.updatePricing(input), store.updatePricing(input),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { reason: "conflict" } },
    ]);
    expect((await store.list(1)).items[0]).toMatchObject({ revision: 1, pricing: input.pricing });
  });

  it("refuses stale, unknown and invalid edits without changing the draft", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const created = await store.create(INPUT, NOW);
    const request = {
      handle: created.gallery.galleryHandle,
      expectedRevision: 0,
      pricing: { includedCount: 3, extraUnitPriceMinor: 100, currency: "EUR" },
    };
    await store.updatePricing(request);
    await expect(store.updatePricing(request)).rejects.toMatchObject({ reason: "conflict" });
    await expect(store.updatePricing({ ...request, handle: "unknown" }))
      .rejects.toMatchObject({ reason: "not-found" });
    await expect(store.updatePricing({ ...request, expectedRevision: 1,
      pricing: { ...request.pricing, extraUnitPriceMinor: -1 } }))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.updatePricing({ ...request, expectedRevision: Number.MAX_SAFE_INTEGER }))
      .rejects.toMatchObject({ reason: "conflict" });
    expect((await store.list(1)).items[0]).toMatchObject({ revision: 1, pricing: request.pricing });
  });

  const proofManifest = [
    { kind: "derivative" as const, derivativeKind: "watermarked-proof" as const,
      nominalBytes: 900_000, width: 1200, height: 800,
      filename: "IMG_0001.JPG", mediaId: "media-1" },
    { kind: "derivative" as const, derivativeKind: "watermarked-proof" as const,
      nominalBytes: 850_000, width: 800, height: 1200,
      filename: "IMG_0002.JPG", mediaId: "media-2" },
  ];

  it("commits the complete first plan with draft to preparing before returning it", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const draft = await store.create(INPUT, NOW);
    const plan = await store.openFirstPreparation({
      handle: draft.gallery.galleryHandle, expectedRevision: 0,
      keyPrefix: "private-galleries", manifest: proofManifest, now: NOW,
    });
    const row = (await store.list(1)).items[0];
    expect(draft.gallery.state).toBe("draft");
    expect(row.gallery).toMatchObject({ galleryId: draft.gallery.galleryId,
      state: "preparing", capabilityGeneration: 0 });
    expect(row).toMatchObject({ revision: 1, pricing: INPUT.pricing,
      preparation: { galleryKind: "proof", totalBytes: 1_750_000 } });
    expect(row.preparation).toEqual(plan);
    expect(plan.preparation.galleryId).toBe(draft.gallery.galleryId);
    expect(plan.preparation.deadline.toISOString()).toBe("2026-10-31T10:00:00.000Z");
    expect(plan.objects).toHaveLength(2);
    expect(plan.objects.map((object) => object.objectKind)).toEqual(["proof", "proof"]);
    expect(new Set(plan.preparation.objectKeys).size).toBe(2);
    expect(plan.preparation.objectKeys).toEqual(plan.objects.map((object) => object.objectKey));
    expect(row.gallery).not.toHaveProperty("publishedAt");
    expect(row.gallery).not.toHaveProperty("accessExpiresAt");
    expect(row).not.toHaveProperty("capability");
    expect(plan).not.toHaveProperty("pricing");

    (plan.objects[0] as { objectKey: string }).objectKey = "changed";
    (row.preparation!.objects[1] as { objectKey: string }).objectKey = "changed-again";
    const saved = (await store.list(1)).items[0].preparation!;
    expect(saved.objects[0].objectKey).not.toBe("changed");
    expect(saved.objects[1].objectKey).not.toBe("changed-again");
  });

  it("rejects invalid, stale, repeated and concurrent preparations without partial mutation", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const draft = await store.create(INPUT, NOW);
    const input = { handle: draft.gallery.galleryHandle, expectedRevision: 0,
      keyPrefix: "private-galleries", manifest: proofManifest, now: NOW };
    await expect(store.openFirstPreparation({ ...input, manifest: [] }))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.openFirstPreparation({ ...input, manifest: [
      proofManifest[0], { ...proofManifest[1], mediaId: "media-1" },
    ] })).rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.openFirstPreparation({ ...input, now: new Date("invalid") }))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.openFirstPreparation({ ...input, keyPrefix: "../other" }))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.openFirstPreparation({ ...input, handle: "unknown" }))
      .rejects.toMatchObject({ reason: "not-found" });
    expect((await store.list(1)).items[0]).toEqual(draft);

    const outcomes = await Promise.allSettled([
      store.openFirstPreparation(input), store.openFirstPreparation(input),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected"))
      .toMatchObject([{ reason: { reason: "conflict" } }]);
    await expect(store.openFirstPreparation({ ...input, expectedRevision: 1 }))
      .rejects.toMatchObject({ reason: "conflict" });
    expect((await store.list(1)).items[0]).toMatchObject({
      gallery: { state: "preparing" }, revision: 1,
    });
  });

  it("edits the current pricing candidate while preparing without changing the upload plan", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const draft = await store.create(INPUT, NOW);
    const input = { handle: draft.gallery.galleryHandle, expectedRevision: 0,
      keyPrefix: "private-galleries", manifest: proofManifest, now: NOW };
    const plan = await store.openFirstPreparation(input);
    await expect(store.updatePricing({
      handle: input.handle, expectedRevision: 0, pricing: INPUT.pricing,
    })).rejects.toMatchObject({ reason: "conflict" });
    const edited = await store.updatePricing({
      handle: input.handle, expectedRevision: 1,
      pricing: { includedCount: 5, extraUnitPriceMinor: 2000, currency: "EUR" },
    });
    expect(edited).toMatchObject({
      revision: 2, gallery: { state: "preparing" },
      pricing: { includedCount: 5, extraUnitPriceMinor: 2000, currency: "EUR" },
    });
    expect(edited.preparation).toEqual(plan);
    expect(edited.preparation).not.toHaveProperty("pricing");
    await expect(store.openFirstPreparation({ ...input, expectedRevision: 2 }))
      .rejects.toMatchObject({ reason: "conflict" });
  });

});
