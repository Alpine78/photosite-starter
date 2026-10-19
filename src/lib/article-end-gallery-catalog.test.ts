import { describe, expect, it } from "vitest";
import { projectArticleEndGalleryCatalog, MAX_ARTICLE_END_SECTION_HEADING_LENGTH } from "./article-end-gallery-catalog";
import { assertGallerySections, MAX_GALLERY_SECTIONS, MAX_SECTION_ID_LENGTH } from "./gallery-sections";
import { MAX_ARTICLE_END_SECTION_HEADING_LENGTH as STUDIO_HEADING, readArticleEndSectionCatalog } from "../../sanity/schemas/article-end-sections";
import { MAX_GALLERY_SECTIONS as STUDIO_COUNT, MAX_SECTION_ID_LENGTH as STUDIO_ID } from "../../sanity/schemas/gallery";

const section = { _key: "one", sectionId: "one", slug: "first", label: "First" };
const doc = (sections: unknown) => ({ endGalleryId: "ending", endGallerySectionHeading: "Photographer's groups", endGallerySections: sections });

describe("article-end catalog boundary", () => {
  it("pins existing limits and accepts identical bounded schema/runtime fixtures", () => {
    expect([STUDIO_COUNT, STUDIO_ID, STUDIO_HEADING]).toEqual([MAX_GALLERY_SECTIONS, MAX_SECTION_ID_LENGTH, MAX_ARTICLE_END_SECTION_HEADING_LENGTH]);
    const rows = Array.from({ length: 20 }, (_, i) => ({ _key: `k${i}`, sectionId: `group-${i}`, slug: `group-${i}`, label: "a".repeat(256) }));
    const projected = projectArticleEndGalleryCatalog(rows, "a".repeat(160), "ending");
    expect(projected.endGallerySections).toHaveLength(20);
    expect(readArticleEndSectionCatalog({ ...doc(rows), endGallerySectionHeading: "a".repeat(160) })).toHaveLength(20);
    expect(() => assertGallerySections(projected.endGallerySections!)).not.toThrow();
  });
  it.each([undefined, null, []])("omits an absent catalog without adding legacy payload keys: %j", (rows) => {
    expect(projectArticleEndGalleryCatalog(rows, undefined, undefined)).toEqual({});
    expect(readArticleEndSectionCatalog({ endGallerySections: rows })).toEqual([]);
  });
  it.each([
    [null], [1], [{}], [{ ...section, label: " " }], [{ ...section, label: "x".repeat(257) }],
    [{ ...section, slug: "all" }], [{ ...section, slug: "UPPER" }],
    [{ ...section, sectionId: "x".repeat(249) }], [{ ...section, sectionId: "BAD ID" }], [section, { ...section, _key: "two", slug: "second" }],
    [section, { ...section, _key: "two", sectionId: "two" }],
    Array.from({ length: 21 }, (_, i) => ({ _key: `k${i}`, sectionId: `g-${i}`, slug: `g-${i}`, label: "Group" })),
  ].map((rows) => ({ rows })))("refuses malformed/ambiguous catalogs in both boundaries: %j", ({ rows }) => {
    expect(() => projectArticleEndGalleryCatalog(rows, "Groups", "ending")).toThrow();
    expect(() => readArticleEndSectionCatalog(doc(rows))).toThrow();
  });
  it.each([false, "wrong", {}, 7])("refuses malformed list containers: %j", (raw) => {
    expect(() => projectArticleEndGalleryCatalog(raw, undefined, "ending")).toThrow();
    expect(() => readArticleEndSectionCatalog(doc(raw))).toThrow();
  });
  it.each([undefined, null, "", " ", "a".repeat(161), 1])("requires an authored bounded heading: %j", (heading) => {
    expect(() => projectArticleEndGalleryCatalog([section], heading, "ending")).toThrow();
  });
  it("rejects a heading without a catalog and a catalog without a gallery", () => {
    expect(() => projectArticleEndGalleryCatalog([], "Groups", "ending")).toThrow();
    expect(() => projectArticleEndGalleryCatalog([section], "Groups", undefined)).toThrow();
  });
  it("explicitly strips internal metadata, unsupported intros and poisoned keys", () => {
    const row = JSON.parse(JSON.stringify(section).replace(/}$/, ',"intro":"secret-intro","_rev":"private-rev","providerSecret":"secret","__proto__":{"polluted":true}}'));
    expect(projectArticleEndGalleryCatalog([row], "Groups", "ending")).toEqual({ endGallerySectionHeading: "Groups", endGallerySections: [{ sectionId: "one", slug: "first", label: "First", order: 0 }] });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
