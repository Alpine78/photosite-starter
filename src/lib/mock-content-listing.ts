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
import { effectiveEventDate } from "@/lib/content-page";
import type { ImageMedia } from "@/lib/media";
import {
  FIELDNOTE_NUMBERS,
  fieldnoteContentId,
  fieldnotePublishedAt,
} from "@/lib/mock-fieldnotes";
import { getMockGalleryCover } from "@/lib/mock-gallery";
import { getMockImages } from "@/lib/mock-media";

const englishImages = getMockImages("en");
const finnishImages = getMockImages("fi");

/**
 * The authored truth for one page's shared (card *and* detail) fields, before
 * `withGalleryCovers` fills a fallback cover and before `publishedAt`/`eventDate`
 * collapse into the single effective `ContentListingRecord.eventDate` a card
 * contract carries (AB#150, ADR-0017). The mock keeps the raw fields here so
 * `mock-content-pages.ts#compose` can put them on the `ContentPage` and
 * `content.ts`'s mock tree build can apply the `endDate` gate.
 *
 * `eventDate`/`endDate` follow the fixture's established date-only convention
 * (`2024-06-18`), never a datetime, so every mock comparison stays internally
 * consistent (ADR-0017 decision 3).
 */
type AuthoredContentRecord = {
  readonly contentId: string;
  readonly title: string;
  readonly summary?: string;
  readonly publishedAt: string;
  /** When the real-world event happened, when it differs from publish order. */
  readonly eventDate?: string;
  /** A permanently-past date on the one fixture that exercises the auto-hide. */
  readonly endDate?: string;
  readonly cover?: ImageMedia;
};

/** Cards for the generated Gear field notes — see `mock-fieldnotes.ts`. */
const fieldnoteRecords: readonly AuthoredContentRecord[] = FIELDNOTE_NUMBERS.map(
  (n) => ({
    contentId: fieldnoteContentId(n),
    title: `Field note ${n}`,
    summary:
      "A short placeholder note. Replaced with real content from the CMS.",
    publishedAt: fieldnotePublishedAt(n),
  }),
);

const englishRecords: readonly AuthoredContentRecord[] = [
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
    // AB#150/ADR-0017 reorder fixture (article): the shoreline sessions this
    // piece reflects on ran into spring 2025, but it was written up and
    // published in August 2024. By publish order it sits mid-list; by
    // effective event date it moves to the very top, ahead of
    // `content-selected-work` (2025-01-15).
    contentId: "content-reading-coastal-light",
    title: "Reading coastal light",
    summary:
      "How overcast mornings change what a shoreline shows, and why they are worth waiting for.",
    publishedAt: "2024-08-02",
    eventDate: "2025-03-15",
    cover: englishImages.mistyBirch,
  },
  {
    // AB#150/ADR-0017 reorder fixture (gallery): the polar night of early
    // 2024, edited and published nearly a year later. Publish order puts it
    // second (after 2025-01-15); effective event order drops it to
    // 2024-01-15 — below `content-shooting-in-low-light` (2024-02-29) and
    // above the 2024-01-08 cluster.
    contentId: "content-polar-night-sessions",
    title: "Polar night sessions",
    summary: "Working through the darkest weeks of the northern winter.",
    publishedAt: "2024-12-05",
    eventDate: "2024-01-15",
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
    contentId: "content-large-archive",
    title: "Large archive",
    summary:
      "A gallery long enough to continue past its first page. Placeholder gallery content.",
    publishedAt: "2024-01-05",
  },
  {
    // The cover doubles as the AB#149 fixture proving a continuation slice
    // never shows a hero, whatever the gallery's own cover: this is the one
    // gallery both long enough to continue and carrying an authored cover
    // (`content-large-archive` is deliberately left untouched — it is a
    // load-bearing fixture for AB#79's own bounded-preload measurement, and
    // an added full-bleed hero image was found to perturb its network-count
    // assertion on desktop-chromium). Deliberately not the gallery's own
    // first pinned lead (`mistyBirch` vs. `coastalLandscape`), so the first
    // page also exercises the clean, non-duplicate hero case —
    // `content-coastal-mornings` already covers the duplicate-but-explicit
    // one.
    contentId: "content-shuffled-showcase",
    title: "Shuffled showcase",
    summary:
      "A gallery in seeded-random order, long enough to continue past its first page. Placeholder gallery content.",
    publishedAt: "2024-01-04",
    cover: englishImages.mistyBirch,
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
  {
    // AB#150/ADR-0017 auto-hide fixture (gallery). `endDate` is permanently in
    // the past, so every public read treats this published, canonically placed
    // gallery as unpublished — no listing card, no detail route, no sitemap
    // entry — a state the site actually serves rather than one only a unit
    // test constructs, matching the empty-gallery / ordering-stale fixture
    // convention.
    contentId: "content-ended-gallery",
    title: "Season pass 2019",
    summary:
      "A time-limited gallery whose scheduled end date has passed. Placeholder gallery content.",
    publishedAt: "2019-01-10",
    endDate: "2020-01-10",
  },
  {
    // AB#150/ADR-0017 auto-hide fixture (article), same permanently-past
    // `endDate`.
    contentId: "content-ended-article",
    title: "Notice: 2018 workshop enrolment",
    summary:
      "A time-limited announcement whose scheduled end date has passed. Placeholder content.",
    publishedAt: "2018-08-01",
    endDate: "2019-01-01",
  },
  ...fieldnoteRecords,
];

