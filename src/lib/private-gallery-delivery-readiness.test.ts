import { describe, expect, it } from "vitest";
import { planPrivateGalleryFirstDeliveryPublication } from "./private-gallery-delivery-readiness";
const NOW = new Date("2026-10-16T12:00:00Z");
type Input = Parameters<typeof planPrivateGalleryFirstDeliveryPublication>[0];
const key = (kind: string, value: number) => `private/g/gallery-1/${kind}/${Buffer.alloc(16, value).toString("base64url")}`;
function fixture(now = NOW): Input {
  return {
    gallery: { galleryId: "gallery-1", galleryHandle: Buffer.alloc(16, 5).toString("base64url"), kind: "delivery", state: "ready",
      capabilityGeneration: 0, createdAt: new Date(now), activeZipObjectKey: key("zip", 3) },
    placements: [
      { galleryId: "gallery-1", placementId: "portrait", objectKey: key("preview", 1), order: 1, derivativeKind: "delivery-preview", nominalBytes: 10000, width: 800, height: 1200 },
      { galleryId: "gallery-1", placementId: "landscape", objectKey: key("preview", 2), order: 3, derivativeKind: "delivery-preview", nominalBytes: 12000, width: 1200, height: 800 },
    ],
    verifiedObjects: [
      { objectKey: key("preview", 1), objectKind: "preview", sizeBytes: 10000 },
      { objectKey: key("zip", 3), objectKind: "zip", sizeBytes: 100000 },
      { objectKey: key("preview", 2), objectKind: "preview", sizeBytes: 12000 },
    ],
    preparation: { galleryId: "gallery-1", preparationId: "prep-1", openedAt: new Date(now),
      deadline: new Date(now.getTime() + 30 * 86400000), objectKeys: [key("preview", 1), key("preview", 2), key("zip", 3)] },
    now: new Date(now),
  };
}
function refused(input: Input, blocker: string) {
  expect(planPrivateGalleryFirstDeliveryPublication(input)).toEqual({ publishable: false, blockers: [blocker] });
}
describe("first delivery publication plan", () => {
  it("plans dates for a complete uncropped set and one ZIP without mutating or exposing asset keys", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = planPrivateGalleryFirstDeliveryPublication(input);
    expect(result).toEqual({ publishable: true, galleryId: "gallery-1", expectedState: "ready", expectedCapabilityGeneration: 0,
      nextState: "published", publishedAt: NOW, accessExpiresAt: new Date("2027-04-16T12:00:00Z") });
    expect(input).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/objectKey|private\/g|portrait|landscape|capability|preparationId/);
    if (!result.publishable) throw new Error("expected publication plan");
    result.publishedAt.setFullYear(2000); result.accessExpiresAt.setFullYear(2000);
    expect(input.now).toEqual(NOW);
    expect(input.gallery.createdAt).toEqual(NOW);
    expect(planPrivateGalleryFirstDeliveryPublication(fixture())).toMatchObject({ publishedAt: NOW });
  });
  it.each([["2026-08-31T23:59:00Z", "2027-02-28T23:59:00Z"], ["2027-08-31T00:01:00Z", "2028-02-29T00:01:00Z"],
    ["2028-02-29T12:00:00Z", "2028-08-29T12:00:00Z"]])("clamps six calendar months from %s in UTC", (start, end) => {
    expect(planPrivateGalleryFirstDeliveryPublication(fixture(new Date(start)))).toMatchObject({ publishable: true, accessExpiresAt: new Date(end) });
  });
  it("accepts the last millisecond before the deadline and refuses equality without extending preparation", () => {
    const input = fixture();
    expect(planPrivateGalleryFirstDeliveryPublication({ ...input, now: new Date(input.preparation!.deadline.getTime() - 1) })).toMatchObject({ publishable: true });
    refused({ ...input, now: input.preparation!.deadline }, "preparation-expired");
    refused({ ...input, preparation: { ...input.preparation!, deadline: new Date(input.preparation!.deadline.getTime() + 1) } }, "preparation-unavailable");
    refused({ ...input, preparation: undefined }, "preparation-unavailable");
    refused({ ...input, preparation: { ...input.preparation!, galleryId: "foreign-gallery" } }, "preparation-unavailable");
  });
  it("refuses invalid or prepublication identity, state, generation and dates with deterministic first blockers", () => {
    const input = fixture();
    for (const change of [{ kind: "proof" }, { state: "draft" }, { state: "published" }, { state: "deleting" }]) {
      refused({ ...input, gallery: { ...input.gallery, ...change } } as Input, "wrong-state");
    }
    for (const change of [{ publishedAt: NOW }, { accessExpiresAt: NOW }]) refused({ ...input, gallery: { ...input.gallery, ...change } }, "publication-metadata-present");
    for (const capabilityGeneration of [-1, 0.1, NaN, Number.MAX_SAFE_INTEGER + 1]) refused({ ...input, gallery: { ...input.gallery, capabilityGeneration } }, "invalid-generation");
    refused({ ...input, gallery: { ...input.gallery, galleryId: "../private-canary" } }, "invalid-identity");
    refused({ ...input, gallery: { ...input.gallery, galleryHandle: "bad-handle" } }, "invalid-identity");
    refused({ ...input, now: new Date(NaN) }, "invalid-time");
    refused({ ...input, now: new Date(NOW.getTime() - 1) }, "invalid-time");
  });
  it("refuses absent, extra, duplicate, foreign and mismatched objects", () => {
    const input = fixture();
    refused({ ...input, placements: [] }, "delivery-data-invalid");
    refused({ ...input, verifiedObjects: input.verifiedObjects.slice(1) }, "delivery-data-invalid");
    refused({ ...input, verifiedObjects: [input.verifiedObjects[0], input.verifiedObjects[0], input.verifiedObjects[2]] }, "delivery-objects-mismatch");
    refused({ ...input, verifiedObjects: input.verifiedObjects.map((item, index) => index === 0 ? { ...item, sizeBytes: 1 } : item) }, "delivery-objects-mismatch");
    refused({ ...input, verifiedObjects: input.verifiedObjects.map((item, index) => index === 0 ? { ...item, objectKind: "proof" } : item) }, "delivery-objects-mismatch");
    refused({ ...input, gallery: { ...input.gallery, activeZipObjectKey: key("zip", 8) } }, "delivery-objects-mismatch");
    refused({ ...input, preparation: { ...input.preparation!, objectKeys: [key("preview", 1), key("preview", 2), "private-canary-unplanned"] } }, "delivery-objects-mismatch");
    refused({ ...input, placements: input.placements.map((item, index) => index === 0 ? { ...item, galleryId: "another-gallery" } : item) }, "delivery-data-invalid");
  });
  it.each([{ width: 2049 }, { height: 0 }, { nominalBytes: 8 * 1024 * 1024 + 1 }, { derivativeKind: "watermarked-proof" },
    { placementId: "landscape" }, { order: 3 }, { order: -1 }, { order: 1.5 }])("refuses invalid preview metadata %j", (change) => {
    const input = fixture();
    refused({ ...input, placements: [{ ...input.placements[0], ...change }, input.placements[1]] } as Input, "delivery-data-invalid");
  });
  it.each([0, -1, 20 * 1024 ** 3 + 1, Number.MAX_SAFE_INTEGER, NaN])("refuses invalid/oversized ZIP %s", (sizeBytes) => {
    const input = fixture();
    refused({ ...input, verifiedObjects: input.verifiedObjects.map((item) => item.objectKind === "zip" ? { ...item, sizeBytes } : item) }, "delivery-objects-mismatch");
  });
  it("refuses malformed array shapes and returns no private values", () => {
    const input = fixture();
    refused({ ...input, verifiedObjects: new Array(3) }, "delivery-objects-mismatch");
    refused({ ...input, placements: new Array(2) }, "delivery-data-invalid");
    refused({ ...input, placements: null as never }, "delivery-data-invalid");
    const result = planPrivateGalleryFirstDeliveryPublication({ ...input, gallery: { ...input.gallery, activeZipObjectKey: "PRIVATE-SIGNED-URL-CANARY" } });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });
});
