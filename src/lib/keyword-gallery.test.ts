import { describe, expect, it } from "vitest";

import { GalleryCursorError } from "@/lib/gallery-pagination";
import {
  compareKeywordGalleryOrder, createKeywordGalleryCursorCodec, KEYWORD_GALLERY_ORDERING, KEYWORD_GALLERY_SOURCE_ID, keywordGalleryScope, readKeywordGalleryPage,
  type KeywordGalleryBoundary, type KeywordGalleryRow, type KeywordGallerySource,
} from "@/lib/keyword-gallery";
import { canonicalizeKeywordSelection, MAX_RAW_KEYWORD_TOKENS, parseKeywordTokens, type KeywordVocabularySnapshot } from "@/lib/keyword-gallery-selection";
import { buildPublicKeywordTaxonomy, type PublicKeyword } from "@/lib/media-keywords";
import { createMockKeywordGallerySource, getMockKeywordVocabulary } from "@/lib/mock-keyword-gallery";
import { projectPublicImageMedia } from "@/lib/media";

const codec = createKeywordGalleryCursorCodec("k".repeat(32));
const keyword = (keywordId: string, parentKeywordId: string | null = null): PublicKeyword => ({ keywordId, title: keywordId, categorySlug: "subject", parentKeywordId });
const snapshot = (keywords: readonly PublicKeyword[], merged: readonly (readonly [string, string])[] = []): KeywordVocabularySnapshot => ({
  taxonomyVersion: 3, taxonomy: buildPublicKeywordTaxonomy(keywords), mergedInto: new Map(merged),
});
const vocabulary = snapshot(
  [keyword("root"), keyword("mid", "root"), keyword("leaf", "mid"), keyword("aa"), keyword("bb"), keyword("cc"), keyword("dd"), keyword("ee"), keyword("ff")],
  [["old-leaf", "leaf"], ["older", "old-leaf"], ["gone", "retired-one"]],
);

describe("canonicalizing a selection", () => {
  it("parses like a query value: trims, and drops empty elements", () => {
    expect(parseKeywordTokens(" aa, ,bb,, ")).toEqual(["aa", "bb"]);
    expect(parseKeywordTokens(null)).toEqual([]);
  });

  it.each([[undefined], [null], [""], [" , ,"]])("treats %j as nothing selected", (raw) => {
    expect(canonicalizeKeywordSelection(raw, vocabulary)).toEqual({ state: "empty" });
  });

  it("sorts, removes repeats and removes an ancestor a descendant makes redundant", () => {
    expect(canonicalizeKeywordSelection("bb,leaf,root,mid,bb,aa", vocabulary)).toEqual({ state: "selection", canonicalIds: ["aa", "bb", "leaf"], canonicalParam: "aa,bb,leaf", redirect: true });
  });

  it("asks for no redirect when the value is already canonical, and one when only the spelling differs", () => {
    expect(canonicalizeKeywordSelection("aa,bb", vocabulary)).toMatchObject({ redirect: false });
    expect(canonicalizeKeywordSelection("aa,bb,", vocabulary)).toMatchObject({ canonicalParam: "aa,bb", redirect: true });
    expect(canonicalizeKeywordSelection(" aa ,bb", vocabulary)).toMatchObject({ canonicalParam: "aa,bb", redirect: true });
  });

  it("follows a merge chain to its target in one step, together with other normalization", () => {
    expect(canonicalizeKeywordSelection("older,root,aa", vocabulary)).toEqual({ state: "selection", canonicalIds: ["aa", "leaf"], canonicalParam: "aa,leaf", redirect: true });
  });

  it("treats a token nothing public answers to as unknown, without guessing", () => {
    for (const raw of ["missing", "aa,missing", "AA", "gone"]) expect(canonicalizeKeywordSelection(raw, vocabulary), raw).toEqual({ state: "unknown-keyword" });
  });

  it("does not resolve a title or an alias, only an id", () => {
    const titled = snapshot([{ ...keyword("harbour"), title: "Port" }]);
    expect(canonicalizeKeywordSelection("Port", titled)).toEqual({ state: "unknown-keyword" });
    expect(canonicalizeKeywordSelection("port", titled)).toEqual({ state: "unknown-keyword" });
  });

  it("accepts five keywords with no relation, and refuses six", () => {
    expect(canonicalizeKeywordSelection("aa,bb,cc,dd,ee", vocabulary)).toMatchObject({ state: "selection", redirect: false });
    expect(canonicalizeKeywordSelection("aa,bb,cc,dd,ee,ff", vocabulary)).toEqual({ state: "over-limit" });
  });

  it("accepts six tokens that collapse to five", () => {
    expect(canonicalizeKeywordSelection("aa,bb,cc,dd,leaf,root", vocabulary)).toMatchObject({ state: "selection", canonicalIds: ["aa", "bb", "cc", "dd", "leaf"] });
  });

  it("checks the raw ceiling before resolving anything", () => {
    const tooMany = Array.from({ length: MAX_RAW_KEYWORD_TOKENS + 1 }, () => "missing").join(",");
    expect(canonicalizeKeywordSelection(tooMany, vocabulary)).toEqual({ state: "over-limit" });
  });

  it("raises on a merge cycle rather than calling it a visitor's unknown keyword", () => {
    const cyclic = snapshot([keyword("aa")], [["one", "two"], ["two", "one"]]);
    expect(() => canonicalizeKeywordSelection("one", cyclic)).toThrow(/cycle/);
  });
});

