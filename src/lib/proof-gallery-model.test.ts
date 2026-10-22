import { describe, expect, it } from "vitest";
import { ClientGalleryDataError } from "@/lib/client-gallery-model";
import { parsePublishedProofGallery, proofGalleryAvailable } from "@/lib/proof-gallery-model";

const handle = "c".repeat(32);
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const alt = (value: string) => [{ _key: "en", _type: "localizedText", language: "en", value }];
const item = (key: string, n: string, reference: string | undefined, extra: Record<string, unknown> = {}) => ({
  _key: key, _type: "clientProofItem", mediaType: "image", originalFilename: `${key}.jpg`,
  image: { _type: "image", asset: { _type: "reference", _ref: asset(n) } }, ...(reference ? { reference } : {}), ...extra,
});
const published = (extra: Record<string, unknown> = {}) => ({
  _id: "g1", _type: "clientProofGallery", _rev: "rev1", handle, available: true, availabilityMode: "indefinite",
  referenceHighWater: 14, title: [{ _key: "fi", _type: "localizedText", language: "fi", value: "Vedokset" }],
  // Authored order, gaps and leading zeros are all kept as publication fixed them.
  items: [item("b", "2", "014", { alt: alt("Second") }), item("a", "1", "002")],
  ...extra,
});

describe("published proof gallery model", () => {
  it("normalizes the published document in authored order, keeping canonical references", () => {
    const gallery = parsePublishedProofGallery(published(), "g1", handle);
    expect(gallery).toEqual({
      id: "g1", revision: "rev1", handle, available: true,
      title: [{ key: "fi", language: "fi", value: "Vedokset" }],
      items: [
        { key: "b", reference: "014", assetId: asset("2"), hash: "2".repeat(40), width: 1600, height: 1000, extension: "webp", alt: [{ key: "en", language: "en", value: "Second" }] },
        { key: "a", reference: "002", assetId: asset("1"), hash: "1".repeat(40), width: 1600, height: 1000, extension: "webp", alt: [] },
      ],
    });
    expect(JSON.stringify(gallery)).not.toContain(".jpg");
  });

  it("treats omitted and projected-null optional fields alike", () => {
    const projected = published({ expiryInstant: null, title: null, items: published().items.map((entry) => ({ alt: null, ...entry })) });
    const fresh = published({ title: undefined });
    expect(parsePublishedProofGallery(projected, "g1", handle)).toEqual(parsePublishedProofGallery(fresh, "g1", handle));
  });

  it.each([
    ["an unnumbered proof", { items: [item("a", "1", undefined)] }],
    ["a repeated number", { items: [item("a", "1", "002"), item("b", "2", "002")] }],
    ["a number above the high-water mark", { referenceHighWater: 1 }],
    ["a missing high-water mark", { referenceHighWater: null }],
    ["another handle", { handle: "d".repeat(32) }],
    ["a draft identity", { _id: "drafts.g1" }],
    ["an unknown field", { customerEmail: "x@example.com" }],
    ["a cropped image", { items: [item("a", "1", "002", { image: { _type: "image", asset: { _type: "reference", _ref: asset("1") }, crop: { top: 0.1, left: 0, right: 0, bottom: 0 } } })] }],
  ])("refuses %s as malformed content", (_name, patch) => {
    expect(() => parsePublishedProofGallery(published(patch), "g1", handle)).toThrow(ClientGalleryDataError);
  });

  it("enforces availability up to, not at, the deadline", () => {
    const deadline = "2026-11-01T00:00:00.000Z", gallery = parsePublishedProofGallery(published({ availabilityMode: "until", expiryInstant: deadline }), "g1", handle);
    expect(gallery.expiryInstant).toBe(deadline);
    expect(proofGalleryAvailable(gallery, Date.parse(deadline) - 1)).toBe(true);
    expect(proofGalleryAvailable(gallery, Date.parse(deadline))).toBe(false);
    expect(proofGalleryAvailable(parsePublishedProofGallery(published({ available: false }), "g1", handle), 0)).toBe(false);
    expect(() => proofGalleryAvailable(gallery, Number.NaN)).toThrow(ClientGalleryDataError);
  });
});
