import { describe, expect, it } from "vitest";

import { defineKeywordType } from "../../sanity/schemas/keyword";
import { defineMediaType } from "../../sanity/schemas/media";
import { PUBLIC_MEDIA_PROJECTION } from "@/lib/sanity-media";
import {
  KEYWORD_DOCUMENT_TYPE, parseMediaKeywordIndex, parsePublicKeywordTaxonomy, PROJECTED_KEYWORD_FIELDS, PROJECTED_MEDIA_KEYWORD_FIELDS,
  PUBLIC_KEYWORD_TAXONOMY_QUERY, PUBLIC_MEDIA_KEYWORD_PROJECTION,
} from "@/lib/sanity-media-keywords";

const row = (overrides: Record<string, unknown> = {}) => ({
  keywordId: "harbour", title: [{ language: "en", value: "Harbour" }, { language: "fi", value: "Satama" }], categorySlug: "place", parentKeywordId: null, ...overrides,
});
const fieldNames = (type: { fields: readonly { name: string }[] }) => new Set(type.fields.map((field) => field.name));

describe("what the queries read", () => {
  it("asks only for fields the schemas declare", () => {
    const keyword = defineKeywordType({}), media = defineMediaType({ datasetVisibility: "public" });
    for (const field of PROJECTED_KEYWORD_FIELDS) expect(fieldNames(keyword), field).toContain(field);
    for (const field of PROJECTED_MEDIA_KEYWORD_FIELDS) expect(fieldNames(media), field).toContain(field);
    expect(KEYWORD_DOCUMENT_TYPE).toBe(keyword.name);
  });

  it("reads active, public, ordinary-path keywords only", () => {
    expect(PUBLIC_KEYWORD_TAXONOMY_QUERY).toContain('status == "active"');
    expect(PUBLIC_KEYWORD_TAXONOMY_QUERY).toContain('visibility == "public"');
    expect(PUBLIC_KEYWORD_TAXONOMY_QUERY).toContain('_id in path("*")');
  });

  it.each(["importedKeywords", "keywordOverrides", "internalKeywords", "keywordRecord", "aliases"])("never names %s", (field) => {
    expect(PUBLIC_KEYWORD_TAXONOMY_QUERY + PUBLIC_MEDIA_KEYWORD_PROJECTION).not.toContain(field);
  });

  it("leaves the grid and lightbox projection without keywords", () => {
    expect(PUBLIC_MEDIA_PROJECTION).not.toMatch(/keyword/i);
  });
});

describe("parsing the taxonomy", () => {
  it("selects the language, falling back to the default language", () => {
    expect(parsePublicKeywordTaxonomy([row()], "fi", "en").byId.get("harbour")?.title).toBe("Satama");
    expect(parsePublicKeywordTaxonomy([row({ title: [{ language: "en", value: "Harbour" }] })], "fi", "en").byId.get("harbour")?.title).toBe("Harbour");
  });

  it.each(["en", "fi", "sv"])("requires a default-language title when requesting %s", (language) => {
    expect(() => parsePublicKeywordTaxonomy([row({ title: [{ language: "en", value: "Harbour" }] })], language, "fi")).toThrow(/no title in the default language/);
  });

  it("rejects a blank default-language title even when a translation exists", () => {
    expect(() => parsePublicKeywordTaxonomy([row({ title: [{ language: "en", value: "Harbour" }, { language: "fi", value: "  " }] })], "en", "fi")).toThrow(/no title in the default language/);
  });

  it("carries only the model's fields, whatever a row holds", () => {
    const parsed = parsePublicKeywordTaxonomy([row({ aliases: ["private spelling"], _id: "x", importedKeywords: ["term"] })], "en", "en");
    expect(Object.keys(parsed.keywords[0]).sort()).toEqual(["categorySlug", "keywordId", "parentKeywordId", "title"]);
  });

  it.each([
    ["not a list", {}, /malformed/],
    ["a row that is no object", [1], /malformed/],
    ["an invalid id", [row({ keywordId: "A B" })], /invalid id/],
    ["no title", [row({ title: [] })], /no title/],
    ["no category", [row({ categorySlug: null })], /no category/],
    ["an invalid parent", [row({ parentKeywordId: 1 })], /invalid parent/],
    ["a parent outside the public rows", [row({ parentRef: "doc-hidden", parentKeywordId: "hidden" })], /unknown parent/],
    ["a dangling parent", [row({ parentRef: "doc-missing", parentKeywordId: null })], /dangling parent/],
    ["a repeated id", [row(), row()], /repeated/],
  ])("refuses %s", (_name, rows, message) => {
    expect(() => parsePublicKeywordTaxonomy(rows, "en", "en")).toThrow(message);
  });
});

