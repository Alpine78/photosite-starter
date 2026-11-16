import { describe, expect, it } from "vitest";

import { getMockGalleryResult } from "@/lib/mock-gallery";
import { getMockMediaKeywordIndex, getMockKeywordTaxonomy, MOCK_VIDEO_MEDIA } from "@/lib/mock-keywords";
import { projectPublicImageMedia } from "@/lib/media";
import {
  buildMediaKeywordIndex, buildPublicKeywordTaxonomy, expandKeywordIds, keywordsOfMedia, MAX_KEYWORD_DEPTH, mediaMatchesAllKeywords,
  type PublicKeyword,
} from "@/lib/media-keywords";

const keyword = (keywordId: string, parentKeywordId: string | null = null): PublicKeyword => ({ keywordId, title: keywordId, categorySlug: "subject", parentKeywordId });
const chain = (length: number) => Array.from({ length }, (_, index) => keyword(`level-${index}`, index === 0 ? null : `level-${index - 1}`));

describe("public keyword taxonomy", () => {
  it("accepts exactly the depth limit and refuses one level more", () => {
    expect(() => buildPublicKeywordTaxonomy(chain(MAX_KEYWORD_DEPTH))).not.toThrow();
    expect(() => buildPublicKeywordTaxonomy(chain(MAX_KEYWORD_DEPTH + 1))).toThrow(/deeper/);
  });

  it.each([
    ["an invalid id", [keyword("A")], /invalid id/],
    ["an id over 40 characters", [keyword("a".repeat(41))], /invalid id/],
    ["a repeated id", [keyword("same"), keyword("same")], /repeated/],
    ["an unknown parent", [keyword("child", "missing")], /unknown parent/],
    ["a parent cycle", [keyword("one", "two"), keyword("two", "one")], /cycle/],
    ["a blank title", [{ ...keyword("blank"), title: "  " }], /no title/],
  ])("refuses %s", (_name, keywords, message) => {
    expect(() => buildPublicKeywordTaxonomy(keywords)).toThrow(message);
  });

  it("expands a keyword to its ancestors, once each", () => {
    const taxonomy = buildPublicKeywordTaxonomy([keyword("root"), keyword("left", "root"), keyword("right", "root")]);
    expect(expandKeywordIds(["left", "right"], taxonomy)).toEqual(["left", "right", "root"]);
    expect(() => expandKeywordIds(["missing"], taxonomy)).toThrow(/unknown keyword/);
  });
});

describe("media keyword assignments", () => {
  it("refuses two assignments for one medium", () => {
    const one = { mediaId: "m", keywordIds: [], expandedKeywordIds: [] };
    expect(() => buildMediaKeywordIndex([one, one])).toThrow(/two keyword assignments/);
  });

  it("gives an untagged medium an empty set", () => {
    expect(keywordsOfMedia(new Map(), "m")).toEqual({ mediaId: "m", keywordIds: [], expandedKeywordIds: [] });
  });

  it("matches every selected keyword through the stored closure, even when it lags the hierarchy", () => {
    const stale = { mediaId: "m", keywordIds: ["leaf"], expandedKeywordIds: ["leaf", "old-root"] };
    expect(mediaMatchesAllKeywords(stale, ["old-root"])).toBe(true);
    expect(mediaMatchesAllKeywords(stale, ["leaf", "old-root"])).toBe(true);
    expect(mediaMatchesAllKeywords(stale, ["leaf", "new-root"])).toBe(false);
    expect(mediaMatchesAllKeywords(stale, [])).toBe(true);
  });
});

describe("mock keywords", () => {
  const index = getMockMediaKeywordIndex();
  const matching = (...selected: string[]) => [...index.values()].filter((media) => mediaMatchesAllKeywords(media, selected)).map((media) => media.mediaId).sort();

  it("holds a two-level hierarchy and several configurable categories", () => {
    const taxonomy = getMockKeywordTaxonomy("en");
    expect(taxonomy.byId.get("water")?.parentKeywordId).toBe("nature");
    expect(new Set(taxonomy.keywords.map((entry) => entry.categorySlug)).size).toBeGreaterThanOrEqual(3);
    expect(matching("nature")).toEqual(["coastal-landscape", "forest-stream", "lakeside-reeds", "misty-birch"]);
  });

  it("selects one medium with two keywords", () => {
    expect(matching("coast", "water")).toEqual(["coastal-landscape"]);
  });

  it("keeps a video-capable item in the same model", () => {
    expect(MOCK_VIDEO_MEDIA.type).toBe("video");
    expect(matching("coast")).toContain(MOCK_VIDEO_MEDIA.mediaId);
  });

  it("gives a keyword a title in each language", () => {
    expect(getMockKeywordTaxonomy("fi").byId.get("forest")?.title).toBe("Metsä");
    expect(getMockKeywordTaxonomy("en").byId.get("forest")?.title).toBe("Forest");
  });

  it("gives a medium placed in two galleries one keyword set, whatever its placements say", async () => {
    const first = await getMockGalleryResult("en", "content-selected-work");
    const second = await getMockGalleryResult("en", "content-coastal-mornings");
    const idsOf = (result: typeof first) => (result?.items ?? []).map((item) => item.media.mediaId);
    const shared = idsOf(first).filter((mediaId) => idsOf(second).includes(mediaId));
    expect(shared).toContain("coastal-landscape");
    expect(keywordsOfMedia(index, "coastal-landscape").keywordIds).toEqual(["coast", "water"]);
  });
});

describe("the browser-bound media value", () => {
  it("carries no keyword or import field, even when an adapter hands it some", () => {
    const projected = projectPublicImageMedia({
      mediaId: "m", publiclyRenderable: true, alt: "",
      rendition: { src: "/gallery/m.1683eecb7e65.webp", version: "1683eecb7e65", width: 1, height: 1, sourceKind: "public-web-derivative" },
      keywords: [{ _ref: "x" }], keywordIds: ["x"], expandedKeywordIds: ["x"], importedKeywords: ["private term"], keywordOverrides: {}, internalKeywords: [{ _ref: "keyword.x" }],
    } as Parameters<typeof projectPublicImageMedia>[0]);
    expect(Object.keys(projected).sort()).toEqual(["alt", "mediaId", "rendition", "type"]);
    expect(JSON.stringify(projected)).not.toMatch(/keyword|private term/i);
  });
});
