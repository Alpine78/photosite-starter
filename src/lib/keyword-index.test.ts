import { describe, expect, it, vi } from "vitest";

import { defineKeywordType, keywordCategoryType } from "../../sanity/schemas/keyword";
import { keywordMatchKey as schemaMatchKey } from "../../sanity/schemas/keyword-rules";
import { buildKeywordIndex, countKeywordMedia, KEYWORD_INDEX_VERSION, keywordIndexMatchKey, type KeywordIndexInput } from "@/lib/keyword-index";
import { buildPublicKeywordTaxonomy, type PublicKeyword } from "@/lib/media-keywords";
import { getMockKeywordIndex } from "@/lib/mock-keyword-gallery";
import { readKeywordGalleryPage } from "@/lib/keyword-gallery";
import { createKeywordGalleryCursorCodec } from "@/lib/keyword-gallery";
import { createMockKeywordGallerySource } from "@/lib/mock-keyword-gallery";
import type { SanityClient } from "@/lib/sanity-client";
import { KEYWORD_GALLERY_ELIGIBILITY, keywordGalleryFilter } from "@/lib/sanity-keyword-gallery";
import { PUBLIC_KEYWORD_FILTER, PUBLIC_KEYWORD_TAXONOMY_QUERY } from "@/lib/sanity-media-keywords";
import { KEYWORD_INDEX_CLOSURE_PAGE_SIZE, KEYWORD_INDEX_CLOSURES_QUERY, KEYWORD_INDEX_VOCABULARY_QUERY, parseKeywordIndex, readSanityKeywordIndex } from "@/lib/sanity-keyword-index";

const keyword = (keywordId: string, parentKeywordId: string | null = null, categorySlug = "subject"): PublicKeyword => ({ keywordId, title: keywordId, categorySlug, parentKeywordId });
const categories = new Map([["subject", { title: "Subject", order: 1 }], ["place", { title: "Place", order: 0 }], ["unordered", { title: "Unordered", order: null }]]);
const input = (overrides: Partial<KeywordIndexInput> = {}): KeywordIndexInput => ({
  language: "en", categories, aliases: new Map(), closures: [],
  taxonomy: buildPublicKeywordTaxonomy([keyword("root"), keyword("child", "root"), keyword("grandchild", "child"), keyword("harbour", null, "place"), keyword("empty")]),
  ...overrides,
});

describe("counting", () => {
  it("counts a medium once per keyword, even when its closure repeats an id", () => {
    expect(countKeywordMedia([["aa", "aa", "bb"], ["aa"]])).toEqual(new Map([["aa", 2], ["bb", 1]]));
  });

  it("gives a parent its descendants through the stored closure, each medium once", () => {
    const index = buildKeywordIndex(input({ closures: [["root", "child"], ["root", "child", "grandchild"], ["root"], ["harbour"]] }));
    expect(Object.fromEntries(index.entries.map((entry) => [entry.keywordId, entry.count]))).toEqual({ harbour: 1, root: 3, child: 2, grandchild: 1 });
  });

  it("agrees with the gallery a count links to", async () => {
    const index = getMockKeywordIndex("en");
    const codec = createKeywordGalleryCursorCodec("k".repeat(32));
    for (const entry of index.entries.filter((candidate) => candidate.keywordId !== "archive")) {
      const page = await readKeywordGalleryPage({ locale: "en", canonicalIds: [entry.keywordId], taxonomyVersion: 1, source: createMockKeywordGallerySource("en"), cursorCodec: codec, pageSize: 100 });
      expect(page.items.length, entry.keywordId).toBe(entry.count);
    }
    expect(index.entries.find((entry) => entry.keywordId === "archive")?.count).toBe(30);
  });

  it("follows the stored closure during a re-sync, without recomputing ancestry", () => {
    const index = buildKeywordIndex(input({ closures: [["grandchild"]] }));
    expect(index.entries.map((entry) => entry.keywordId)).toEqual(["grandchild"]);
    expect(index.entries[0].ancestorIds).toEqual(["root", "child"]);
  });
});

