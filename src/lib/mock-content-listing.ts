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
 * `content-polar-night-sessions` has no authored cover on purpose, and neither
 * does the article `content-packing-for-a-photo-trip`: a page without one is a
 * normal authoring state. The two are handled differently on purpose. An article
 * has no images of its own to fall back on and renders as a text card, while a
 * gallery falls back to its first public item, which is the rule
 * `selectCuratedGalleryCover` owns and `withGalleryCovers` applies below. A
 * gallery with no items yet — `content-awaiting-selection` — has nothing to fall
 * back to either, so it renders as a text card like the article does.
 */

import type { ContentListingRecord } from "@/lib/content-listing";
import { getMockGalleryCover } from "@/lib/mock-gallery";
import { getMockImages } from "@/lib/mock-media";

const englishImages = getMockImages("en");
const finnishImages = getMockImages("fi");

const englishRecords: readonly ContentListingRecord[] = [
  {
    // The curated selection the site chrome features. Its card takes the
    // gallery's own opening photograph rather than an authored cover, which is
    // what keeps the card and the page a visitor lands on in step.
    contentId: "content-selected-work",
    title: "Selected work",
    summary:
      "A hand-picked selection across recent projects. Placeholder gallery content; replaced with real work from the CMS.",
    publishedAt: "2025-01-15",
  },
  {
    contentId: "content-coastal-mornings",
    title: "Coastal mornings",
    summary:
      "First light along the shoreline, photographed over a series of early starts.",
    publishedAt: "2024-06-18",
    cover: englishImages.coastalLandscape,
  },
  {
    contentId: "content-reading-coastal-light",
    title: "Reading coastal light",
    summary:
      "How overcast mornings change what a shoreline shows, and why they are worth waiting for.",
    publishedAt: "2024-08-02",
    cover: englishImages.mistyBirch,
  },
  {
    contentId: "content-polar-night-sessions",
    title: "Polar night sessions",
    summary: "Working through the darkest weeks of the northern winter.",
    publishedAt: "2024-12-05",
  },
  {
    // No cover, and no first item to fall back to either: an empty gallery's
    // card is a text card, exactly like an article with no cover.
    contentId: "content-awaiting-selection",
    title: "Awaiting selection",
    summary: "A series still being edited. Placeholder gallery content.",
    publishedAt: "2024-01-08",
  },
  {
    contentId: "content-choosing-a-telephoto-lens",
    title: "Choosing a telephoto lens: what the specs don't tell you",
    summary:
      "Focal length and maximum aperture are only the start. Here is what I look for after years of shooting sports and wildlife with long glass.",
    publishedAt: "2024-09-12",
    cover: englishImages.openMarsh,
  },
  {
    contentId: "content-understanding-exposure-triangle",
    title: "The exposure triangle in practice",
    summary:
      "Aperture, shutter speed, and ISO are taught as separate controls, but mastering them means learning to trade one against another fluently.",
    publishedAt: "2024-07-04",
    cover: englishImages.coastalLandscape,
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
    cover: englishImages.lichenStones,
  },
];

const finnishRecords: readonly ContentListingRecord[] = [
  {
    contentId: "content-selected-work",
    title: "Valikoima",
    summary:
      "Käsin valittu kokoelma viimeaikaisista töistä. Paikkamerkkisisältöä; korvataan CMS:n sisällöllä.",
    publishedAt: "2025-01-15",
  },
  {
    contentId: "content-coastal-mornings",
    title: "Rannikon aamut",
    summary:
      "Ensimmäinen valo rantaviivalla, kuvattuna useiden aikaisten aamujen aikana.",
    publishedAt: "2024-06-18",
    cover: finnishImages.coastalLandscape,
  },
  {
    contentId: "content-reading-coastal-light",
    title: "Rannikon valon lukeminen",
    summary:
      "Miten pilvinen aamu muuttaa rantamaisemaa ja miksi sitä kannattaa odottaa.",
    publishedAt: "2024-08-02",
    cover: finnishImages.mistyBirch,
  },
  {
    contentId: "content-polar-night-sessions",
    title: "Kaamoskuvaukset",
    summary: "Työskentelyä pohjoisen talven pimeimpien viikkojen läpi.",
    publishedAt: "2024-12-05",
  },
  {
    contentId: "content-awaiting-selection",
    title: "Odottaa valintaa",
    summary: "Sarja on vielä työn alla. Paikkamerkkisisältöä.",
    publishedAt: "2024-01-08",
  },
  {
    contentId: "content-understanding-exposure-triangle",
    title: "Valotuskolmio käytännössä",
    summary:
      "Aukko, valotusaika ja herkkyys opetetaan erillisinä säätiminä, mutta niiden hallinta tarkoittaa sujuvaa vaihtokauppaa yhden ja toisen välillä.",
    publishedAt: "2024-07-04",
    cover: finnishImages.coastalLandscape,
  },
  {
    contentId: "content-shooting-in-low-light",
    title: "Hämäräkuvaus ilman jalustaa",
    summary:
      "Käytännöllinen tapa hallita valotusaikaa, herkkyyttä ja kuvanvakautusta käsivaralta kuvatessa.",
    publishedAt: "2024-02-29",
    cover: finnishImages.lichenStones,
  },
];

/**
 * Fills in the cover of any record whose page is a curated gallery with no
 * authored one.
 *
 * A gallery that has items has an image to show, so leaving its card blank would
 * hide work the page is made of. The fallback is the gallery's own first public
 * item in manual order, resolved through `selectCuratedGalleryCover`, which is
 * the same ordering the gallery's first page renders — so the card opens with
 * the photograph the visitor is about to see, on every request. A gallery whose
 * selection is not made yet has no such item and keeps no cover.
 *
 * One image, not a collection: this is the single row a CMS adapter projects
 * beside the card's other fields, and the listing query boundary is unchanged.
 *
 * These records are composed for both languages when the module loads, which is
 * what a fixture can do and an adapter cannot; the per-locale projection it
 * stands in for runs per request.
 */
function withGalleryCovers(
  language: string,
  records: readonly ContentListingRecord[],
): readonly ContentListingRecord[] {
  return records.map((record) => {
    if (record.cover !== undefined) return record;

    const cover = getMockGalleryCover(language, record.contentId);
    return cover === undefined ? record : { ...record, cover };
  });
}

function index(
  records: readonly ContentListingRecord[],
): ReadonlyMap<string, ContentListingRecord> {
  return new Map(records.map((record) => [record.contentId, record]));
}

/** Authored listing records per language subtag. */
export const mockContentListingRecords: Readonly<
  Record<string, ReadonlyMap<string, ContentListingRecord>>
> = {
  en: index(withGalleryCovers("en", englishRecords)),
  fi: index(withGalleryCovers("fi", finnishRecords)),
};
