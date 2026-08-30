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
  assertGalleryOrdering,
  selectCuratedGalleryCover,
  selectGalleryWindow,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryOrdering,
} from "@/lib/gallery-pagination";
import { computeShuffledOrder } from "@/lib/gallery-shuffle";
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
  /**
   * Keeps this placement in the pinned lead tier under a `seeded-random`
   * ordering rule (AB#129, ADR-0009 §3). Ignored for a `manual` gallery.
   */
  readonly pinned?: boolean;
  /**
   * This placement's own visibility (ADR-0002 §3). Absent means visible; `false`
   * hides this occurrence while leaving the photograph public elsewhere. The
   * grid already filters a hidden placement out; the enquiry resolver treats one
   * as an unavailable container (AB#60).
   */
  readonly visible?: boolean;
};

/** How a mock gallery is ordered. Absent means `manual`, the default. */
type MockOrderingInput = {
  readonly orderingRule?: "manual" | "seeded-random";
  /** Required exactly when `orderingRule` is `seeded-random`. */
  readonly orderingSeed?: string;
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

type MockGalleryInput = MockOrderingInput & {
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
  // AB#60 enquiry-resolution fixtures. A hidden occurrence: it stays out of the
  // grid and the enquiry resolver rejects it as an unavailable container.
  {
    placementId: "polar-night-hidden-occurrence",
    image: "forestStream",
    visible: false,
  },
  // A placement whose id is deliberately also a real `mediaId` ("open-marsh"),
  // so the enquiry resolver's `kind` discriminator is what tells a curated
  // reference from a dynamic one — this resolves to the coastal-landscape
  // photograph as a curated placement, while `kind:"dynamic"` + "open-marsh"
  // resolves the open-marsh photograph.
  {
    placementId: "open-marsh",
    image: "coastalLandscape",
    caption: { en: "Shared identity", fi: "Jaettu tunniste" },
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

/**
 * The seeded-random gallery (AB#129, ADR-0009). It exists so the shuffled
 * ordering rule is a state the site actually serves — the grid, every
 * continuation page, and the lightbox all read one materialized order — rather
 * than one only a unit test has seen.
 *
 * Generated like the large archive, and deliberately more than one 24-item mock
 * page (34 placements), so a keyset walk under the shuffle crosses a real page
 * boundary. The first three placements are `pinned`: ADR-0009 §3 keeps them in
 * their exact manual positions (`order` 0, 1, 2 from `buildPlacements`), ahead
 * of the shuffled rest. The remaining 31 also receive an ascending `order` from
 * `buildPlacements`, but it is inert for them — the materialized `shuffledOrder`,
 * not `order`, decides their sequence, which is the whole point of the rule.
 *
 * `SHUFFLED_SHOWCASE_SEED` is the fixture's fixed seed. A test that rebuilds the
 * gallery with a different seed proves "different seed => different order" and
 * that replaying the first seed's cursor fails `wrong-scope`.
 */
export const SHUFFLED_SHOWCASE_SEED = "showcase-seed-2026-08";
const SHUFFLED_SHOWCASE_SIZE = 34;
const SHUFFLED_SHOWCASE_PINNED_COUNT = 3;

const shuffledShowcasePlacements: readonly MockPlacementInput[] = Array.from(
  { length: SHUFFLED_SHOWCASE_SIZE },
  (_unused, index): MockPlacementInput => {
    const position = index + 1;
    const pinned = index < SHUFFLED_SHOWCASE_PINNED_COUNT;
    const image = archiveImageCycle[index % archiveImageCycle.length];

    return {
      placementId: `shuffled-showcase-${String(position).padStart(3, "0")}`,
      image,
      // A pinned lead keeps its authored position; a shuffled item's `order`
      // is not what sequences it, so it is left at the generator default.
      ...(pinned ? { pinned: true } : {}),
      ...(position % 4 === 0
        ? {}
        : {
            caption: {
              en: `Showcase image ${position}`,
              fi: `Esittelykuva ${position}`,
            },
          }),
    };
  },
);

const authoredGalleries: Readonly<Record<string, MockGalleryInput>> = {
  "content-selected-work": { placements: selectedWorkPlacements },
  "content-coastal-mornings": { placements: coastalMorningsPlacements },
  "content-polar-night-sessions": { placements: polarNightPlacements },
  "content-awaiting-selection": { placements: awaitingSelectionPlacements },
  "content-large-archive": {
    placements: largeArchivePlacements,
    sections: largeArchiveSections,
  },
  "content-shuffled-showcase": {
    placements: shuffledShowcasePlacements,
    orderingRule: "seeded-random",
    orderingSeed: SHUFFLED_SHOWCASE_SEED,
  },
};

/** Stable identity of the gallery this deployment features as its portfolio. */
export const MOCK_FEATURED_GALLERY_ID = "content-selected-work";

/**
 * Languages these placements carry text for. A locale outside the set publishes
 * no gallery at all rather than one described in somebody else's language.
 */
const AUTHORED_LANGUAGES: ReadonlySet<string> = new Set(["en", "fi"]);

/**
 * Resolves a gallery's authored ordering into a validated `GalleryOrdering`.
 * A `seeded-random` gallery must name a seed; a `manual` one must not.
 */
function resolveMockOrdering(input: MockOrderingInput): GalleryOrdering {
  if (input.orderingRule === "seeded-random") {
    if (input.orderingSeed === undefined) {
      throw new TypeError(
        "A seeded-random mock gallery must declare an orderingSeed",
      );
    }
    const ordering: GalleryOrdering = {
      kind: "seeded-random",
      seed: input.orderingSeed,
    };
    assertGalleryOrdering(ordering);
    return ordering;
  }
  if (input.orderingSeed !== undefined) {
    throw new TypeError(
      "orderingSeed is only used while orderingRule is seeded-random",
    );
  }
  return { kind: "manual" };
}

function buildPlacements(
  language: string,
  inputs: readonly MockPlacementInput[],
  ordering: GalleryOrdering,
): readonly CuratedGalleryPlacement[] {
  const images = getMockImages(language);
  const seed = ordering.kind === "seeded-random" ? ordering.seed : undefined;

  return inputs.map((input, index) => {
    const caption = input.caption?.[language];
    const pinned = input.pinned === true;
    // ADR-0009 §2: the shuffle key is materialized once, here, not recomputed
    // on the read path. A store-backed adapter (PR2) stores it as a field; the
    // mock computes it while building its cached placements. Only a non-pinned
    // placement of a seeded gallery gets one — a pinned lead sorts by `order`.
    const shuffledOrder =
      seed !== undefined && !pinned
        ? computeShuffledOrder(seed, input.placementId)
        : undefined;

    return {
      placementId: input.placementId,
      order: index,
      visible: input.visible ?? true,
      media: images[input.image],
      ...(caption === undefined ? {} : { captionOverride: caption }),
      ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
      ...(pinned ? { pinned: true } : {}),
      ...(shuffledOrder === undefined ? {} : { shuffledOrder }),
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
 * What is remembered is the gallery's *placements, sections, and resolved
 * ordering* rather than a built page. Every cursor names a different slice of
 * the same sequence, so caching pages would mint an entry per token a visitor
 * happens to hold; the ordered source is the part worth keeping, and slicing it
 * again is cheap. They are cached together, one map entry per gallery, so they
 * can never desync — and, for a seeded gallery, the materialized `shuffledOrder`
 * on each placement is computed exactly once, when this entry is built.
 */
type CachedGallery = {
  readonly placements: readonly CuratedGalleryPlacement[];
  readonly sections: readonly GallerySection[];
  readonly ordering: GalleryOrdering;
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

  const ordering = resolveMockOrdering(input);
  const placements = buildPlacements(language, input.placements, ordering);
  const sections =
    input.sections === undefined ? [] : buildSections(language, input.sections);
  // The same kind of authoring-time checks AB#113's Studio schema will run
  // before publish (mirroring `category-validation.ts`/`article-validation.ts`),
  // run once here against the complete list rather than per request.
  assertGallerySections(sections);
  assertPlacementSectionReferences(placements, sections);

  const gallery: CachedGallery = { placements, sections, ordering };
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
 * is the slice that follows that token's boundary. `ordering` is the gallery's
 * resolved rule (`manual` for every fixture but `content-shuffled-showcase`,
 * which is `seeded-random`); `readCuratedGallerySectionPage` derives the
 * `GalleryCursorScope.ordering` string from it, so a reseed of a seeded gallery
 * retires its outstanding cursors as `wrong-scope`. `visibilityVersion` is not
 * bumped by an append or a presentation-only edit — only by a change that could
 * move a cursor's boundary.
 *
 * The codec is handed in rather than reached for. A fixture describes what the
 * photographer authored, and which key this deployment signs its continuation
 * tokens with is not that — it belongs to the seam in `gallery.ts`, the way a
 * CMS adapter will be handed the same one. Keeping it out here also keeps this
 * module importable by anything that only wants to read the fixture, without
 * dragging a server-only secret in behind it. A gallery that fits inside one
 * page issues no cursor and so needs no codec at all.
 */
export async function getMockGalleryResult(
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
): Promise<CuratedGalleryPage | undefined> {
  // Text is authored per language while routes are configured per locale, so
  // the two are read apart: `en-GB` and `en-US` share one set of English
  // placements but never share a cursor.
  const language = new Intl.Locale(locale).language;
  const gallery = getOrBuildGallery(language, contentId);
  if (gallery === undefined) return undefined;

  // The section predicate is applied before `selectGalleryWindow` ever sees a
  // row — the seam a store-backed adapter (AB#114) would turn into a `WHERE
  // section_id = ?` clause on its own keyset query. This fixture still
  // filters an in-memory array and answers the bounded window from it, which
  // is a fixture property (AB#134 bounds the *interface*, not this in-memory
  // implementation's own work), not a contract one. `source` is declared
  // `async` only to satisfy `CuratedGallerySectionSource`'s contract — a real
  // adapter awaits its store call here; this one has nothing to await.
  const source: CuratedGallerySectionSource = async ({ filter, window }) => {
    const filtered =
      filter.kind === "all"
        ? gallery.placements
        : gallery.placements.filter(
            (placement) => placement.sectionId === filter.section.sectionId,
          );
    return selectGalleryWindow(filtered, window, gallery.ordering);
  };

  return readCuratedGallerySectionPage({
    query: {
      locale,
      contentId,
      pageSize: MOCK_GALLERY_PAGE_SIZE,
      ordering: gallery.ordering,
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
 * One curated placement of one gallery, by its site-wide `placementId`, in the
 * language a route renders — or `undefined` when the gallery or the placement is
 * not in the fixture.
 *
 * The enquiry resolver (AB#60) needs a placement's own facts — which photograph,
 * its section, whether this occurrence is visible, and the resolved caption —
 * without going through the bounded windowed read a grid uses. A store-backed
 * adapter answers this with a single keyed lookup; the fixture reads its own
 * cached placement list. `contentId` is resolved to a supported public route by
 * the caller before this is reached, so a `undefined` here means the fixture and
 * the content tree disagree.
 */
export function findMockCuratedPlacement(
  language: string,
  contentId: string,
  placementId: string,
): CuratedGalleryPlacement | undefined {
  return getOrBuildGallery(language, contentId)?.placements.find(
    (placement) => placement.placementId === placementId,
  );
}

/**
 * The cover a gallery's listing card falls back to: the first visible placement
 * in the gallery's active order (manual, or — for `content-shuffled-showcase` —
 * pinned leads then the materialized shuffle), whose media renders publicly.
 *
 * A store-backed adapter answers this with a one-row `order(...) [0]` query and
 * hands `selectCuratedGalleryCover` that single row. The in-memory fixture has
 * nowhere else to order, so it passes the whole visible list plus the ordering
 * rule and lets `selectCuratedGalleryCover` sort — the bounding is real for a
 * store, the saving is not, and only a store can have both.
 */
export function getMockGalleryCover(
  language: string,
  contentId: string,
): ImageMedia | undefined {
  const gallery = getOrBuildGallery(language, contentId);
  if (gallery === undefined) return undefined;

  const key = cacheKey(language, contentId);
  if (covers.has(key)) return covers.get(key);

  const cover = selectCuratedGalleryCover(gallery.placements, gallery.ordering);
  covers.set(key, cover);
  return cover;
}
