/**
 * The mock content source's keyword gallery (AB#58), over `mock-keywords.ts`. It applies the
 * same rule as the Sanity source, in memory: discoverable images whose stored closure holds
 * every keyword, in the shared public order. The video item is keyworded but not delivered,
 * because the public result is images until a video renderer exists.
 */

import "server-only";

import { compareKeywordGalleryOrder, type KeywordGallerySource, type KeywordGalleryRow } from "@/lib/keyword-gallery";
import type { KeywordVocabularySnapshot } from "@/lib/keyword-gallery-selection";
import { keywordsOfMedia, mediaMatchesAllKeywords } from "@/lib/media-keywords";
import { getMockImages } from "@/lib/mock-media";
import { getMockKeywordTaxonomy, getMockMediaKeywordIndex, MOCK_ARCHIVE_MEDIA_IDS } from "@/lib/mock-keywords";

const MOCK_TAXONOMY_VERSION = 1;
const MOCK_LATEST_CHANGE = "2026-01-01T00:00:00Z";

/** One keyword id kept as a merge record, so a redirect can be exercised. */
const MOCK_MERGED_INTO: ReadonlyMap<string, string> = new Map([["seaside", "coast"]]);
/** Opted out of keyword galleries, as a client delivery would be. */
const OPTED_OUT: ReadonlySet<string> = new Set(["lichen-stones"]);
/** Undated media sort last. */
const CAPTURED_AT: Readonly<Record<string, string>> = {
  "coastal-landscape": "2025-06-01T08:00:00.000Z",
  "forest-stream": "2025-06-01T08:00:00.000Z",
  "misty-birch": "2024-10-12T07:30:00.000Z",
};

export function getMockKeywordVocabulary(language: string): KeywordVocabularySnapshot {
  return { taxonomyVersion: MOCK_TAXONOMY_VERSION, taxonomy: getMockKeywordTaxonomy(language), mergedInto: MOCK_MERGED_INTO };
}

export function createMockKeywordGallerySource(language: string): KeywordGallerySource {
  const index = getMockMediaKeywordIndex();
  const images = getMockImages(language);
  const archive = MOCK_ARCHIVE_MEDIA_IDS.map((mediaId) => ({ ...images.coastalLandscape, mediaId }));
  const rowsFor = (canonicalIds: readonly string[]): readonly KeywordGalleryRow[] => [...Object.values(images), ...archive]
    .filter((media) => !OPTED_OUT.has(media.mediaId) && index.has(media.mediaId) && mediaMatchesAllKeywords(keywordsOfMedia(index, media.mediaId), canonicalIds))
    .map((media) => ({ orderKey: CAPTURED_AT[media.mediaId] ?? "", media }))
    .sort((left, right) => compareKeywordGalleryOrder({ orderKey: left.orderKey, mediaId: left.media.mediaId }, { orderKey: right.orderKey, mediaId: right.media.mediaId }));
  return {
    readLatestChange: async (canonicalIds) => (rowsFor(canonicalIds).length === 0 ? undefined : MOCK_LATEST_CHANGE),
    readBoundary: async (canonicalIds, mediaId) => rowsFor(canonicalIds).find((row) => row.media.mediaId === mediaId),
    readWindow: async ({ canonicalIds, after, limit }) => rowsFor(canonicalIds)
      .filter((row) => after === undefined || compareKeywordGalleryOrder(after, { orderKey: row.orderKey, mediaId: row.media.mediaId }) < 0)
      .slice(0, limit),
  };
}
