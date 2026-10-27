import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyClientGalleryExpiry, planClientGalleryCleanup, RETENTION_MAX_REFERRERS } from "./client-gallery-retention";
import { clientGalleryAvailable, parseClientGallery } from "./client-gallery-model";

const image = `image-${"a".repeat(40)}-1600x1000-webp`, secondImage = `image-${"b".repeat(40)}-1000x1600-webp`;
const zip = `file-${"c".repeat(40)}-zip`, id = "delivery", revision = "r1";
const deadline = "2026-10-24T12:34:56.789Z", now = Date.parse(deadline), handle = "d".repeat(32);
const ref = (_ref: string) => ({ _type: "reference", _ref });
function gallery() {
  return { _id: id, _type: "clientDeliveryGallery", _rev: revision, handle,
    title: [{ _key: "en", _type: "localizedText", language: "en", value: "sensitive-title-canary" }],
    available: true, availabilityMode: "until", expiryInstant: deadline,
    items: [{ _key: "one", _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: ref(image) },
      alt: [{ _key: "en", _type: "localizedText", language: "en", value: "sensitive-alt-canary" }] }] };
}
function asset(assetId = image, referrers = [{ id, revision }]) {
  return { id: assetId, revision: "asset-r1", type: assetId.startsWith("file-") ? "sanity.fileAsset" : "sanity.imageAsset",
    complete: true, referenceCount: referrers.length, referrers };
}
function setup() {
  return { gallery: gallery(), enrollment: { galleryId: id, revision }, now,
    evidence: { galleryId: id, revision, variants: { complete: true, ids: [id] }, assetsComplete: true, assets: [asset()] } };
}
afterEach(() => vi.unstubAllGlobals());

describe("expiry classification before evidence reads", () => {
  it("shares the real reader's exclusive deadline, including milliseconds", () => {
    const input = setup(), parsed = parseClientGallery(input.gallery, id, handle);
    for (const offset of [-1, 0, 1]) {
      const at = now + offset;
      expect(classifyClientGalleryExpiry(input.gallery, input.enrollment, at).state).toBe(offset < 0 ? "skipped" : "eligible");
      expect(clientGalleryAvailable(parsed, at)).toBe(offset < 0);
    }
    input.gallery.expiryInstant = "2026-10-24T12:34:56Z";
    expect(classifyClientGalleryExpiry(input.gallery, input.enrollment, now)).toMatchObject({ state: "eligible" });
  });
  it("an expired paused page still qualifies; indefinite and future pages do not", () => {
    const input = setup(); input.gallery.available = false;
    expect(planClientGalleryCleanup(input).state).toBe("candidate");
    expect(classifyClientGalleryExpiry(input.gallery, input.enrollment, now - 1)).toMatchObject({ state: "skipped", reason: "not-expired" });
    const { expiryInstant: unused, ...indefinite } = { ...input.gallery, availabilityMode: "indefinite" }; void unused;
    expect(classifyClientGalleryExpiry(indefinite, input.enrollment, now)).toMatchObject({ state: "skipped", reason: "indefinite" });
    expect(classifyClientGalleryExpiry({ ...indefinite, expiryInstant: deadline }, input.enrollment, now)).toMatchObject({ state: "blocked", reason: "invalid-gallery" });
  });
  it("skips unenrolled deliveries before reading malformed fields or evidence", () => {
    const input = setup();
    expect(planClientGalleryCleanup({ ...input, enrollment: null, gallery: { _id: id, _type: "clientDeliveryGallery", _rev: revision }, evidence: null }))
      .toEqual({ state: "skipped", reason: "not-enrolled", readyToDelete: false, readyToWrite: false });
  });
  it.each(["clientProofGallery", "legacyDeliveryGallery", "article"])("excludes %s regardless of enrollment", type => {
    const input = setup(); expect(planClientGalleryCleanup({ ...input, gallery: { ...input.gallery, _type: type } })).toMatchObject({ state: "blocked", reason: "unsupported-type" });
  });
  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1])("refuses invalid now %s", at => {
    const input = setup(); expect(planClientGalleryCleanup({ ...input, now: at })).toMatchObject({ reason: "invalid-clock" });
  });
  it.each(["2026-02-30T00:00:00Z", "2026-10-24", "2026-10-24T12:34:56+00:00", "bad", "2026-10-24T12:34:56Z\n"])("blocks malformed deadline %j", expiryInstant => {
    const input = setup(); expect(planClientGalleryCleanup({ ...input, gallery: { ...input.gallery, expiryInstant } })).toMatchObject({ state: "blocked", reason: "invalid-gallery" });
  });
  it("a revision mismatch requests re-planning rather than silently losing enrollment", () => {
    const input = setup();
    for (const enrollment of [{ galleryId: id, revision: "r2" }, { galleryId: "another", revision }, {}, "yes", { ...input.enrollment, extra: true }])
      expect(planClientGalleryCleanup({ ...input, enrollment })).toMatchObject({ state: "blocked", reason: "enrollment-changed" });
  });
});

