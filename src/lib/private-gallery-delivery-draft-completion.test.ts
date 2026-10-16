import { describe, expect, it } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore } from "./private-gallery-delivery-draft-store";
import type { PrivateGalleryManifestEntry } from "./private-gallery-upload";
const NOW = new Date("2026-10-16T12:00:00Z");
const PREVIEW = { kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 12000, width: 1200, height: 800 } as const;
const ZIP = { kind: "zip", nominalBytes: 250000 } as const;
const MANIFEST: readonly PrivateGalleryManifestEntry[] = [PREVIEW, ZIP, { ...PREVIEW, width: 800, height: 1200 }];
async function setup() {
  const store = createPrivateGalleryDeliveryDraftMemoryStore();
  const draft = await store.create({ customerReference: "client-1" }, NOW);
  const plan = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private-objects", manifest: MANIFEST, now: NOW });
  const completion = { handle: draft.gallery.galleryHandle, expectedRevision: 1, preparationId: plan.preparation.preparationId,
    receipts: plan.objects.map((object) => ({ objectKey: object.objectKey, checksum: { algorithm: "sha256" as const, value: "synthetic-digest" } })),
    observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes,
      etag: "multipart-etag-2", checksum: { algorithm: "sha256" as const, value: "synthetic-digest" } })), now: NOW };
  return { store, draft, plan, completion };
}
describe("first delivery preparation and completion", () => {
  it("commits the complete plan first, then ready previews/ZIP together without publication or access", async () => {
    const { store, draft, plan, completion } = await setup();
    const preparing = (await store.list(1)).items[0];
    expect(preparing).toMatchObject({ revision: 1, gallery: { state: "preparing" }, preparation: plan });
    expect(preparing).not.toHaveProperty("readyDelivery");
    const result = await store.completeFirstPreparation({ ...completion, observations: [...completion.observations].reverse() });
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("fixture readiness failed");
    const row = result.setup;
    expect(row).toMatchObject({ revision: 2, customerReference: "client-1", gallery: { kind: "delivery", state: "ready", capabilityGeneration: 0 } });
    expect(row.gallery.activeZipObjectKey).toBe(plan.objects[1].objectKey);
    expect(row.readyDelivery!.placements.map((item) => [item.width, item.height, item.order])).toEqual([[1200, 800, 1], [800, 1200, 2]]);
    expect(new Set(row.readyDelivery!.placements.map((item) => item.placementId)).size).toBe(2);
    for (const field of ["publishedAt", "accessExpiresAt", "capability"]) expect(row.gallery).not.toHaveProperty(field);
    (row.readyDelivery!.placements[0] as { width: number }).width = 1; // Returned snapshots cannot mutate storage.
    row.gallery.createdAt.setFullYear(2000);
    expect((await store.list(1)).items[0].readyDelivery!.placements[0].width).toBe(1200);
    expect((await store.list(1)).items[0].gallery.createdAt).toEqual(draft.gallery.createdAt);
    await expect(store.completeFirstPreparation(completion)).rejects.toMatchObject({ reason: "conflict" });
    await expect(store.updateReferences({ handle: draft.gallery.galleryHandle, expectedRevision: 2, references: {} })).rejects.toMatchObject({ reason: "conflict" });
  });
  it.each(["missing", "size", "checksum", "algorithm", "unplanned"])("keeps every part preparing on %s verification failure", async (failure) => {
    const { store, completion } = await setup();
    const before = (await store.list(1)).items;
    const observations = structuredClone(completion.observations);
    if (failure === "missing") observations.pop();
    if (failure === "size") observations[0].sizeBytes++;
    if (failure === "checksum") observations[0].checksum.value = "wrong-digest";
    if (failure === "algorithm") observations[0].checksum.algorithm = "crc32c" as "sha256";
    if (failure === "unplanned") observations.push({ ...observations[0], objectKey: "private-objects/g/other/preview/" + "A".repeat(22) });
    expect(await store.completeFirstPreparation({ ...completion, observations })).toMatchObject({ ready: false, truncated: false });
    expect((await store.list(1)).items).toEqual(before);
  });
  it("permits one open and one completion for each revision under concurrency", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    const draft = await store.create({}, NOW);
    const open = { handle: draft.gallery.galleryHandle, expectedRevision: 0, manifest: MANIFEST, keyPrefix: "private", now: NOW };
    const opens = await Promise.allSettled([store.openFirstPreparation(open), store.openFirstPreparation(open)]);
    expect(opens.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const plan = (await store.list(1)).items[0].preparation!;
    const completion = { handle: draft.gallery.galleryHandle, expectedRevision: 1, preparationId: plan.preparation.preparationId,
      receipts: [], observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })), now: NOW };
    const outcomes = await Promise.allSettled([store.completeFirstPreparation(completion), store.completeFirstPreparation(completion)]);
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((row) => row.status === "rejected")).toMatchObject([{ reason: { reason: "conflict" } }]);
  });
  it("refuses invalid times, stale plans and the deadline equality without mutation", async () => {
    const { store, plan, completion } = await setup();
    const before = (await store.list(1)).items;
    for (const [change, reason] of [
      [{ now: new Date(NaN) }, "invalid-time"], [{ now: new Date(NOW.getTime() - 1) }, "invalid-time"],
      [{ now: plan.preparation.deadline }, "preparation-expired"], [{ preparationId: "another-plan" }, "conflict"],
      [{ expectedRevision: 0 }, "conflict"], [{ observations: new Array(1002) }, "invalid-input"],
      [{ receipts: [{ objectKey: "other-secret-key" }] }, "invalid-input"],
    ] as const) await expect(store.completeFirstPreparation({ ...completion, ...change } as never)).rejects.toMatchObject({ reason });
    expect((await store.list(1)).items).toEqual(before);
    expect((await store.completeFirstPreparation({ ...completion, now: new Date(plan.preparation.deadline.getTime() - 1) })).ready).toBe(true);
  });
  it.each([[], [ZIP], [PREVIEW], [PREVIEW, ZIP, ZIP], [{ ...PREVIEW, filename: "private-filename" }, ZIP],
    [{ ...PREVIEW, width: 2049 }, ZIP], [{ ...PREVIEW, nominalBytes: 0 }, ZIP], new Array(3)])("rejects an invalid or incomplete manifest %j atomically", async (manifest) => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    const draft = await store.create({}, NOW);
    await expect(store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private", manifest: manifest as never, now: NOW })).rejects.toMatchObject({ reason: "invalid-input" });
    expect((await store.list(1)).items).toEqual([draft]);
  });
  it("bounds the complete plan at 999 previews plus ZIP and detaches caller manifests", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    const draft = await store.create({}, NOW);
    await expect(store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private",
      manifest: MANIFEST, now: new Date(NOW.getTime() - 1) })).rejects.toMatchObject({ reason: "invalid-time" });
    const manifest = [...Array.from({ length: 999 }, () => ({ ...PREVIEW })), { ...ZIP }];
    await expect(store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private", manifest: [...manifest, PREVIEW], now: NOW })).rejects.toMatchObject({ reason: "invalid-input" });
    const plan = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private", manifest, now: NOW });
    manifest[0].nominalBytes = 1 as 12000;
    plan.preparation.deadline.setFullYear(2000);
    expect((await store.list(1)).items[0].preparation!.objects[0].nominalBytes).toBe(12000);
    expect((await store.list(1)).items[0].preparation!.preparation.deadline.getUTCFullYear()).toBe(2026);
  });
});
