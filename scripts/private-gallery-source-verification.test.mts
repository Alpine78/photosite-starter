import { describe, expect, it } from "vitest";
import { buildPrivateGallerySourcePlan } from "./private-gallery-source-plan.mts";
import { validateSavedPrivateSourcePlan, PRIVATE_SOURCE_MAX_PLAN_BYTES } from "./private-gallery-source-verification.mts";

function fixture() {
  return buildPrivateGallerySourcePlan({ mode: "proof", externallyWatermarked: true,
    images: [{ relativePath: "IMG_0001.JPG", mediaId: "media-1" }] }, [
    { relativePath: "IMG_0001.JPG", bytes: 1000, sha256: "a".repeat(64), identity: "1:2",
      format: "jpeg", width: 1200, height: 800, hasExif: true, hasIcc: false },
  ]);
}
describe("saved private source report validation", () => {
  it("reconstructs the entire pinned report without retaining caller-owned objects", () => {
    const report = fixture();
    const result = validateSavedPrivateSourcePlan(report, report.digest);
    expect(result.plan).toEqual(report);
    expect(result.plan).not.toBe(report);
    expect(result.input).toEqual({ mode: "proof", externallyWatermarked: true, images: [{ relativePath: "IMG_0001.JPG", mediaId: "media-1" }] });
    report.localAssets[0].relativePath = "changed.JPG";
    expect(result.plan.localAssets[0].relativePath).toBe("IMG_0001.JPG");
  });
  it("pins the selected digest separately from the report's self-checksum", () => {
    const report = fixture();
    expect(() => validateSavedPrivateSourcePlan(report, "b".repeat(64))).toThrow("PLAN_DIGEST_MISMATCH");
    for (const pin of ["", "A".repeat(64), "a".repeat(63)]) expect(() => validateSavedPrivateSourcePlan(report, pin)).toThrow("INVALID_ARGUMENTS");
  });
  it.each([
    (p: Record<string, unknown>) => { p.version = 2; },
    (p: Record<string, unknown>) => { p.extra = "unknown"; },
    (p: Record<string, unknown>) => { p.mode = "other"; },
    (p: Record<string, unknown>) => { p.totalBytes = 999; },
    (p: Record<string, unknown>) => { p.digest = "b".repeat(64); },
    (p: Record<string, unknown>) => { p.checks = { watermarks: "detected-and-safe" }; },
    (p: Record<string, unknown>) => { p.manifest = []; },
    (p: Record<string, unknown>) => { p.localAssets = []; },
  ])("refuses altered top-level contract %#", (change) => {
    const report = fixture(); change(report);
    expect(() => validateSavedPrivateSourcePlan(report, report.digest)).toThrow("INVALID_PLAN");
  });
  it.each([
    ["manifest", "filename", "different.JPG"], ["manifest", "mediaId", ""],
    ["manifest", "derivativeKind", "delivery-preview"], ["manifest", "nominalBytes", 900],
    ["manifest", "width", 2049], ["manifest", "extra", "unknown"],
    ["localAssets", "relativePath", "../escape.JPG"], ["localAssets", "sha256", "bad"],
    ["localAssets", "bytes", Number.MAX_SAFE_INTEGER + 1], ["localAssets", "hasExif", "false"],
    ["localAssets", "extra", "unknown"],
  ] as const)("refuses altered %s.%s", (part, key, value) => {
    const report = fixture();
    Object.assign(report[part][0], { [key]: value });
    expect(() => validateSavedPrivateSourcePlan(report, report.digest)).toThrow("INVALID_PLAN");
  });
  it("accepts delivery previews plus exactly one final ZIP, never ZIP integrity claims", () => {
    const report = buildPrivateGallerySourcePlan({ mode: "delivery", images: [{ relativePath: "preview.JPG" }], zipPath: "delivery.zip" }, [
      { relativePath: "preview.JPG", bytes: 100, sha256: "a".repeat(64), identity: "1:1", format: "jpeg", width: 100, height: 50 },
      { relativePath: "delivery.zip", bytes: 200, sha256: "b".repeat(64), identity: "1:2" },
    ]);
    expect(validateSavedPrivateSourcePlan(report, report.digest).input.zipPath).toBe("delivery.zip");
    report.manifest.reverse(); report.localAssets.reverse();
    expect(() => validateSavedPrivateSourcePlan(report, report.digest)).toThrow("INVALID_PLAN");
  });
  it("bounds a maximal model report with JSON-escaped paths, filenames and media IDs", () => {
    const images = Array.from({ length: 1000 }, (_, index) => ({
      relativePath: ['"'.repeat(255), '"'.repeat(255), '"'.repeat(255), "x",
        String(index).padStart(4, "0") + '"'.repeat(246) + ".JPG"].join("/"),
      mediaId: '"'.repeat(124) + String(index).padStart(4, "0"),
    }));
    expect(Buffer.byteLength(images[0].relativePath)).toBe(1024);
    const report = buildPrivateGallerySourcePlan({ mode: "proof", externallyWatermarked: true, images }, images.map((image, index) => ({
      relativePath: image.relativePath, bytes: 1, sha256: "a".repeat(64), identity: `1:${index}`, format: "jpeg", width: 1, height: 1,
    })));
    expect(Buffer.byteLength(JSON.stringify(report, null, 2) + "\n")).toBeLessThan(PRIVATE_SOURCE_MAX_PLAN_BYTES);
    expect(validateSavedPrivateSourcePlan(report, report.digest).plan.manifest).toHaveLength(1000);
    report.manifest.push(report.manifest[0]); report.localAssets.push(report.localAssets[0]);
    expect(() => validateSavedPrivateSourcePlan(report, report.digest)).toThrow("INVALID_PLAN");
  });
});
