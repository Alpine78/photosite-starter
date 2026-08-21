/**
 * The pure, no-IO half of AB#84's seed script: the full set of sample Sanity
 * documents this repository's own schemas describe, built as plain data.
 *
 * ## Why six media documents, not more
 *
 * ADR-0002 and `sanity/schemas/media.ts` are explicit: one photograph is one
 * document, described once, reused wherever it appears. This fixture has
 * exactly six real, already-vetted, non-personal demo photographs
 * (`public/gallery/*.webp`), so it creates exactly six `media` documents —
 * never more identities than there are photographs. Every placement, cover,
 * hero, and body-media block below references one of those six; a photograph
 * appearing in hundreds of placements is exactly what ADR-0002 describes as
 * normal, not a workaround for not having more images.
 *
 * ## Two-phase construction — logical asset keys, not real refs
 *
 * `buildSeedFixtures()` never needs a real Sanity asset id to produce a valid,
 * fully-checkable document set: each media document's `image.asset._ref`
 * resolves through `resolveAssetRef`, which falls back to a recognizable
 * placeholder (`PENDING_ASSET_REF_PREFIX`) when no `assetRefsByKey` map is
 * given. Dry-run and every structural test call this with no map at all —
 * building and validating the *logical* spec, with no network involved. Only
 * the CLI's apply path, after the six real assets are actually uploaded,
 * calls it again with the resolved id map to produce the documents that are
 * actually sent to Sanity's mutate endpoint.
 *
 * ## The `seed.**` id namespace
 *
 * Every document below gets a dot-segmented `_id` under `seed.` — `seed.media.…`,
 * `seed.category.…`, `seed.gallery.<contentId>.<language>`, etc. Dot segments
 * are what Sanity's own `path()` GROQ function matches hierarchically (the same
 * mechanism `drafts.<id>` relies on), so `*[_id in path("seed.**")]` is a
 * correct single-query way to find or remove every document this script owns.
 * A hyphen prefix would not satisfy `path()` matching — see `docs/sanity-seeding.md`.
 *
 * ## Deterministic `_key`s
 *
 * Every array-of-object field (localized text/slug entries, navigation items,
 * pricing tiers, content blocks, gallery sections/intro blocks, secondary
 * category references) carries a stable `_key`, derived from the item's own
 * logical identity rather than left for Sanity to auto-assign. A repeated
 * `createOrReplace` of the same logical content must not reshuffle every
 * array item's key on every run — that would make the seeded content painful
 * and risky to ever hand-edit in Studio afterward, undermining the whole
 * point of a "handoff".
 *
 * ## What this module restates from `sanity/schemas`, and why it cannot import it
 *
 * A first draft imported type-name constants directly from `sanity/schemas/*`
 * — that directory carries no `server-only` marker, so the risk that keeps
 * every other `scripts/*.mts` file from importing `src/lib` does not apply to
 * it. But it turned out to be unusable anyway, for an unrelated, purely
 * mechanical reason: this script runs under plain `node`, whose native ESM
 * resolver requires a literal file extension on every specifier, while
 * `sanity/schemas/*.ts` files import each other without one (correct for the
 * bundler-style resolution `tsconfig.json` and Vitest both use, which is how
 * every existing `sanity/**\/*.test.ts` file already imports them safely —
 * just not how plain `node` resolves a relative import). Rewriting every
 * schema file's internal imports to fix that would touch code well outside
 * this story, so every type name and numeric bound this module needs is
 * restated as a local constant instead — the same move `gallery-placement.ts`
 * itself already makes for constants it cannot import from `src/lib`, and
 * `sanity-seed-fixtures.test.mts` pins every one of them equal to the real
 * schema constant so the two copies cannot silently drift.
 */

const ARTICLE_TYPE_NAME = "article";
const CATEGORY_TYPE_NAME = "category";
const GALLERY_TYPE_NAME = "gallery";
const GALLERY_PLACEMENT_TYPE_NAME = "galleryPlacement";
const HOME_PAGE_TYPE_NAME = "homePage";
const HOME_ACTION_TYPE_NAME = "homeAction";
const HOME_SECTION_TYPE_NAME = "homeSection";
const LOCALIZED_TEXT_TYPE_NAME = "localizedText";
const LOCALIZED_SLUG_TYPE_NAME = "localizedSlug";
const MEDIA_TYPE_NAME = "media";
const NAVIGATION_ITEM_TYPE_NAME = "navigationItem";
const SERVICE_TYPE_NAME = "service";
const SITE_SETTINGS_TYPE_NAME = "siteSettings";

const GALLERY_SECTION_INLINE_SPAN_TYPE_NAME = "gallerySectionInlineSpan";
const GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME = "gallerySectionIntroParagraphBlock";
const GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME = "gallerySectionIntroListItem";
const GALLERY_SECTION_INTRO_LIST_TYPE_NAME = "gallerySectionIntroListBlock";

type ContentBlockKind = "paragraph" | "heading" | "list" | "blockquote" | "media" | "youtube";

/** Restates `content-block.ts`'s `CONTENT_BLOCK_OBJECT_TYPES`. */
const CONTENT_BLOCK_OBJECT_TYPES: Readonly<Record<ContentBlockKind, string>> = {
  paragraph: "contentParagraphBlock",
  heading: "contentHeadingBlock",
  list: "contentListBlock",
  blockquote: "contentQuoteBlock",
  media: "contentMediaBlock",
  youtube: "contentYoutubeBlock",
};

/** Restates `media.ts`'s exported public-delivery policy constants. */
const MAX_PUBLIC_DELIVERY_DIMENSION = 2048;
const PUBLIC_DELIVERY_FORMATS: Readonly<Record<string, string>> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Restates `localized-text.ts`'s `LANGUAGE_SUBTAG`. */
const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

export {
  ARTICLE_TYPE_NAME,
  CATEGORY_TYPE_NAME,
  GALLERY_TYPE_NAME,
  GALLERY_PLACEMENT_TYPE_NAME,
  HOME_PAGE_TYPE_NAME,
  MEDIA_TYPE_NAME,
  SERVICE_TYPE_NAME,
  SITE_SETTINGS_TYPE_NAME,
  MAX_PUBLIC_DELIVERY_DIMENSION,
  PUBLIC_DELIVERY_FORMATS,
  // Exported only so `sanity-seed-fixtures.test.mts` can pin every restated
  // constant equal to the real one in `sanity/schemas` — nothing else in this
  // module's own public surface needs them individually.
  HOME_ACTION_TYPE_NAME,
  HOME_SECTION_TYPE_NAME,
  LOCALIZED_TEXT_TYPE_NAME,
  LOCALIZED_SLUG_TYPE_NAME,
  NAVIGATION_ITEM_TYPE_NAME,
  GALLERY_SECTION_INLINE_SPAN_TYPE_NAME,
  GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME,
  GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME,
  GALLERY_SECTION_INTRO_LIST_TYPE_NAME,
  CONTENT_BLOCK_OBJECT_TYPES,
  LANGUAGE_SUBTAG,
};

// ---------------------------------------------------------------------------
// The `seed.**` id namespace
// ---------------------------------------------------------------------------

export const SEED_ID_ROOT = "seed";

/** Restates every schema's own (unexported) identity-pattern regex. */
export const SEED_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function seedId(...segments: readonly string[]): string {
  for (const segment of segments) {
    if (!SEED_ID_PATTERN.test(segment)) {
      throw new TypeError(`[sanity-seed-fixtures] Invalid id segment: "${segment}"`);
    }
  }
  return [SEED_ID_ROOT, ...segments].join(".");
}