describe("parsing media keywords", () => {
  const assigned = (...keywordIds: string[]) => ({
    keywords: keywordIds.map((keywordId) => ({ _ref: `doc-${keywordId}`, _key: keywordId })),
    keywordTargets: keywordIds.map((keywordId) => ({ keywordId, status: "active", visibility: "public" })),
  });

  it("sorts and collapses repeats, and treats a medium no import touched as empty", () => {
    const index = parseMediaKeywordIndex([
      { mediaId: "a", ...assigned("b-key", "a-key", "a-key"), expandedKeywordIds: ["root", "a-key"] },
      { mediaId: "b", keywords: null, keywordTargets: null, expandedKeywordIds: null },
      { mediaId: "c" },
    ]);
    expect(index.get("a")).toEqual({ mediaId: "a", keywordIds: ["a-key", "b-key"], expandedKeywordIds: ["a-key", "root"] });
    expect(index.get("b")).toEqual({ mediaId: "b", keywordIds: [], expandedKeywordIds: [] });
    expect(index.get("c")).toEqual({ mediaId: "c", keywordIds: [], expandedKeywordIds: [] });
  });

  it("keeps an empty list distinct from nothing being wrong, and carries nothing else", () => {
    const parsed = parseMediaKeywordIndex([{ mediaId: "a", keywords: [], keywordTargets: [], expandedKeywordIds: [], importedKeywords: ["private term"], internalKeywords: [] }]).get("a");
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["expandedKeywordIds", "keywordIds", "mediaId"]);
  });

  it.each([undefined, null])("allows an absent closure (%s) when there are no references", (expandedKeywordIds) => {
    expect(parseMediaKeywordIndex([{ mediaId: "a", ...assigned(), expandedKeywordIds }]).get("a")).toEqual({ mediaId: "a", keywordIds: [], expandedKeywordIds: [] });
  });

  it.each([undefined, null])("rejects an absent closure (%s) when references exist", (expandedKeywordIds) => {
    for (const status of ["active", "merged", "retired"]) {
      expect(() => parseMediaKeywordIndex([{
        mediaId: "a", ...assigned("live-key"), keywordTargets: [{ keywordId: "live-key", status, visibility: "public" }], expandedKeywordIds,
      }])).toThrow(/malformed expandedKeywordIds/);
    }
  });

  it("preserves the stored closure when only merged and retired references remain", () => {
    expect(parseMediaKeywordIndex([{
      mediaId: "a", ...assigned("old-key", "gone-key"),
      keywordTargets: [{ keywordId: "old-key", status: "merged", visibility: "public" }, { keywordId: "gone-key", status: "retired", visibility: "public" }],
      expandedKeywordIds: ["old-key", "root"],
    }]).get("a")).toEqual({ mediaId: "a", keywordIds: [], expandedKeywordIds: ["old-key", "root"] });
  });

  it("leaves out a merged or retired keyword until the re-sync re-points it", () => {
    const keywords = [{ _ref: "doc-old" }, { _ref: "doc-gone" }, { _ref: "doc-live" }];
    const keywordTargets = [{ keywordId: "old-key", status: "merged", visibility: "public" }, { keywordId: "gone-key", status: "retired", visibility: "public" }, { keywordId: "live-key", status: "active", visibility: "public" }];
    expect(parseMediaKeywordIndex([{ mediaId: "a", keywords, keywordTargets, expandedKeywordIds: ["old-key"] }]).get("a")).toEqual({ mediaId: "a", keywordIds: ["live-key"], expandedKeywordIds: ["old-key"] });
  });

  it("does not expose a keyword that turned internal", () => {
    expect(parseMediaKeywordIndex([{ mediaId: "a", keywords: [{ _ref: "doc-x" }], keywordTargets: [{ keywordId: "x-key", status: "active", visibility: "internal" }], expandedKeywordIds: [] }]).get("a")?.keywordIds).toEqual([]);
  });

  it.each([undefined, null, "activ"])("rejects invalid status (%s) before filtering by visibility", (status) => {
    for (const visibility of ["public", "internal"]) {
      expect(() => parseMediaKeywordIndex([{
        mediaId: "a", ...assigned("live-key"), keywordTargets: [{ keywordId: "live-key", status, visibility }], expandedKeywordIds: [],
      }])).toThrow(/malformed keywords/);
    }
  });

  it.each([undefined, null, "publik"])("rejects invalid visibility (%s) before filtering by status", (visibility) => {
    for (const status of ["active", "merged", "retired"]) {
      expect(() => parseMediaKeywordIndex([{
        mediaId: "a", ...assigned("live-key"), keywordTargets: [{ keywordId: "live-key", status, visibility }], expandedKeywordIds: [],
      }])).toThrow(/malformed keywords/);
    }
  });

  it.each([
    ["not a list", {}, /malformed/],
    ["no mediaId", [{ keywords: [] }], /no mediaId/],
    ["keywords that are no list", [{ mediaId: "a", keywords: "x", keywordTargets: null }], /malformed keywords/],
    ["targets that do not line up", [{ mediaId: "a", keywords: [{ _ref: "x" }], keywordTargets: [] }], /malformed keywords/],
    ["a reference with no ref", [{ mediaId: "a", keywords: [{}], keywordTargets: [{ keywordId: "x-key", status: "active", visibility: "public" }] }], /malformed keywords/],
    ["a dangling reference", [{ mediaId: "a", keywords: [{ _ref: "x" }], keywordTargets: [null] }], /dangling keyword/],
    ["a target with a bad id", [{ mediaId: "a", keywords: [{ _ref: "x" }], keywordTargets: [{ keywordId: "A B", status: "active", visibility: "public" }] }], /malformed keywords/],
    ["a bad closure entry", [{ mediaId: "a", expandedKeywordIds: ["A B"] }], /malformed expandedKeywordIds/],
    ["two rows for one medium", [{ mediaId: "a" }, { mediaId: "a" }], /two keyword assignments/],
  ])("refuses %s", (_name, rows, message) => {
    expect(() => parseMediaKeywordIndex(rows)).toThrow(message);
  });
});