describe("the order", () => {
  const sort = (keys: readonly (readonly [string, string])[]) => [...keys]
    .map(([orderKey, mediaId]): KeywordGalleryBoundary => ({ orderKey, mediaId }))
    .sort(compareKeywordGalleryOrder).map((row) => row.mediaId);

  it("puts newer first, breaks ties by mediaId and puts undated last", () => {
    expect(sort([["", "z"], ["2024-01-01T00:00:00Z", "b"], ["", "a"], ["2025-01-01T00:00:00Z", "c"], ["2024-01-01T00:00:00Z", "a"]])).toEqual(["c", "a", "b", "a", "z"]);
  });

  it("matches the order GROQ returned for mixed precision on the preview dataset", () => {
    const groq = ["2024-01-02T00:00:00+02:00", "2024-01-01T00:00:01Z", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00.5Z", "2024-01-01T00:00:00.123Z", "2023-12-31T23:59:59Z", ""];
    expect([...groq].reverse().map((orderKey) => ({ orderKey, mediaId: "m" })).sort(compareKeywordGalleryOrder).map((row) => row.orderKey)).toEqual(groq);
  });
});

describe("the cursor", () => {
  const scope = keywordGalleryScope(["aa", "bb"], 3, "2026-01-01T00:00:00Z", 2, "en");

  it("binds the scope to keywords, taxonomy version, policy, ordering and page size", () => {
    expect(scope).toEqual({ sourceId: `${KEYWORD_GALLERY_SOURCE_ID}@en`, normalizedFilter: "v3:aa,bb", ordering: KEYWORD_GALLERY_ORDERING, visibilityVersion: "p1:2026-01-01T00:00:00Z", pageSize: 2 });
    expect(keywordGalleryScope(["aa"], 3, undefined, 2, "en").visibilityVersion).toBe("p1:none");
  });

  it("round-trips a boundary's identity", () => {
    expect(codec.decode(codec.encode(scope, "m"), scope)).toBe("m");
  });

  it("fits five of the longest ids inside the scope field", () => {
    const longest = Array.from({ length: 5 }, (_, index) => `${"a".repeat(39)}${index}`);
    const wide = keywordGalleryScope(longest, Number.MAX_SAFE_INTEGER, "2026-01-01T00:00:00.000Z", 24, "en-GB");
    expect(wide.normalizedFilter.length).toBeLessThanOrEqual(256);
    expect(codec.decode(codec.encode(wide, "m"), wide)).toBe("m");
  });

  it.each([
    ["garbage", "not-a-cursor", "malformed"],
    ["a non-string", 7, "malformed"],
  ])("refuses %s", (_name, cursor, code) => {
    expect(() => codec.decode(cursor, scope)).toThrow(GalleryCursorError);
    try { codec.decode(cursor, scope); } catch (error) { expect((error as GalleryCursorError).code).toBe(code); }
  });

  it("refuses a tampered token and one signed with another key", () => {
    const token = codec.encode(scope, "m");
    const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => codec.decode(tampered, scope)).toThrow(GalleryCursorError);
    expect(() => createKeywordGalleryCursorCodec("x".repeat(32)).decode(token, scope)).toThrow(GalleryCursorError);
  });

  it.each([
    ["other keywords", keywordGalleryScope(["aa", "cc"], 3, "2026-01-01T00:00:00Z", 2, "en")],
    ["a newer taxonomy", keywordGalleryScope(["aa", "bb"], 4, "2026-01-01T00:00:00Z", 2, "en")],
    ["changed media", keywordGalleryScope(["aa", "bb"], 3, "2026-02-01T00:00:00Z", 2, "en")],
    ["another page size", keywordGalleryScope(["aa", "bb"], 3, "2026-01-01T00:00:00Z", 3, "en")],
    ["another language", keywordGalleryScope(["aa", "bb"], 3, "2026-01-01T00:00:00Z", 2, "fi")],
  ])("refuses a token from %s", (_name, other) => {
    const token = codec.encode(scope, "m");
    expect(() => codec.decode(token, other)).toThrow(GalleryCursorError);
  });

  it("refuses a validly signed token with a key this ordering cannot hold", async () => {
    const { createHmacKeysetCursorCodec } = await import("@/lib/keyset-cursor");
    const inner = createHmacKeysetCursorCodec("k".repeat(32));
    for (const key of [7, "not-a-date", "2024-01-01T00:00:00Z"]) {
      expect(() => codec.decode(inner.encode(scope, key, "m"), scope), String(key)).toThrow(GalleryCursorError);
    }
  });
});

