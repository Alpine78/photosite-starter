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
} from "@/lib/gallery-pagination";
import type {
  CuratedGalleryResultItem,
  GalleryPage,
} from "@/lib/gallery-result";
import type { ImageMedia } from "@/lib/media";
import { getMockImages, type MockImages } from "@/lib/mock-media";

/**
 * Bound on one mock gallery. Continuation past it is AB#72's, so the fixture
 * stays inside a single page and says so loudly if it ever stops doing that.
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

const authoredGalleries: Readonly<Record<string, readonly MockPlacementInput[]>> =
  {
    "content-selected-work": selectedWorkPlacements,
    "content-coastal-mornings": coastalMorningsPlacements,
    "content-polar-night-sessions": polarNightPlacements,
    "content-awaiting-selection": awaitingSelectionPlacements,
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
 * A gallery's cursor scope. `sourceId` is the gallery's own stable identity, so
 * a token issued for one gallery can never be spent in another; the ordering
 * rule is the authored manual order, which is the only rule the MVP has
 * (AB#129 adds the seeded one).
 */
function cursorScope(contentId: string) {
  return {
    sourceId: contentId,
    normalizedFilter: "all",
    ordering: "manual-v1",
    visibilityVersion: `mock-${contentId}-v1`,
    pageSize: MOCK_GALLERY_PAGE_SIZE,
  } as const;
}

/**
 * Builds one gallery's first page.
 *
 * No cursor codec is supplied, because this MVP slice issues no cursor: the
 * route renders one bounded page and rejects any token (AB#66 decides the
 * cursor contract, AB#72 the continuation across grid and lightbox).
 */
function buildResult(
  language: string,
  contentId: string,
  inputs: readonly MockPlacementInput[],
): GalleryPage<CuratedGalleryResultItem> {
  return buildCuratedGalleryPage({
    placements: buildPlacements(language, inputs),
    scope: cursorScope(contentId),
  });
}

/**
 * A fixture that outgrew one page would hide its remaining items, because
 * nothing renders a continuation yet. Checked over the authored placements at
 * import — no page is built to do it — so the story that lifts the bound is
 * named where the fixture is written rather than at a visitor's request.
 */
for (const [contentId, inputs] of Object.entries(authoredGalleries)) {
  if (inputs.length > MOCK_GALLERY_PAGE_SIZE) {
    throw new TypeError(
      `mock gallery "${contentId}" has ${inputs.length} placements, more than the ${MOCK_GALLERY_PAGE_SIZE} one page holds; continuation is AB#72`,
    );
  }
}

/**
 * Results and covers are built per gallery, on the first read of that gallery in
 * that language, and remembered.
 *
 * A CMS adapter answers one gallery at a time and never builds the site's whole
 * media set to serve one card, so the fixture behaves the same way: a listing
 * that needs one cover pays for one cover, and a language nobody requested costs
 * nothing at all.
 */
const results = new Map<string, GalleryPage<CuratedGalleryResultItem>>();
const covers = new Map<string, ImageMedia | undefined>();

function cacheKey(language: string, contentId: string): string {
  return `${language}\u0000${contentId}`;
}

/** One gallery's bounded first page, or `undefined` when the fixture has none. */
export function getMockGalleryResult(
  language: string,
  contentId: string,
): GalleryPage<CuratedGalleryResultItem> | undefined {
  const inputs = authoredGalleries[contentId];
  if (inputs === undefined || !AUTHORED_LANGUAGES.has(language)) {
    return undefined;
  }

  const key = cacheKey(language, contentId);
  let result = results.get(key);
  if (result === undefined) {
    result = buildResult(language, contentId, inputs);
    results.set(key, result);
  }
  return result;
}

/**
 * The cover a gallery's listing card falls back to.
 *
 * The placement list is bounded to the opening one before the rule sees it, so
 * this is the single row a CMS adapter projects beside the card's other fields
 * rather than a gallery loaded to produce a thumbnail.
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

  // The in-memory equivalent of the adapter's one-row query: the first visible
  // placement in authored order, and nothing after it. Filtering before the
  // slice matters — a hidden opening placement is not the cover, it is skipped.
  const opening = buildPlacements(language, inputs)
    .filter((placement) => placement.visible)
    .slice(0, 1);
  const cover = selectCuratedGalleryCover(opening);
  covers.set(key, cover);
  return cover;
}
