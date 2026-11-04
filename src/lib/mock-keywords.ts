/**
 * Keyword fixture for the shared media model (AB#68): configurable categories, a two-level
 * hierarchy, one medium two keywords select together, and a video-capable item. Neutral on
 * purpose, because a deployment's vocabulary is content. Nothing renders these yet.
 */

import "server-only";

import {
  buildMediaKeywordIndex,
  buildPublicKeywordTaxonomy,
  expandKeywordIds,
  type MediaKeywordIndex,
  type PublicKeywordTaxonomy,
} from "@/lib/media-keywords";
import type { VideoMedia } from "@/lib/media";

const KEYWORDS = [
  { keywordId: "nature", title: { en: "Nature", fi: "Luonto" }, categorySlug: "subject", parentKeywordId: null },
  { keywordId: "water", title: { en: "Water", fi: "Vesi" }, categorySlug: "subject", parentKeywordId: "nature" },
  { keywordId: "trees", title: { en: "Trees", fi: "Puut" }, categorySlug: "subject", parentKeywordId: "nature" },
  { keywordId: "coast", title: { en: "Coast", fi: "Rannikko" }, categorySlug: "place", parentKeywordId: null },
  { keywordId: "forest", title: { en: "Forest", fi: "Metsä" }, categorySlug: "place", parentKeywordId: null },
  { keywordId: "autumn", title: { en: "Autumn", fi: "Syksy" }, categorySlug: "season", parentKeywordId: null },
] as const;

/** Never rendered: it shows that a keyword assignment needs no image rendition. */
export const MOCK_VIDEO_MEDIA: VideoMedia = {
  type: "video",
  mediaId: "sample-video",
  src: "https://media.example.invalid/sample-video.mp4",
  title: "Sample video",
  width: 1920,
  height: 1080,
};

const ASSIGNMENTS: Readonly<Record<string, readonly string[]>> = {
  "coastal-landscape": ["coast", "water"],
  "forest-stream": ["forest", "water"],
  "lakeside-reeds": ["water"],
  "misty-birch": ["autumn", "trees"],
  "lichen-stones": ["forest"],
  [MOCK_VIDEO_MEDIA.mediaId]: ["coast"],
};

/** Each language has a title for every keyword, so the fallback rule stays the adapter's concern. */
export function getMockKeywordTaxonomy(language: string): PublicKeywordTaxonomy {
  return buildPublicKeywordTaxonomy(KEYWORDS.map(({ title, ...keyword }) => ({
    ...keyword,
    title: language === "fi" ? title.fi : title.en,
  })));
}

export function getMockMediaKeywordIndex(): MediaKeywordIndex {
  const taxonomy = getMockKeywordTaxonomy("en");
  return buildMediaKeywordIndex(Object.entries(ASSIGNMENTS).map(([mediaId, keywordIds]) => ({
    mediaId,
    keywordIds,
    expandedKeywordIds: expandKeywordIds(keywordIds, taxonomy),
  })));
}
