import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLegacyGalleryReader, LEGACY_IMAGE_QUERY, LEGACY_QUERY_MAX_RESPONSE_BYTES, LegacyGalleryDataError } from "@/lib/legacy-gallery-sanity";
import { legacyGalleryManifestString, type LegacyManifestImage } from "@/lib/legacy-gallery-manifest";
import { SanityQueryError } from "@/lib/sanity-client";

const handle = "a".repeat(32), batch = "b".repeat(64), galleryId = `legacyDeliveryGallery-${handle}`;
const zipId = `file-${"c".repeat(40)}-zip`;
const deadline = Date.parse("2027-01-07T22:00:00Z");
function fixture(count = 2, archive = true, alt = "Photograph") {
  const manifest: LegacyManifestImage[] = Array.from({ length: count }, (_, position) => ({
    id: position.toString(16).padStart(32, "0"), position, assetId: `image-${"d".repeat(40)}-3000x2000-jpg`,
    width: 3000, height: 2000, bytes: 1000, orientation: 1, alt,
  }));
  const images = manifest.map((i) => ({
    _id: `legacyDeliveryImage-${i.id}`, _type: "legacyDeliveryImage", imageId: i.id,
    migrationBatch: batch, position: i.position, displayWidth: i.width, displayHeight: i.height,
    sourceOrientation: 1, alt: i.alt, galleryId, galleryReferenceType: "reference",
    sourceAssetId: i.assetId, sourceReferenceType: "reference",
    asset: { _id: i.assetId, _type: "sanity.imageAsset", sha1hash: "d".repeat(40), size: i.bytes, mimeType: "image/jpeg" },
  }));
  const zip = archive ? { _id: zipId, _type: "sanity.fileAsset", sha1hash: "c".repeat(40), size: 2_032_617_616, mimeType: "application/zip" } : null;
  const metadata = {
    _id: galleryId, _type: "legacyDeliveryGallery", _rev: "revision-a", handle, migrationBatch: batch,
    published: true, availabilityMode: "until", expiryInstant: "2027-01-07T22:00:00Z", imageCount: count,
    manifestDigest: createHash("sha256").update(legacyGalleryManifestString(galleryId, batch, manifest, zip === null ? null : { assetId: zipId, bytes: zip.size })).digest("hex"),
    ...(archive ? { deliveryZip: { _type: "file", asset: { _type: "reference", _ref: zipId } } } : {}),
  };
  return { metadata, data: { images, zip } };
}
function setup(options: { first?: unknown; last?: unknown; data?: unknown; clock?: () => number } = {}) {
  const f = fixture();
  const read = vi.fn().mockResolvedValueOnce(options.first === undefined ? f.metadata : options.first)
    .mockResolvedValueOnce(options.last === undefined ? f.metadata : options.last);
  const query = vi.fn().mockResolvedValue(options.data === undefined ? f.data : options.data);
  const reader = createLegacyGalleryReader({ config: { projectId: "fixture1", dataset: "production" }, batch, documents: { read }, query: { query }, now: options.clock ?? (() => deadline - 1) });
  return { reader, read, query };
}
describe("legacy delivery read boundary", () => {
  it("serves direct byte-versioned full-frame JPEGs and one whole ZIP after two fresh reads", async () => {
    const { reader, read, query } = setup();
    const value = await reader.read(handle);
    expect(read.mock.calls).toEqual([[galleryId], [galleryId]]);
    expect(query).toHaveBeenCalledWith({ query: LEGACY_IMAGE_QUERY, tag: "legacy.images", params: { galleryId, batch, zipId } });
    expect(value?.images[0]).toEqual({ itemId: "0".repeat(32), mediaId: "0".repeat(32), src: `https://cdn.sanity.io/images/fixture1/production/${"d".repeat(40)}-3000x2000.jpg`, width: 3000, height: 2000, alt: "Photograph" });
    expect(value?.zipUrl).toBe(`https://cdn.sanity.io/files/fixture1/production/${"c".repeat(40)}.zip?dl=photographs.zip`);
    expect(JSON.stringify(value)).not.toMatch(/_rev|migrationBatch|sourceAssetId|sha1hash|manifestDigest/);
  });
  it.each(["bad", "A".repeat(32), "a".repeat(31), "a".repeat(33), "a/../b"])("refuses invalid handle before provider IO: %s", async (input) => {
    const { reader, read, query } = setup(); expect(await reader.read(input)).toBeUndefined(); expect(read).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it.each([null, { ...fixture().metadata, published: false }])("refuses unavailable content before the image query", async (first) => {
    const { reader, query } = setup({ first }); expect(await reader.read(handle)).toBeUndefined(); expect(query).not.toHaveBeenCalled();
  });
  it.each([deadline, deadline + 1])("expires at and after the exclusive Finnish-day boundary", async (now) => {
    const { reader, query } = setup({ clock: () => now }); expect(await reader.read(handle)).toBeUndefined(); expect(query).not.toHaveBeenCalled();
  });
  it("rechecks expiry after image IO", async () => {
    const now = vi.fn().mockReturnValueOnce(deadline - 1).mockReturnValueOnce(deadline);
    expect(await setup({ clock: now }).reader.read(handle)).toBeUndefined();
  });
  it.each([null, { ...fixture().metadata, published: false }, { ...fixture().metadata, _rev: "revision-b" }])("refuses an unpublished/deleted/changed second document", async (last) => {
    expect(await setup({ last }).reader.read(handle)).toBeUndefined();
  });
  it("requires explicit indefinite mode without a deadline", async () => {
    const f = fixture(2, false); const indefinite = { ...f.metadata, availabilityMode: "indefinite", expiryInstant: null };
    const value = await setup({ first: indefinite, last: indefinite, data: f.data, clock: () => deadline + 1000 }).reader.read(handle);
    expect(value?.images).toHaveLength(2); expect(value?.zipUrl).toBeUndefined();
  });
  it.each([
    { migrationBatch: "e".repeat(64) }, { _id: "drafts.other" }, { published: "true" }, { _rev: "bad/rev" },
    { availabilityMode: "indefinite" }, { availabilityMode: "missing", expiryInstant: null }, { expiryInstant: "2027-02-30T00:00:00Z" },
    { expiryInstant: "2027-01-08T00:00:00+02:00" }, { imageCount: 257 }, { imageCount: 0 }, { manifestDigest: "wrong" },
    { displayTitle: "title\nprivate" }, { deliveryZip: { _type: "file", asset: { _type: "reference", _ref: "https://other.test/zip" } } },
  ])("rejects malformed metadata %j", async (change) => {
    const first = { ...fixture().metadata, ...change };
    await expect(setup({ first }).reader.read(handle)).rejects.toBeInstanceOf(LegacyGalleryDataError);
  });
  it.each([
    { sourceOrientation: 6 }, { displayWidth: 2000 }, { displayHeight: 3000 }, { galleryId: "other-gallery" },
    { migrationBatch: "e".repeat(64) }, { sourceReferenceType: "weak" }, { position: 1 }, { alt: "\u0000" },
    { sourceAssetId: `image-${"e".repeat(40)}-3000x2000-jpg` },
  ])("rejects malformed image %j", async (change) => {
    const f = fixture(); Object.assign(f.data.images[0], change);
    await expect(setup({ data: f.data }).reader.read(handle)).rejects.toBeInstanceOf(LegacyGalleryDataError);
  });
  it.each([{ size: 0 }, { mimeType: "image/png" }, { sha1hash: "e".repeat(40) }, { _type: "media" }])("rejects wrong asset metadata %j", async (change) => {
    const f = fixture(); Object.assign(f.data.images[0].asset, change);
    await expect(setup({ data: f.data }).reader.read(handle)).rejects.toBeInstanceOf(LegacyGalleryDataError);
  });
  it("rejects missing, duplicate and incomplete placement results", async () => {
    for (const images of [[], [fixture().data.images[0]], [fixture().data.images[0], fixture().data.images[0]], Array(257).fill(fixture().data.images[0])]) {
      await expect(setup({ data: { images, zip: fixture().data.zip } }).reader.read(handle)).rejects.toBeInstanceOf(LegacyGalleryDataError);
    }
  });
  it("refuses stale independently changed content through the ordered manifest", async () => {
    const f = fixture(); f.data.images[0].alt = "Changed";
    await expect(setup({ data: f.data }).reader.read(handle)).rejects.toBeInstanceOf(LegacyGalleryDataError);
  });
  it.each([null, { ...fixture().data.zip, size: 1 }, { ...fixture().data.zip, mimeType: "text/plain" }])("refuses missing or changed whole ZIP", async (zip) => {
    await expect(setup({ data: { ...fixture().data, zip } }).reader.read(handle)).rejects.toBeInstanceOf(LegacyGalleryDataError);
  });
  it("keeps the maximum bounded projection within the HTTP response ceiling", async () => {
    const f = fixture(256, false, "漢".repeat(400));
    expect(Buffer.byteLength(JSON.stringify({ result: f.data }))).toBeLessThan(LEGACY_QUERY_MAX_RESPONSE_BYTES);
    expect(await setup({ first: f.metadata, last: f.metadata, data: f.data }).reader.read(handle)).toHaveProperty("images.length", 256);
    expect(LEGACY_IMAGE_QUERY).toContain("[0...257]");
  });
  it("preserves typed transport failures without an empty-gallery fallback", async () => {
    const { reader, query } = setup(); const error = new SanityQueryError({ errorClass: "unavailable", retryable: true, correlationId: "fixture" });
    query.mockRejectedValueOnce(error); await expect(reader.read(handle)).rejects.toBe(error);
  });
});
