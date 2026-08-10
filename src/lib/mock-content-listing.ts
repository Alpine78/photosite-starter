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
import { withLocalizedText } from "@/lib/media";
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
  {
    contentId: "content-choosing-a-telephoto-lens",
    title: "Choosing a telephoto lens: what the specs don't tell you",
    summary:
      "Focal length and maximum aperture are only the start. Here is what I look for after years of shooting sports and wildlife with long glass.",
    publishedAt: "2024-09-12",
    cover: mockImages.openMarsh,
  },
  {
    contentId: "content-understanding-exposure-triangle",
    title: "The exposure triangle in practice",
    summary:
      "Aperture, shutter speed, and ISO are taught as separate controls, but mastering them means learning to trade one against another fluently.",
    publishedAt: "2024-07-04",
    cover: mockImages.coastalLandscape,
  },
  {
    // No cover on purpose, like the polar night gallery above: a card and a
    // detail page both have to work without one.
    contentId: "content-packing-for-a-photo-trip",
    title: "What I pack for a week-long photo trip",
    summary:
      "Camera gear is only part of the story. After dozens of trips I have settled on a system that keeps me mobile without leaving anything essential at home.",
    publishedAt: "2024-05-20",
  },
  {
    contentId: "content-shooting-in-low-light",
    title: "Low-light photography without a tripod",
    summary:
      "Modern sensors have changed what is possible hand-held after dark. Here is how I approach concerts, street scenes, and indoor events.",
    publishedAt: "2024-02-29",
    cover: mockImages.lichenStones,
  },
];

/**
 * The same public rendition the English records use, described in Finnish. Alt
 * text is what a screen reader announces inside a page that declares `lang="fi"`,
 * so it is authored per locale even though the bytes are shared.
 */
const finnishCoastalLandscape = withLocalizedText(mockImages.coastalLandscape, {
  alt: "Kivinen rantaviiva tyynen veden äärellä pilvisen taivaan alla",
});

const finnishMistyBirch = withLocalizedText(mockImages.mistyBirch, {
  alt: "Hopeakoivu sumuisessa vihreässä metsässä",
});

const finnishLichenStones = withLocalizedText(mockImages.lichenStones, {
  alt: "Sateen tummentamia kiviä vaalean jäkälän kuvioimina",
});

const finnishRecords: readonly ContentListingRecord[] = [
  {
    contentId: "content-coastal-mornings",
    title: "Rannikon aamut",
    summary:
      "Ensimmäinen valo rantaviivalla, kuvattuna useiden aikaisten aamujen aikana.",
    publishedAt: "2024-06-18",
    cover: finnishCoastalLandscape,
  },
  {
    contentId: "content-reading-coastal-light",
    title: "Rannikon valon lukeminen",
    summary:
      "Miten pilvinen aamu muuttaa rantamaisemaa ja miksi sitä kannattaa odottaa.",
    publishedAt: "2024-08-02",
    cover: finnishMistyBirch,
  },
  {
    contentId: "content-polar-night-sessions",
    title: "Kaamoskuvaukset",
    summary: "Työskentelyä pohjoisen talven pimeimpien viikkojen läpi.",
    publishedAt: "2024-12-05",
  },
  {
    contentId: "content-understanding-exposure-triangle",
    title: "Valotuskolmio käytännössä",
    summary:
      "Aukko, valotusaika ja herkkyys opetetaan erillisinä säätiminä, mutta niiden hallinta tarkoittaa sujuvaa vaihtokauppaa yhden ja toisen välillä.",
    publishedAt: "2024-07-04",
    cover: finnishCoastalLandscape,
  },
  {
    contentId: "content-shooting-in-low-light",
    title: "Hämäräkuvaus ilman jalustaa",
    summary:
      "Käytännöllinen tapa hallita valotusaikaa, herkkyyttä ja kuvanvakautusta käsivaralta kuvatessa.",
    publishedAt: "2024-02-29",
    cover: finnishLichenStones,
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
