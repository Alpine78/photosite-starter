import { describe, expect, it } from "vitest";
import { cleanupControlId, cleanupControlMutation, cleanupControlPayload, cleanupPolicyFromGallery, parseCleanupControl, type CleanupControl } from "./client-gallery-cleanup-contract";

const ASSET = `image-${"a".repeat(40)}-1600x1000-webp`;
const ZIP = `file-${"b".repeat(40)}-zip`;
const zipReference = { _type: "file", asset: { _type: "reference", _ref: ZIP } };
async function control(): Promise<CleanupControl> {
  return { _id: await cleanupControlId("delivery"), _type: "clientGalleryCleanup", version: 1, galleryId: "delivery",
    policy: { handle: "1".repeat(32), expiryInstant: "2027-04-24T12:00:00Z", assetIds: [ASSET] },
    sourceDocumentId: "drafts.delivery", sourceRevision: "r1", publicationId: "publish-1", enrolledAt: "2026-10-24T12:00:00Z", state: "enrolled" };
}
describe("private cleanup contract", () => {
  it("derives a bounded deterministic private SHA256 identity without normalizing drafts or releases", async () => {
    expect(await cleanupControlId("delivery")).toBe("clientGalleryCleanup." + "b4af39d5b65a14849e885a9d65f0efe4f4e689989689c28c16cfcb3a6e78db5a");
    expect((await cleanupControlId("x".repeat(128))).length).toBeLessThanOrEqual(128);
    for (const id of ["drafts.delivery", "versions.release.delivery", "delivery\n", "", "x".repeat(129)]) await expect(cleanupControlId(id)).rejects.toThrow();
  });
  it("projects only finite new delivery strong image references, retaining no authored private fields", () => {
    const source = { _type: "clientDeliveryGallery", handle: "1".repeat(32), availabilityMode: "until", expiryInstant: "2027-04-24T12:00:00Z",
      items: [{ image: { asset: { _ref: ASSET } } }, { image: { asset: { _ref: ASSET } } }], customerEmail: "not-retained@example.test" };
    expect(cleanupPolicyFromGallery(source)).toEqual({ handle: source.handle, expiryInstant: source.expiryInstant, assetIds: [ASSET] });
    for (const change of [{ _type: "clientProofGallery" }, { _type: "legacyDeliveryGallery" }, { availabilityMode: "indefinite" }, { items: [] }, { items: [{ image: { asset: { _ref: ASSET, _weak: true } } }] }]) expect(cleanupPolicyFromGallery({ ...source, ...change })).toBeUndefined();
  });
  it("round-trips a closed latest state and rejects malformed operational data", async () => {
    const value = await control();
    expect(parseCleanupControl(value, value._id, "delivery")).toEqual(value);
    const getter = Object.defineProperty({ ...value }, "state", { enumerable: true, get: () => { throw new Error("must not execute"); } });
    const symbol = { ...value, [Symbol("private")]: true };
    const sparse = new Array(1);
    const extra = Object.assign([ASSET], { extra: true });
    for (const bad of [getter, symbol, { ...value, extra: true }, { ...value, galleryId: "drafts.delivery" }, { ...value, sourceDocumentId: "other" },
      { ...value, sourceRevision: "r1\n" }, { ...value, enrolledAt: "2026-02-30T00:00:00Z" }, { ...value, _rev: "r1\n" },
      { ...value, state: "pending" }, { ...value, attempt: { operationId: "op", at: value.enrolledAt } },
      { ...value, lastResult: { reason: "anything", at: value.enrolledAt } },
      ...[sparse, extra, [ASSET, ASSET], Array(257).fill(ASSET)].map((assetIds) => ({ ...value, policy: { ...value.policy, assetIds } })),
    ]) expect(() => parseCleanupControl(bad, value._id, "delivery")).toThrow();
    expect(() => parseCleanupControl(value, value._id, "another")).toThrow();
    expect(() => parseCleanupControl(value, "wrong")).toThrow();
  });
  it("requires completed receipts to partition exactly the approved assets with actual revisions", async () => {
    const value = await control(), asset = { id: ASSET, revision: "a1", type: "sanity.imageAsset" };
    const receipt = { operationId: "op", at: value.enrolledAt, deletedAssets: [asset], sharedAssets: [], deletedCount: 1, sharedCount: 0 };
    expect(parseCleanupControl({ ...value, state: "complete", receipt }, value._id).receipt).toEqual(receipt);
    for (const change of [{ deletedCount: 0 }, { sharedAssets: [asset], sharedCount: 1 }, { deletedAssets: [], deletedCount: 0 }, { deletedAssets: [{ ...asset, revision: "" }] }, { extra: true }]) expect(() => parseCleanupControl({ ...value, state: "complete", receipt: { ...receipt, ...change } }, value._id)).toThrow();
    expect(() => parseCleanupControl({ ...value, state: "pending", attempt: { operationId: "op", at: value.enrolledAt, candidateAssets: [] } }, value._id)).toThrow();
  });
  it("uses create for absence and CAS patches clearing obsolete attempt/receipt/result state", async () => {
    const value = await control(), current = { ...value, _rev: "r2", _createdAt: value.enrolledAt, _updatedAt: value.enrolledAt };
    expect(cleanupControlMutation(undefined, value)).toEqual({ create: value });
    expect(cleanupControlPayload(current)).toEqual(value);
    expect(cleanupControlMutation(current, { ...value, state: "disabled" })).toMatchObject({ patch: { id: value._id, ifRevisionID: "r2", set: { state: "disabled" }, unset: ["attempt", "receipt", "lastResult"] } });
    expect(() => cleanupControlMutation(value, value)).toThrow();
  });
  it("includes the actual strong ZIP and never treats a file reference as an image", async () => {
    const value = await control(), source = { _type: "clientDeliveryGallery", ...value.policy, availabilityMode: "until",
      items: [{ image: { asset: { _ref: ASSET } } }], deliveryZip: zipReference };
    expect(cleanupPolicyFromGallery(source)?.assetIds).toEqual([ZIP, ASSET].sort());
    for (const change of [{ deliveryZip: { ...zipReference, asset: { ...zipReference.asset, _weak: true } } },
      { deliveryZip: { ...zipReference, url: "https://example.invalid/private" } }, { items: [{ image: { asset: { _ref: ZIP } } }] }])
      expect(cleanupPolicyFromGallery({ ...source, ...change })).toBeUndefined();
  });
  it("bounds policies to 256 distinct images and one ZIP and binds receipt identities to their types", async () => {
    const value = await control(), images = Array.from({ length: 257 }, (_, index) => `image-${index.toString(16).padStart(40, "0")}-1600x1000-webp`);
    const policy = { ...value.policy, assetIds: [ZIP, ...images.slice(0, 256)].sort() };
    expect(parseCleanupControl({ ...value, policy }, value._id).policy).toEqual(policy);
    for (const assetIds of [images, [ZIP, `file-${"c".repeat(40)}-zip`, ASSET].sort()])
      expect(() => parseCleanupControl({ ...value, policy: { ...policy, assetIds } }, value._id)).toThrow();
    const image = { id: ASSET, type: "sanity.imageAsset", revision: "image-r1" }, zip = { id: ZIP, type: "sanity.fileAsset", revision: "zip-r1" };
    const receipt = { operationId: "op", at: value.enrolledAt, deletedAssets: [image], sharedAssets: [zip], deletedCount: 1, sharedCount: 1 };
    const completed = { ...value, policy: { ...value.policy, assetIds: [ZIP, ASSET].sort() }, state: "complete", receipt };
    expect(parseCleanupControl(completed, value._id).receipt).toEqual(receipt);
    for (const change of [{ sharedAssets: [], sharedCount: 0 }, { sharedAssets: [{ ...zip, type: "sanity.imageAsset" }] },
      { deletedAssets: [{ ...image, type: "sanity.fileAsset" }] }])
      expect(() => parseCleanupControl({ ...completed, receipt: { ...receipt, ...change } }, value._id)).toThrow();
  });
  it("preserves byte-identical version-one image-only controls and terminal receipts", async () => {
    const value = await control(), receipt = { operationId: "op", at: value.enrolledAt,
      deletedAssets: [{ id: ASSET, revision: "image-r1", type: "sanity.imageAsset" }], sharedAssets: [], deletedCount: 1, sharedCount: 0 };
    for (const original of [value, { ...value, state: "complete", receipt }])
      expect(JSON.stringify(parseCleanupControl(original, value._id))).toBe(JSON.stringify(original));
  });
});