const media = (mediaId: string) => projectPublicImageMedia({
  mediaId, publiclyRenderable: true, alt: "",
  rendition: { src: "/gallery/m.1683eecb7e65.webp", version: "1683eecb7e65", width: 4, height: 3, sourceKind: "public-web-derivative" },
});
const row = (orderKey: string, mediaId: string): KeywordGalleryRow => ({ orderKey, media: media(mediaId) });

/** An in-memory store with the query's semantics, so a walk exercises the real page logic. */
function storeOf(rows: readonly KeywordGalleryRow[], latest = "2026-01-01T00:00:00Z"): KeywordGallerySource {
  const sorted = [...rows].sort((a, b) => compareKeywordGalleryOrder({ orderKey: a.orderKey, mediaId: a.media.mediaId }, { orderKey: b.orderKey, mediaId: b.media.mediaId }));
  return {
    readLatestChange: async () => (rows.length === 0 ? undefined : latest),
    readBoundary: async (_canonicalIds, mediaId) => sorted.find((entry) => entry.media.mediaId === mediaId),
    readWindow: async ({ after, limit }) => sorted.filter((entry) => after === undefined || compareKeywordGalleryOrder(after, { orderKey: entry.orderKey, mediaId: entry.media.mediaId }) < 0).slice(0, limit),
  };
}

async function walk(source: KeywordGallerySource, pageSize: number) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source, cursorCodec: codec, pageSize, ...(cursor === undefined ? {} : { cursor }) });
    expect(page.items.length).toBeLessThanOrEqual(pageSize);
    seen.push(...page.items.map((item) => item.mediaId));
    if (!page.page.hasNextPage) return seen;
    cursor = page.page.endCursor;
  }
  throw new Error("the walk did not end");
}

