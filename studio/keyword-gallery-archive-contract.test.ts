import { evaluate, parse } from "groq-js/1";
import { beforeAll, describe, expect, it } from "vitest";

import { createKeywordGalleryCursorCodec, keywordGalleryScope, KEYWORD_GALLERY_PAGE_SIZE } from "../src/lib/keyword-gallery";
import { resolveKeywordGalleryRoute, type KeywordGalleryRoute, type KeywordGalleryStore } from "../src/lib/keyword-gallery-route";
import { createSanityKeywordGallerySource, readSanityKeywordVocabulary } from "../src/lib/sanity-keyword-gallery";
import type { SanityClient } from "../src/lib/sanity-client";
import { ancestorsOf, ARCHIVE_MEDIA_COUNT, ARCHIVE_PROJECT, buildKeywordArchive, expectedMatches, type KeywordArchive } from "./keyword-archive-fixture";

/**
 * The completed keyword query at archive scale (AB#73): a raw `?keywords=` value through the real
 * route, the real queries and the real projection, evaluated by GROQ over about 8000 media. It
 * models query semantics, not Sanity's perspective, access control or latency.
 *
 * Budgets here hold what does not vary by machine. Time is measured separately; see
 * `docs/keyword-gallery-scale.md`.
 */

// Evaluating GROQ over thousands of documents takes seconds per walk, past Vitest's 5 s default.
const WALK_TIMEOUT = 180_000;
const SIGNING_KEY = "k".repeat(32);
const LOCALE = "en-GB";

const PAGE_JSON_BUDGET = 12 * 1024;
const FIRST_PAGE_QUERIES = 3;
const CONTINUATION_QUERIES = 4;

let archive: KeywordArchive;
let queries: { tag: string; rows: number }[] = [];

function storeFor(vocabularyDataset: readonly unknown[], mediaDataset: readonly unknown[], signingKey = SIGNING_KEY): KeywordGalleryStore {
  const client = {
    query: async ({ query, params, tag }: { query: string; params: Record<string, unknown>; tag: string }) => {
      const dataset = tag === "keyword-gallery.vocabulary" ? vocabularyDataset : mediaDataset;
      const result = await (await evaluate(parse(query, { params }), { dataset, params })).get();
      queries.push({ tag, rows: Array.isArray(result) ? result.length : 1 });
      return result;
    },
  } as unknown as SanityClient;
  return {
    readVocabulary: (locale) => readSanityKeywordVocabulary({ language: locale, fallbackLanguage: "en", client }),
    source: (locale) => createSanityKeywordGallerySource({ language: locale, fallbackLanguage: "en", client, config: ARCHIVE_PROJECT }),
    cursorCodec: createKeywordGalleryCursorCodec(signingKey),
  };
}

let store: KeywordGalleryStore;
const route = (keywords: string, cursor?: string, using = store) => resolveKeywordGalleryRoute(LOCALE, keywords, cursor, using);

async function walk(keywords: string): Promise<readonly string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await route(keywords, cursor);
    if (result === undefined) throw new Error(`the walk for ${keywords} ended early`);
    expect(result.page.items.length).toBeLessThanOrEqual(KEYWORD_GALLERY_PAGE_SIZE);
    ids.push(...result.page.items.map((item) => item.mediaId));
    cursor = result.page.page.endCursor ?? undefined;
  } while (cursor !== undefined);
  return ids;
}

/** `count` unrelated leaves that at least one photograph holds together, from the rarest such photograph. */
function intersection(count: number, atMost: number): readonly string[] {
  const rootOf = (keywordId: string) => ancestorsOf(keywordId, archive.byId).at(-1)!;
  for (const item of [...archive.media].reverse()) {
    const byRoot = new Map(item.assigned.map((keywordId) => [rootOf(keywordId), keywordId]));
    if (byRoot.size < count) continue;
    const selected = [...byRoot.values()].slice(0, count).sort();
    if (expectedMatches(archive, selected).length <= atMost) return selected;
  }
  throw new Error(`no ${count}-keyword intersection in the fixture`);
}

beforeAll(() => {
  archive = buildKeywordArchive();
  store = storeFor(archive.vocabularyDataset, archive.mediaDataset);
});

