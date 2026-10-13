import { describe, expect, it } from "vitest";
import { publicationLocaleCensus, snapshotDocuments, CENSUS_MAX_CATEGORY_DEPTH } from "./publication-locale-census.mts";
import { MAX_CATEGORY_DEPTH } from "../src/lib/content-tree.ts";
const category = { _id: "cat", _rev: "rev-1", _type: "category", categoryId: "landscapes", label: ["fi", "en"].map(language => ({ language, value: "Fixture" })), slug: ["fi", "en"].map(language => ({ language, value: "landscapes" })) };
const article = (language = "fi", _id = "article-fi") => ({ _id, _rev: "rev-1", _type: "article", contentId: "fixture-article", language, canonicalCategory: { _ref: "cat" }, body: "Private authored text" });
const encode = (docs: unknown[]) => Buffer.from(docs.map(d => JSON.stringify(d)).join("\n") + "\n");
const census = (docs: unknown[]) => publicationLocaleCensus(encode(docs), ["fi", "en"]);
describe("revision-bound publication census", () => {
  it("reports published coverage without claiming translation acceptance", () => {
    const result = census([category, article(), article("en", "article-en")]);
    expect(result.hasBlockers).toBe(false); expect(result.translationAcceptanceVerified).toBe(false);
    expect(result.publicationAuthorized).toBe(false); expect(result.rows[0].revision).toBe("rev-1");
    expect(JSON.stringify(result)).not.toContain("Private authored text");
  });
  it("separates copied draft and release content from publication", () => {
    const result = census([category, article(), { ...article("en", "drafts.article-en"), localizedFrom: "fi", localizationReview: { sourceLanguage: "fi", pendingFields: ["body[0].text", "title"], notices: ["Private prose"] } }, article("en", "versions.release.article-en")]);
    expect(result.coverage[0]).toMatchObject({ published: { fi: 1, en: 0 }, drafts: 1, releases: 1 });
    expect(result.rows.find(r => r.state === "draft")).toMatchObject({ pendingFields: 2, blockers: ["EDITOR_REVIEW_PENDING"] });
    expect(JSON.stringify(result)).not.toContain("Private prose");
  });
  it("rejects duplicate identities across different document roots", () => {
    const result = census([category, article(), article("fi", "other"), article("fi", "drafts.article-fi")]);
    expect(result.rows.filter(r => r.type === "article").every(r => r.blockers.includes("DUPLICATE_IDENTITY"))).toBe(true);
  });
  it("allows a normal published/draft version pair", () => {
    expect(census([category, article(), article("en", "article-en"), article("en", "drafts.article-en")]).rows.some(r => r.blockers.includes("DUPLICATE_IDENTITY"))).toBe(false);
  });
  it("binds every canonical category prerequisite to published target-language values", () => {
    for (const cat of [{ ...category, label: category.label.slice(0, 1) }, { ...category, slug: category.slug.slice(0, 1) }, { ...category, _id: "drafts.cat" }, { ...category, label: [...category.label, category.label[1]] }]) {
      expect(census([cat, article(), article("en", "drafts.article-en")]).rows.find(r => r.state === "draft" && r.type === "article")?.blockers.length).toBeGreaterThan(0);
    }
  });
  it.each([null, {}, { pendingFields: "private" }, { pendingFields: [17] }])("refuses malformed review metadata %j", localizationReview => expect(() => census([category, { ...article(), localizationReview }])).toThrow());
  it("reports absent and mismatched review source without clearing it", () => {
    expect(census([category, { ...article(), localizedFrom: "en" }]).rows.find(r => r.type === "article")?.blockers).toContain("REVIEW_STATE_MISSING");
    expect(census([category, { ...article(), localizedFrom: "en", localizationReview: { pendingFields: [], sourceLanguage: "fi" } }]).rows.find(r => r.type === "article")?.blockers).toContain("REVIEW_SOURCE_MISMATCH");
  });
  it("uses serviceId for per-language services", () => expect(census([{ _id: "service-fi", _rev: "r", _type: "service", serviceId: "portraits", language: "fi" }]).coverage[2].missing).toEqual([{ identity: "portraits", language: "en", draftIds: [] }]));
  it("checks ancestor language prerequisites and detects category cycles", () => {
    const parent = { ...category, _id: "parent", categoryId: "parent-category", label: category.label.slice(0, 1) };
    expect(census([parent, { ...category, parent: { _ref: "parent" } }, article("en", "drafts.article-en")]).rows.find(r => r.type === "article")?.blockers).toContain("CATEGORY_LABEL_MISSING");
    expect(census([{ ...category, parent: { _ref: "cat" } }, article()]).rows.find(r => r.type === "article")?.blockers).toContain("CATEGORY_CYCLE_OR_DEPTH");
  });
  it("keeps category depth aligned with the public contract", () => {
    expect(CENSUS_MAX_CATEGORY_DEPTH).toBe(MAX_CATEGORY_DEPTH);
    const categories = Array.from({ length: MAX_CATEGORY_DEPTH + 1 }, (_, i) => ({ ...category, _id: `cat-${i}`, categoryId: `category-${i}`, ...(i < MAX_CATEGORY_DEPTH ? { parent: { _ref: `cat-${i + 1}` } } : {}) }));
    expect(census([...categories, { ...article(), canonicalCategory: { _ref: "cat-0" } }]).rows.find(r => r.type === "article")?.blockers).toContain("CATEGORY_CYCLE_OR_DEPTH");
  });
  it.each([[], ["fi"], ["fi", "fi"], ["fi", "EN"]].map(languages => [languages]))("rejects malformed configured languages %j", languages => expect(() => publicationLocaleCensus(encode([category]), languages)).toThrow());
  it("rejects duplicate IDs, invalid identity, blank/truncated lines and invalid UTF8", () => {
    for (const bytes of [encode([article(), article()]), encode([{ ...article(), contentId: "Invalid" }]), Buffer.from("\n"), Buffer.from("{"), Buffer.from([0xff])]) expect(() => publicationLocaleCensus(bytes, ["fi", "en"])).toThrow();
    expect(() => snapshotDocuments(encode([{ _id: "valid", _type: "other" }]))).toThrow();
  });
  it("records a fresh raw snapshot hash when only a revision changes", () => {
    expect(census([category, article()]).snapshotSha256).not.toBe(census([category, { ...article(), _rev: "rev-2" }]).snapshotSha256);
  });
  it("keeps independently keyed large language families separate", () => {
    const services = Array.from({ length: 1000 }, (_, i) => ({ _id: `service-${i}`, _rev: "r", _type: "service", serviceId: `service-${i}`, language: i % 2 ? "en" : "fi" }));
    expect(census(services).coverage[2]).toMatchObject({ identities: 1000, published: { fi: 500, en: 500 }, drafts: 0 });
    expect(census(services).coverage[2].missing).toHaveLength(1000);
  });
});
