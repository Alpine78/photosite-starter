import { describe, expect, it } from "vitest";
import { openPrivateGalleryUploadPreparation } from "./private-gallery-upload";
import { verifyPrivateGalleryUpload } from "./private-gallery-upload-completion";
import { buildVerifiedFirstDeliveryData, PrivateGalleryDeliveryUploadError } from "./private-gallery-delivery-upload";
const NOW = new Date("2026-10-16T12:00:00Z");
function setup() {
  const plan = openPrivateGalleryUploadPreparation({ galleryId: "gallery-1", galleryKind: "delivery", state: "draft", keyPrefix: "private",
    preparationId: "plan-1", now: NOW, manifest: [
      { kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 10000, width: 1200, height: 800 },
      { kind: "zip", nominalBytes: 100000 },
    ] });
  const completed = verifyPrivateGalleryUpload({ preparation: plan.preparation, expected: plan.objects, receipts: [],
    observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })), keyPrefix: "private", now: NOW });
  if (!completed.verified) throw new Error("fixture not verified");
  return { plan, completed };
}
describe("verified first delivery rows", () => {
  it("joins a complete set deterministically without leaking object keys through placement identity", () => {
    const { plan, completed } = setup();
    const data = buildVerifiedFirstDeliveryData(plan, completed);
    expect(buildVerifiedFirstDeliveryData(plan, { ...completed, objects: [...completed.objects].reverse() })).toEqual(data);
    expect(data.activeZipObjectKey).toBe(plan.objects[1].objectKey);
    expect(data.placements[0]).toMatchObject({ galleryId: "gallery-1", objectKey: plan.objects[0].objectKey,
      derivativeKind: "delivery-preview", width: 1200, height: 800, nominalBytes: 10000, order: 1 });
    expect(data.placements[0].placementId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.placements[0].placementId).not.toContain("private");
  });
  it("refuses incomplete, duplicate, changed or foreign sets rather than building partial rows", () => {
    const { plan, completed } = setup();
    const check = (p: typeof plan, c: typeof completed) => expect(() => buildVerifiedFirstDeliveryData(p, c)).toThrow(PrivateGalleryDeliveryUploadError);
    check(plan, { ...completed, objects: completed.objects.slice(1) });
    check(plan, { ...completed, objects: [completed.objects[0], completed.objects[0]] });
    check(plan, { ...completed, objects: [{ ...completed.objects[0], sizeBytes: 1 }, completed.objects[1]] });
    check(plan, { ...completed, zipSwap: undefined });
    check(plan, { ...completed, zipSwap: { objectKey: completed.zipSwap!.objectKey, predecessorObjectKey: "old-zip-key" } });
    check({ ...plan, totalBytes: plan.totalBytes + 1 }, completed);
    check({ ...plan, galleryKind: "proof" }, completed);
    check({ ...plan, objects: [...plan.objects, plan.objects[0]] }, completed);
    check({ ...plan, objects: [plan.objects[0], { ...plan.objects[1], objectKey: "private/g/another/zip/" + "A".repeat(22) }] }, completed);
    expect(() => buildVerifiedFirstDeliveryData(plan, { verified: false, failures: [], truncated: false })).toThrow("unverified-upload");
  });
});
