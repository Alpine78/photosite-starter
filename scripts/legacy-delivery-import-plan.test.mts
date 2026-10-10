import { describe, expect, it } from "vitest";
import { buildLegacyImportPlan, parseLegacySource, type LegacySource } from "./legacy-delivery-import-plan.mts";

const now = Date.parse("2026-10-10T12:00:00Z");
export function fixture(): LegacySource {
  return {
    version: 1, target: { projectId: "synthetic-project", dataset: "production" },
    sourceEvidence: { backupSha256: "a".repeat(64), availabilitySha256: "b".repeat(64),
      orderingSha256: "c".repeat(64), inventorySha256: "d".repeat(64) },
    excludedLegacyIds: [7, 3], galleries: [{ legacyId: 2, handle: "1".repeat(32), legacyPath: "/clients/synthetic",
      availability: { mode: "until", expiryInstant: "2027-01-07T22:00:00Z" },
      images: [
        { sourceLocator: "images/one.jpg", sha1: "1".repeat(40), sha256: "1".repeat(64), bytes: 500, width: 12, height: 8, orientation: 1, alt: "A whole frame" },
        { sourceLocator: "images/two.jpg", sha1: "2".repeat(40), sha256: "2".repeat(64), bytes: 501, width: 8, height: 12, orientation: 1, alt: "" },
      ], zip: { sourceLocator: "packages/one.zip", sha1: "3".repeat(40), sha256: "3".repeat(64), bytes: 2032617616 } }],
  };
}
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