describe("the fixture", () => {
  it("represents the archive the work item names", () => {
    expect(archive.media).toHaveLength(ARCHIVE_MEDIA_COUNT);
    expect(new Set(archive.media.map((item) => item.mediaId)).size).toBe(ARCHIVE_MEDIA_COUNT);
    expect(archive.keywords.filter((keyword) => keyword.parent === null).length).toBeGreaterThan(10);
    expect(archive.keywords.length).toBeLessThanOrEqual(500);
    expect(expectedMatches(archive, ["subject-r1"]).length).toBeGreaterThan(1000);
    expect(expectedMatches(archive, ["season-r6-m5-l4"]).length).toBeLessThan(100);
  });

  it("is the same on every run", () => {
    expect(buildKeywordArchive().media).toEqual(archive.media);
  });
});

describe("every page of a selection", () => {
  it.each([[1, 60], [2, 60], [3, 60], [4, 60], [5, 60]])("%i unrelated keywords: exactly the photographs holding all of them, in order, once each", async (count, atMost) => {
    const selection = intersection(count, atMost);
    expect(await walk(selection.join(","))).toEqual(expectedMatches(archive, selection));
  }, WALK_TIMEOUT);

  it("a narrow leaf, a parent over it and a root agree with the hierarchy, and a parent holds its children", async () => {
    const leaf = "season-r6-m5-l4", middle = "season-r6-m5";
    const leafIds = await walk(leaf), middleIds = await walk(middle);
    expect(leafIds).toEqual(expectedMatches(archive, [leaf]));
    expect(middleIds).toEqual(expectedMatches(archive, [middle]));
    expect(middleIds).toEqual(expect.arrayContaining([...leafIds]));
    expect(middleIds.length).toBeGreaterThan(leafIds.length);
  }, WALK_TIMEOUT);

  // The broadest root's walk takes about a minute of GROQ here. It was run once and is recorded in the document.
  it("a broad parent is whole across many pages, with no repeat or gap", async () => {
    const expected = expectedMatches(archive, ["place-r1-m1"]);
    expect(expected.length).toBeGreaterThan(KEYWORD_GALLERY_PAGE_SIZE * 5);
    const ids = await walk("place-r1-m1");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expected);
  }, WALK_TIMEOUT);
});

describe("one address per selection", () => {
  const shape = (result: KeywordGalleryRoute | undefined) => ({ canonical: result?.canonicalParam, ids: result?.page.items.map((item) => item.mediaId) });

  it.each([
    ["an ancestor collapses into its descendant", "subject-r1,subject-r1-m1-l1", "subject-r1-m1-l1"],
    ["the whole chain collapses", "subject-r1-m1-l1,subject-r1,subject-r1-m1", "subject-r1-m1-l1"],
    ["order does not matter", "subject-r1-m1,place-r1-m1", "place-r1-m1,subject-r1-m1"],
    ["a repeat does not matter", "place-r1,place-r1", "place-r1"],
    ["spaces and empty elements do not matter", " place-r1 ,,", "place-r1"],
    ["a merged id reaches its target", "old-name", "subject-r1"],
  ])("%s", async (_name, raw, canonical) => {
    const [variant, direct] = [await route(raw), await route(canonical)];
    expect(variant?.redirect).toBe(true);
    expect(direct?.redirect).toBe(false);
    expect(shape(variant)).toEqual(shape(direct));
    expect(variant?.canonicalQuery).toBe(direct?.canonicalQuery);
    expect(variant?.canonicalParam).toBe(canonical);
  }, WALK_TIMEOUT);

  it("gives a variant and its canonical form one cursor, so they share a cache identity", async () => {
    const variant = await route("subject-r1,subject-r1-m1"), direct = await route("subject-r1-m1");
    expect(variant?.page.page.endCursor).toBeTruthy();
    expect(variant?.page.page.endCursor).toBe(direct?.page.page.endCursor);
  }, WALK_TIMEOUT);

  it("counts a selection after collapsing it, and refuses more than five left", async () => {
    const roots = ["subject-r1", "subject-r2", "place-r1", "place-r2", "season-r1"];
    expect((await route([...roots, "subject-r1-m1"].join(",")))?.canonicalParam.split(",")).toHaveLength(5);
    expect(await route([...roots, "season-r2"].join(","))).toBeUndefined();
  }, WALK_TIMEOUT);
});