describe("candidate evidence, not deletion authority", () => {
  it("returns only deterministic revision-bound identities, counts and owned locations without IO", () => {
    const network = vi.fn(() => { throw new Error("no network"); }); vi.stubGlobal("fetch", network);
    const input = setup(), before = structuredClone(input), result = planClientGalleryCleanup(input);
    expect(result).toEqual({ state: "candidate", readyToDelete: false, readyToWrite: false,
      gallery: { id, revision }, deadline, references: [{ kind: "image", itemKey: "one", assetId: image }],
      candidates: [{ id: image, revision: "asset-r1", type: "sanity.imageAsset" }], shared: [],
      counts: { images: 1, zip: 0, assets: 1, candidates: 1, shared: 0 } });
    expect(input).toEqual(before); expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/sensitive-|dddddddd|https:|mutations|token/);
  });
  it.each(["portfolio", "proof", "drafts.delivery", "versions.release.delivery"])("keeps an asset referenced by %s", other => {
    const input = setup(); input.evidence.assets = [asset(image, [{ id, revision }, { id: other, revision: "other-r1" }])];
    expect(planClientGalleryCleanup(input)).toMatchObject({ state: "candidate", candidates: [], shared: [{ id: image }], counts: { shared: 1 } });
  });
  it("deduplicates repeated own uses without treating them as shared, and keeps every owned location", () => {
    const input = setup(); input.gallery.items.push({ ...input.gallery.items[0], _key: "two" });
    expect(planClientGalleryCleanup(input)).toMatchObject({ state: "candidate", references: [{ itemKey: "one" }, { itemKey: "two" }], counts: { images: 2, assets: 1, candidates: 1 } });
  });
  it("plans the gallery's actual whole ZIP and preserves a shared ZIP", () => {
    const input = setup(); input.evidence.assets.push(asset(zip, [{ id, revision }, { id: "another-gallery", revision: "r2" }]));
    const zipReference = { _type: "file", asset: ref(zip) };
    const withZip = { ...input, gallery: { ...input.gallery, deliveryZip: zipReference } };
    expect(planClientGalleryCleanup(withZip)).toMatchObject({ state: "candidate", counts: { zip: 1, assets: 2, shared: 1 }, shared: [{ id: zip }],
      references: [{ kind: "image" }, { kind: "zip", assetId: zip }] });
    input.evidence.assets[1] = asset(zip);
    expect(planClientGalleryCleanup({ ...withZip, zipReference })).toMatchObject({ counts: { candidates: 2 } });
    expect(planClientGalleryCleanup({ ...input, zipReference })).toMatchObject({ reason: "invalid-zip" });
    expect(planClientGalleryCleanup({ ...withZip, zipReference: { _type: "file", asset: ref(`file-${"d".repeat(40)}-zip`) } })).toMatchObject({ reason: "invalid-zip" });
  });
  it.each([null, [], { _type: "file", asset: ref(image) }, { _type: "file", asset: ref(zip + "\n") },
    { _type: "file", asset: { ...ref(zip), _weak: true } }, { _type: "file", asset: { ...ref(zip), _dataset: "other" } },
    { _type: "file", asset: ref(zip), url: "sensitive-url-canary" }])("blocks malformed or partial ZIP input %#", zipReference => {
    expect(planClientGalleryCleanup({ ...setup(), zipReference })).toMatchObject({ state: "blocked", reason: "invalid-zip" });
  });
  it("requires complete variants and refuses drafts/releases of the selected gallery", () => {
    for (const variants of [{ complete: false, ids: [id] }, { complete: true, ids: [] }, { complete: true, ids: [id, "drafts.delivery"] },
      { complete: true, ids: [id, "versions.release.delivery"] }, { complete: true, ids: ["another"] }]) {
      const input = setup(); expect(planClientGalleryCleanup({ ...input, evidence: { ...input.evidence, variants } }).state).toBe("blocked");
    }
  });
  it("rejects missing, stale, incomplete and excessive evidence", () => {
    const input = setup();
    for (const evidence of [null, {}, { ...input.evidence, assetsComplete: false }, { ...input.evidence, revision: "r2" },
      { ...input.evidence, galleryId: "another" }, { ...input.evidence, assets: [] }, { ...input.evidence, assets: [asset(), asset()] },
      { ...input.evidence, assets: Array.from({ length: 258 }, () => asset()) }, { ...input.evidence, assets: [asset(zip)] }])
      expect(planClientGalleryCleanup({ ...input, evidence }).state).toBe("blocked");
  });
  it("bounds referrer evidence and never accepts a truncated or contradictory list", () => {
    const input = setup(), many = Array.from({ length: RETENTION_MAX_REFERRERS }, (_, i) => ({ id: `other-${i}`, revision }));
    for (const item of [
      { ...asset(), complete: false }, { ...asset(), referenceCount: 2 }, { ...asset(), revision: "bad revision" },
      { ...asset(), type: "sanity.fileAsset" }, asset(image, []), asset(image, [{ id, revision: "r2" }]),
      asset(image, [{ id, revision }, { id, revision }]), asset(image, many), asset(image, [{ id: "x\n", revision }]),
    ]) expect(planClientGalleryCleanup({ ...input, evidence: { ...input.evidence, assets: [item] } }).state).toBe("blocked");
  });
  it("sorts candidate identities independent of asset evidence order", () => {
    const input = setup(); input.gallery.items.push({ ...input.gallery.items[0], _key: "two", image: { _type: "image", asset: ref(secondImage) } });
    input.evidence.assets.push(asset(secondImage));
    const result = planClientGalleryCleanup(input); input.evidence.assets.reverse();
    expect(planClientGalleryCleanup(input)).toEqual(result);
  });
  it("accepts self plus 98 other uses but rejects a full 100-entry referrer list even with self present", () => {
    const input = setup();
    const others = Array.from({ length: RETENTION_MAX_REFERRERS - 2 }, (_, i) => ({ id: `other-${i}`, revision }));
    input.evidence.assets = [asset(image, [{ id, revision }, ...others])];
    expect(planClientGalleryCleanup(input)).toMatchObject({ state: "candidate", counts: { shared: 1, candidates: 0 } });
    input.evidence.assets = [asset(image, [{ id, revision }, ...others, { id: "last-use", revision }])];
    expect(planClientGalleryCleanup(input)).toMatchObject({ state: "blocked", reason: "invalid-assets" });
  });
  it("admits the full supported gallery of 256 distinct images and one intact ZIP", () => {
    const input = setup(), template = input.gallery.items[0];
    input.gallery.items = Array.from({ length: 256 }, (_, index) => ({
      ...template, _key: `item-${index}`, image: { _type: "image", asset: ref(`image-${index.toString(16).padStart(40, "0")}-1600x1000-webp`) },
    }));
    input.evidence.assets = [...input.gallery.items.map(item => asset(item.image.asset._ref)), asset(zip)];
    expect(planClientGalleryCleanup({ ...input, gallery: { ...input.gallery, deliveryZip: { _type: "file", asset: ref(zip) } } })).toMatchObject({
      state: "candidate", readyToDelete: false, counts: { images: 256, zip: 1, assets: 257, candidates: 257, shared: 0 },
    });
  });
  it("blocks malformed references, excessive galleries, non-plain objects, holes and unknown asset paths", () => {
    const input = setup(), hole = new Array(1);
    for (const bad of [new Date(), [], { ...input.gallery, unexpected: { asset: ref(secondImage) } },
      { ...input.gallery, items: hole }, { ...input.gallery, items: Array.from({ length: 257 }, () => input.gallery.items[0]) },
      { ...input.gallery, items: [{ ...input.gallery.items[0], image: { _type: "image", asset: { ...ref(image), _weak: true } } }] }])
      expect(planClientGalleryCleanup({ ...input, gallery: bad }).state).toBe("blocked");
    expect(planClientGalleryCleanup({ ...input, evidence: new Map() }).state).toBe("blocked");
    expect(planClientGalleryCleanup({ ...input, evidence: { ...input.evidence, assets: hole } }).state).toBe("blocked");
    const accessors = Object.defineProperty({}, "galleryId", { get: () => { throw Error("must not execute"); }, enumerable: true });
    expect(planClientGalleryCleanup({ ...input, evidence: accessors }).state).toBe("blocked");
  });
});
