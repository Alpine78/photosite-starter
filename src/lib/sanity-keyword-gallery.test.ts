import { describe, expect, it, vi } from "vitest";

import { defineMediaType } from "../../sanity/schemas/media";
import { KEYWORD_TAXONOMY_STATE_ID } from "../../sanity/schemas/keyword-rules";
import type { SanityClient } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import { PUBLIC_MEDIA_ORDER } from "@/lib/sanity-media";
import {
  createSanityKeywordGallerySource, KEYWORD_TAXONOMY_STATE_DOCUMENT_ID, KEYWORD_VOCABULARY_QUERY, keywordGalleryBoundaryQuery, keywordGalleryFilter, keywordGalleryLatestChangeQuery, keywordGalleryWindowQuery, parseKeywordVocabulary,
} from "@/lib/sanity-keyword-gallery";

const keywordRow = (keywordId: string) => ({ keywordId, title: [{ language: "en", value: keywordId }], categorySlug: "subject", parentRef: null, parentKeywordId: null });

describe("the queries", () => {
  it("reads a field the schema declares, and the state document the Studio writes", () => {
    const fields = defineMediaType({ datasetVisibility: "public" }).fields.map((field: { name: string }) => field.name);
    expect(fields).toContain("dynamicallyDiscoverable");
    expect(KEYWORD_TAXONOMY_STATE_DOCUMENT_ID).toBe(KEYWORD_TAXONOMY_STATE_ID);
  });

  it("keeps a photograph out unless it is opted in, public, an image and holds every keyword", () => {
    const filter = keywordGalleryFilter(["aa", "bb"]);
    expect(filter).toContain("dynamicallyDiscoverable == true");
    expect(filter).toContain("publiclyRenderable == true");
    expect(filter).toContain("privateOnly");
    expect(filter).toContain('mediaType == "image"');
    expect(filter).toContain("$k0 in expandedKeywordIds && $k1 in expandedKeywordIds");
  });

  it("never interpolates a keyword value", () => {
    const hostile = 'x" || true || "';
    for (const query of [keywordGalleryFilter([hostile]), keywordGalleryLatestChangeQuery([hostile]), keywordGalleryBoundaryQuery([hostile]), keywordGalleryWindowQuery([hostile], true)]) {
      expect(query).not.toContain(hostile);
    }
  });

  it("applies one predicate to the scope, the boundary and the candidates", () => {
    const filter = keywordGalleryFilter(["aa"]);
    expect(keywordGalleryLatestChangeQuery(["aa"])).toContain(filter);
    expect(keywordGalleryBoundaryQuery(["aa"])).toContain(filter);
    const window = keywordGalleryWindowQuery(["aa"], true);
    expect(window).toContain(filter);
    expect(window).toContain(PUBLIC_MEDIA_ORDER);
  });

  it("compares the key in the direction of the order", () => {
    expect(keywordGalleryWindowQuery(["aa"], true)).toContain('coalesce(capturedAt, "") < $afterKey || (coalesce(capturedAt, "") == $afterKey && mediaId > $afterId)');
    expect(keywordGalleryWindowQuery(["aa"], false)).not.toContain("$afterKey");
  });

  it("never names private or administrative fields, and no aliases", () => {
    for (const query of [KEYWORD_VOCABULARY_QUERY, keywordGalleryWindowQuery(["aa"], true)]) {
      expect(query).not.toMatch(/importedKeywords|keywordOverrides|internalKeywords|keywordRecord|aliases|archiveLocator/);
    }
    expect(KEYWORD_VOCABULARY_QUERY.match(/_id in path\("\*"\)/g)).toHaveLength(2);
  });

  it.each([[[]], [["a", "b", "c", "d", "e", "f"]]])("refuses a query for %j", (ids) => {
    expect(() => keywordGalleryFilter(ids)).toThrow(RangeError);
  });
});

