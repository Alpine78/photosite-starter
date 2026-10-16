import { describe, expect, it } from "vitest";

import {
  createPrivateGalleryProofDraftMemoryStore,
  type PrivateGalleryProofDraftCompletionInput,
} from "@/lib/private-gallery-proof-draft-store";
import { planPrivateGalleryFirstProofPublication } from "@/lib/private-gallery-readiness";
import type { PrivateGalleryManifestEntry } from "@/lib/private-gallery-upload";

const NOW = new Date("2026-10-16T10:00:00.000Z");
const PRICING = { includedCount: 2, extraUnitPriceMinor: 1200, currency: "EUR" };
const MANIFEST = [
  { kind: "derivative", derivativeKind: "watermarked-proof", filename: "IMG_0010.JPG",
    mediaId: "media-c", nominalBytes: 900_000, width: 1200, height: 800 },
  { kind: "derivative", derivativeKind: "watermarked-proof", filename: "IMG_0002.JPG",
    mediaId: "media-b", nominalBytes: 850_000, width: 800, height: 1200 },
  { kind: "derivative", derivativeKind: "watermarked-proof", filename: "IMG_0002.JPG",
    mediaId: "media-a", nominalBytes: 800_000, width: 2048, height: 512 },
] satisfies readonly PrivateGalleryManifestEntry[];

async function prepared(manifest: readonly PrivateGalleryManifestEntry[] = MANIFEST) {
  const store = createPrivateGalleryProofDraftMemoryStore();
  const draft = await store.create({ pricing: PRICING, customerReference: "customer-1", jobReference: "job-1" }, NOW);
  const plan = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle,
    expectedRevision: 0, keyPrefix: "private/proofs", manifest, now: NOW });
  const input: PrivateGalleryProofDraftCompletionInput = {
    handle: draft.gallery.galleryHandle, expectedRevision: 1,
    preparationId: plan.preparation.preparationId, now: NOW, receipts: [],
    observations: plan.objects.map(object => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })),
  };
  return { store, draft, plan, input, row: async () => (await store.list(100)).items.find(row => row.gallery.galleryHandle === draft.gallery.galleryHandle)! };
}

