import { describe, expect, it, vi } from "vitest";
import { articleType } from "./article";
import { articleEndGalleryPlacementType } from "./article-end-gallery-placement";
import { inspectValidationRules } from "./validation-test-helper";
import { readArticleEndSectionCatalog, validateArticleEndSections, validateArticleEndMembership } from "./article-end-sections";
import type { SchemaValidationContext } from "./schema-types";

const section = { _key: "key-one", sectionId: "one", slug: "first", label: "First" };
const catalog = { contentId: "story", endGalleryId: "ending", endGallerySectionHeading: "Groups", endGallerySections: [section] };
const article = { ...catalog, _id: "drafts.article", language: "fi" };
const empty = { published: null, dangling: null, catalogConflict: null, membershipConflict: null };
const placement = { _id: "drafts.placement", placementId: "photo-one", article: { _ref: "article" }, sectionId: "one" };
function fixture(answers: unknown[], document: Record<string, unknown> = article) {
  const fetch = vi.fn(async () => { const result = answers.shift(); if (result instanceof Error) throw result; return result; });
  const withConfig = vi.fn();
  const client = { fetch, withConfig: (options: unknown) => { withConfig(options); return client; } };
  const context = { document, getClient: () => client } as unknown as SchemaValidationContext;
  return { context, fetch, withConfig };
}

describe("actual article and placement schema guards", () => {
  it("reuses three generic section fields, exposes no intro/hidden condition and wires publication checks", async () => {
    const field = articleType.fields.find((x) => x.name === "endGallerySections")!;
    expect(field.of?.[0]?.fields?.map((x) => x.name)).toEqual(["sectionId", "slug", "label"]);
    expect(inspectValidationRules(field.validation).max).toBe(20);
    expect(field).not.toHaveProperty("hidden");
    expect(articleType.fields.some((x) => x.name === "endGallerySectionHeading")).toBe(true);
    expect(articleEndGalleryPlacementType.fields.some((x) => x.name === "sectionId")).toBe(true);
    const f = fixture([empty]);
    await expect(inspectValidationRules(articleType.validation).checks[1]?.(article, f.context)).resolves.toBe(true);
    expect(f.withConfig).toHaveBeenCalledWith({ perspective: "published", useCdn: false });
    const member = fixture([catalog, { article: catalog, conflict: null, catalogConflict: null }], placement);
    await expect(inspectValidationRules(articleEndGalleryPlacementType.validation).checks[1]?.(placement, member.context)).resolves.toBe(true);
  });
  it.each([{ ...section, _key: undefined }, { ...section, intro: [] }])("rejects invalid authoring-only metadata: %j", (row) => {
    expect(() => readArticleEndSectionCatalog({ ...catalog, endGallerySections: [row] })).toThrow();
  });
  it("rejects repeated array keys even when identities differ", () => {
    expect(() => readArticleEndSectionCatalog({ ...catalog, endGallerySections: [section, { ...section, sectionId: "two", slug: "second" }] })).toThrow();
  });
  it.each([
    { ...section, sectionId: "renamed" }, { ...section, slug: "renamed" },
  ])("rejects published in-place identity or slug changes: %j", async (row) => {
    const doc = { ...article, endGallerySections: [row] }, f = fixture([{ ...empty, published: catalog }], doc);
    expect(await validateArticleEndSections(doc, f.context)).toContain("cannot be changed");
  });
  it("permits new sections/removal only when no published placement depends on old ones", async () => {
    const doc = { ...article, endGallerySections: [], endGallerySectionHeading: undefined };
    expect(await validateArticleEndSections(doc, fixture([{ ...empty, published: catalog }], doc).context)).toBe(true);
    const blocked = fixture([{ ...empty, published: catalog, dangling: { _id: "hidden-placement" } }], doc);
    expect(await validateArticleEndSections(doc, blocked.context)).toContain("including hidden");
    expect(blocked.fetch.mock.calls[0]).toBeDefined();
  });
  it.each(["catalogConflict", "membershipConflict"])('refuses translated catalog/membership conflict witness %s', async (field) => {
    expect(await validateArticleEndSections(article, fixture([{ ...empty, [field]: { _id: "conflict" } }]).context)).not.toBe(true);
  });
  it.each([undefined, [], {}, { _id: 1 }, { message: "secret" }])("fails closed on malformed consistency answers: %j", async (answer) => {
    expect(await validateArticleEndSections(article, fixture([answer]).context)).toContain("could not be completed");
  });
  it.each(["dangling", "catalogConflict", "membershipConflict"])('validates every witness shape %s', async (field) => {
    expect(await validateArticleEndSections(article, fixture([{ ...empty, [field]: [] }]).context)).toContain("could not be completed");
  });
  it("does not disclose failed fetch details", async () => {
    expect(await validateArticleEndSections(article, fixture([new Error("credential-secret")]).context)).toBe("The published section consistency check could not be completed. Retry before publishing.");
  });
  it("does not trust a malformed published snapshot", async () => {
    expect(await validateArticleEndSections(article, fixture([{ ...empty, published: { ...catalog, endGallerySections: [{}] } }]).context)).toContain("could not be completed");
  });
});

describe("published placement membership", () => {
  it.each([null, { ...catalog, endGallerySections: undefined, endGallerySectionHeading: undefined }])("refuses a missing/draft-only or undeclared catalog: %j", async (own) => {
    expect(await validateArticleEndMembership(placement, fixture([own], placement).context)).not.toBe(true);
  });
  it("preserves the no-catalog locale exemption for unassigned placements", async () => {
    const doc = { ...placement, sectionId: undefined }, f = fixture([{ contentId: "story", endGalleryId: "ending" }], doc);
    expect(await validateArticleEndMembership(doc, f.context)).toBe(true);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["one", undefined])("compares both assigned and unassigned membership when catalogued: %j", async (sectionId) => {
    const doc = { ...placement, sectionId };
    expect(await validateArticleEndMembership(doc, fixture([catalog, { article: catalog, conflict: { _id: "peer" }, catalogConflict: null }], doc).context)).toContain("matching sections");
  });
  it.each(["", "unknown", "Bad ID", 1])("refuses invalid or unknown membership: %j", async (sectionId) => {
    const doc = { ...placement, sectionId };
    expect(await validateArticleEndMembership(doc, fixture([catalog], doc).context)).not.toBe(true);
  });
  it.each([null, [], { conflict: [] }, { article: catalog, conflict: [] }, { article: { ...catalog, contentId: "other" }, conflict: null }])("fails closed on malformed/changed second answers: %j", async (answer) => {
    expect(await validateArticleEndMembership(placement, fixture([catalog, answer], placement).context)).toContain("could not be completed");
  });
});