describe("the entries", () => {
  it("carries the version, and no medium", () => {
    const index = buildKeywordIndex(input({ closures: [["harbour"]] }));
    expect(index.version).toBe(KEYWORD_INDEX_VERSION);
    expect(Object.keys(index.entries[0]).sort()).toEqual(["aliasKeys", "ancestorIds", "categorySlug", "categoryTitle", "count", "keywordId", "title"]);
  });

  it("leaves out a keyword nothing eligible carries, and a closure id it does not know", () => {
    const entries = buildKeywordIndex(input({ closures: [["root"], ["private-person"], ["merged-away"]] })).entries;
    expect(entries.map((entry) => entry.keywordId)).toEqual(["root"]);
    expect(JSON.stringify(entries)).not.toMatch(/private-person|merged-away/);
  });

  it("orders by category order, then slug, then id, whatever the input order", () => {
    const taxonomy = buildPublicKeywordTaxonomy([keyword("zz", null, "unordered"), keyword("bb"), keyword("aa"), keyword("place-a", null, "place")]);
    const closures = [["zz"], ["bb"], ["aa"], ["place-a"]];
    const first = buildKeywordIndex(input({ taxonomy, closures }));
    expect(first.entries.map((entry) => entry.keywordId)).toEqual(["place-a", "aa", "bb", "zz"]);
    const shuffled = buildKeywordIndex(input({ taxonomy: buildPublicKeywordTaxonomy([...taxonomy.keywords].reverse()), closures: [...closures].reverse() }));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(first));
  });

  it("normalizes aliases to sorted match keys without repeats", () => {
    const aliases = new Map([["harbour", ["  PORT ", "port", "Satäma", "  ", "Bay  Area"]]]);
    expect(buildKeywordIndex(input({ aliases, closures: [["harbour"]] })).entries[0].aliasKeys).toEqual(["bay area", "port", "satäma"]);
  });

  it("raises on a keyword whose category is unknown", () => {
    expect(() => buildKeywordIndex(input({ categories: new Map(), closures: [["harbour"]] }))).toThrow(/unknown category/);
  });
});

describe("match keys", () => {
  it.each([
    ["  Bike\t Racing ", "bike racing"], ["MÄKI", "mäki"], ["Maki", "maki"], ["Mäki", "mäki"], ["", ""],
  ])("normalizes %j, as the import does", (value, expected) => {
    expect(keywordIndexMatchKey(value)).toBe(expected);
    expect(schemaMatchKey(value)).toBe(expected);
  });
});