describe("offline legacy review contract", () => {
  it("preserves original image order/size/metadata descriptors, one ZIP and exact deadline", () => {
    const original = fixture(), before = structuredClone(original), plan = buildLegacyImportPlan(original, now);
    expect(original).toEqual(before);
    expect(plan.source.galleries[0]).toEqual(original.galleries[0]);
    expect(plan.source.excludedLegacyIds).toEqual([3, 7]);
    expect(plan.placements[0].images.map((i) => i.position)).toEqual([0, 1]);
    expect(plan.counts).toEqual({ galleries: 1, images: 2, zips: 1, excluded: 2 });
    expect(plan.status).toBe("offline-review-only");
    expect(plan.unresolvedGates).toContain("supported-whole-zip-transfer");
  });
  it("keeps indefinite galleries and absent ZIPs without inventing deadlines/packages", () => {
    const source = JSON.parse(JSON.stringify(fixture()));
    source.galleries[0].availability = { mode: "indefinite" }; source.galleries[0].zip = null;
    const plan = buildLegacyImportPlan(source, now);
    expect(plan.source.galleries[0].availability).toEqual({ mode: "indefinite" });
    expect(plan.source.galleries[0].zip).toBeNull(); expect(plan.counts.zips).toBe(0);
  });
  it("allows repeated source bytes as distinct ordered placements", () => {
    const source = JSON.parse(JSON.stringify(fixture())); source.galleries[0].images.push(source.galleries[0].images[0]);
    const plan = buildLegacyImportPlan(source, now);
    expect(new Set(plan.placements[0].images.map((i) => i.imageId)).size).toBe(3);
  });
  it.each(["2027-01-07T21:59:59.999Z", "2026-12-31T12:00:00Z"])("accepts before the exclusive deadline: %s", (time) => {
    expect(() => buildLegacyImportPlan(fixture(), Date.parse(time))).not.toThrow();
  });
  it.each(["2027-01-07T22:00:00Z", "2027-01-08T00:00:00Z"])("refuses at or after the deadline: %s", (time) => {
    expect(() => buildLegacyImportPlan(fixture(), Date.parse(time))).toThrow("GALLERY_EXPIRED:g0");
  });
  it.each(["2027-02-30T12:00:00Z", "2027-01-07T24:00:00Z", "2027-01-07T22:00:00.000Z", "2027-01-07T22:00:00+00:00"])
    ("refuses noncanonical or impossible deadlines: %s", (expiryInstant) => {
      const source = JSON.parse(JSON.stringify(fixture())); source.galleries[0].availability.expiryInstant = expiryInstant;
      expect(() => buildLegacyImportPlan(source, now)).toThrow();
    });
  it("binds every content-bearing tuple field, while ignoring object key order", () => {
    const baseline = buildLegacyImportPlan(fixture(), now).reviewDigest;
    const changes = [
      (s: Mutable<LegacySource>) => { s.galleries[0].images.reverse(); },
      (s: Mutable<LegacySource>) => { s.galleries[0].images[0].alt = "Different"; },
      (s: Mutable<LegacySource>) => { s.galleries[0].zip = null; },
      (s: Mutable<LegacySource>) => { s.galleries[0].displayTitle = "Delivery"; },
      (s: Mutable<LegacySource>) => { s.galleries[0].availability = { mode: "until", expiryInstant: "2027-01-08T22:00:00Z" }; },
      (s: Mutable<LegacySource>) => { s.galleries[0].legacyPath = "/clients/another"; },
      (s: Mutable<LegacySource>) => { s.sourceEvidence.inventorySha256 = "e".repeat(64); },
      (s: Mutable<LegacySource>) => { s.target.projectId = "other-project"; },
      (s: Mutable<LegacySource>) => { s.excludedLegacyIds.push(100); },
    ];
    for (const edit of changes) { const source = JSON.parse(JSON.stringify(fixture())); edit(source);
      expect(buildLegacyImportPlan(source, now).reviewDigest).not.toBe(baseline); }
    const source = fixture();
    expect(buildLegacyImportPlan(Object.fromEntries(Object.entries(source).reverse()), now).reviewDigest).toBe(baseline);
  });
  it("sorts IDs numerically without reordering images", () => {
    const source = JSON.parse(JSON.stringify(fixture())), other = structuredClone(source.galleries[0]);
    other.legacyId = 10; other.handle = "2".repeat(32); other.legacyPath = "/clients/other";
    source.galleries.unshift(other);
    const first = buildLegacyImportPlan(source, now); source.galleries.reverse(); source.excludedLegacyIds.reverse();
    expect(buildLegacyImportPlan(source, now)).toEqual(first);
    expect(first.source.galleries.map((g) => g.legacyId)).toEqual([2, 10]);
  });
  it.each([null, [], { ...fixture(), approved: true }, { ...fixture(), __proto__: {} }])("refuses open or malformed root inputs", (source) => {
    expect(() => parseLegacySource(source, now)).toThrow();
  });
  it("refuses unknown fields at each nested boundary including prototype-looking keys", () => {
    for (const segment of ["target", "sourceEvidence", "gallery", "availability", "image", "zip"]) {
      const s = JSON.parse(JSON.stringify(fixture()));
      const row = segment === "target" ? s.target : segment === "sourceEvidence" ? s.sourceEvidence :
        segment === "gallery" ? s.galleries[0] : segment === "availability" ? s.galleries[0].availability :
          segment === "image" ? s.galleries[0].images[0] : s.galleries[0].zip;
      Object.defineProperty(row, "__proto__", { enumerable: true, value: "unexpected" });
      expect(() => buildLegacyImportPlan(s, now)).toThrow("OBJECT_FIELDS");
    }
  });
  it.each(["../photo.jpg", "/photo.jpg", "a//b.jpg", "a/./b.jpg", "a/../b.jpg", "a\\b.jpg", "https://example.test/a", "a%2fb.jpg", "a\u0000.jpg", "a\ud800.jpg"])
    ("refuses unsafe source locators without echoing them", (sourceLocator) => {
      const s = JSON.parse(JSON.stringify(fixture())); s.galleries[0].images[0].sourceLocator = sourceLocator;
      expect(() => buildLegacyImportPlan(s, now)).toThrow(/(?:STRING_SHAPE|SOURCE_LOCATOR):i0:g0/);
    });
  it("preserves exact Unicode instead of normalizing a locator", () => {
    const s = JSON.parse(JSON.stringify(fixture())); s.galleries[0].images[0].sourceLocator = "images/cafe\u0301.jpg";
    expect(buildLegacyImportPlan(s, now).source.galleries[0].images[0].sourceLocator).toBe("images/cafe\u0301.jpg");
  });
  it.each(["IMAGES/one.jpg", "images/one.jpg"])("rejects aliases or contradictory source descriptors", (sourceLocator) => {
    const s = JSON.parse(JSON.stringify(fixture())); s.galleries[0].images[1].sourceLocator = sourceLocator;
    expect(() => buildLegacyImportPlan(s, now)).toThrow(/SOURCE_(ALIAS_COLLISION|DESCRIPTOR_CONFLICT)/);
  });
  it("rejects SHA1 descriptor substitution and retained/excluded overlap", () => {
    const s = JSON.parse(JSON.stringify(fixture())); s.galleries[0].images[1].sha1 = s.galleries[0].images[0].sha1;
    expect(() => buildLegacyImportPlan(s, now)).toThrow("SOURCE_DESCRIPTOR_CONFLICT");
    s.galleries[0].images[1].sha1 = "2".repeat(40); s.excludedLegacyIds.push(2);
    expect(() => buildLegacyImportPlan(s, now)).toThrow("GALLERY_IDENTITY_CONFLICT");
  });
  it.each([0, 100000001, Infinity, 1.1])("bounds image byte sizes: %s", (bytes) => {
    const s = JSON.parse(JSON.stringify(fixture())); s.galleries[0].images[0].bytes = bytes;
    expect(() => buildLegacyImportPlan(s, now)).toThrow("INTEGER_RANGE");
  });
  it("bounds aggregate work and refuses unsupported orientation or overlarge pixels", () => {
    const s = JSON.parse(JSON.stringify(fixture()));
    s.galleries[0].images = Array.from({ length: 256 }, () => structuredClone(s.galleries[0].images[0]));
    const row = s.galleries[0]; s.galleries = Array.from({ length: 9 }, (_, i) => ({ ...row, legacyId: 100 + i,
      handle: i.toString(16).padStart(32, "0"), legacyPath: `/clients/synthetic-${i}` }));
    expect(() => buildLegacyImportPlan(s, now)).toThrow("TOTAL_IMAGES_LIMIT");
    for (const image of [{ orientation: 6 }, { width: 32768, height: 32768 }]) {
      const bad = JSON.parse(JSON.stringify(fixture())); Object.assign(bad.galleries[0].images[0], image);
      expect(() => buildLegacyImportPlan(bad, now)).toThrow("IMAGE_METADATA");
    }
    expect(() => buildLegacyImportPlan(fixture(), NaN)).toThrow("CLOCK_INVALID");
  });
});
