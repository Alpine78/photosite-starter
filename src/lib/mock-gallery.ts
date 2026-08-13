/**
 * Curated gallery mock used until the CMS adapter lands.
 *
 * One gallery per `contentId` in the public content tree, so a gallery is
 * reached the way every other page is: the tree resolves a path to an identity,
 * and this fixture answers with that gallery's ordered result. Nothing here
 * knows about routes, locales' path vocabulary, or the grid.
 *
 * Placements are authored once and described per language. The structure — which
 * photograph, in which position, under which placement identity — is the same in
 * every locale, because ADR-0003 associates language versions by stable identity
 * and a translated caption is not an identity. Only the words change.
 *
 * Order is the array order. The authored sequence is the manual order the whole
 * story rests on, and deriving `order` from the position rather than restating
 * it as a number keeps the fixture from disagreeing with itself.
 */

import {
  buildCuratedGalleryPage,
  selectCuratedGalleryCover,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
} from "@/lib/gallery-pagination";
import type {
  CuratedGalleryResultItem,
  GalleryPage,
} from "@/lib/gallery-result";
import type { ImageMedia } from "@/lib/media";
import { getMockImages, type MockImages } from "@/lib/mock-media";

/**
 * How many items one page of a mock gallery holds.
 *
 * A gallery longer than this now continues rather than being refused: the page
 * issues an opaque cursor and the next one resumes after it. The number is the
 * fixture's own bound, not a contract — `MAX_GALLERY_PAGE_SIZE` is the ceiling
 * the shared builder enforces.
 */
const MOCK_GALLERY_PAGE_SIZE = 24;

type MockPlacementInput = {
  readonly placementId: string;
  readonly image: keyof MockImages;
  /**
   * Placement caption per language subtag. A language with no entry shows the
   * media's own caption, which is the normal partly-translated state.
   */
  readonly caption?: Readonly<Record<string, string>>;
};

/**
 * The site's own selection: a manually curated mix rather than a themed series,
 * which is what the header, footer, and home page point at. It carries the six
 * placements, order, and captions the pre-tree `/portfolio` route published, so
 * the migration into the content tree changed the address and nothing a visitor
 * sees.
 */
const selectedWorkPlacements: readonly MockPlacementInput[] = [
  {
    placementId: "selected-work-coastal-landscape",
    image: "coastalLandscape",
    caption: { en: "Quiet coast", fi: "Hiljainen rannikko" },
  },
  {
    placementId: "selected-work-misty-birch",
    image: "mistyBirch",
    caption: { en: "Morning mist", fi: "Aamun sumu" },
  },
  {
    placementId: "selected-work-lakeside-reeds",
    image: "lakesideReeds",
  },
  {
    placementId: "selected-work-forest-stream",
    image: "forestStream",
    caption: { en: "Forest stream", fi: "Metsäpuro" },
  },
  {
    placementId: "selected-work-open-marsh",
    image: "openMarsh",
    caption: { en: "After the rain", fi: "Sateen jälkeen" },
  },
  {
    placementId: "selected-work-lichen-stones",
    image: "lichenStones",
    caption: { en: "Shoreline details", fi: "Rantaviivan yksityiskohtia" },
  },
];

/** A themed series, and the gallery whose listing card has an authored cover. */
const coastalMorningsPlacements: readonly MockPlacementInput[] = [
  {
    placementId: "coastal-mornings-coastal-landscape",
    image: "coastalLandscape",
    caption: { en: "First light", fi: "Ensimmäinen valo" },
  },
  {
    placementId: "coastal-mornings-open-marsh",
    image: "openMarsh",
    caption: { en: "Low water", fi: "Matala vesi" },
  },
  {
    placementId: "coastal-mornings-lakeside-reeds",
    image: "lakesideReeds",
  },
];

/**
 * No authored listing cover anywhere in this gallery's records, so it is the
 * fixture that exercises the deterministic first-public-item fallback — and the
 * card it produces has to open with the same photograph the page does.
 */
const polarNightPlacements: readonly MockPlacementInput[] = [
  {
    placementId: "polar-night-misty-birch",
    image: "mistyBirch",
    caption: { en: "Blue hour", fi: "Sininen hetki" },
  },
  {
    placementId: "polar-night-forest-stream",
    image: "forestStream",
  },
  {
    placementId: "polar-night-lichen-stones",
    image: "lichenStones",
    caption: { en: "Frozen detail", fi: "Jäätynyt yksityiskohta" },
  },
];

