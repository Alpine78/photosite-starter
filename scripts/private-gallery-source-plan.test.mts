import { describe, expect, it } from "vitest";
import { buildPrivateGallerySourcePlan, validatePrivateSourceInput, validatePrivateSourcePath } from "./private-gallery-source-plan.mts";
import { openPrivateGalleryUploadPreparation } from "../src/lib/private-gallery-upload.ts";
const HASH = "a".repeat(64);
const proof = { mode: "proof", externallyWatermarked: true, images: [{ relativePath: "proofs/IMG_0001.JPG", mediaId: "media-1" }] };
const image = { relativePath: "proofs/IMG_0001.JPG", bytes: 10000, sha256: HASH, identity: "1:2", format: "jpeg", width: 800, height: 1200 };
const delivery = { mode: "delivery", images: [{ relativePath: image.relativePath }], zipPath: "delivery.zip" };
const zip = { relativePath: "delivery.zip", bytes: 100000, sha256: HASH, identity: "1:3" };
describe("offline private upload source plan", () => {
  it("produces a deterministic server-accepted proof manifest without assigning keys or pretending to detect watermarks", () => {
    const result = buildPrivateGallerySourcePlan(proof, [image]);
    expect(buildPrivateGallerySourcePlan(proof, [{ ...image }])).toEqual(result);
    expect(result.manifest).toEqual([{ kind: "derivative", derivativeKind: "watermarked-proof", filename: "IMG_0001.JPG", mediaId: "media-1", nominalBytes: 10000, width: 800, height: 1200 }]);
    expect(result.checks).toMatchObject({ watermarks: "owner-attested-not-detected", remote: "not-contacted" });
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/objectKey|preparationId|capability|"identity"/);
    expect(() => openPrivateGalleryUploadPreparation({ galleryId: "gallery-1", galleryKind: "proof", state: "draft",
      preparationId: "prep-1", keyPrefix: "private", manifest: result.manifest, now: new Date("2026-10-16T12:00:00Z") })).not.toThrow();
    expect(buildPrivateGallerySourcePlan(proof, [{ ...image, sha256: "b".repeat(64) }]).digest).not.toBe(result.digest);
  });
  it("includes the whole ZIP as one object and does not disclose filenames in the delivery server manifest", () => {
    const result = buildPrivateGallerySourcePlan(delivery, [image, zip]);
    expect(result.manifest).toEqual([{ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 10000, width: 800, height: 1200 }, { kind: "zip", nominalBytes: 100000 }]);
    expect(result.totalBytes).toBe(110000);
    expect(result.checks.zip).toBe("signature-only-no-entry-or-crc-verification");
    expect(JSON.stringify(result.manifest)).not.toMatch(/IMG|proofs|mediaId|relativePath/);
  });
  it.each([null, [], {}, { ...proof, images: [] }, { ...proof, externallyWatermarked: false }, { ...proof, zipPath: "x.zip" },
    { ...delivery, zipPath: undefined }, { ...delivery, externallyWatermarked: true }, { ...delivery, images: proof.images },
    { ...proof, other: true }, JSON.parse('{"mode":"proof","__proto__":{}}')])("refuses incomplete or unknown input %j", (value) => {
    expect(() => validatePrivateSourceInput(value)).toThrow();
  });
  it.each(["", "/absolute.jpg", "../source.jpg", "folder/../source.jpg", "folder//source.jpg", "C:/source.jpg", "folder\\source.jpg", "a\nb.jpg", "x\u202ey.jpg", "./a.jpg"])("refuses nonportable or escaping path %s", (value) => {
    expect(() => validatePrivateSourcePath(value)).toThrow();
  });
  it("refuses source aliases, duplicate identities and duplicate proof media IDs", () => {
    for (const relativePath of [image.relativePath, "PROOFS/img_0001.jpg"]) {
      expect(() => validatePrivateSourceInput({ ...proof, images: [...proof.images, { relativePath, mediaId: "media-2" }] })).toThrow("DUPLICATE_SOURCE");
    }
    expect(() => validatePrivateSourceInput({ ...proof, images: [...proof.images, { relativePath: "other.JPG", mediaId: "media-1" }] })).toThrow("INVALID_PROOF");
    expect(() => buildPrivateGallerySourcePlan(delivery, [image, { ...zip, identity: image.identity }])).toThrow("DUPLICATE_SOURCE");
    expect(() => validatePrivateSourceInput({ ...delivery, zipPath: image.relativePath })).toThrow("DUPLICATE_SOURCE");
  });
  it("preserves exact byte/pixel boundaries and uses the same contract as the server", () => {
    const atLimit = buildPrivateGallerySourcePlan(proof, [{ ...image, bytes: 8 * 1024 ** 2, width: 2048, height: 2048 }]);
    expect(atLimit.manifest[0]).toMatchObject({ nominalBytes: 8 * 1024 ** 2, width: 2048 });
    for (const change of [{ bytes: 8 * 1024 ** 2 + 1 }, { width: 2049 }, { height: 0 }, { format: "png" }, { orientation: 6 }, { pages: 2 }, { bytes: NaN }]) {
      expect(() => buildPrivateGallerySourcePlan(proof, [{ ...image, ...change }])).toThrow();
    }
    const maxImages = Array.from({ length: 1000 }, (_, index) => ({ relativePath: `${index}.JPG`, mediaId: `media-${index}` }));
    const assets = maxImages.map((item, index) => ({ ...image, relativePath: item.relativePath, identity: `1:${index}` }));
    const result = buildPrivateGallerySourcePlan({ ...proof, images: maxImages }, assets);
    expect(result.manifest).toHaveLength(1000);
    expect(() => openPrivateGalleryUploadPreparation({ galleryId: "gallery-1", galleryKind: "proof", state: "draft", keyPrefix: "private", preparationId: "prep-1", manifest: result.manifest, now: new Date() })).not.toThrow();
    expect(() => validatePrivateSourceInput({ ...proof, images: [...maxImages, { relativePath: "extra.JPG", mediaId: "extra" }] })).toThrow();
    const deliverImages = maxImages.slice(0, 999).map(({ relativePath }) => ({ relativePath }));
    const delivered = buildPrivateGallerySourcePlan({ ...delivery, images: deliverImages }, [...assets.slice(0, 999), { ...zip, identity: "2:1" }]);
    expect(delivered.manifest).toHaveLength(1000);
    expect(() => openPrivateGalleryUploadPreparation({ galleryId: "gallery-2", galleryKind: "delivery", state: "draft", keyPrefix: "private", preparationId: "prep-2", manifest: delivered.manifest, now: new Date() })).not.toThrow();
  });
  it("bounds ZIP and total sizes without reading or allocating large files", () => {
    expect(buildPrivateGallerySourcePlan(delivery, [image, { ...zip, bytes: 20 * 1024 ** 3 }]).totalBytes).toBe(20 * 1024 ** 3 + image.bytes);
    expect(() => buildPrivateGallerySourcePlan(delivery, [image, { ...zip, bytes: 20 * 1024 ** 3 + 1 }])).toThrow("INVALID_SIZE");
    const images = Array.from({ length: 999 }, (_, index) => ({ relativePath: `${index}.JPG` }));
    const assets = images.map((item, index) => ({ ...image, relativePath: item.relativePath, bytes: 8 * 1024 ** 2, identity: `1:${index}` }));
    expect(() => buildPrivateGallerySourcePlan({ ...delivery, images }, [...assets, { ...zip, bytes: 20 * 1024 ** 3, identity: "2:1" }])).toThrow("INVALID_SIZE");
  });
});
