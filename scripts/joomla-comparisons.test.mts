import { describe, expect, it } from "vitest";
import { resolveLegacyComparison, MAX_COMPARISON_LABEL_LENGTH, MAX_COMPARISON_TITLE_LENGTH } from "./joomla-comparisons.mts";
import { MAX_COMPARISON_LABEL_LENGTH as SCHEMA_LABEL, MAX_COMPARISON_TITLE_LENGTH as SCHEMA_TITLE } from "../sanity/schemas/content-block";
import { convertJoomlaBody, resolvedConversionDigest, CONVERSION_POLICY_VERSION } from "./joomla-html-conversion.mts";
import { buildImportPlan, validateMigrationDocuments, writablePlanDigest } from "./joomla-import-plan.mts";
import { validatePlanContract } from "./write-joomla-content.mts";

const source = "<p>Before {loadmodule mod_aikon_awesome_compare,Synthetic module} After</p>";
const moduleConfig = { img1: "first.jpg", img2: "second.jpg", labels: { fi: { first: "Original", second: "Adjusted" } }, title: { fi: "Exposure comparison" } };
const image = (src: string) => ({ mediaId: src === "first.jpg" ? "first-image" : "second-image", alt: `Description of ${src}`, contentHash: (src === "first.jpg" ? "a" : "b").repeat(64) });
const context = { language: "fi", resolveImage: image, resolveGallery: () => undefined, resolveComparison: () => resolveLegacyComparison(moduleConfig, "fi") };
const conversion = () => convertJoomlaBody(source, context);

function plan() {
  const result = conversion();
  const sourceDigest = "c".repeat(64);
  return buildImportPlan({ phase: "launch", manifestDigest: "d".repeat(64), sourceExportDigest: "e".repeat(64), knownCategoryIds: ["blog"], sourceLocators: { "first-image": "first.jpg", "second-image": "second.jpg" }, articles: [{ title: "Synthetic article", sourceDigest, conversion: result, approval: { sourceId: "1", language: "fi", contentId: "synthetic", slug: "synthetic", canonicalAtStoryRoot: false, canonicalCategory: "blog", secondaryCategories: [], phase: "launch", publishedAt: "2020-01-01T00:00:00Z", sourceDigest, resolvedDigest: resolvedConversionDigest(result), conversionPolicy: CONVERSION_POLICY_VERSION, acknowledgedFindings: [], approvedBy: "test", approvedAt: "2026-09-18" } }] });
}

