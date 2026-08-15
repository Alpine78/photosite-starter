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
 *
 * Sections (AB#105) are authored the same way: gallery-local, described once
 * per language, and resolved to a plain per-language `GallerySection` before
 * they reach the shared query. This fixture implements `CuratedGallerySectionSource`
 * over its own already-cached, in-memory placements — that's a fixture property,
 * not something the contract requires; a store-backed adapter (AB#114) would push
 * the same section predicate into its own query instead.
 */

import {
  selectCuratedGalleryCover,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
} from "@/lib/gallery-pagination";
import {
  assertGallerySections,
  assertPlacementSectionReferences,
  readCuratedGallerySectionPage,
  type CuratedGalleryPage,
  type CuratedGallerySectionSource,
  type GallerySection,
  type GallerySectionIntroBlock,
} from "@/lib/gallery-sections";
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
  /** Gallery-local section this placement belongs to, if any (AB#105). */
  readonly sectionId?: string;
};

/**
 * One gallery-local section, authored per language like a placement's caption.
 * `order` is not authored here: like a placement's `order`, it is derived from
 * array position (see `buildSections`), so the fixture cannot disagree with
 * itself about its own sequence.
 */
type MockGallerySectionInput = {
  readonly sectionId: string;
  readonly slug: string;
  readonly label: Readonly<Record<string, string>>;
  readonly intro?: Readonly<Record<string, readonly GallerySectionIntroBlock[]>>;
};

type MockGalleryInput = {
  readonly placements: readonly MockPlacementInput[];
  readonly sections?: readonly MockGallerySectionInput[];
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
 * state is a state the site actually serves rather than one only a test has
 * seen: the page renders, says it has no images, and offers no grid.
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
 *
 * Sectioned into two ranges that each span more than one 24-item mock page —
 * "early" (1–150) and "late" (151–300) — so a section query is exercised across
 * a real page boundary, not just within one page. Placements 301–400 stay
 * unsectioned, exercised only through `All` (`largeArchiveSections` below also
 * declares a third, "unused" section no placement references, for the
 * valid-empty-section case).
 */
const largeArchivePlacements: readonly MockPlacementInput[] = Array.from(
  { length: LARGE_ARCHIVE_SIZE },
  (_unused, index): MockPlacementInput => {
    const position = index + 1;
    const image = archiveImageCycle[index % archiveImageCycle.length];
    const sectionId =
      position <= 150 ? "early" : position <= 300 ? "late" : undefined;

    return {
      placementId: `large-archive-${String(position).padStart(4, "0")}`,
      image,
      ...(sectionId === undefined ? {} : { sectionId }),
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

const largeArchiveSections: readonly MockGallerySectionInput[] = [
  { sectionId: "early", slug: "early", label: { en: "Early", fi: "Alkupää" } },
  { sectionId: "late", slug: "late", label: { en: "Late", fi: "Loppupää" } },
  {
    sectionId: "unused",
    slug: "unused",
    label: { en: "Unused", fi: "Käyttämätön" },
    intro: {
      en: [{ type: "paragraph", spans: [{ text: "Nothing placed here yet." }] }],
      fi: [{ type: "paragraph", spans: [{ text: "Tähän ei ole vielä valittu kuvia." }] }],
    },
  },
];

const authoredGalleries: Readonly<Record<string, MockGalleryInput>> = {
  "content-selected-work": { placements: selectedWorkPlacements },
  "content-coastal-mornings": { placements: coastalMorningsPlacements },
  "content-polar-night-sessions": { placements: polarNightPlacements },
  "content-awaiting-selection": { placements: awaitingSelectionPlacements },
  "content-large-archive": {
    placements: largeArchivePlacements,
    sections: largeArchiveSections,
  },
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
      ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
    };
  });
}

function buildSections(
  language: string,
  inputs: readonly MockGallerySectionInput[],
): readonly GallerySection[] {
  return inputs.map((input, index) => {
    const label = input.label[language];
    if (label === undefined) {
      throw new TypeError(
        `Gallery section ${input.sectionId} has no label for language: ${language}`,
      );
    }
    const intro = input.intro?.[language];

    return {
      sectionId: input.sectionId,
      slug: input.slug,
      label,
      order: index,
      ...(intro === undefined ? {} : { intro }),
    };
  });
}

/**
 * Placements and sections are built per gallery, on the first read of that
 * gallery in that language, and remembered.
 *
 * A CMS adapter answers one gallery at a time rather than building the site's
 * whole media set to serve one card, so the fixture keeps the same shape: a
 * gallery nobody asked for is never built, and a language nobody requested costs
 * nothing at all. Within one gallery it still builds that gallery's placements,
 * which is the part only a store can avoid.
 *
 * What is remembered is the gallery's *placements and sections* rather than a
 * built page. Every cursor names a different slice of the same sequence, so
 * caching pages would mint an entry per token a visitor happens to hold; the
 * ordered source is the part worth keeping, and slicing it again is cheap.
 * The two are cached together, one map entry per gallery, so they can never
 * desync — a lookup that finds one always finds the other.
 */
type CachedGallery = {
  readonly placements: readonly CuratedGalleryPlacement[];
  readonly sections: readonly GallerySection[];
};

const galleriesByLanguageAndId = new Map<string, CachedGallery>();
const covers = new Map<string, ImageMedia | undefined>();

/** A separator that cannot legally appear in either component, unlike a printable one. */
const CACHE_KEY_SEPARATOR = String.fromCharCode(0);

function cacheKey(language: string, contentId: string): string {
  return `${language}${CACHE_KEY_SEPARATOR}${contentId}`;
}

function getOrBuildGallery(
  language: string,
  contentId: string,
): CachedGallery | undefined {
  const input = authoredGalleries[contentId];
  if (input === undefined || !AUTHORED_LANGUAGES.has(language)) {
    return undefined;
  }

  const key = cacheKey(language, contentId);
  const cached = galleriesByLanguageAndId.get(key);
  if (cached !== undefined) return cached;

  const placements = buildPlacements(language, input.placements);
  const sections =
    input.sections === undefined ? [] : buildSections(language, input.sections);
  // The same kind of authoring-time checks AB#113's Studio schema will run
  // before publish (mirroring `category-validation.ts`/`article-validation.ts`),
  // run once here against the complete list rather than per request.
  assertGallerySections(sections);
  assertPlacementSectionReferences(placements, sections);

  const gallery: CachedGallery = { placements, sections };
  galleriesByLanguageAndId.set(key, gallery);
  return gallery;
}

/**
 * One bounded page of a gallery, or `undefined` when the fixture has none.
 *
 * Takes the route's validated locale, not its language subtag: the cursor is
 * scoped to the route space a visitor is actually in (and, with it, to the
 * section named in that scope — see `gallery-sections.ts`'s
 * `normalizedFilterKey`), while the fixture's text is looked up by the language
 * that locale belongs to. `sourceId` is therefore built from `locale`, not
 * `language`: `en-GB` and `en-US` are separate route spaces that merely happen
 * to share authored text today, and binding to the `en` subtag would let a
 * slice cross between them the moment an adapter can answer differently per
 * locale (AB#114) — by which point the tokens would already be indexed.
 *
 * Without a cursor this is the first page of the requested filter; with one it
 * is the slice that follows that token's boundary. `ordering` is the authored
 * manual order, the only rule the MVP has (AB#129 adds the seeded one).
 * `visibilityVersion` is not bumped by an append or a presentation-only edit —
 * only by a change that could move a cursor's boundary.
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
    sectionSlug,
    cursorCodec,
  }: {
    readonly cursor?: string;
    readonly sectionSlug?: string;
    readonly cursorCodec?: GalleryCursorCodec;
  } = {},
): CuratedGalleryPage | undefined {
  // Text is authored per language while routes are configured per locale, so
  // the two are read apart: `en-GB` and `en-US` share one set of English
  // placements but never share a cursor.
  const language = new Intl.Locale(locale).language;
  const gallery = getOrBuildGallery(language, contentId);
  if (gallery === undefined) return undefined;

  // The section predicate is applied inside the source call, before
  // `buildCuratedGalleryPage` sees any row — the seam a store-backed adapter
  // (AB#114) would turn into a `WHERE section_id = ?`-shaped query. This
  // fixture still filters an in-memory array, which is a fixture property, not
  // a contract one.
  const source: CuratedGallerySectionSource = ({ filter }) =>
    filter.kind === "all"
      ? gallery.placements
      : gallery.placements.filter(
          (placement) => placement.sectionId === filter.section.sectionId,
        );

  return readCuratedGallerySectionPage({
    query: {
      locale,
      contentId,
      pageSize: MOCK_GALLERY_PAGE_SIZE,
      ordering: "manual-v1",
      visibilityVersion: `mock-${contentId}-v1`,
      ...(sectionSlug === undefined ? {} : { sectionSlug }),
      ...(cursor === undefined ? {} : { cursor }),
    },
    sections: gallery.sections,
    source,
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
  const gallery = getOrBuildGallery(language, contentId);
  if (gallery === undefined) return undefined;

  const key = cacheKey(language, contentId);
  if (covers.has(key)) return covers.get(key);

  // The first visible placement in authored order, and nothing after it, which
  // is what the adapter's one-row query returns. Filtering before the slice
  // matters — a hidden opening placement is not the cover, it is skipped.
  const opening = gallery.placements
    .filter((placement) => placement.visible)
    .slice(0, 1);
  const cover = selectCuratedGalleryCover(opening);
  covers.set(key, cover);
  return cover;
}