describe("reading pages", () => {
  const rows = [
    row("2025-01-01T00:00:00Z", "a"), row("2025-01-01T00:00:00Z", "b"), row("2024-01-01T00:00:00Z", "c"),
    row("", "d"), row("", "e"), row("", "f"), row("", "g"), row("", "h"),
  ];

  it.each([1, 2, 3, 8, 9])("walks dated and undated rows with no repeat or gap at page size %i", async (pageSize) => {
    expect(await walk(storeOf(rows), pageSize)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("returns the shared result shape, with no placement or enquiry permission", async () => {
    const page = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 1 });
    expect(Object.keys(page.items[0]).sort()).toEqual(["itemId", "media", "mediaId"]);
    expect(page.items[0].itemId).toBe("a");
    expect(page.page).toMatchObject({ size: 1, hasNextPage: true });
  });

  it("asks only for the page plus one row", async () => {
    const limits: number[] = [];
    const source = storeOf(rows);
    await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, cursorCodec: codec, pageSize: 3, source: { ...source, readWindow: (request) => { limits.push(request.limit); return source.readWindow(request); } } });
    expect(limits).toEqual([4]);
  });

  it("ends without a cursor when the page is exactly full", async () => {
    const page = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows.slice(0, 2)), cursorCodec: codec, pageSize: 2 });
    expect(page.page).toEqual({ size: 2, hasNextPage: false, endCursor: null });
  });

  it("gives an empty result for a selection nothing matches", async () => {
    expect(await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf([]), cursorCodec: codec })).toEqual({ items: [], page: { size: 24, hasNextPage: false, endCursor: null } });
  });

  it("keeps the capture time out of the cursor, which is signed but readable", async () => {
    const first = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 1 });
    const decoded = Buffer.from(first.page.endCursor!.split(".")[0], "base64url").toString("utf8");
    expect(decoded).toContain('"a"');
    expect(decoded).not.toMatch(/2025|T00:00/);
    expect(first.page.endCursor).not.toContain("2025");
  });

  it("calls a cursor stale when its boundary has gone, even with an unchanged version", async () => {
    const first = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 1 });
    const cursor = first.page.endCursor!;
    const stale = async (source: KeywordGallerySource) => {
      await expect(readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, cursor, source, cursorCodec: codec, pageSize: 1 })).rejects.toMatchObject({ code: "stale" });
    };
    await stale(storeOf(rows.slice(1)));
  });

  it("refuses a repeated identity at the boundary's own position", async () => {
    const first = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 1 });
    const source = storeOf(rows);
    await expect(readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, cursor: first.page.endCursor!, cursorCodec: codec, pageSize: 1, source: { ...source, readWindow: async () => [row("2020-01-01T00:00:00Z", "a")] } })).rejects.toThrow(/more than once/);
  });

  it("calls a cursor wrong-scope when the eligible media changed, or the taxonomy moved", async () => {
    const first = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 1 });
    const cursor = first.page.endCursor!;
    await expect(readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, cursor, source: storeOf(rows, "2026-02-02T00:00:00Z"), cursorCodec: codec, pageSize: 1 })).rejects.toBeInstanceOf(GalleryCursorError);
    await expect(readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 2, cursor, source: storeOf(rows), cursorCodec: codec, pageSize: 1 })).rejects.toBeInstanceOf(GalleryCursorError);
  });

  it("continues from the longest mediaId a cursor can hold, and refuses a longer one", async () => {
    const longest = "a".repeat(256);
    const long = [row("", longest), row("", `${longest.slice(0, -1)}b`)];
    expect(await walk(storeOf(long), 1)).toEqual([longest, `${longest.slice(0, -1)}b`]);
    await expect(walk(storeOf([row("", "a".repeat(257))]), 1)).rejects.toThrow(/too long/);
  });

  it("does not continue in another language", async () => {
    const first = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 1 });
    await expect(readKeywordGalleryPage({ locale: "fi", canonicalIds: ["aa"], taxonomyVersion: 1, cursor: first.page.endCursor!, source: storeOf(rows), cursorCodec: codec, pageSize: 1 })).rejects.toBeInstanceOf(GalleryCursorError);
  });

  it.each([0, -1, 1.5, 101, Number.NaN])("refuses page size %d before reading anything", async (pageSize) => {
    const source: KeywordGallerySource = { readLatestChange: async () => { throw new Error("read"); }, readBoundary: async () => { throw new Error("read"); }, readWindow: async () => { throw new Error("read"); } };
    await expect(readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source, cursorCodec: codec, pageSize })).rejects.toBeInstanceOf(RangeError);
  });

  it("accepts the shared maximum page size", async () => {
    const page = await readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: storeOf(rows), cursorCodec: codec, pageSize: 100 });
    expect(page.page.size).toBe(100);
  });

  const source = (candidates: readonly KeywordGalleryRow[]): KeywordGallerySource => ({ readLatestChange: async () => "x", readBoundary: async () => undefined, readWindow: async () => candidates });

  it.each([
    ["rows out of order", [row("2024-01-01T00:00:00Z", "a"), row("2025-01-01T00:00:00Z", "b")], /out of order/],
    ["a repeated row", [row("", "a"), row("", "a")], /more than once/],
    ["one identity with two dates", [row("2025-01-01T00:00:00Z", "a"), row("2024-01-01T00:00:00Z", "a")], /more than once/],
    ["too many rows", [row("", "a"), row("", "b"), row("", "c"), row("", "d")], /more rows/],
    ["an unusable key in the look-ahead row", [row("", "a"), row("", "b"), row("yesterday", "c")], /unusable order key/],
  ])("treats %s as a defect, not a page", async (_name, candidates, message) => {
    await expect(readKeywordGalleryPage({ locale: "en", canonicalIds: ["aa"], taxonomyVersion: 1, source: source(candidates), cursorCodec: codec, pageSize: 2 })).rejects.toThrow(message);
  });
});

describe("the mock source", () => {
  const ids = async (canonicalIds: readonly string[], pageSize = 24) =>
    (await readKeywordGalleryPage({ locale: "en", canonicalIds, taxonomyVersion: 1, source: createMockKeywordGallerySource("en"), cursorCodec: codec, pageSize })).items.map((item) => item.mediaId);

  it("answers broad, narrow and parent selections, undated last", async () => {
    expect(await ids(["water"])).toEqual(["coastal-landscape", "forest-stream", "lakeside-reeds"]);
    expect(await ids(["coast", "water"])).toEqual(["coastal-landscape"]);
    expect(await ids(["nature"])).toEqual(["coastal-landscape", "forest-stream", "misty-birch", "lakeside-reeds"]);
  });

  it("leaves out opted-out media and the keyworded video", async () => {
    expect(await ids(["forest"])).toEqual(["forest-stream"]);
    expect(await ids(["coast"])).toEqual(["coastal-landscape"]);
  });

  it("resolves its merge record, and localizes the vocabulary", () => {
    expect(canonicalizeKeywordSelection("seaside", getMockKeywordVocabulary("en"))).toMatchObject({ canonicalParam: "coast", redirect: true });
    expect(getMockKeywordVocabulary("fi").taxonomy.byId.get("forest")?.title).toBe("Metsä");
  });
});