const finnishRecords: readonly AuthoredContentRecord[] = [
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
    eventDate: "2025-03-15",
    cover: finnishImages.mistyBirch,
  },
  {
    contentId: "content-polar-night-sessions",
    title: "Kaamoskuvaukset",
    summary: "Työskentelyä pohjoisen talven pimeimpien viikkojen läpi.",
    publishedAt: "2024-12-05",
    eventDate: "2024-01-15",
  },
  {
    contentId: "content-awaiting-selection",
    title: "Odottaa valintaa",
    summary: "Sarja on vielä työn alla. Paikkamerkkisisältöä.",
    publishedAt: "2024-01-08",
  },
  {
    contentId: "content-large-archive",
    title: "Suuri arkisto",
    summary:
      "Galleria, joka jatkuu ensimmäisen sivunsa yli. Paikkamerkkisisältöä.",
    publishedAt: "2024-01-05",
  },
  {
    contentId: "content-shuffled-showcase",
    title: "Sekoitettu esittely",
    summary:
      "Galleria satunnaistetussa järjestyksessä, joka jatkuu ensimmäisen sivunsa yli. Paikkamerkkisisältöä.",
    publishedAt: "2024-01-04",
    cover: finnishImages.mistyBirch,
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
  records: readonly AuthoredContentRecord[],
): readonly AuthoredContentRecord[] {
  return records.map((record) => {
    if (record.cover !== undefined) return record;

    const cover = getMockGalleryCover(language, record.contentId);
    return cover === undefined ? record : { ...record, cover };
  });
}

/**
 * The card-contract projection of one authored record: `publishedAt`/`eventDate`
 * collapse into the single effective `ContentListingRecord.eventDate`
 * (`content-page.ts#effectiveEventDate`), and `endDate` drops out — a card for
 * an ended page is never reached, because the content tree already treats it as
 * unpublished (AB#150, ADR-0017). This is the projection a real adapter's
 * listing query performs.
 */
function toListingRecord(record: AuthoredContentRecord): ContentListingRecord {
  return {
    contentId: record.contentId,
    title: record.title,
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    eventDate: effectiveEventDate(record),
    ...(record.cover === undefined ? {} : { cover: record.cover }),
  };
}

function indexAuthored(
  records: readonly AuthoredContentRecord[],
): ReadonlyMap<string, AuthoredContentRecord> {
  return new Map(records.map((record) => [record.contentId, record]));
}

function indexListing(
  records: readonly ContentListingRecord[],
): ReadonlyMap<string, ContentListingRecord> {
  return new Map(records.map((record) => [record.contentId, record]));
}

/**
 * The same records, indexed *before* `withGalleryCovers` fills in a
 * gallery's fallback cover.
 *
 * `mockContentListingRecords` below is correct for a card, and wrong for a
 * page's own hero (AB#149, ADR-0003's 2026-09-04 amendment): the fallback is
 * deliberately the gallery's own first grid item, so composing a detail
 * page's `cover` field from the post-fallback record would open every
 * gallery with no authored cover with a hero identical to the grid's first
 * item — exactly the duplication AB#149 exists to prevent by default.
 * `mock-content-pages.ts#compose` reads this map instead, mirroring
 * `sanity-gallery.ts#projectGalleryContentPage`'s own explicit-only
 * projection, which never had this fallback to begin with. It also carries the
 * raw `publishedAt`/`eventDate`/`endDate` a `ContentPage` needs and the mock
 * tree build's `endDate` gate reads (AB#150, ADR-0017).
 */
export const mockAuthoredContentRecords: Readonly<
  Record<string, ReadonlyMap<string, AuthoredContentRecord>>
> = {
  en: indexAuthored(englishRecords),
  fi: indexAuthored(finnishRecords),
};

export type { AuthoredContentRecord };

/** Card-contract listing records per language subtag (effective event date, fallback cover). */
export const mockContentListingRecords: Readonly<
  Record<string, ReadonlyMap<string, ContentListingRecord>>
> = {
  en: indexListing(withGalleryCovers("en", englishRecords).map(toListingRecord)),
  fi: indexListing(withGalleryCovers("fi", finnishRecords).map(toListingRecord)),
};