describe("parsing the vocabulary", () => {
  it("treats a missing state document as version 0, and reads merges", () => {
    const snapshot = parseKeywordVocabulary({ taxonomyVersion: null, keywords: [keywordRow("aa")], mergeRecords: [{ keywordId: "bb", mergedIntoKeywordId: "aa" }] }, "en-GB", "en-GB");
    expect(snapshot.taxonomyVersion).toBe(0);
    expect(snapshot.mergedInto.get("bb")).toBe("aa");
    expect(snapshot.taxonomy.byId.has("aa")).toBe(true);
  });

  it.each([
    ["no result", null, /malformed/],
    ["a negative version", { taxonomyVersion: -1, keywords: [], mergeRecords: [] }, /taxonomy version/],
    ["a text version", { taxonomyVersion: "1", keywords: [], mergeRecords: [] }, /taxonomy version/],
    ["no merge list", { taxonomyVersion: 1, keywords: [] }, /merge records/],
    ["a merge row with no id", { taxonomyVersion: 1, keywords: [], mergeRecords: [{}] }, /malformed/],
    ["a dangling merge", { taxonomyVersion: 1, keywords: [], mergeRecords: [{ keywordId: "bb", mergedIntoKeywordId: null }] }, /dangling/],
    ["a repeated merge", { taxonomyVersion: 1, keywords: [], mergeRecords: [{ keywordId: "bb", mergedIntoKeywordId: "aa" }, { keywordId: "bb", mergedIntoKeywordId: "aa" }] }, /repeated/],
  ])("refuses %s", (_name, result, message) => {
    expect(() => parseKeywordVocabulary(result, "en", "en")).toThrow(message);
  });
});

describe("the source", () => {
  const config = { projectId: "abc123", dataset: "preview" } as unknown as SanityConfig;
  const options = (query: (request: unknown) => unknown) => ({ language: "en", fallbackLanguage: "en", config, client: { query: vi.fn(async (request: unknown) => query(request)) } as unknown as SanityClient });

  it("sends keyword values and the boundary only as parameters", async () => {
    const opts = options(() => []);
    await createSanityKeywordGallerySource(opts).readWindow({ canonicalIds: ["aa", "bb"], after: { orderKey: "", mediaId: "m" }, limit: 3 });
    expect(opts.client.query).toHaveBeenCalledWith(expect.objectContaining({ params: { k0: "aa", k1: "bb", limit: 3, afterKey: "", afterId: "m" } }));
  });

  it("reads no change when nothing matches, and refuses anything but text", async () => {
    expect(await createSanityKeywordGallerySource(options(() => null)).readLatestChange(["aa"])).toBeUndefined();
    await expect(createSanityKeywordGallerySource(options(() => 3)).readLatestChange(["aa"])).rejects.toThrow(/malformed/);
  });

  it("reads the media's enquiry opt-in beside the row, and refuses anything but a boolean", async () => {
    expect(keywordGalleryWindowQuery(["aa"], false)).toContain('"enquiryAllowed": enquiryEligible == true');
    await expect(createSanityKeywordGallerySource(options(() => [{ orderKey: "", enquiryAllowed: "yes", document: {} }])).readWindow({ canonicalIds: ["aa"], after: undefined, limit: 2 })).rejects.toThrow(/malformed/);
  });

  it("reads a boundary, and refuses a repeated identity", async () => {
    expect(await createSanityKeywordGallerySource(options(() => [])).readBoundary(["aa"], "m")).toBeUndefined();
    await expect(createSanityKeywordGallerySource(options(() => [{}, {}])).readBoundary(["aa"], "m")).rejects.toThrow(/more than once/);
    await expect(createSanityKeywordGallerySource(options(() => null)).readBoundary(["aa"], "m")).rejects.toThrow(/malformed/);
  });

  it.each([
    ["not a list", { candidates: [] }],
    ["a malformed row", [{ orderKey: 1 }]],
  ])("refuses a window with %s", async (_name, result) => {
    await expect(createSanityKeywordGallerySource(options(() => result)).readWindow({ canonicalIds: ["aa"], after: undefined, limit: 2 })).rejects.toThrow(TypeError);
  });
});
