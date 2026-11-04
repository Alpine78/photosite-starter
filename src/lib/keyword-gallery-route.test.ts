import { describe, expect, it } from "vitest";

import { createKeywordGalleryCursorCodec } from "@/lib/keyword-gallery";
import {
  keywordGalleryQuery,
  resolveKeywordGalleryRoute,
  type KeywordGalleryStore,
} from "@/lib/keyword-gallery-route";
import { buildGalleryHref, galleryContinuationHref } from "@/lib/gallery-slice";
import { createMockKeywordGallerySource, getMockKeywordVocabulary } from "@/lib/mock-keyword-gallery";

const store: KeywordGalleryStore = {
  cursorCodec: createKeywordGalleryCursorCodec("k".repeat(32)),
  readVocabulary: async (locale) => getMockKeywordVocabulary(locale),
  source: (locale) => createMockKeywordGallerySource(locale),
};
const route = (raw: string, cursor?: string | readonly string[]) => resolveKeywordGalleryRoute("en", raw, cursor, store);

describe("resolving a keyword gallery request", () => {
  it("gives a canonical selection its names and first page, without a redirect", async () => {
    const result = await route("coast,water");
    expect(result).toMatchObject({ canonicalParam: "coast,water", canonicalQuery: "keywords=coast,water", redirect: false, titles: ["Coast", "Water"], cursor: undefined });
    expect(result?.page.items.map((item) => item.mediaId)).toEqual(["coastal-landscape"]);
  });

  it.each([
    ["reordering", "water,coast"],
    ["a repeat", "coast,water,coast"],
    ["a redundant ancestor", "coast,water,nature"],
    ["a merged id", "seaside,water"],
    ["a stray separator", "coast,water,"],
    ["spacing", " coast , water"],
  ])("asks for one redirect after %s", async (_name, raw) => {
    expect(await route(raw)).toMatchObject({ canonicalParam: "coast,water", redirect: true });
  });

  it.each([
    ["an unknown id", "missing"],
    ["an alias or title", "Coast"],
    ["six unrelated keywords", "archive,autumn,coast,forest,trees,water"],
    ["more raw tokens than the ceiling", Array.from({ length: 16 }, () => "coast").join(",")],
    ["nothing at all", ""],
  ])("answers %s with nothing, which a page turns into a 404", async (_name, raw) => {
    expect(await route(raw)).toBeUndefined();
  });

  it("accepts five unrelated keywords, even when nothing has them all", async () => {
    const result = await route("archive,autumn,coast,forest,trees");
    expect(result?.page.items).toEqual([]);
    expect(result?.redirect).toBe(false);
  });

  it("continues across pages with no repeat, and restores the same order from the same address", async () => {
    const first = await route("archive");
    expect(first?.page.page.hasNextPage).toBe(true);
    const cursor = first!.page.page.endCursor!;
    const second = await route("archive", cursor);
    const repeat = await route("archive", cursor);
    expect(second?.canonicalQuery).toBe(`keywords=archive&cursor=${encodeURIComponent(cursor)}`);
    expect(repeat?.page.items.map((item) => item.mediaId)).toEqual(second?.page.items.map((item) => item.mediaId));
    const ids = [...first!.page.items, ...second!.page.items].map((item) => item.mediaId);
    expect(new Set(ids).size).toBe(30);
  });

  it.each([
    ["a repeated cursor, even an identical one", ["x", "x"]],
    ["an empty cursor", ""],
    ["an overlong cursor", "x".repeat(2049)],
    ["garbage", "not-a-cursor"],
  ])("refuses %s before anything could redirect", async (_name, cursor) => {
    expect(await route("water,coast", cursor)).toBeUndefined();
  });

  it("refuses a cursor from another selection or language", async () => {
    const first = await route("archive");
    const cursor = first!.page.page.endCursor!;
    expect(await route("coast", cursor)).toBeUndefined();
    expect(await resolveKeywordGalleryRoute("fi", "archive", cursor, store)).toBeUndefined();
  });

  it("raises when the store fails, because that is not a visitor's 404", async () => {
    const failing: KeywordGalleryStore = { ...store, readVocabulary: async () => { throw new Error("store down"); } };
    await expect(resolveKeywordGalleryRoute("en", "coast", undefined, failing)).rejects.toThrow("store down");
  });

  it("refuses an oversized list and a bad cursor shape without reading the store", async () => {
    const failing: KeywordGalleryStore = { ...store, readVocabulary: async () => { throw new Error("store read"); } };
    const tooMany = Array.from({ length: 16 }, () => "coast").join(",");
    expect(await resolveKeywordGalleryRoute("en", tooMany, undefined, failing)).toBeUndefined();
    expect(await resolveKeywordGalleryRoute("en", "coast", ["a", "b"], failing)).toBeUndefined();
  });

  it("does not give a Finnish page English names", async () => {
    expect((await resolveKeywordGalleryRoute("fi", "forest", undefined, store))?.titles).toEqual(["Metsä"]);
  });

});

describe("keyword gallery addresses", () => {
  it("keeps literal commas, and keywords before cursor", () => {
    expect(keywordGalleryQuery("coast,water")).toBe("keywords=coast,water");
    expect(keywordGalleryQuery("coast,water", "a/b+c")).toBe("keywords=coast,water&cursor=a%2Fb%2Bc");
  });

  it("appends a cursor to an address that already holds its selection", () => {
    expect(galleryContinuationHref("/haku?keywords=coast,water", "abc")).toBe("/haku?keywords=coast,water&cursor=abc");
    expect(buildGalleryHref("/gallery", { cursor: "abc" })).toBe("/gallery?cursor=abc");
    expect(buildGalleryHref("/haku?keywords=coast", {})).toBe("/haku?keywords=coast");
  });
});