/**
 * A published gallery whose selection is not made yet. It exists so the empty
 * state is a state the site actually serves rather than one only a unit test
 * has seen: the page renders, says it has no images, and offers no grid.
 */
const awaitingSelectionPlacements: readonly MockPlacementInput[] = [];

/** The demo images the archive cycles, in a fixed order so it is reproducible. */
const archiveImageCycle = [
  "coastalLandscape",
  "mistyBirch",
  "lakesideReeds",
  "forestStream",
  "openMarsh",
  "lichenStones",
] as const satisfies readonly (keyof MockImages)[];

const LARGE_ARCHIVE_SIZE = 400;

/**
 * A gallery far larger than one page, and the reason continuation exists.
 *
 * Six demo photographs stand in for four hundred, each under its own placement
 * identity — the contract separates where a photograph appears from which
 * photograph it is precisely so one asset can be placed many times, and a real
 * archive of this size is exactly the case that made the distinction worth
 * having. What is being exercised is the ordering, the page boundaries, and the
 * cursor between them, none of which depends on the pictures differing.
 *
 * Generated rather than authored: four hundred literal entries would be four
 * hundred chances for the fixture to disagree with itself about its own order.
 * Ids are zero-padded so their string order matches their manual order, which
 * keeps the deterministic tie-breaker aligned with the sequence even though
 * unique `order` values mean it never has to break a tie.
 */
const largeArchivePlacements: readonly MockPlacementInput[] = Array.from(
  { length: LARGE_ARCHIVE_SIZE },
  (_unused, index): MockPlacementInput => {
    const position = index + 1;
    const image = archiveImageCycle[index % archiveImageCycle.length];

    return {
      placementId: `large-archive-${String(position).padStart(4, "0")}`,
      image,
      // Every fourth placement carries none, so an item with no caption keeps
      // appearing after a page boundary rather than only on the first page.
      ...(position % 4 === 0
        ? {}
        : {
            caption: {
              en: `Archive image ${position}`,
              fi: `Arkistokuva ${position}`,
            },
          }),
    };
  },
);

const authoredGalleries: Readonly<Record<string, readonly MockPlacementInput[]>> =
  {
    "content-selected-work": selectedWorkPlacements,
    "content-coastal-mornings": coastalMorningsPlacements,
    "content-polar-night-sessions": polarNightPlacements,
    "content-awaiting-selection": awaitingSelectionPlacements,
    "content-large-archive": largeArchivePlacements,
  };

/** Stable identity of the gallery this deployment features as its portfolio. */
export const MOCK_FEATURED_GALLERY_ID = "content-selected-work";

/**
 * Languages these placements carry text for. A locale outside the set publishes
 * no gallery at all rather than one described in somebody else's language.
 */
const AUTHORED_LANGUAGES: ReadonlySet<string> = new Set(["en", "fi"]);

function buildPlacements(
  language: string,
  inputs: readonly MockPlacementInput[],
): readonly CuratedGalleryPlacement[] {
  const images = getMockImages(language);

  return inputs.map((input, index) => {
    const caption = input.caption?.[language];

    return {
      placementId: input.placementId,
      order: index,
      visible: true,
      media: images[input.image],
      ...(caption === undefined ? {} : { captionOverride: caption }),
    };
  });
}

/**
 * A gallery's cursor scope.
 *
 * `sourceId` is the gallery's stable identity *in one route locale*, so a token
 * issued for one gallery can never be spent in another — and a token issued on
 * one locale's route can never be spent on another's. It is bound to the whole
 * validated locale rather than to its language subtag, because `en-GB` and
 * `en-US` are separate route spaces that merely happen to share authored text
 * today; binding to `en` would let a slice cross between them.
 *
 * These results currently agree across locales, so mixing them would be harmless
 * now; it stops being harmless the moment an adapter can answer differently per
 * locale (AB#114), and by then the tokens would already be indexed. It is also
 * the property the continuation page's metadata relies on when it declines to
 * name `hreflang` alternates.
 *
 * The ordering rule is the authored manual order, which is the only rule the
 * MVP has (AB#129 adds the seeded one).
 */