describe("private proof first-upload completion", () => {
  it("atomically commits ready, permanent filename references, frozen current pricing and verified metadata", async () => {
    const f = await prepared();
    const pricing = { includedCount: 5, extraUnitPriceMinor: 2400, currency: "USD" };
    await f.store.updatePricing({ handle: f.input.handle, expectedRevision: 1, pricing });
    const result = await f.store.completeFirstPreparation({ ...f.input, expectedRevision: 2,
      observations: [...f.input.observations].reverse() });
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("expected ready");
    expect(result.setup).toEqual(await f.row());
    expect(result.setup).toMatchObject({ revision: 3, pricing,
      gallery: { state: "ready", capabilityGeneration: 0 },
      customerReference: "customer-1", jobReference: "job-1",
      readyProof: { pricingSnapshot: pricing, lastAssignedOrdinal: 3 } });
    expect(result.setup.preparation).toEqual(f.plan);
    expect(result.setup.preparationKeyPrefix).toBe("private/proofs");
    expect(result.setup.readyProof!.placements.map(p => [p.mediaId, p.reference, p.order])).toEqual([
      ["media-c", "003", 1], ["media-b", "002", 2], ["media-a", "001", 3],
    ]);
    expect(result.setup.readyProof!.verifiedObjects).toEqual(f.plan.objects.map(o => ({
      objectKey: o.objectKey, objectKind: "proof", sizeBytes: o.nominalBytes,
    })));
    for (const name of ["publishedAt", "accessExpiresAt", "activeZipObjectKey"]) {
      expect(result.setup.gallery).not.toHaveProperty(name);
    }
    expect(result.setup).not.toHaveProperty("capability");
    await expect(f.store.updatePricing({ handle: f.input.handle, expectedRevision: 3, pricing: PRICING }))
      .rejects.toMatchObject({ reason: "conflict" });
    const publication = { gallery: result.setup.gallery, proof: result.setup.readyProof,
      verifiedObjects: result.setup.readyProof!.verifiedObjects,
      preparation: result.setup.preparation!.preparation, now: NOW };
    expect(planPrivateGalleryFirstProofPublication(publication)).toMatchObject({ publishable: true });
    expect(planPrivateGalleryFirstProofPublication({ ...publication, now: f.plan.preparation.deadline }))
      .toMatchObject({ publishable: false, blockers: ["preparation-expired"] });
  });

  it("refuses receipt-only completion, preserves the entire row, then accepts a verified retry", async () => {
    const f = await prepared();
    const before = await f.row();
    const failure = await f.store.completeFirstPreparation({ ...f.input, observations: [],
      receipts: f.plan.objects.map(o => ({ objectKey: o.objectKey })) });
    expect(failure).toEqual({ ready: false, failures: f.plan.objects.map(o => ({
      objectKey: o.objectKey, reason: "missing",
    })), truncated: false });
    expect(await f.row()).toEqual(before);
    expect((await f.store.completeFirstPreparation(f.input)).ready).toBe(true);
  });

  it.each(["size-mismatch", "unplanned", "checksum-unavailable", "checksum-mismatch", "checksum-algorithm-mismatch"])(
    "rejects %s without any persisted reference, frozen price or revision", async reason => {
      const f = await prepared();
      const before = await f.row();
      const first = f.input.observations[0];
      const observations = reason === "unplanned" ? [...f.input.observations, { ...first, objectKey: "private/proofs/unplanned" }]
        : [{ ...first, ...(reason === "size-mismatch" ? { sizeBytes: 1 } : {}),
          ...(reason === "checksum-mismatch" ? { checksum: { algorithm: "sha256" as const, value: "different" } } : {}),
          ...(reason === "checksum-algorithm-mismatch" ? { checksum: { algorithm: "crc32c" as const, value: "digest" } } : {}) }, ...f.input.observations.slice(1)];
      const receipts = reason.startsWith("checksum") ? [{ objectKey: first.objectKey,
        checksum: { algorithm: "sha256" as const, value: "digest" } }] : [];
      expect(await f.store.completeFirstPreparation({ ...f.input, observations, receipts }))
        .toMatchObject({ ready: false, failures: [{ reason }], truncated: false });
      expect(await f.row()).toEqual(before);
    });

  it("caps missing-object failure status at twenty and leaves all hundred rows unaccepted", async () => {
    const f = await prepared(Array.from({ length: 100 }, (_, i) => ({ ...MANIFEST[0],
      kind: "derivative", derivativeKind: "watermarked-proof", filename: `IMG_${i}.JPG`, mediaId: `media-${i}` })));
    const before = await f.row();
    const result = await f.store.completeFirstPreparation({ ...f.input, observations: [] });
    expect(result).toMatchObject({ ready: false, truncated: true });
    if (result.ready) throw new Error("expected incomplete upload");
    expect(result.failures).toHaveLength(20);
    expect(await f.row()).toEqual(before);
  });

  it.each([
    { now: new Date(NaN), reason: "invalid-time" },
    { now: new Date(NOW.getTime() - 1), reason: "invalid-time" },
    { now: new Date(NOW.getTime() + 30 * 86400000), reason: "preparation-expired" },
    { expectedRevision: 0, reason: "conflict" },
    { preparationId: "another-preparation", reason: "conflict" },
    { handle: "unknown", reason: "not-found" },
  ])("refuses stale/expired/unknown input $reason without mutation", async ({ reason, ...overrides }) => {
    const f = await prepared();
    const before = await f.row();
    await expect(f.store.completeFirstPreparation({ ...f.input, ...overrides })).rejects.toMatchObject({ reason });
    expect(await f.row()).toEqual(before);
  });

  it("rejects draft completion and replay instead of recomputing permanent references", async () => {
    const f = await prepared();
    const draft = await f.store.create({ pricing: PRICING }, NOW);
    await expect(f.store.completeFirstPreparation({ ...f.input, handle: draft.gallery.galleryHandle, expectedRevision: 0 }))
      .rejects.toMatchObject({ reason: "conflict" });
    expect((await f.store.completeFirstPreparation(f.input)).ready).toBe(true);
    const before = await f.row();
    for (const expectedRevision of [1, 2]) {
      await expect(f.store.completeFirstPreparation({ ...f.input, expectedRevision }))
        .rejects.toMatchObject({ reason: "conflict" });
    }
    expect(await f.row()).toEqual(before);
  });

  it("allows only one completion at a revision and orders competing price edits through the same CAS", async () => {
    const f = await prepared();
    const outcomes = await Promise.allSettled([
      f.store.completeFirstPreparation(f.input), f.store.completeFirstPreparation(f.input),
      f.store.updatePricing({ handle: f.input.handle, expectedRevision: 1, pricing: PRICING }),
    ]);
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "rejected", "rejected"]);
    expect(await f.row()).toMatchObject({ revision: 2, gallery: { state: "ready" } });
  });

  it("isolates stored pricing, dates, verification data and references from caller mutation", async () => {
    const f = await prepared();
    const checksum = { algorithm: "sha256" as const, value: "valid" };
    const providerObservation = { ...f.input.observations[0], checksum, etag: '"opaque-etag"', unexpected: "discard" };
    const result = await f.store.completeFirstPreparation({ ...f.input,
      receipts: [{ objectKey: f.input.observations[0].objectKey, checksum }],
      observations: [providerObservation,
        ...f.input.observations.slice(1)] });
    if (!result.ready) throw new Error("expected ready");
    checksum.value = "changed";
    (result.setup.readyProof!.placements[0] as { reference: string }).reference = "999";
    (result.setup.readyProof!.pricingSnapshot as { currency: string }).currency = "USD";
    result.setup.preparation!.preparation.deadline.setTime(0);
    expect((await f.row()).readyProof!.verifiedObjects[0]).toEqual({
      objectKey: f.input.observations[0].objectKey, objectKind: "proof", sizeBytes: 900_000,
      checksum: { algorithm: "sha256", value: "valid" }, etag: '"opaque-etag"',
    });
    expect((await f.row()).readyProof!.placements[0].reference).toBe("003");
    expect((await f.row()).readyProof!.pricingSnapshot.currency).toBe("EUR");
    expect((await f.row()).preparation!.preparation.deadline).toEqual(f.plan.preparation.deadline);
  });

  it("does not overwrite a pricing revision changed while adapter metadata is snapshotted", async () => {
    const f = await prepared();
    const pricing = { ...PRICING, includedCount: 7 };
    let edit: Promise<unknown> | undefined;
    const observations = [{ ...f.input.observations[0], get etag() {
      edit = f.store.updatePricing({ handle: f.input.handle, expectedRevision: 1, pricing });
      return "etag";
    } }, ...f.input.observations.slice(1)];
    await expect(f.store.completeFirstPreparation({ ...f.input, observations }))
      .rejects.toMatchObject({ reason: "conflict" });
    await edit;
    expect(await f.row()).toMatchObject({ revision: 2, pricing, gallery: { state: "preparing" } });
    expect(await f.row()).not.toHaveProperty("readyProof");
  });

  it.each(["duplicate-receipt", "unplanned-receipt", "duplicate-observation", "excess-observations", "oversized-etag", "malformed-checksum"])(
    "refuses malformed adapter evidence: %s", async mode => {
      const f = await prepared();
      const before = await f.row();
      const first = f.input.observations[0];
      const receipt = { objectKey: first.objectKey };
      const receipts = mode === "duplicate-receipt" ? [receipt, receipt]
        : mode === "unplanned-receipt" ? [{ objectKey: "foreign" }] : [];
      const observations = mode === "duplicate-observation" ? [first, first]
        : mode === "excess-observations" ? Array(5).fill(first)
        : mode === "oversized-etag" ? [{ ...first, etag: "a".repeat(513) }]
        : mode === "malformed-checksum" ? [{ ...first, checksum: { algorithm: "sha256" as const, value: "bad\n" } }]
        : f.input.observations;
      await expect(f.store.completeFirstPreparation({ ...f.input, receipts, observations }))
        .rejects.toMatchObject({ reason: "invalid-input" });
      expect(await f.row()).toEqual(before);
    });

  it("completes the maximum file count with maximum derivative dimensions and filename bytes", async () => {
    const f = await prepared(Array.from({ length: 1000 }, (_, i) => ({ ...MANIFEST[0], kind: "derivative",
      derivativeKind: "watermarked-proof", filename: `${"a".repeat(247)}${String(i).padStart(4, "0")}.JPG`,
      mediaId: `media-${i}`, nominalBytes: 8_000_000, width: 2048, height: 2048 })));
    const result = await f.store.completeFirstPreparation(f.input);
    expect(result).toMatchObject({ ready: true, setup: { revision: 2,
      readyProof: { lastAssignedOrdinal: 1000 } } });
  });
});
