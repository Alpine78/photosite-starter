/**
 * Listing fields for the mock content tree, until the CMS adapter lands.
 *
 * Deliberately separate from `mock-content-tree.ts`: that module authors
 * structure — identity, placement, order — while these are the few fields a
 * card shows. Keeping them apart is the same boundary a real adapter needs,
 * where a listing query must project these and never an article body or a
 * gallery's media collection.
 *
 * One set per language subtag, keyed by the same immutable `contentId` the tree
 * uses, so a translated title never becomes the thing that associates versions.
 * `content-polar-night-sessions` has no cover on purpose: a page without one is
 * a normal authoring state, and the card must handle it without inventing an
 * image.
 */

import type { ContentListingRecord } from "@/lib/content-listing";
import { mockImages } from "@/lib/mock-media";

const englishRecords: readonly ContentListingRecord[] = [
  {
    contentId: "content-coastal-mornings",
    title: "Coastal mornings",
    summary:
      "First light along the shoreline, photographed over a series of early starts.",
    publishedAt: "2024-06-18",
    cover: mockImages.coastalLandscape,
  },
  {
    contentId: "content-reading-coastal-light",
    title: "Reading coastal light",
    summary:
      "How overcast mornings change what a shoreline shows, and why they are worth waiting for.",
    publishedAt: "2024-08-02",
    cover: mockImages.mistyBirch,
  },
  {
    contentId: "content-polar-night-sessions",
    title: "Polar night sessions",
    summary: "Working through the darkest weeks of the northern winter.",
    publishedAt: "2024-12-05",
  },
];

const finnishRecords: readonly ContentListingRecord[] = [
  {
    contentId: "content-coastal-mornings",
    title: "Rannikon aamut",
    summary:
      "Ensimmäinen valo rantaviivalla, kuvattuna useiden aikaisten aamujen aikana.",
    publishedAt: "2024-06-18",
    cover: mockImages.coastalLandscape,
  },
  {
    contentId: "content-polar-night-sessions",
    title: "Kaamoskuvaukset",
    summary: "Työskentelyä pohjoisen talven pimeimpien viikkojen läpi.",
    publishedAt: "2024-12-05",
  },
];

function index(
  records: readonly ContentListingRecord[],
): ReadonlyMap<string, ContentListingRecord> {
  return new Map(records.map((record) => [record.contentId, record]));
}

/** Authored listing records per language subtag. */
export const mockContentListingRecords: Readonly<
  Record<string, ReadonlyMap<string, ContentListingRecord>>
> = {
  en: index(englishRecords),
  fi: index(finnishRecords),
};