describe("the budget", () => {
  /** The largest vocabulary the budget covers: 40-character ids and titles, three aliases, six levels. */
  function worstCaseIndex(size: number) {
    const id = (index: number) => `k${String(index).padStart(39, "0")}`;
    const keywords = Array.from({ length: size }, (_, index): PublicKeyword => ({
      keywordId: id(index), title: "T".repeat(40), categorySlug: "subject", parentKeywordId: index % 6 === 0 ? null : id(index - 1),
    }));
    const aliases = new Map(keywords.map((entry) => [entry.keywordId, ["a".repeat(40), "b".repeat(40), "c".repeat(40)]]));
    return buildKeywordIndex({ language: "en", taxonomy: buildPublicKeywordTaxonomy(keywords), categories, aliases, closures: keywords.map((entry) => [entry.keywordId]) });
  }

  it("keeps a 500-keyword index within 250 KB, because it is rebuilt from its inputs on each read", () => {
    expect(Buffer.byteLength(JSON.stringify(worstCaseIndex(500)))).toBeLessThan(250_000);
  });

  it("keeps one page of closures in several branches under Next's 2 MB limit, once encoded as Next stores it", () => {
    const closure = Array.from({ length: 20 }, (_, index) => `${"k".repeat(38)}${String(index).padStart(2, "0")}`);
    const body = JSON.stringify({ result: Array.from({ length: KEYWORD_INDEX_CLOSURE_PAGE_SIZE }, () => ({ mediaId: "m".repeat(64), expandedKeywordIds: closure })) });
    expect(Buffer.from(body).toString("base64").length).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("the Sanity inputs", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    keywordId: "harbour", title: [{ language: "en", value: "Harbour" }, { language: "fi", value: "Satama" }], aliases: ["Port"], categorySlug: "place",
    categoryTitle: [{ language: "en", value: "Place" }, { language: "fi", value: "Paikka" }], categoryOrder: 2, parentRef: null, parentKeywordId: null, ...overrides,
  });

  it("uses the gallery's own eligibility, and the public keyword rule the taxonomy uses", () => {
    expect(keywordGalleryFilter(["aa"])).toContain(KEYWORD_GALLERY_ELIGIBILITY);
    expect(KEYWORD_INDEX_CLOSURES_QUERY).toContain(KEYWORD_GALLERY_ELIGIBILITY);
    expect(KEYWORD_INDEX_VOCABULARY_QUERY).toContain(PUBLIC_KEYWORD_FILTER);
    expect(PUBLIC_KEYWORD_TAXONOMY_QUERY).toContain(PUBLIC_KEYWORD_FILTER);
  });

  it("reads only public, active, ordinary-path keywords, and fields the schemas declare", () => {
    expect(KEYWORD_INDEX_VOCABULARY_QUERY).toMatch(/status == "active" && visibility == "public" && _id in path\("\*"\)/);
    const fields = (type: { fields: readonly { name: string }[] }) => type.fields.map((field) => field.name);
    expect(fields(defineKeywordType({}))).toEqual(expect.arrayContaining(["keywordId", "title", "aliases", "category", "parent"]));
    expect(fields(keywordCategoryType)).toEqual(expect.arrayContaining(["slug", "title", "order"]));
    expect(KEYWORD_INDEX_VOCABULARY_QUERY + KEYWORD_INDEX_CLOSURES_QUERY).not.toMatch(/importedKeywords|keywordOverrides|internalKeywords|keywordRecord/);
  });

  it("selects the language, falling back to the default, for keywords and categories", () => {
    const finnish = parseKeywordIndex([row()], [["harbour"]], "fi-FI", "en-GB").entries[0];
    expect(finnish).toMatchObject({ title: "Satama", categoryTitle: "Paikka", aliasKeys: ["port"], count: 1 });
    const fallback = parseKeywordIndex([row()], [["harbour"]], "sv", "en-GB").entries[0];
    expect(fallback).toMatchObject({ title: "Harbour", categoryTitle: "Place" });
  });

  it("leaves out a keyword whose parent is not public, and what sits under it, keeping the rest", () => {
    const rows = [row(), row({ keywordId: "orphan", parentRef: "doc-gone", parentKeywordId: null }), row({ keywordId: "below", parentRef: "doc-orphan", parentKeywordId: "orphan" })];
    const index = parseKeywordIndex(rows, [["harbour"], ["below", "orphan"]], "en", "en");
    expect(index.entries.map((entry) => entry.keywordId)).toEqual(["harbour"]);
  });

  it("refuses two categories claiming one slug with different words, because last-wins would change between reads", () => {
    const other = row({ keywordId: "pier", categoryOrder: 9 });
    expect(() => parseKeywordIndex([row(), other], [], "en", "en")).toThrow(/two keyword categories claim the slug "place"/);
    expect(parseKeywordIndex([row(), row({ keywordId: "pier" })], [["pier"]], "en", "en").entries).toHaveLength(1);
  });

  it.each([
    ["no vocabulary", null, [], /malformed/],
    ["no closures", [row()], null, /closures are malformed/],
    ["a malformed closure", [row()], [["A B"]], /malformed expandedKeywordIds/],
    ["a category with no default title", [row({ categoryTitle: [] })], [], /no title in the default language/],
    ["a malformed order", [row({ categoryOrder: "1" })], [], /malformed order/],
    ["malformed aliases", [row({ aliases: "Port" })], [], /malformed aliases/],
  ])("refuses %s", (_name, vocabulary, closures, message) => {
    expect(() => parseKeywordIndex(vocabulary, closures, "en", "en")).toThrow(message);
  });

  it("reads through tags the cache policy knows", async () => {
    const query = vi.fn(async ({ tag }: { tag: string }) => (tag === "keyword-index.vocabulary" ? [row()] : [{ mediaId: "m1", expandedKeywordIds: ["harbour"] }]));
    const index = await readSanityKeywordIndex({ language: "en", fallbackLanguage: "en", client: { query } as unknown as SanityClient });
    expect(index.entries).toHaveLength(1);
    expect(query.mock.calls.map(([request]) => request.tag).sort()).toEqual(["keyword-index.closures", "keyword-index.vocabulary"]);
  });

  const closureRow = (index: number) => ({ mediaId: `m${String(index).padStart(6, "0")}`, expandedKeywordIds: ["harbour"] });

  it("reads the closures by identity until a short page, so a medium published between pages counts no other twice", async () => {
    const all = Array.from({ length: KEYWORD_INDEX_CLOSURE_PAGE_SIZE + 1 }, (_, index) => closureRow(index));
    const query = vi.fn(async ({ tag, params }: { tag: string; params: { after?: string; limit?: number } }) =>
      tag === "keyword-index.vocabulary" ? [row()] : all.filter((entry) => entry.mediaId > (params.after ?? "")).slice(0, params.limit));
    const index = await readSanityKeywordIndex({ language: "en", fallbackLanguage: "en", client: { query } as unknown as SanityClient });
    expect(index.entries[0].count).toBe(KEYWORD_INDEX_CLOSURE_PAGE_SIZE + 1);
    expect(query.mock.calls.map(([request]) => request.params).filter((params) => "after" in params)).toEqual([
      { after: "", limit: KEYWORD_INDEX_CLOSURE_PAGE_SIZE }, { after: all[KEYWORD_INDEX_CLOSURE_PAGE_SIZE - 1].mediaId, limit: KEYWORD_INDEX_CLOSURE_PAGE_SIZE },
    ]);
    expect(KEYWORD_INDEX_CLOSURES_QUERY).toContain("mediaId > $after] | order(mediaId asc) [0...$limit]");
  });

  it.each([
    ["no identity", [{ expandedKeywordIds: ["harbour"] }]],
    ["an identity that does not advance", [{ mediaId: "", expandedKeywordIds: ["harbour"] }]],
  ])("refuses a closure row with %s, because paging could not go on from it", async (_name, rows) => {
    const query = vi.fn(async ({ tag }: { tag: string }) => (tag === "keyword-index.vocabulary" ? [row()] : rows));
    await expect(readSanityKeywordIndex({ language: "en", fallbackLanguage: "en", client: { query } as unknown as SanityClient })).rejects.toThrow(/closures are malformed/);
  });

  it("refuses a store that never ends the list, and a page that is no list", async () => {
    let next = 0;
    const endless = vi.fn(async ({ tag }: { tag: string }) => (tag === "keyword-index.vocabulary" ? [row()] : Array.from({ length: KEYWORD_INDEX_CLOSURE_PAGE_SIZE }, () => closureRow(next++))));
    await expect(readSanityKeywordIndex({ language: "en", fallbackLanguage: "en", client: { query: endless } as unknown as SanityClient })).rejects.toThrow(/did not end/);
    const broken = vi.fn(async ({ tag }: { tag: string }) => (tag === "keyword-index.vocabulary" ? [row()] : null));
    await expect(readSanityKeywordIndex({ language: "en", fallbackLanguage: "en", client: { query: broken } as unknown as SanityClient })).rejects.toThrow(/closures are malformed/);
  });
});