describe("a cursor", () => {
  let cursor: string;
  beforeAll(async () => {
    cursor = (await route("subject-r1"))!.page.page.endCursor!;
  }, WALK_TIMEOUT);

  it("continues its own selection and nothing else", async () => {
    expect(await route("subject-r1", cursor)).toBeDefined();
    expect(await route("subject-r2", cursor)).toBeUndefined();
    expect(await resolveKeywordGalleryRoute("fi-FI", "subject-r1", cursor, store)).toBeUndefined();
  }, WALK_TIMEOUT);

  it("dies with a changed hierarchy, a changed photograph or another signing key", async () => {
    const moved = archive.vocabularyDataset.map((document) => (document._id === "keywordTaxonomyState" ? { ...document, taxonomyVersion: 5 } : document));
    expect(await route("subject-r1", cursor, storeFor(moved, archive.mediaDataset))).toBeUndefined();
    const edited = archive.mediaDataset.map((document) => (document._type === "media" && document.mediaId === "archive-00001" ? { ...document, _updatedAt: "2026-11-02T00:00:00Z" } : document));
    expect(await route("subject-r1", cursor, storeFor(archive.vocabularyDataset, edited))).toBeUndefined();
    expect(await route("subject-r1", cursor, storeFor(archive.vocabularyDataset, archive.mediaDataset, "x".repeat(32)))).toBeUndefined();
  }, WALK_TIMEOUT);

  it("cannot name a photograph outside the query, even correctly signed", async () => {
    const scope = keywordGalleryScope(["subject-r1"], 4, "2026-11-01T00:00:00Z", KEYWORD_GALLERY_PAGE_SIZE, LOCALE);
    const codec = createKeywordGalleryCursorCodec(SIGNING_KEY);
    expect(await route("subject-r1", codec.encode(scope, expectedMatches(archive, ["subject-r1"])[0]))).toBeDefined();
    for (const excluded of archive.excludedIds) expect(await route("subject-r1", codec.encode(scope, excluded))).toBeUndefined();
  }, WALK_TIMEOUT);
});

describe("isolation", () => {
  it("never returns a photograph that is opted out, private, not renderable or not an image, though it holds every keyword", async () => {
    for (const selection of ["subject-r1-m1-l1", "subject-r1", intersection(5, 60).join(",")]) {
      const ids = (await route(selection))!.page.items.map((item) => item.mediaId);
      for (const excluded of archive.excludedIds) expect(ids).not.toContain(excluded);
    }
  }, WALK_TIMEOUT);

  it("answers nothing for an internal or a retired keyword, and an id is the only token", async () => {
    for (const token of ["private-person", "retired-name", "A private name", "Name of subject-r1", "nonexistent"]) expect(await route(token)).toBeUndefined();
  }, WALK_TIMEOUT);

  it("puts nothing private in a page, and no field the public contract does not name", async () => {
    const serialized = JSON.stringify((await route("subject-r1"))!.page);
    expect(serialized).not.toMatch(/private|importedKeywords|internalKeywords|keywordOverrides|expandedKeywordIds|capturedAt|archiveLocator|_rev/);
  }, WALK_TIMEOUT);
});

describe("what one request costs", () => {
  it("a first page reads a bounded window, never the whole match set", async () => {
    queries = [];
    await route("subject-r1");
    expect(queries).toHaveLength(FIRST_PAGE_QUERIES);
    expect(queries.find((entry) => entry.tag === "keyword-gallery.window")?.rows).toBe(KEYWORD_GALLERY_PAGE_SIZE + 1);
  }, WALK_TIMEOUT);

  it("a continuation adds one bounded boundary read, however deep it is", async () => {
    const first = await route("subject-r1");
    const second = await route("subject-r1", first!.page.page.endCursor!);
    queries = [];
    await route("subject-r1", second!.page.page.endCursor!);
    expect(queries).toHaveLength(CONTINUATION_QUERIES);
    expect(queries.find((entry) => entry.tag === "keyword-gallery.boundary")?.rows).toBe(1);
    expect(queries.find((entry) => entry.tag === "keyword-gallery.window")?.rows).toBe(KEYWORD_GALLERY_PAGE_SIZE + 1);
  }, WALK_TIMEOUT);

  it("a page of photographs stays within its budget", async () => {
    const { page } = (await route("subject-r1"))!;
    expect(page.items).toHaveLength(KEYWORD_GALLERY_PAGE_SIZE);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(PAGE_JSON_BUDGET);
  }, WALK_TIMEOUT);
});