export const SITE_SETTINGS_ID = seedId("site-settings");
export const HOME_PAGE_ID = seedId("home-page");

// ---------------------------------------------------------------------------
// Small value builders
// ---------------------------------------------------------------------------

export type SeedDocument = Readonly<Record<string, unknown>> & {
  readonly _id: string;
  readonly _type: string;
};

type LocalizedEntry = { readonly language: string; readonly value: string };

function assertLanguage(language: string): void {
  if (!LANGUAGE_SUBTAG.test(language)) {
    throw new TypeError(`[sanity-seed-fixtures] Invalid language subtag: "${language}"`);
  }
}

function localizedEntries(objectType: string, entries: readonly LocalizedEntry[]) {
  return entries.map((entry) => {
    assertLanguage(entry.language);
    return { _key: entry.language, _type: objectType, language: entry.language, value: entry.value };
  });
}

function localizedText(entries: readonly LocalizedEntry[]) {
  return localizedEntries(LOCALIZED_TEXT_TYPE_NAME, entries);
}

function localizedSlug(entries: readonly LocalizedEntry[]) {
  return localizedEntries(LOCALIZED_SLUG_TYPE_NAME, entries);
}

function reference(id: string) {
  return { _type: "reference", _ref: id };
}

// ---------------------------------------------------------------------------
// Media: exactly six documents, one per real photograph
// ---------------------------------------------------------------------------

export type MediaFixture = {
  readonly mediaId: string;
  /** The logical key `resolveAssetRef` looks up — matches the demo file's basename. */
  readonly assetKey: string;
  readonly altFi: string;
  readonly altEn: string;
  readonly captionFi?: string;
  readonly captionEn?: string;
  readonly credit: string;
  readonly capturedAt: string;
};

/**
 * One entry per file in `public/gallery/*.webp`. The IO layer resolves
 * `assetKey` to that file's actual (hashed) path at upload time, so a
 * reprocessed file's changed hash never has to be mirrored here.
 */
export const MEDIA_FIXTURES: readonly MediaFixture[] = [
  {
    mediaId: "coastal-landscape",
    assetKey: "coastal-landscape",
    altFi: "Kivinen rantaviiva laskuveden aikaan, matala aurinko pilkottaa pilvien läpi",
    altEn: "A rocky shoreline at low tide, low sun breaking through cloud",
    captionFi: "Rannikkomaisema, alkusyksy",
    captionEn: "Coastal landscape, early autumn",
    credit: "Sample credit — Studio Example",
    capturedAt: "2025-09-14T06:40:00.000Z",
  },
  {
    mediaId: "forest-stream",
    assetKey: "forest-stream",
    altFi: "Kirkas puro virtaa sammaloituneiden kivien läpi tiheässä metsässä",
    altEn: "A clear stream winding through moss-covered stones in dense forest",
    captionFi: "Metsäpuro",
    captionEn: "Forest stream",
    credit: "Sample credit — Studio Example",
    capturedAt: "2025-06-02T05:15:00.000Z",
  },
  {
    mediaId: "lakeside-reeds",
    assetKey: "lakeside-reeds",
    altFi: "Ruovikko tyynen järven rannalla auringonlaskun aikaan",
    altEn: "Reeds along a still lakeshore at sunset",
    captionFi: "Järvenranta, iltavalo",
    captionEn: "Lakeside, evening light",
    credit: "Sample credit — Studio Example",
    capturedAt: "2025-08-21T17:50:00.000Z",
  },
  {
    mediaId: "lichen-stones",
    assetKey: "lichen-stones",
    altFi: "Jäkälän peittämiä kiviä lähikuvassa, pehmeä luonnonvalo",
    altEn: "Lichen-covered stones in close-up, soft natural light",
    captionFi: "Jäkäläkivet",
    captionEn: "Lichen stones",
    credit: "Sample credit — Studio Example",
    capturedAt: "2025-05-11T09:05:00.000Z",
  },
  {
    mediaId: "misty-birch",
    assetKey: "misty-birch",
    altFi: "Koivumetsä aamuusvassa, valo suodattuu puiden lomasta",
    altEn: "A birch grove in morning mist, light filtering between the trunks",
    captionFi: "Koivikko, aamu",
    captionEn: "Birch grove, morning",
    credit: "Sample credit — Studio Example",
    capturedAt: "2025-09-28T05:30:00.000Z",
  },
  {
    mediaId: "open-marsh",
    assetKey: "open-marsh",
    altFi: "Avara suomaisema syyskesällä, matala kasvillisuus ulottuu horisonttiin",
    altEn: "An open marsh landscape in late summer, low vegetation reaching the horizon",
    captionFi: "Suomaisema",
    captionEn: "Marsh landscape",
    credit: "Sample credit — Studio Example",
    capturedAt: "2025-08-03T07:20:00.000Z",
  },
];

export const MEDIA_KEYS: readonly string[] = MEDIA_FIXTURES.map((item) => item.mediaId);

/** Placeholder asset ref used whenever a real, uploaded one is not supplied. */
const PENDING_ASSET_REF_PREFIX = "seed-pending-asset:";

export function isPendingAssetRef(ref: string): boolean {
  return ref.startsWith(PENDING_ASSET_REF_PREFIX);
}

function resolveAssetRef(
  assetKey: string,
  assetRefsByKey: ReadonlyMap<string, string> | undefined,
): string {
  return assetRefsByKey?.get(assetKey) ?? `${PENDING_ASSET_REF_PREFIX}${assetKey}`;
}

/** The present entries among a set of `{language, value}` pairs, dropping any `undefined` value. */
function presentEntries(
  pairs: readonly { readonly language: string; readonly value: string | undefined }[],
): readonly LocalizedEntry[] {
  return pairs.flatMap(({ language, value }) => (value === undefined ? [] : [{ language, value }]));
}