function cursorScope(locale: string, contentId: string) {
  return {
    sourceId: `${contentId}@${locale}`,
    normalizedFilter: "all",
    ordering: "manual-v1",
    visibilityVersion: `mock-${contentId}-v1`,
    pageSize: MOCK_GALLERY_PAGE_SIZE,
  } as const;
}

/**
 * Placements and covers are built per gallery, on the first read of that gallery
 * in that language, and remembered.
 *
 * A CMS adapter answers one gallery at a time rather than building the site's
 * whole media set to serve one card, so the fixture keeps the same shape: a
 * gallery nobody asked for is never built, and a language nobody requested costs
 * nothing at all. Within one gallery it still builds that gallery's placements,
 * which is the part only a store can avoid.
 *
 * What is remembered is the gallery's *placements* rather than a built page.
 * Every cursor names a different slice of the same sequence, so caching pages
 * would mint an entry per token a visitor happens to hold; the ordered source is
 * the part worth keeping, and slicing it again is cheap.
 */
const placementsByGallery = new Map<
  string,
  readonly CuratedGalleryPlacement[]
>();
const covers = new Map<string, ImageMedia | undefined>();

function cacheKey(language: string, contentId: string): string {
  return `${language}\u0000${contentId}`;
}

/**
 * One bounded page of a gallery, or `undefined` when the fixture has none.
 *
 * Takes the route's validated locale, not its language subtag: the cursor is
 * scoped to the route space a visitor is actually in, while the fixture's text
 * is looked up by the language that locale belongs to.
 *
 * Without a cursor this is the first page; with one it is the slice that follows
 * that token's boundary.
 *
 * The codec is handed in rather than reached for. A fixture describes what the
 * photographer authored, and which key this deployment signs its continuation
 * tokens with is not that — it belongs to the seam in `gallery.ts`, the way a
 * CMS adapter will be handed the same one. Keeping it out here also keeps this
 * module importable by anything that only wants to read the fixture, without
 * dragging a server-only secret in behind it. A gallery that fits inside one
 * page issues no cursor and so needs no codec at all.
 */
export function getMockGalleryResult(
  locale: string,
  contentId: string,
  {
    cursor,
    cursorCodec,
  }: {
    readonly cursor?: string;
    readonly cursorCodec?: GalleryCursorCodec;
  } = {},
): GalleryPage<CuratedGalleryResultItem> | undefined {
  // Text is authored per language while routes are configured per locale, so
  // the two are read apart: `en-GB` and `en-US` share one set of English
  // placements but never share a cursor.
  const language = new Intl.Locale(locale).language;
  const inputs = authoredGalleries[contentId];
  if (inputs === undefined || !AUTHORED_LANGUAGES.has(language)) {
    return undefined;
  }

  const key = cacheKey(language, contentId);
  let placements = placementsByGallery.get(key);
  if (placements === undefined) {
    placements = buildPlacements(language, inputs);
    placementsByGallery.set(key, placements);
  }

  return buildCuratedGalleryPage({
    placements,
    scope: cursorScope(locale, contentId),
    ...(cursor === undefined ? {} : { cursor }),
    ...(cursorCodec === undefined ? {} : { cursorCodec }),
  });
}

/**
 * The cover a gallery's listing card falls back to.
 *
 * The rule is handed one placement, which is the shape of the query that matters:
 * a CMS adapter projects that single row beside the card's other fields instead
 * of loading a gallery to produce a thumbnail. Getting to it here still walks
 * the authored list, because an in-memory fixture has nowhere else to order —
 * the bounding is real, the saving is not, and only a store can have both.
 */
export function getMockGalleryCover(
  language: string,
  contentId: string,
): ImageMedia | undefined {
  const inputs = authoredGalleries[contentId];
  if (inputs === undefined || !AUTHORED_LANGUAGES.has(language)) {
    return undefined;
  }

  const key = cacheKey(language, contentId);
  if (covers.has(key)) return covers.get(key);

  // The first visible placement in authored order, and nothing after it, which
  // is what the adapter's one-row query returns. Filtering before the slice
  // matters — a hidden opening placement is not the cover, it is skipped.
  const opening = buildPlacements(language, inputs)
    .filter((placement) => placement.visible)
    .slice(0, 1);
  const cover = selectCuratedGalleryCover(opening);
  covers.set(key, cover);
  return cover;
}