describe("legacy comparison conversion", () => {
  it("pins the Studio's bounds", () => {
    expect(MAX_COMPARISON_LABEL_LENGTH).toBe(SCHEMA_LABEL);
    expect(MAX_COMPARISON_TITLE_LENGTH).toBe(SCHEMA_TITLE);
  });
  it("preserves both placements and labels at the authored position", () => {
    const result = conversion();
    expect(result.convertible).toBe(true);
    expect(result.blocks.map((block) => block._type)).toEqual(["contentParagraphBlock", "contentImageComparisonBlock", "contentParagraphBlock"]);
    expect(result.blocks[1]).toMatchObject({ first: "first-image", second: "second-image", firstLabel: "Original", secondLabel: "Adjusted", title: "Exposure comparison" });
    expect(result.resolvedImageAltText).toHaveLength(2);
    expect(result.resolvedImageContentHashes).toHaveLength(2);
  });
  it("refuses unknown modules, missing images, and missing descriptive text", () => {
    expect(convertJoomlaBody(source, { ...context, resolveComparison: () => undefined }).convertible).toBe(false);
    expect(convertJoomlaBody(source.replace("mod_aikon_awesome_compare", "mod_other"), context).convertible).toBe(false);
    expect(convertJoomlaBody(source, { ...context, resolveImage: () => undefined }).convertible).toBe(false);
    expect(convertJoomlaBody(source, { ...context, resolveImage: (src) => ({ ...image(src), alt: " " }) }).convertible).toBe(false);
  });
  it("requires explicitly authored labels in this language, including unlabeled legacy pairs", () => {
    for (const value of [null, {}, { ...moduleConfig, labels: {} }, { ...moduleConfig, labels: { fi: { first: "", second: "B" } } }, { ...moduleConfig, img2: 7 }, { ...moduleConfig, labels: { fi: { first: "A".repeat(201), second: "B" } } }, { ...moduleConfig, title: { fi: "A".repeat(121) } }]) expect(resolveLegacyComparison(value, "fi")).toBeUndefined();
    expect(resolveLegacyComparison(moduleConfig, "en")).toBeUndefined();
  });
  it("binds conversion approval to each side's identity, label and bytes", () => {
    const baseline = resolvedConversionDigest(conversion());
    for (const side of ["first", "second"] as const) {
      const pair = context.resolveComparison()!;
      const changed = convertJoomlaBody(source, { ...context, resolveComparison: () => ({ ...pair, [side]: { ...pair[side], label: "Changed" } }) });
      expect(resolvedConversionDigest(changed)).not.toBe(baseline);
    }
    expect(resolvedConversionDigest(convertJoomlaBody(source, { ...context, resolveImage: (src) => ({ ...image(src), mediaId: `changed-${image(src).mediaId}` }) }))).not.toBe(baseline);
    expect(resolvedConversionDigest(convertJoomlaBody(source, { ...context, resolveImage: (src) => ({ ...image(src), contentHash: "f".repeat(64) }) }))).not.toBe(baseline);
  });
  it("carries both images into asset requirements and validates the writer contract", () => {
    const result = plan();
    expect(result.errors).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.assetRequirements.map((entry) => entry.mediaId).sort()).toEqual(["first-image", "second-image"]);
    expect(validatePlanContract(result).issues).toEqual([]);
    const article = result.documents.find((document) => document._type === "article")!;
    expect((article.body as Record<string, unknown>[])[1]).toMatchObject({ first: { _type: "reference", _ref: "migrated--media-first-image" }, second: { _type: "reference", _ref: "migrated--media-second-image" } });
    expect(writablePlanDigest(result.documents, result.assetRequirements, result.errors, result.blocked)).toBe(result.documentsDigest);
  });
  it.each(["first", "second"] as const)("rejects invalid %s references and private fields in a modified plan", (side) => {
    for (const changed of [{ [side]: undefined }, { [side]: { _type: "reference", _ref: "missing-medium" } }, { [side]: { _type: "reference", _ref: "migrated-pending-asset:first-image" } }, { [`${side}Label`]: " " }, { archiveLocator: "private" }]) {
      const result = plan();
      const documents = result.documents.map((doc) => doc._type === "article" ? { ...doc, body: (doc.body as Record<string, unknown>[]).map((block) => block._type === "contentImageComparisonBlock" ? { ...block, ...changed } : block) } : doc);
      expect([...validatePlanContract({ ...result, documents }).issues, ...validateMigrationDocuments(documents)].length).toBeGreaterThan(0);
    }
    const result = plan();
    const documents = result.documents.map((doc) => doc._type === "media" ? { ...doc, publiclyRenderable: false } : doc);
    expect(validateMigrationDocuments(documents)).not.toEqual([]);
  });
});

it("wires module resolution and verified image hashes through the offline converter CLI", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(path.join(tmpdir(), "comparison-cli-"));
  try {
    const images: Record<string, { locator: string; sha256: string }> = {};
    for (const src of ["first.jpg", "second.jpg"]) {
      const bytes = Buffer.from(`synthetic bytes for ${src}`);
      await writeFile(path.join(root, src), bytes);
      images[src] = { locator: src, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    await writeFile(path.join(root, "source.ndjson"), JSON.stringify({ joomlaId: "1", language: "fi", title: "Synthetic", body: source }));
    await writeFile(path.join(root, "resolution.json"), JSON.stringify({ images, altText: { "first.jpg": { fi: "Original exposure" }, "second.jpg": { fi: "Adjusted exposure" } }, comparisonModules: { "Synthetic module": moduleConfig } }));
    await promisify(execFile)("node", [path.join(import.meta.dirname, "convert-joomla-content.mts"), "--source", path.join(root, "source.ndjson"), "--resolution", path.join(root, "resolution.json"), "--image-root", root, "--out", path.join(root, "out")]);
    const findings = JSON.parse(await readFile(path.join(root, "out", "findings.json"), "utf8"));
    expect(findings[0].convertible).toBe(true);
    expect(findings[0].blocks[1]).toMatchObject({ _type: "contentImageComparisonBlock", firstLabel: "Original", secondLabel: "Adjusted" });
    expect(findings[0].resolvedImageAltText).toHaveLength(2);
    const baselineDigest = findings[0].resolvedDigest;
    const changedBytes = Buffer.from("changed second image");
    await writeFile(path.join(root, "second.jpg"), changedBytes);
    const { stdout } = await promisify(execFile)("node", [path.join(import.meta.dirname, "convert-joomla-content.mts"), "--source", path.join(root, "source.ndjson"), "--resolution", path.join(root, "resolution.json"), "--image-root", root, "--out", path.join(root, "out")]);
    expect(stdout).not.toContain("Synthetic module");
    const changed = JSON.parse(await readFile(path.join(root, "out", "findings.json"), "utf8"));
    expect(changed[0].convertible).toBe(false);
    expect(changed[0].resolvedDigest).not.toBe(baselineDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