function buildMediaDocuments(
  assetRefsByKey: ReadonlyMap<string, string> | undefined,
): readonly SeedDocument[] {
  return MEDIA_FIXTURES.map((fixture) => {
    const captionEntries = presentEntries([
      { language: "fi", value: fixture.captionFi },
      { language: "en", value: fixture.captionEn },
    ]);
    return {
      _id: seedId("media", fixture.mediaId),
      _type: MEDIA_TYPE_NAME,
      mediaId: fixture.mediaId,
      mediaType: "image",
      image: {
        _type: "image",
        asset: reference(resolveAssetRef(fixture.assetKey, assetRefsByKey)),
      },
      alt: localizedText([
        { language: "fi", value: fixture.altFi },
        { language: "en", value: fixture.altEn },
      ]),
      ...(captionEntries.length === 0 ? {} : { caption: localizedText(captionEntries) }),
      credit: fixture.credit,
      capturedAt: fixture.capturedAt,
      publiclyRenderable: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Categories: a multilevel tree
// ---------------------------------------------------------------------------

type CategoryFixture = {
  readonly categoryId: string;
  readonly parentId?: string;
  readonly order: number;
  readonly labelFi: string;
  readonly labelEn: string;
  readonly slugFi: string;
  readonly slugEn: string;
};

export const CATEGORY_FIXTURES: readonly CategoryFixture[] = [
  {
    categoryId: "landscapes",
    order: 0,
    labelFi: "Maisemat",
    labelEn: "Landscapes",
    slugFi: "maisemat",
    slugEn: "landscapes",
  },
  {
    categoryId: "coastal",
    parentId: "landscapes",
    order: 0,
    labelFi: "Rannikko",
    labelEn: "Coastal",
    slugFi: "rannikko",
    slugEn: "coastal",
  },
  {
    categoryId: "tidal-pools",
    parentId: "coastal",
    order: 0,
    labelFi: "Vuorovesialtaat",
    labelEn: "Tidal pools",
    slugFi: "vuorovesialtaat",
    slugEn: "tidal-pools",
  },
  {
    categoryId: "forest",
    parentId: "landscapes",
    order: 1,
    labelFi: "Metsä",
    labelEn: "Forest",
    slugFi: "metsa",
    slugEn: "forest",
  },
  {
    categoryId: "journal",
    order: 1,
    labelFi: "Blogi",
    labelEn: "Journal",
    slugFi: "blogi",
    slugEn: "journal",
  },
  {
    categoryId: "field-notes",
    parentId: "journal",
    order: 0,
    labelFi: "Kenttämuistiinpanot",
    labelEn: "Field notes",
    slugFi: "kenttamuistiinpanot",
    slugEn: "field-notes",
  },
];

function buildCategoryDocuments(): readonly SeedDocument[] {
  return CATEGORY_FIXTURES.map((fixture) => ({
    _id: seedId("category", fixture.categoryId),
    _type: CATEGORY_TYPE_NAME,
    categoryId: fixture.categoryId,
    ...(fixture.parentId === undefined
      ? {}
      : { parent: reference(seedId("category", fixture.parentId)) }),
    slug: localizedSlug([
      { language: "fi", value: fixture.slugFi },
      { language: "en", value: fixture.slugEn },
    ]),
    label: localizedText([
      { language: "fi", value: fixture.labelFi },
      { language: "en", value: fixture.labelEn },
    ]),
    order: fixture.order,
  }));
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

type ServiceFixture = {
  readonly slug: string;
  readonly name: string;
  readonly shortDescription: string;
  readonly description: readonly string[];
  readonly coverMediaId: string;
  readonly startingPrice: string;
  readonly pricing: readonly { readonly name: string; readonly price: string; readonly note?: string }[];
  readonly order: number;
};

export const SERVICE_FIXTURES: readonly ServiceFixture[] = [
  {
    slug: "portrait-sessions",
    name: "Portrait sessions",
    shortDescription: "One-on-one outdoor portrait sessions, tailored to the light and the season.",
    description: [
      "A portrait session built around natural light and a location that means something to you — a familiar shoreline, a forest trail, your own garden.",
      "Sessions run 60–90 minutes and include a private online gallery of edited images within two weeks.",
    ],
    coverMediaId: "misty-birch",
    startingPrice: "From € 250",
    pricing: [
      { name: "Standard session", price: "€ 250", note: "60 minutes, 15 edited images" },
      { name: "Extended session", price: "€ 390", note: "90 minutes, 30 edited images" },
    ],
    order: 0,
  },
  {
    slug: "wedding-coverage",
    name: "Wedding coverage",
    shortDescription: "Full-day documentary coverage, from morning preparations to the last dance.",
    description: [
      "Documentary-style wedding coverage that stays out of the way: candid moments over posed lineups, wherever possible.",
      "Every package includes a same-week highlights preview and a full private gallery within four weeks.",
    ],
    coverMediaId: "lakeside-reeds",
    startingPrice: "From € 1 800",
    pricing: [
      { name: "Half day", price: "€ 1 800", note: "Up to 6 hours, one photographer" },
      { name: "Full day", price: "€ 2 900", note: "Up to 10 hours, two photographers" },
    ],
    order: 1,
  },
  {
    slug: "print-sales",
    name: "Fine art prints",
    shortDescription: "Archival prints of select landscape work, made to order.",
    description: [
      "A small selection of landscape photographs available as archival pigment prints, made to order in a handful of fixed sizes.",
      "Each print ships mounted and ready to frame; a certificate of authenticity is included with every order.",
    ],
    coverMediaId: "open-marsh",
    startingPrice: "From € 120",
    pricing: [
      { name: "30 × 40 cm", price: "€ 120" },
      { name: "50 × 70 cm", price: "€ 220" },
      { name: "70 × 100 cm", price: "€ 380" },
    ],
    order: 2,
  },
];

function buildServiceDocuments(): readonly SeedDocument[] {
  return SERVICE_FIXTURES.map((fixture) => ({
    _id: seedId("service", fixture.slug),
    _type: SERVICE_TYPE_NAME,
    slug: fixture.slug,
    name: fixture.name,
    shortDescription: fixture.shortDescription,
    description: fixture.description,
    coverMedia: reference(seedId("media", fixture.coverMediaId)),
    startingPrice: fixture.startingPrice,
    pricing: fixture.pricing.map((tier) => ({
      _key: tier.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      _type: "object",
      name: tier.name,
      price: tier.price,
      ...(tier.note === undefined ? {} : { note: tier.note }),
    })),
    order: fixture.order,
  }));
}

// ---------------------------------------------------------------------------
// Content blocks (shared by article and gallery bodies)
// ---------------------------------------------------------------------------

type BodyBlockFixture =
  | { readonly kind: "paragraph"; readonly key: string; readonly text: string }
  | { readonly kind: "heading"; readonly key: string; readonly level: 2 | 3; readonly text: string }
  | { readonly kind: "list"; readonly key: string; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: "blockquote"; readonly key: string; readonly text: string; readonly attribution?: string }
  | { readonly kind: "media"; readonly key: string; readonly mediaId: string };

function buildBodyBlock(block: BodyBlockFixture): Readonly<Record<string, unknown>> {
  const kind = block.kind satisfies ContentBlockKind;
  const _type = CONTENT_BLOCK_OBJECT_TYPES[kind];
  switch (block.kind) {
    case "paragraph":
      return { _key: block.key, _type, text: block.text };
    case "heading":
      return { _key: block.key, _type, level: block.level, text: block.text };
    case "list":
      return { _key: block.key, _type, ordered: block.ordered, items: block.items };
    case "blockquote":
      return {
        _key: block.key,
        _type,
        text: block.text,
        ...(block.attribution === undefined ? {} : { attribution: block.attribution }),
      };
    case "media":
      return { _key: block.key, _type, media: reference(seedId("media", block.mediaId)) };
  }
}

const SAMPLE_BODY: readonly BodyBlockFixture[] = [
  {
    kind: "paragraph",
    key: "intro",
    text: "This sample page exists to prove the seeding pipeline end to end — the schemas, the write, and the read all agree on the same shape. Replace it with real writing once your own content is ready.",
  },
  { kind: "heading", key: "process-heading", level: 2, text: "How this was made" },
  {
    kind: "paragraph",
    key: "process-body",
    text: "Every photograph on this page is one of six demo images shipped with the project template, reused across many placements — the same way one photograph in your own archive can appear in more than one gallery without becoming two different files.",
  },
  {
    kind: "list",
    key: "process-list",
    ordered: false,
    items: [
      "Seeded through a repeatable, owner-run script — never by hand.",
      "Distinguishable from real content by its document id.",
      "Safe to delete entirely before real content is authored.",
    ],
  },
  { kind: "heading", key: "notes-heading", level: 3, text: "A note on the images" },
  {
    kind: "blockquote",
    key: "notes-quote",
    text: "Sample content, not a finished page — replace before going live.",
    attribution: "Seed script",
  },
  { kind: "media", key: "notes-media", mediaId: "lichen-stones" },
];

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

type ArticleLanguageFixture = {
  readonly language: string;
  readonly title: string;
  readonly slug: string;
  readonly summary: string;
};

type ArticleFixture = {
  readonly contentId: string;
  readonly canonicalCategoryId: string;
  readonly coverMediaId: string;
  readonly tags: readonly string[];
  readonly publishedAt: string;
  readonly languages: readonly ArticleLanguageFixture[];
};

export const ARTICLE_FIXTURES: readonly ArticleFixture[] = [
  {
    contentId: "coastal-light",
    canonicalCategoryId: "field-notes",
    coverMediaId: "coastal-landscape",
    tags: ["light", "coast", "technique"],
    publishedAt: "2026-02-10T08:00:00.000Z",
    languages: [
      {
        language: "fi",
        title: "Rannikon valosta",
        slug: "rannikon-valosta",
        summary: "Miten aamun ja illan valo muuttaa saman rantamaiseman.",
      },
      {
        language: "en",
        title: "Reading coastal light",
        slug: "reading-coastal-light",
        summary: "How morning and evening light change the same stretch of shoreline.",
      },
    ],
  },
  {
    contentId: "tidal-pools-notes",
    canonicalCategoryId: "tidal-pools",
    coverMediaId: "lichen-stones",
    tags: ["field-notes", "coast"],
    publishedAt: "2026-03-02T08:00:00.000Z",
    languages: [
      {
        language: "fi",
        title: "Muistiinpanoja vuorovesialtailta",
        slug: "muistiinpanoja-vuorovesialtailta",
        summary: "Lyhyitä havaintoja kuvausretkiltä matalan veden aikaan.",
      },
    ],
  },
];

function buildArticleDocuments(): readonly SeedDocument[] {
  return ARTICLE_FIXTURES.flatMap((fixture) =>
    fixture.languages.map((language) => ({
      _id: seedId("article", fixture.contentId, language.language),
      _type: ARTICLE_TYPE_NAME,
      contentId: fixture.contentId,
      language: language.language,
      title: language.title,
      slug: language.slug,
      summary: language.summary,
      publishedAt: fixture.publishedAt,
      cover: reference(seedId("media", fixture.coverMediaId)),
      tags: fixture.tags,
      canonicalCategory: reference(seedId("category", fixture.canonicalCategoryId)),
      body: SAMPLE_BODY.map(buildBodyBlock),
    })),
  );
}

// ---------------------------------------------------------------------------
// Galleries, sections, and placements
// ---------------------------------------------------------------------------

export const ARCHIVE_GALLERY_CONTENT_ID = "archive";
export const FEATURED_GALLERY_CONTENT_ID = "featured";
export const GALLERY_LANGUAGE = "fi";
export const FEATURED_GALLERY_SECTION_SIZE = 13;
export const FEATURED_GALLERY_PLACEMENT_COUNT = FEATURED_GALLERY_SECTION_SIZE * 2;
export const ARCHIVE_GALLERY_PLACEMENT_COUNT = 400;

function mediaIdAt(index: number): string {
  return MEDIA_KEYS[index % MEDIA_KEYS.length];
}

function buildSectionIntro(paragraphText: string, listItems: readonly string[]) {
  return [
    {
      _key: "intro-paragraph",
      _type: GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME,
      spans: [
        { _key: "span-1", _type: GALLERY_SECTION_INLINE_SPAN_TYPE_NAME, text: paragraphText },
      ],
    },
    {
      _key: "intro-list",
      _type: GALLERY_SECTION_INTRO_LIST_TYPE_NAME,
      ordered: false,
      items: listItems.map((text, index) => ({
        _key: `item-${index}`,
        _type: GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME,
        spans: [{ _key: "span-1", _type: GALLERY_SECTION_INLINE_SPAN_TYPE_NAME, text }],
      })),
    },
  ];
}

function buildPlacement(options: {
  readonly placementId: string;
  readonly order: number;
  readonly galleryRef: string;
  readonly mediaId: string;
  readonly sectionId?: string;
}): SeedDocument {
  return {
    _id: seedId("placement", options.placementId),
    _type: GALLERY_PLACEMENT_TYPE_NAME,
    gallery: reference(options.galleryRef),
    placementId: options.placementId,
    order: options.order,
    ...(options.sectionId === undefined ? {} : { sectionId: options.sectionId }),
    visible: true,
    pinned: false,
    media: reference(seedId("media", options.mediaId)),
  };
}

function buildFeaturedGalleryPlacements(): readonly SeedDocument[] {
  const sections: readonly { readonly id: string; readonly offset: number }[] = [
    { id: "high-tide", offset: 0 },
    { id: "low-tide", offset: FEATURED_GALLERY_SECTION_SIZE },
  ];
  const galleryRef = seedId("gallery", FEATURED_GALLERY_CONTENT_ID, GALLERY_LANGUAGE);

  return sections.flatMap(({ id: sectionId, offset }) =>
    Array.from({ length: FEATURED_GALLERY_SECTION_SIZE }, (_unused, position) =>
      buildPlacement({
        placementId: `featured-${sectionId}-${String(position + 1).padStart(2, "0")}`,
        order: offset + position,
        galleryRef,
        mediaId: mediaIdAt(offset + position),
        sectionId,
      }),
    ),
  );
}

function buildArchiveGalleryPlacements(): readonly SeedDocument[] {
  const galleryRef = seedId("gallery", ARCHIVE_GALLERY_CONTENT_ID, GALLERY_LANGUAGE);
  return Array.from({ length: ARCHIVE_GALLERY_PLACEMENT_COUNT }, (_unused, index) =>
    buildPlacement({
      placementId: `archive-${String(index + 1).padStart(4, "0")}`,
      order: index,
      galleryRef,
      mediaId: mediaIdAt(index),
    }),
  );
}

function buildGalleryDocuments(): readonly SeedDocument[] {
  /** Restates `gallery.ts`'s `ORDERING_RULES` — the only rule actually applied anywhere yet. */
  const manualOrdering = "manual" as const;

  const featured: SeedDocument = {
    _id: seedId("gallery", FEATURED_GALLERY_CONTENT_ID, GALLERY_LANGUAGE),
    _type: GALLERY_TYPE_NAME,
    contentId: FEATURED_GALLERY_CONTENT_ID,
    language: GALLERY_LANGUAGE,
    title: "Vuorovesialtaiden valo",
    slug: "vuorovesialtaiden-valo",
    summary: "Kausittainen kokoelma vuorovesialtailta, jaoteltu nousu- ja laskuveden mukaan.",
    publishedAt: "2026-01-15T08:00:00.000Z",
    cover: reference(seedId("media", "coastal-landscape")),
    tags: ["coast", "seasonal"],
    canonicalCategory: reference(seedId("category", "tidal-pools")),
    orderingRule: manualOrdering,
    sections: [
      {
        _key: "high-tide",
        _type: "object",
        sectionId: "high-tide",
        slug: "nousuvesi",
        label: "Nousuvesi",
        intro: buildSectionIntro(
          "Nousuveden aikaan kuvatut otokset, kun valo heijastuu vielä matalasta vedestä.",
          ["Kuvattu aina samalta rannalta", "Vain luonnonvalossa"],
        ),
      },
      {
        _key: "low-tide",
        _type: "object",
        sectionId: "low-tide",
        slug: "laskuvesi",
        label: "Laskuvesi",
        intro: buildSectionIntro(
          "Laskuveden paljastamat kivet ja altaat, kuvattu heti veden vetäydyttyä.",
          ["Parhaimmillaan aikaisin aamulla"],
        ),
      },
    ],
    body: SAMPLE_BODY.map(buildBodyBlock),
  };

  const archive: SeedDocument = {
    _id: seedId("gallery", ARCHIVE_GALLERY_CONTENT_ID, GALLERY_LANGUAGE),
    _type: GALLERY_TYPE_NAME,
    contentId: ARCHIVE_GALLERY_CONTENT_ID,
    language: GALLERY_LANGUAGE,
    title: "Metsäarkisto",
    slug: "metsaarkisto",
    summary: "Laaja arkistokokoelma, jota käytetään sivutetun lukijan testaamiseen.",
    publishedAt: "2025-11-01T08:00:00.000Z",
    cover: reference(seedId("media", "forest-stream")),
    tags: ["forest", "archive"],
    canonicalCategory: reference(seedId("category", "forest")),
    secondaryCategories: [
      { _key: "coastal", ...reference(seedId("category", "coastal")) },
    ],
    orderingRule: manualOrdering,
    sections: [],
  };

  return [featured, archive];
}

// ---------------------------------------------------------------------------
// Site settings and home page
// ---------------------------------------------------------------------------

function buildSiteSettingsDocument(): SeedDocument {
  return {
    _id: SITE_SETTINGS_ID,
    _type: SITE_SETTINGS_TYPE_NAME,
    siteName: "Studio Example",
    photographerName: "Sam Example",
    tagline: localizedText([
      { language: "fi", value: "Rannikon ja metsän kuvia" },
      { language: "en", value: "Coastal and forest photography" },
    ]),
    featuredGalleryId: FEATURED_GALLERY_CONTENT_ID,
    navigation: [
      {
        _key: "story-root",
        _type: NAVIGATION_ITEM_TYPE_NAME,
        label: localizedText([
          { language: "fi", value: "Tarinat" },
          { language: "en", value: "Stories" },
        ]),
        target: "story-root",
      },
      {
        _key: "services",
        _type: NAVIGATION_ITEM_TYPE_NAME,
        label: localizedText([
          { language: "fi", value: "Palvelut" },
          { language: "en", value: "Services" },
        ]),
        target: "static",
        href: "/services",
      },
      {
        _key: "featured-gallery",
        _type: NAVIGATION_ITEM_TYPE_NAME,
        label: localizedText([
          { language: "fi", value: "Vuorovesialtaat" },
          { language: "en", value: "Tidal pools" },
        ]),
        target: "featured-gallery",
      },
      {
        _key: "contact",
        _type: NAVIGATION_ITEM_TYPE_NAME,
        label: localizedText([
          { language: "fi", value: "Yhteystiedot" },
          { language: "en", value: "Contact" },
        ]),
        target: "static",
        href: "/contact",
      },
    ],
    contact: {
      _type: "object",
      email: "hello@example.com",
      address: localizedText([
        { language: "fi", value: "Esimerkkikatu 1, 00100 Helsinki" },
        { language: "en", value: "1 Example Street, 00100 Helsinki" },
      ]),
      privacyNotice: {
        _type: "object",
        collected: localizedText([
          { language: "fi", value: "Nimi, sähköposti ja viestin sisältö." },
          { language: "en", value: "Name, email address, and message content." },
        ]),
        purpose: localizedText([
          { language: "fi", value: "Yhteydenottoon vastaaminen." },
          { language: "en", value: "Responding to your enquiry." },
        ]),
        recipient: localizedText([
          { language: "fi", value: "Vain valokuvaaja." },
          { language: "en", value: "The photographer only." },
        ]),
        retention: localizedText([
          { language: "fi", value: "Enintään 12 kuukautta." },
          { language: "en", value: "Up to 12 months." },
        ]),
      },
    },
    socialLinks: [
      {
        _key: "instagram",
        _type: "object",
        platform: "instagram",
        url: "https://www.instagram.com/example",
        label: localizedText([
          { language: "fi", value: "Instagram" },
          { language: "en", value: "Instagram" },
        ]),
      },
    ],
    footerLinks: [
      {
        _key: "contact",
        _type: NAVIGATION_ITEM_TYPE_NAME,
        label: localizedText([
          { language: "fi", value: "Yhteystiedot" },
          { language: "en", value: "Contact" },
        ]),
        target: "static",
        href: "/contact",
      },
    ],
    copyrightHolder: "Studio Example",
    defaultSeo: {
      _type: "object",
      titleTemplate: localizedText([
        { language: "fi", value: "%s — Studio Example" },
        { language: "en", value: "%s — Studio Example" },
      ]),
      description: localizedText([
        { language: "fi", value: "Rannikon ja metsän valokuvausta." },
        { language: "en", value: "Coastal and forest photography." },
      ]),
    },
  };
}

function buildHomePageDocument(): SeedDocument {
  return {
    _id: HOME_PAGE_ID,
    _type: HOME_PAGE_TYPE_NAME,
    heroMedia: reference(seedId("media", "coastal-landscape")),
    heroAction: {
      _type: HOME_ACTION_TYPE_NAME,
      label: localizedText([
        { language: "fi", value: "Katso tarinat" },
        { language: "en", value: "View the stories" },
      ]),
      target: "story-root",
    },
    intro: localizedText([
      { language: "fi", value: "Rannikon ja metsän valokuvausta, kausien mukaan." },
      { language: "en", value: "Coastal and forest photography, following the seasons." },
    ]),
    sections: [
      {
        _key: "featured",
        _type: HOME_SECTION_TYPE_NAME,
        title: localizedText([
          { language: "fi", value: "Vuorovesialtaiden valo" },
          { language: "en", value: "Tidal pools" },
        ]),
        description: localizedText([
          { language: "fi", value: "Uusin kuratoitu kokoelma." },
          { language: "en", value: "The latest curated collection." },
        ]),
        target: "featured-gallery",
      },
      {
        _key: "services",
        _type: HOME_SECTION_TYPE_NAME,
        title: localizedText([
          { language: "fi", value: "Palvelut" },
          { language: "en", value: "Services" },
        ]),
        description: localizedText([
          { language: "fi", value: "Muotokuvat, häät ja vedokset." },
          { language: "en", value: "Portraits, weddings, and prints." },
        ]),
        target: "static",
        href: "/services",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type SeedFixtures = {
  readonly documents: readonly SeedDocument[];
};

/**
 * The full document set. The IO layer resolves which local files to upload
 * directly from `MEDIA_FIXTURES` (exported above) rather than from a field on
 * this return value — this function's only job is documents.
 */
export function buildSeedFixtures(options?: {
  readonly assetRefsByKey?: ReadonlyMap<string, string>;
}): SeedFixtures {
  const documents: readonly SeedDocument[] = [
    ...buildCategoryDocuments(),
    ...buildMediaDocuments(options?.assetRefsByKey),
    buildSiteSettingsDocument(),
    buildHomePageDocument(),
    ...buildServiceDocuments(),
    ...buildArticleDocuments(),
    ...buildGalleryDocuments(),
    ...buildFeaturedGalleryPlacements(),
    ...buildArchiveGalleryPlacements(),
  ];

  return { documents };
}

// ---------------------------------------------------------------------------
// Seed identities — the IO/CLI layer's own preflight and cleanup logic
//
// Pure, and colocated with the document builders they read, rather than
// living in the CLI: `scripts/seed-sanity-content.mts` never gets a
// dedicated test file (it auto-runs `main()` on import, so nothing there is
// directly unit-testable without an entry-point-guard refactor this story
// doesn't need), so any logic worth testing on its own belongs here instead.
// ---------------------------------------------------------------------------

/**
 * Restates `sanity/schemas/validation.ts`'s `publishedIdOf` — a Sanity
 * document's `_id` is `drafts.<id>` while unpublished or
 * `versions.<release>.<id>` inside a content release, both naming the same
 * logical document a plain `<id>` names once published. A first draft of
 * this restatement only handled the `drafts.` case and was caught missing
 * `versions.` by this story's own review — pinned equal to the real one by
 * `sanity-seed-fixtures.test.mts` so the two copies cannot drift again.
 */
export function publishedIdOf(id: string): string {
  if (id.startsWith("drafts.")) return id.slice("drafts.".length);
  if (id.startsWith("versions.")) {
    const withoutPrefix = id.slice("versions.".length);
    const separator = withoutPrefix.indexOf(".");
    return separator === -1 ? withoutPrefix : withoutPrefix.slice(separator + 1);
  }
  return id;
}

export type SeedIdentities = {
  readonly mediaIds: readonly string[];
  readonly categoryIds: readonly string[];
  readonly serviceSlugs: readonly string[];
  readonly contentIds: readonly string[];
  /**
   * Every placement's `placementId`, unchunked. There are as many of these
   * as there are placements (426 in this fixture) — a caller checking them
   * against a live dataset cannot put them all in one GET request (measured
   * directly: 400 alone already URL-encode past 10 KB) and must chunk this
   * list itself, the same way `seed-sanity-content.mts`'s archive-placement
   * verification and identity-collision preflight both do via
   * `sanity-seed-http.mts`'s exported `chunk`.
   */
  readonly placementIds: readonly string[];
  /** `${kind}:${identity}` -> the `_id` this document set expects to own it. */
  readonly expectedIdByIdentity: ReadonlyMap<string, string>;
  /**
   * `contentId` -> the one variant (`article`/`gallery`) this fixture set
   * uses it as. A `contentId` this fixture writes as a gallery must not
   * already be claimed by an *article* under a different language (or vice
   * versa) — the real Studio rule (`makeContentIdentityValidator`) is that
   * one `contentId` names exactly one variant, site-wide, across every one
   * of its language versions — and that check needs the variant, not just
   * the exact `(contentId, language)` pair `expectedIdByIdentity` already
   * covers, since the colliding document can be in a language this fixture
   * never defines for that `contentId` at all.
   */
  readonly expectedVariantByContentId: ReadonlyMap<string, string>;
};

/**
 * Every site-wide public identity this fixture set claims — `mediaId`,
 * `categoryId`, service `slug`, article/gallery `(contentId, language)`, and
 * `placementId` — used by the CLI's preflight to detect a collision with a
 * differently-id'd document already claiming one of them. `placementIds` is
 * returned unchunked and large (426 entries): see its own field comment on
 * `SeedIdentities` for why a caller must chunk it before querying, rather
 * than this function doing so itself — chunking is an IO-shaped concern
 * (how many fit in one request), not something a pure identity-collection
 * function should decide on a caller's behalf.
 */
export function collectSeedIdentities(documents: readonly SeedDocument[]): SeedIdentities {
  const mediaIds: string[] = [];
  const categoryIds: string[] = [];
  const serviceSlugs: string[] = [];
  const contentIds: string[] = [];
  const placementIds: string[] = [];
  const expectedIdByIdentity = new Map<string, string>();
  const expectedVariantByContentId = new Map<string, string>();

  for (const doc of documents) {
    if (doc._type === MEDIA_TYPE_NAME) {
      const mediaId = doc.mediaId as string;
      mediaIds.push(mediaId);
      expectedIdByIdentity.set(`media:${mediaId}`, doc._id);
    } else if (doc._type === CATEGORY_TYPE_NAME) {
      const categoryId = doc.categoryId as string;
      categoryIds.push(categoryId);
      expectedIdByIdentity.set(`category:${categoryId}`, doc._id);
    } else if (doc._type === SERVICE_TYPE_NAME) {
      const slug = doc.slug as string;
      serviceSlugs.push(slug);
      expectedIdByIdentity.set(`service:${slug}`, doc._id);
    } else if (doc._type === ARTICLE_TYPE_NAME || doc._type === GALLERY_TYPE_NAME) {
      const contentId = doc.contentId as string;
      const language = doc.language as string;
      contentIds.push(contentId);
      expectedIdByIdentity.set(`content:${contentId}:${language}`, doc._id);
      expectedVariantByContentId.set(contentId, doc._type);
    } else if (doc._type === GALLERY_PLACEMENT_TYPE_NAME) {
      const placementId = doc.placementId as string;
      placementIds.push(placementId);
      expectedIdByIdentity.set(`placement:${placementId}`, doc._id);
    }
  }

  return {
    mediaIds,
    categoryIds,
    serviceSlugs,
    contentIds,
    placementIds,
    expectedIdByIdentity,
    expectedVariantByContentId,
  };
}

/**
 * Orders a set of seeded documents into the sequence of waves that is safe
 * to delete in, one wave at a time: every reference field this schema set
 * declares is a **strong** reference (Sanity's default — nothing here sets
 * `weak: true`), and Sanity's own documentation is explicit that a strong
 * reference "will not allow deletion of a document that any other document
 * refers to" — so a referrer must always be deleted before whatever it
 * references, in a *separate*, earlier wave (a mutation batch is its own
 * transaction; two documents in the same wave but different batches carry
 * no ordering guarantee relative to each other).
 *
 * A first draft of this split only two ways — every `galleryPlacement`
 * first, then everything else in one pass — which is enough for a normal
 * run (the whole non-placement set is 22 documents, one batch), but is not
 * correct in general: this story's own review found that a large enough
 * mixed batch (drafts/content-release copies of seeded documents can push
 * the count past `MUTATION_BATCH_SIZE`) could split across several
 * transactions with no guarantee the referrer's transaction runs first. The
 * full reference graph this schema set actually declares:
 *
 * - `galleryPlacement` → `gallery`, `media`
 * - `article`/`gallery` → `canonicalCategory`/`secondaryCategories` (`category`), `cover`/body media (`media`)
 * - `service` → `coverMedia` (`media`)
 * - `homePage` → `heroMedia` (`media`)
 * - `category` → `parent` (another `category` — a self-referential hierarchy)
 * - `siteSettings`, and a `media` document itself, reference nothing here
 *
 * — giving five ordered waves: placements; article/gallery/service/homePage
 * (they reference category/media but nothing here references them);
 * category, itself split into as many sub-waves as the tree is deep, leaves
 * first (a category referencing another category as `parent` must be
 * deleted before that parent, the same rule one level up); media; and
 * finally siteSettings, which depends on nothing.
 */
export function orderSeedDocumentsForDeletion<
  T extends { readonly _id: string; readonly _type: string; readonly parent?: { readonly _ref?: unknown } },
>(docs: readonly T[]): readonly (readonly T[])[] {
  const byType = (type: string) => docs.filter((doc) => doc._type === type);

  const categoryWaves: T[][] = [];
  const remainingCategories = new Set(byType(CATEGORY_TYPE_NAME));
  for (let iteration = 0; iteration < MAX_CATEGORY_DEPTH && remainingCategories.size > 0; iteration += 1) {
    // A "leaf" here means the deepest kind: nothing still remaining names it
    // as *their* parent, so nothing left depends on it surviving — the
    // opposite of a category with no parent of its own (a top-level one),
    // which must be deleted *last* among categories, not first.
    const referencedAsParent = new Set(
      [...remainingCategories].flatMap((doc) => {
        const ref = doc.parent?._ref;
        return typeof ref === "string" ? [ref] : [];
      }),
    );
    const leaves = [...remainingCategories].filter((doc) => !referencedAsParent.has(doc._id));
    if (leaves.length === 0) break; // A cycle among what's left — nothing more can be safely ordered.
    categoryWaves.push(leaves);
    for (const leaf of leaves) remainingCategories.delete(leaf);
  }
  // Whatever never resolved (a genuine cycle, which validateSeedFixtures
  // already refuses to let this fixture ever produce) still needs to be
  // attempted rather than silently dropped.
  if (remainingCategories.size > 0) categoryWaves.push([...remainingCategories]);

  return [
    byType(GALLERY_PLACEMENT_TYPE_NAME),
    [...byType(ARTICLE_TYPE_NAME), ...byType(GALLERY_TYPE_NAME), ...byType(SERVICE_TYPE_NAME), ...byType(HOME_PAGE_TYPE_NAME)],
    ...categoryWaves,
    byType(MEDIA_TYPE_NAME),
    byType(SITE_SETTINGS_TYPE_NAME),
  ].filter((wave) => wave.length > 0);
}

// ---------------------------------------------------------------------------
// Invariant validation
//
// Nothing enforces these once a document leaves this module: Sanity's HTTP
// mutate API does not run Studio's async validation rules (`sanity-setup.md`
// already says as much — "Studio validation cannot protect API imports"), so
// this fixture set is solely responsible for its own correctness. Called both
// by the offline test suite and by the CLI itself before any write, as a
// second, independent gate against a future edit to the fixtures above
// silently breaking one of these rules.
// ---------------------------------------------------------------------------

type ReferenceLike = { readonly _ref?: unknown };

function referencedId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ref = (value as ReferenceLike)._ref;
  return typeof ref === "string" ? ref : undefined;
}

function isKeyedArray(value: unknown): value is readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}

/**
 * Every `_key` in every array-of-objects field, anywhere in one document's
 * field tree, is present, non-empty, and unique among its own array siblings.
 * `value` may be an array (checked directly, then each item's own fields are
 * walked) or a plain object (not itself checked — only a `_type: "document"`
 * or nested object's *fields* are walked for further arrays).
 */
function collectKeyViolations(path: string, value: unknown, violations: string[]): void {
  if (isKeyedArray(value)) {
    const seen = new Set<string>();
    for (const item of value) {
      const key = item._key;
      if (typeof key !== "string" || key.length === 0) {
        violations.push(`${path}: array item is missing a non-empty _key`);
      } else if (seen.has(key)) {
        violations.push(`${path}: duplicate _key "${key}"`);
      } else {
        seen.add(key);
      }
      for (const [field, fieldValue] of Object.entries(item)) {
        if (field === "_key") continue;
        collectKeyViolations(`${path}.${String(key)}.${field}`, fieldValue, violations);
      }
    }
    return;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [field, fieldValue] of Object.entries(value)) {
      collectKeyViolations(`${path}.${field}`, fieldValue, violations);
    }
  }
}

/** No level-3 heading appears before the first level-2 heading in one body. */
function hasHeadingOrderViolation(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  let sawLevel2 = false;
  for (const block of body) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as { readonly _type?: unknown; readonly level?: unknown };
    if (record._type !== CONTENT_BLOCK_OBJECT_TYPES.heading) continue;
    if (record.level === 2) sawLevel2 = true;
    else if (record.level === 3 && !sawLevel2) return true;
  }
  return false;
}

function uniqueLanguagesOf(entries: unknown): boolean {
  if (!Array.isArray(entries)) return true;
  const languages = entries.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { language?: unknown }).language === "string"
      ? [(entry as { language: string }).language]
      : [],
  );
  return new Set(languages).size === languages.length;
}

/** Every entry's `value` is a non-blank string, mirroring the Studio's own `nonBlank` rule. */
function blankLanguageIn(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { language, value } = entry as { readonly language?: unknown; readonly value?: unknown };
    if (typeof value !== "string" || value.trim().length === 0) {
      return typeof language === "string" ? language : "(unknown language)";
    }
  }
  return undefined;
}

/** Restates `sanity-config.ts`'s `parseApiVersion`-style calendar round trip for a datetime field. */
function isRealCalendarDateTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Restates `content-tree.ts`'s `MAX_CATEGORY_DEPTH`. */
export const MAX_CATEGORY_DEPTH = 5;

export function validateSeedFixtures(documents: readonly SeedDocument[]): readonly string[] {
  const violations: string[] = [];
  const byId = new Map<string, SeedDocument>(documents.map((doc) => [doc._id, doc]));

  // --- id namespace, per-document-type uniqueness -------------------------
  const mediaIds = new Set<string>();
  const categoryIds = new Set<string>();
  const serviceSlugs = new Set<string>();
  const placementIds = new Set<string>();
  const contentIdentities = new Set<string>(); // `${type}:${contentId}:${language}`
  const contentIdVariant = new Map<string, string>(); // contentId -> variant type

  for (const doc of documents) {
    if (!doc._id.startsWith(`${SEED_ID_ROOT}.`)) {
      violations.push(`${doc._id}: id is not under the "${SEED_ID_ROOT}.**" namespace`);
    }

    if (doc._type === MEDIA_TYPE_NAME) {
      const mediaId = doc.mediaId as string;
      if (mediaIds.has(mediaId)) violations.push(`media ${mediaId}: duplicate mediaId`);
      mediaIds.add(mediaId);
    }

    if (doc._type === CATEGORY_TYPE_NAME) {
      const categoryId = doc.categoryId as string;
      if (categoryIds.has(categoryId)) violations.push(`category ${categoryId}: duplicate categoryId`);
      categoryIds.add(categoryId);
    }

    if (doc._type === SERVICE_TYPE_NAME) {
      const slug = doc.slug as string;
      if (serviceSlugs.has(slug)) violations.push(`service ${slug}: duplicate slug`);
      serviceSlugs.add(slug);
    }

    if (doc._type === GALLERY_PLACEMENT_TYPE_NAME) {
      const placementId = doc.placementId as string;
      if (placementIds.has(placementId)) {
        violations.push(`placement ${placementId}: duplicate placementId`);
      }
      placementIds.add(placementId);

      const order = doc.order;
      if (typeof order !== "number" || !Number.isInteger(order) || order < 0) {
        violations.push(`placement ${placementId}: order must be a non-negative integer`);
      }

      const galleryId = referencedId(doc.gallery);
      const galleryDoc = galleryId === undefined ? undefined : byId.get(galleryId);
      if (galleryDoc === undefined || galleryDoc._type !== GALLERY_TYPE_NAME) {
        violations.push(`placement ${placementId}: "gallery" does not resolve to a gallery document`);
      } else if (typeof doc.sectionId === "string") {
        const declared = (galleryDoc.sections as readonly { readonly sectionId?: unknown }[] | undefined) ?? [];
        if (!declared.some((section) => section.sectionId === doc.sectionId)) {
          violations.push(
            `placement ${placementId}: sectionId "${doc.sectionId}" is not declared on its gallery`,
          );
        }
      }

      const mediaId = referencedId(doc.media);
      if (mediaId === undefined || byId.get(mediaId)?._type !== MEDIA_TYPE_NAME) {
        violations.push(`placement ${placementId}: "media" does not resolve to a media document`);
      }
    }

    if (doc._type === ARTICLE_TYPE_NAME || doc._type === GALLERY_TYPE_NAME) {
      const contentId = doc.contentId as string;
      const language = doc.language as string;
      const identity = `${contentId}:${language}`;
      if (contentIdentities.has(identity)) {
        violations.push(`${doc._type} ${contentId}: duplicate (contentId, language) "${identity}"`);
      }
      contentIdentities.add(identity);

      const existingVariant = contentIdVariant.get(contentId);
      if (existingVariant !== undefined && existingVariant !== doc._type) {
        violations.push(
          `contentId "${contentId}" is claimed by both ${existingVariant} and ${doc._type}`,
        );
      }
      contentIdVariant.set(contentId, doc._type);

      const canonicalId = referencedId(doc.canonicalCategory);
      if (canonicalId === undefined || byId.get(canonicalId)?._type !== CATEGORY_TYPE_NAME) {
        violations.push(`${doc._type} ${contentId}: "canonicalCategory" does not resolve to a category`);
      }

      const secondaryRefs = Array.isArray(doc.secondaryCategories) ? doc.secondaryCategories : [];
      const secondaryIds = secondaryRefs.flatMap((entry) => {
        const id = referencedId(entry);
        return id === undefined ? [] : [id];
      });
      if (canonicalId !== undefined && secondaryIds.includes(canonicalId)) {
        violations.push(`${doc._type} ${contentId}: canonicalCategory also appears in secondaryCategories`);
      }
      for (const id of secondaryIds) {
        if (byId.get(id)?._type !== CATEGORY_TYPE_NAME) {
          violations.push(`${doc._type} ${contentId}: a secondaryCategories entry does not resolve to a category`);
        }
      }

      if (doc._type === GALLERY_TYPE_NAME && doc.orderingRule !== "manual") {
        violations.push(`gallery ${contentId}: orderingRule must be "manual"`);
      }

      if (hasHeadingOrderViolation(doc.body)) {
        violations.push(`${doc._type} ${contentId}: a level-3 heading precedes the first level-2 heading`);
      }

      if (!isRealCalendarDateTime(doc.publishedAt)) {
        violations.push(`${doc._type} ${contentId}: publishedAt is not a real ISO calendar date`);
      }
    }

    if (doc._type === CATEGORY_TYPE_NAME) {
      const categoryId = doc.categoryId as string;
      if (!uniqueLanguagesOf(doc.slug)) violations.push(`category ${categoryId}: duplicate language in slug`);
      if (!uniqueLanguagesOf(doc.label)) violations.push(`category ${categoryId}: duplicate language in label`);
      const blankSlugLanguage = blankLanguageIn(doc.slug);
      if (blankSlugLanguage !== undefined) {
        violations.push(`category ${categoryId}: blank slug value for language "${blankSlugLanguage}"`);
      }
      const blankLabelLanguage = blankLanguageIn(doc.label);
      if (blankLabelLanguage !== undefined) {
        violations.push(`category ${categoryId}: blank label value for language "${blankLabelLanguage}"`);
      }
    }

    collectKeyViolations(doc._id, doc, violations);
  }

  // --- category tree: acyclic, no orphaned parent --------------------------
  for (const doc of documents) {
    if (doc._type !== CATEGORY_TYPE_NAME) continue;
    const categoryId = doc.categoryId as string;
    const parentRef = referencedId(doc.parent);
    if (parentRef !== undefined && byId.get(parentRef)?._type !== CATEGORY_TYPE_NAME) {
      violations.push(`category ${categoryId}: parent does not resolve to a category`);
    }

    const visited = new Set<string>();
    let current: SeedDocument | undefined = doc;
    let cyclic = false;
    while (current !== undefined) {
      const currentCategoryId = current.categoryId as string;
      if (visited.has(currentCategoryId)) {
        violations.push(`category ${categoryId}: parent chain contains a cycle`);
        cyclic = true;
        break;
      }
      visited.add(currentCategoryId);
      const nextRef = referencedId(current.parent);
      current = nextRef === undefined ? undefined : byId.get(nextRef);
    }
    if (!cyclic && visited.size > MAX_CATEGORY_DEPTH) {
      violations.push(
        `category ${categoryId}: depth ${visited.size} exceeds the maximum of ${MAX_CATEGORY_DEPTH}`,
      );
    }
  }

  // --- exactly one gallery has sections + body, the other neither ---------
  const galleries = documents.filter((doc) => doc._type === GALLERY_TYPE_NAME);
  const galleryShapes = galleries.map((doc) => ({
    hasSections: Array.isArray(doc.sections) && doc.sections.length > 0,
    hasBody: Array.isArray(doc.body) && doc.body.length > 0,
  }));
  const withSectionsAndBodyCount = galleryShapes.filter(
    (shape) => shape.hasSections && shape.hasBody,
  ).length;
  const withNeitherCount = galleryShapes.filter((shape) => !shape.hasSections && !shape.hasBody).length;
  if (withSectionsAndBodyCount !== 1) {
    violations.push(
      `expected exactly one gallery with both sections and a body, found ${withSectionsAndBodyCount}`,
    );
  }
  if (withNeitherCount !== 1) {
    violations.push(`expected exactly one gallery with neither sections nor a body, found ${withNeitherCount}`);
  }

  // --- archive gallery placement count -------------------------------------
  const archiveGalleryId = seedId("gallery", ARCHIVE_GALLERY_CONTENT_ID, GALLERY_LANGUAGE);
  const archivePlacementCount = documents.filter(
    (doc) => doc._type === GALLERY_PLACEMENT_TYPE_NAME && referencedId(doc.gallery) === archiveGalleryId,
  ).length;
  if (archivePlacementCount !== ARCHIVE_GALLERY_PLACEMENT_COUNT) {
    violations.push(
      `expected ${ARCHIVE_GALLERY_PLACEMENT_COUNT} archive gallery placements, found ${archivePlacementCount}`,
    );
  }

  // --- same media, two curated placements ----------------------------------
  const featuredGalleryId = seedId("gallery", FEATURED_GALLERY_CONTENT_ID, GALLERY_LANGUAGE);
  const placementsByGalleryThenMedia = new Map<string, Set<string>>([
    [archiveGalleryId, new Set<string>()],
    [featuredGalleryId, new Set<string>()],
  ]);
  for (const doc of documents) {
    if (doc._type !== GALLERY_PLACEMENT_TYPE_NAME) continue;
    const galleryId = referencedId(doc.gallery);
    const mediaId = referencedId(doc.media);
    if (galleryId === undefined || mediaId === undefined) continue;
    placementsByGalleryThenMedia.get(galleryId)?.add(mediaId);
  }
  const inBoth = [...(placementsByGalleryThenMedia.get(archiveGalleryId) ?? [])].filter((mediaId) =>
    placementsByGalleryThenMedia.get(featuredGalleryId)?.has(mediaId),
  );
  if (inBoth.length === 0) {
    violations.push(
      "expected at least one media document to have a placement in both the featured and archive galleries",
    );
  }

  return violations;
}
