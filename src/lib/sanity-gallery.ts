/**
 * The public gallery adapter (AB#113): Sanity `gallery` documents in, two
 * things out — the `ContentPlacementInput` `content-tree.ts` needs to place
 * the page, and the page-level `GalleryContentPage` (`content-page.ts`) a
 * detail route renders. A gallery's own curated items (`CuratedGalleryPlacement`)
 * and its section catalog's `intro` are deliberately narrower here than
 * `sanity-article.ts`'s equivalent read: `projectGalleryPlacement` and
 * `projectGallerySectionIntro` are pure, unit-tested projectors that AB#114's
 * bounded/windowed query calls, not something this module calls itself from an
 * eager "read every placement" query — that shape is exactly what AB#114
 * replaces `mock-gallery.ts`'s in-memory equivalent with (see the
 * `buildCuratedGalleryPage`/AB#134 precedent already set for the unfiltered and
 * section-filtered gallery reads).
 *
 * ## One document per language
 *
 * Same reasoning as `sanity-article.ts`: `gallery.ts`'s module comment
 * explains why a gallery is one document per language, not one document
 * describing every language.
 *
 * ## Visibility composes by AND (ADR-0002 §3)
 *
 * `projectGalleryPlacement` never rejects the whole document over one
 * placement referencing non-public media — that is the normal "this
 * occurrence doesn't render" state, computed as
 * `placement.visible && media.publiclyRenderable`, never a thrown error.
 */

import "server-only";

import {
  orderContentListingRecords,
  type CategorySubtreeListingQuery,
  type ContentListingRecord,
  type RoutedContentListingQuery,
} from "@/lib/content-listing";
import type { GalleryContentPage } from "@/lib/content-page";
import type { ContentPlacementInput } from "@/lib/content-tree";
import {
  MAX_GALLERY_ORDERING_SEED_LENGTH,
  orderingScopeString,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryOrdering,
  type GalleryWindowRequest,
} from "@/lib/gallery-pagination";
import {
  assertGallerySections,
  readCuratedGallerySectionPage,
  type CuratedGalleryPage,
  type CuratedGallerySectionSource,
  type GallerySection,
  type GallerySectionFilter,
  type GallerySectionIntroBlock,
  type GallerySectionInlineMark,
  type GallerySectionInlineSpan,
  type GallerySectionSummary,
} from "@/lib/gallery-sections";
import {
  CONTENT_BLOCK_PROJECTION,
  readContentBlocks,
} from "@/lib/sanity-content-blocks";
import {
  CATEGORY_DOCUMENT_TYPE,
  readCategoryDocumentIndex,
} from "@/lib/sanity-content-tree";
import {
  getSanityClient,
  type SanityClient,
} from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  isPubliclyRenderable,
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type PublicMediaLanguage,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import {
  chunkContentIds as chunkContentIdsShared,
  isRecord,
  MAX_CONTENT_IDS_BYTES,
  readString,
  toLanguageSubtag,
} from "@/lib/sanity-values";
import { getDeploymentConfig } from "@/lib/deployment-config";

/**
 * The document type this adapter reads. Declared here rather than imported
 * from `sanity/schemas`: the Studio schema is content-store configuration, not
 * application code (ADR-0006).
 */
export const GALLERY_DOCUMENT_TYPE = "gallery";

/** The identity form `gallery.ts`'s Studio validation enforces, enforced again here. */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const GALLERY_FILTER = `_type == "${GALLERY_DOCUMENT_TYPE}" && language == $language`;

/** How many items one bounded page of a Sanity-backed gallery holds. */
export const GALLERY_PAGE_SIZE = 24;

/**
 * The gallery *page's* placement in the category tree — `contentId`, `slug`,
 * `canonicalCategoryRef`, `secondaryCategoryRefs` — unrelated to the gallery's
 * own curated items/`CuratedGalleryPlacement` list. Named to match
 * `sanity-article.ts#ARTICLE_PLACEMENT_PROJECTION`'s identical concept, not the
 * gallery's own `placements` field.
 */
export const GALLERY_PLACEMENT_PROJECTION = `{
  contentId,
  slug,
  "canonicalCategoryRef": canonicalCategory._ref,
  "secondaryCategoryRefs": secondaryCategories[]._ref
}`;

export const GALLERY_DETAIL_PROJECTION = `{
  contentId,
  title,
  summary,
  publishedAt,
  "cover": cover->${PUBLIC_MEDIA_PROJECTION},
  tags,
  body[]${CONTENT_BLOCK_PROJECTION}
}`;

/** Why a document could not become a published gallery projection. */
export type SanityGalleryRejection =
  | "incomplete-document"
  | "malformed-section"
  | "ambiguous-content-id"
  | "malformed-result"
  /** The gallery's `orderingRule` is `seeded-random`, which this adapter does not yet implement (ADR-0009, AB#129). */
  | "ordering-not-implemented"
  /**
   * A `seeded-random` gallery whose placements' materialized `shuffledOrder`
   * keys do not all match the gallery's current `orderingSeed` — i.e. the
   * seed was rotated and `npm run recompute:shuffled-order` has not finished.
   * A transient, retryable state, not a defect (ADR-0009 2026-08-28 amendment):
   * the route serves an accessible "temporarily unavailable" page, and the
   * gallery recovers on its own once the recompute lands and the
   * `sanity:galleries` cache tag is invalidated.
   */
  | "ordering-stale";

export class SanityGalleryError extends Error {
  readonly rejection: SanityGalleryRejection;
  readonly contentId: string | undefined;

  constructor(
    rejection: SanityGalleryRejection,
    detail: string,
    contentId?: string,
  ) {
    super(
      `[sanity-gallery] ${detail}${contentId === undefined ? "" : ` (contentId "${contentId}")`}`,
    );
    this.name = "SanityGalleryError";
    this.rejection = rejection;
    this.contentId = contentId;
  }
}

export type RawGalleryPlacementDocument = {
  readonly contentId?: unknown;
  readonly slug?: unknown;
  readonly canonicalCategoryRef?: unknown;
  readonly secondaryCategoryRefs?: unknown;
};

export type RawGalleryDetailDocument = {
  readonly contentId?: unknown;
  readonly title?: unknown;
  readonly summary?: unknown;
  readonly publishedAt?: unknown;
  readonly cover?: unknown;
  readonly tags?: unknown;
  readonly body?: unknown;
};

function readContentId(value: unknown, context?: string): string {
  const contentId = readString(value);
  if (contentId === undefined || !CONTENT_ID.test(contentId)) {
    throw new SanityGalleryError(
      "incomplete-document",
      `a gallery document has no usable contentId, so nothing can reference it${context === undefined ? "" : ` (${context})`}`,
    );
  }
  return contentId;
}

const ISO_DATE_OR_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z)?$/;

/** Same round-trip validation as `sanity-article.ts#isValidIsoDate`. */
function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_OR_DATETIME.exec(value);
  if (match === null) return false;

  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = hour === undefined ? 0 : Number(hour);
  const mi = minute === undefined ? 0 : Number(minute);
  const s = second === undefined ? 0 : Number(second);

  const rebuilt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    rebuilt.getUTCFullYear() === y &&
    rebuilt.getUTCMonth() === mo - 1 &&
    rebuilt.getUTCDate() === d &&
    rebuilt.getUTCHours() === h &&
    rebuilt.getUTCMinutes() === mi &&
    rebuilt.getUTCSeconds() === s
  );
}

function readPublishedAt(value: unknown, contentId: string): string {
  const publishedAt = readString(value);
  if (publishedAt === undefined || !isValidIsoDate(publishedAt)) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery has no publishedAt, or it is not a real ISO calendar date",
      contentId,
    );
  }
  return publishedAt;
}

const UNRESOLVED_CATEGORY_PREFIX = "unresolved-ref:";

function resolveCategoryId(
  ref: string,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): string {
  return (
    categoryIdsByDocumentId.get(ref) ?? `${UNRESOLVED_CATEGORY_PREFIX}${ref}`
  );
}

function readCategoryReference(value: unknown, contentId: string): string | null {
  if (value === undefined || value === null) return null;
  const ref = readString(value);
  if (ref !== undefined) return ref;
  throw new SanityGalleryError(
    "incomplete-document",
    "the gallery's canonical category reference is malformed",
    contentId,
  );
}

function readSecondaryCategoryReferences(
  value: unknown,
  contentId: string,
): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery's secondary categories are not a list",
      contentId,
    );
  }
  return value.map((entry) => {
    const ref = readString(entry);
    if (ref === undefined) {
      throw new SanityGalleryError(
        "incomplete-document",
        "the gallery has a malformed secondary category reference",
        contentId,
      );
    }
    return ref;
  });
}

/**
 * Projects one document into the placement `content-tree.ts` needs — page-
 * level metadata, unrelated to the gallery's own curated items. Pure and
 * exported so a fixture test can exercise it without a network, mirroring
 * `sanity-article.ts#projectArticlePlacementInput`.
 */
export function projectGalleryPlacementInput(
  document: RawGalleryPlacementDocument,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ContentPlacementInput {
  const contentId = readContentId(document.contentId);

  const slug = readString(document.slug);
  if (slug === undefined) {
    throw new SanityGalleryError("incomplete-document", "the gallery has no slug", contentId);
  }

  const canonicalRef = readCategoryReference(document.canonicalCategoryRef, contentId);
  const canonicalCategoryId =
    canonicalRef === null ? null : resolveCategoryId(canonicalRef, categoryIdsByDocumentId);

  const secondaryRefs = readSecondaryCategoryReferences(
    document.secondaryCategoryRefs,
    contentId,
  );
  const secondaryCategoryIds = secondaryRefs.map((ref) =>
    resolveCategoryId(ref, categoryIdsByDocumentId),
  );

  return {
    contentId,
    variant: "gallery",
    slug,
    published: true,
    canonicalCategoryId,
    ...(secondaryCategoryIds.length > 0 ? { secondaryCategoryIds } : {}),
  };
}

function readDocuments<T>(result: unknown): readonly T[] {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered with something other than a list of gallery documents",
    );
  }
  return result as readonly T[];
}

/**
 * Resolves *the* published document matching a content identity from a
 * bounded `[0...2]` probe: zero means "not published in this language" (a
 * normal outcome, not an error), and more than one means the store holds an
 * identity collision this boundary refuses to silently pick a winner from.
 * Shared by every bounded-by-two identity read in this file — gallery detail
 * and gallery pagination basics — so the message and the `contentId` attached
 * to it can never drift between two hand-written copies of this check.
 * Deliberately its own array-shape check rather than a thin wrapper around
 * `readDocuments`: this function's contract always has a `contentId` to
 * attach to a malformed-result error, which `readDocuments`'s other caller
 * (a whole-language listing read with no single identity to attach) does not.
 */
function resolveUniqueDocument<T>(raw: unknown, contentId: string): T | undefined {
  if (!Array.isArray(raw) || !raw.every(isRecord)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered with something other than a list of gallery documents",
      contentId,
    );
  }
  const documents = raw as readonly T[];
  if (documents.length === 0) return undefined;
  if (documents.length > 1) {
    throw new SanityGalleryError(
      "ambiguous-content-id",
      "two published documents claim one content identity in this language",
      contentId,
    );
  }
  return documents[0];
}

function getFallbackLocale(): string {
  return getDeploymentConfig().localeRoutes.defaultLocale;
}

export type PublicGalleryPlacementReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
};

/**
 * Every published gallery in one language, as the placements
 * `readPublicContentTree` composes with categories into one validated tree.
 * In scope for AB#113: this is page-level metadata, not the gallery's curated
 * items.
 */
export async function readPublicGalleryPlacements(
  options: PublicGalleryPlacementReadOptions,
): Promise<readonly ContentPlacementInput[]> {
  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const categoryIdsByDocumentId = await readCategoryDocumentIndex(client);

  const result = await client.query({
    query: `*[${GALLERY_FILTER}]${GALLERY_PLACEMENT_PROJECTION}`,
    params: { language },
    tag: "gallery.placements",
  });

  return readDocuments<RawGalleryPlacementDocument>(result).map((document) =>
    projectGalleryPlacementInput(document, categoryIdsByDocumentId),
  );
}

// ---------------------------------------------------------------------------
// Listing record: the fields a category branch's card reads for a gallery,
// mirroring `sanity-article.ts`'s equivalent read exactly (its own module
// comment explains why a listing card must never load a body).
// ---------------------------------------------------------------------------

export const GALLERY_LISTING_PROJECTION = `{
  contentId,
  title,
  summary,
  publishedAt,
  "cover": cover->${PUBLIC_MEDIA_PROJECTION}
}`;

/** The GROQ order `content-listing.ts`'s `CONTENT_LISTING_ORDERING` names. */
export const GALLERY_LISTING_ORDER = `order(publishedAt desc, contentId asc)`;

export type RawGalleryListingDocument = {
  readonly contentId?: unknown;
  readonly title?: unknown;
  readonly summary?: unknown;
  readonly publishedAt?: unknown;
  readonly cover?: unknown;
};

type ListingProjectionOptions = {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly config: SanityConfig;
};

/**
 * Projects one document into the fields a listing card reads. Mirrors
 * `sanity-article.ts#projectArticleListingRecord`.
 */
export function projectGalleryListingRecord(
  document: RawGalleryListingDocument,
  options: ListingProjectionOptions,
): ContentListingRecord {
  const contentId = readContentId(document.contentId);

  const title = readString(document.title);
  if (title === undefined) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery has no title",
      contentId,
    );
  }

  const publishedAt = readPublishedAt(document.publishedAt, contentId);

  const summary = readString(document.summary);
  const cover = isRecord(document.cover)
    ? projectPublicMedia(document.cover as RawPublicMediaDocument, options)
    : undefined;

  return {
    contentId,
    title,
    publishedAt,
    ...(summary === undefined ? {} : { summary }),
    ...(cover === undefined ? {} : { cover }),
  };
}

export type PublicGalleryListingReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

/**
 * Splits candidate ids the same way `sanity-article.ts#chunkContentIds` does,
 * with this adapter's own classified error for the id-too-large-by-itself
 * case — `sanity-values.ts#chunkContentIds`'s provider-neutral mechanics keep
 * a gallery-listing failure from ever surfacing as a `SanityArticleError`.
 */
function chunkGalleryContentIds(
  contentIds: readonly string[],
  maxBytes: number,
): readonly (readonly string[])[] {
  return chunkContentIdsShared(contentIds, maxBytes, (id) => {
    throw new SanityGalleryError(
      "incomplete-document",
      "a content id is too large to fit any bounded listing request by itself",
      id,
    );
  });
}

/**
 * Resolves the requested project `categoryId`s to the Sanity document ids that
 * carry them, with one targeted, chunked lookup of just those categories —
 * mirroring `sanity-article.ts#resolveCategoryDocumentIds`. The read scales with
 * the subtree in scope, not the whole category collection, and the gallery
 * filter below keys on the resolved `_id`s through `references()` rather than
 * dereferencing a category from the gallery side.
 */
async function resolveCategoryDocumentIds(
  client: SanityClient,
  categoryIds: readonly string[],
): Promise<readonly string[]> {
  const chunks = chunkGalleryContentIds(categoryIds, MAX_CONTENT_IDS_BYTES);
  const perChunk = await Promise.all(
    chunks.map(async (ids) => {
      const result = await client.query({
        query: `*[_type == "${CATEGORY_DOCUMENT_TYPE}" && categoryId in $categoryIds]{ _id }`,
        params: { categoryIds: ids },
        tag: "category.ids",
      });
      return readDocuments<{ readonly _id?: unknown }>(result).flatMap(
        (document) => (typeof document._id === "string" ? [document._id] : []),
      );
    }),
  );
  return perChunk.flat();
}

/**
 * The bounded listing read `content-listing.ts`'s `ContentListingSource`
 * describes, for gallery pages. Mirrors
 * `sanity-article.ts#readPublicArticleListingRecords` exactly, including
 * chunking `query.contentIds` to the GET URL budget: a category branch can
 * list galleries and articles side by side, and this is the gallery half of
 * that bounded multi-id read.
 */
export async function readPublicGalleryListingRecords(
  query: RoutedContentListingQuery,
  options: PublicGalleryListingReadOptions,
): Promise<readonly ContentListingRecord[]> {
  if (query.contentIds.length === 0) return [];

  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();
  const languages = { language, fallbackLanguage: getFallbackLocale(), config };

  const chunks = chunkGalleryContentIds(query.contentIds, MAX_CONTENT_IDS_BYTES);

  const chunkedRecords = await Promise.all(
    chunks.map(async (contentIds) => {
      const result = await client.query({
        query: `*[${GALLERY_FILTER} && contentId in $contentIds] | ${GALLERY_LISTING_ORDER} [0...$limit]${GALLERY_LISTING_PROJECTION}`,
        params: { language, contentIds, limit: query.limit },
        tag: "gallery.listing",
      });

      return readDocuments<RawGalleryListingDocument>(result).map((document) =>
        projectGalleryListingRecord(document, languages),
      );
    }),
  );

  return orderContentListingRecords(chunkedRecords.flat()).slice(0, query.limit);
}

/**
 * The gallery half of the `category-subtree` listing read, mirroring
 * `sanity-article.ts#readPublicArticleListingRecordsInCategories` exactly:
 * project `categoryId`s resolve to Sanity document ids through one targeted
 * lookup of just those categories (so the filter keys on `_id` through
 * `references()`, never a dereference from the gallery side), the id list is
 * chunked to the GET URL budget, and the merged rows are de-duplicated by
 * `contentId` because a chunk split can match one gallery on a canonical
 * category in one chunk and a secondary in another.
 */
export async function readPublicGalleryListingRecordsInCategories(
  query: CategorySubtreeListingQuery,
  options: PublicGalleryListingReadOptions,
): Promise<readonly ContentListingRecord[]> {
  if (query.categoryIds.length === 0) return [];

  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();
  const languages = { language, fallbackLanguage: getFallbackLocale(), config };

  const categoryDocumentIds = await resolveCategoryDocumentIds(
    client,
    query.categoryIds,
  );
  if (categoryDocumentIds.length === 0) return [];

  const chunks = chunkGalleryContentIds(
    categoryDocumentIds,
    MAX_CONTENT_IDS_BYTES,
  );

  // See `sanity-article.ts#readPublicArticleListingRecordsInCategories`: a
  // category-listing continuation cursor (AB#140, ADR-0013) resumes strictly
  // after a `(publishedAt, contentId)` boundary, `publishedAt` compared as the
  // stored string exactly as `GALLERY_LISTING_ORDER` orders it.
  const keysetFilter =
    query.after === undefined
      ? ""
      : " && (publishedAt < $afterPublishedAt || (publishedAt == $afterPublishedAt && contentId > $afterContentId))";
  const keysetParams =
    query.after === undefined
      ? {}
      : {
          afterPublishedAt: query.after.publishedAt,
          afterContentId: query.after.contentId,
        };

  const chunkedRecords = await Promise.all(
    chunks.map(async (categoryIds) => {
      const result = await client.query({
        query: `*[${GALLERY_FILTER} && references($categoryIds)${keysetFilter}] | ${GALLERY_LISTING_ORDER} [0...$limit]${GALLERY_LISTING_PROJECTION}`,
        params: { language, categoryIds, limit: query.limit, ...keysetParams },
        tag: "gallery.listing.by-category",
      });

      return readDocuments<RawGalleryListingDocument>(result).map((document) =>
        projectGalleryListingRecord(document, languages),
      );
    }),
  );

  const byId = new Map<string, ContentListingRecord>();
  for (const record of chunkedRecords.flat()) {
    if (!byId.has(record.contentId)) byId.set(record.contentId, record);
  }

  return orderContentListingRecords([...byId.values()]).slice(0, query.limit);
}

function readTags(value: unknown, contentId: string): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery's tags are not a list of strings",
      contentId,
    );
  }
  return value;
}

type DetailProjectionOptions = {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly config: SanityConfig;
};

/**
 * Projects one document into the page-level `GalleryContentPage` a route
 * renders — title, lead, publication date, tags, body, and an explicit cover
 * only. Unlike `sanity-article.ts#projectArticleContentPage`, an empty body is
 * not a defect (ADR-0003 decision 3: a gallery's body is optional editorial
 * content, separate from its curated grid), and there is no fallback here from
 * a missing `cover` to the gallery's first visible placement — that fallback
 * needs the ordered, visible placement list, which is AB#114's bounded query.
 */
export function projectGalleryContentPage(
  document: RawGalleryDetailDocument,
  options: DetailProjectionOptions,
): GalleryContentPage {
  const contentId = readContentId(document.contentId);

  const title = readString(document.title);
  if (title === undefined) {
    throw new SanityGalleryError("incomplete-document", "the gallery has no title", contentId);
  }

  const publishedAt = readPublishedAt(document.publishedAt, contentId);

  const summary = readString(document.summary);
  const cover = isRecord(document.cover)
    ? projectPublicMedia(document.cover as RawPublicMediaDocument, options)
    : undefined;
  const tags = readTags(document.tags, contentId);
  const body = readContentBlocks(document.body, options);

  return {
    contentId,
    variant: "gallery",
    title,
    publishedAt,
    ...(summary === undefined ? {} : { summary }),
    ...(cover === undefined ? {} : { cover }),
    ...(tags.length > 0 ? { tags } : {}),
    body,
  };
}

export type PublicGalleryReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

/**
 * One gallery's page-level content by its stable identity, or `undefined`
 * when this language publishes none under that id — the normal bilingual
 * state, not an error. Mirrors `sanity-article.ts#readPublicArticlePage`;
 * reads `[0...2]` to detect two published documents claiming one identity.
 */
export async function readPublicGalleryPage(
  contentId: string,
  options: PublicGalleryReadOptions,
): Promise<GalleryContentPage | undefined> {
  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();

  const result = await client.query({
    query: `*[${GALLERY_FILTER} && contentId == $contentId][0...2]${GALLERY_DETAIL_PROJECTION}`,
    params: { language, contentId },
    tag: "gallery.detail",
  });

  const document = resolveUniqueDocument<RawGalleryDetailDocument>(result, contentId);
  if (document === undefined) return undefined;

  return projectGalleryContentPage(document, {
    language,
    fallbackLanguage: getFallbackLocale(),
    config,
  });
}

// ---------------------------------------------------------------------------
// Section catalog (bounded, structural only — not pagination)
// ---------------------------------------------------------------------------

export type RawGallerySectionSummary = {
  readonly sectionId?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
};

/** Projects one raw section row into the bounded, `intro`-free catalog entry. */
export function projectGallerySectionSummary(
  raw: RawGallerySectionSummary,
  order: number,
  contentId: string,
): GallerySectionSummary {
  const sectionId = readString(raw.sectionId);
  const slug = readString(raw.slug);
  const label = readString(raw.label);
  if (sectionId === undefined || slug === undefined || label === undefined) {
    throw new SanityGalleryError(
      "malformed-section",
      "a gallery section is missing its id, slug, or label",
      contentId,
    );
  }
  return { sectionId, slug, label, order };
}

/**
 * The gallery's full section catalog — id/slug/label/order only, no `intro` —
 * for AB#105's "full section catalog exposed on every page" requirement. A
 * handful of strings per gallery, so this stays in scope for AB#113 (it is not
 * a windowed/bounded placement query).
 */
export async function readPublicGallerySectionCatalog(
  contentId: string,
  language: string,
  client?: SanityClient,
): Promise<readonly GallerySectionSummary[]> {
  const resolvedClient = client ?? getSanityClient();
  const resolvedLanguage = toLanguageSubtag(language);

  const result = await resolvedClient.query({
    query: `*[${GALLERY_FILTER} && contentId == $contentId][0].sections[]{sectionId, slug, label}`,
    params: { language: resolvedLanguage, contentId },
    tag: "gallery.sections",
  });

  if (result === null || result === undefined) return [];
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered with something other than a list of gallery sections",
      contentId,
    );
  }

  return (result as readonly RawGallerySectionSummary[]).map((raw, index) =>
    projectGallerySectionSummary(raw, index, contentId),
  );
}

// ---------------------------------------------------------------------------
// Section intro: pure projector, no querying
// ---------------------------------------------------------------------------

const KNOWN_MARKS: ReadonlySet<string> = new Set(["emphasis"]);

export type RawGallerySectionInlineSpan = {
  readonly text?: unknown;
  readonly marks?: unknown;
  readonly href?: unknown;
};

export type RawGallerySectionIntroParagraph = {
  readonly _type: "gallerySectionIntroParagraphBlock";
  readonly _key?: unknown;
  readonly spans?: unknown;
};

export type RawGallerySectionIntroListItem = {
  readonly _key?: unknown;
  readonly spans?: unknown;
};

export type RawGallerySectionIntroList = {
  readonly _type: "gallerySectionIntroListBlock";
  readonly _key?: unknown;
  readonly ordered?: unknown;
  readonly items?: unknown;
};

export type RawGallerySectionIntroBlock =
  | RawGallerySectionIntroParagraph
  | RawGallerySectionIntroList;

function projectSpan(raw: RawGallerySectionInlineSpan): GallerySectionInlineSpan {
  // Not `readString`: it trims whitespace, which would silently swallow a
  // deliberate leading/trailing space between two adjacent spans (e.g. the
  // space before an emphasised run of text).
  const text = typeof raw.text === "string" && raw.text.length > 0 ? raw.text : undefined;
  if (text === undefined) {
    throw new SanityGalleryError(
      "malformed-section",
      "a gallery section intro span has no text",
    );
  }

  const marksRaw = raw.marks;
  const marks =
    Array.isArray(marksRaw) && marksRaw.length > 0
      ? marksRaw.flatMap((mark): readonly GallerySectionInlineMark[] => {
          if (typeof mark !== "string" || !KNOWN_MARKS.has(mark)) {
            throw new SanityGalleryError(
              "malformed-section",
              `a gallery section intro span has an unknown mark: ${String(mark)}`,
            );
          }
          return [mark as GallerySectionInlineMark];
        })
      : undefined;

  const href = readString(raw.href);

  return {
    text,
    ...(marks !== undefined ? { marks } : {}),
    ...(href !== undefined ? { href } : {}),
  };
}

function projectSpans(value: unknown): readonly GallerySectionInlineSpan[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SanityGalleryError(
      "malformed-section",
      "a gallery section intro block has no spans",
    );
  }
  return value.map((entry) => projectSpan(entry as RawGallerySectionInlineSpan));
}

/**
 * Projects Sanity's `gallerySectionIntroParagraphBlock`/`gallerySectionIntroListBlock`
 * object array back onto `gallery-sections.ts`'s `GallerySectionIntroBlock`
 * union — a 1:1 structural projection, not a portable-text grouping problem:
 * each domain block (including a list's `items`) already corresponds to one
 * Sanity array/object, each carrying its own stable `_key` from Sanity
 * automatically. Pure and unit-tested independently of any query.
 */
export function projectGallerySectionIntro(
  raw: readonly RawGallerySectionIntroBlock[] | undefined,
): readonly GallerySectionIntroBlock[] {
  if (raw === undefined) return [];

  return raw.map((block) => {
    const key = readString((block as { readonly _key?: unknown })._key);
    if (block._type === "gallerySectionIntroParagraphBlock") {
      return {
        type: "paragraph" as const,
        spans: projectSpans(block.spans),
        ...(key !== undefined ? { key } : {}),
      };
    }
    if (block._type === "gallerySectionIntroListBlock") {
      const orderedRaw = block.ordered;
      if (typeof orderedRaw !== "boolean") {
        throw new SanityGalleryError(
          "malformed-section",
          "a gallery section intro list has a non-boolean ordered field",
        );
      }
      const itemsRaw = block.items;
      if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
        throw new SanityGalleryError(
          "malformed-section",
          "a gallery section intro list has no items",
        );
      }
      const items = itemsRaw.map((item) => {
        const raw = item as RawGallerySectionIntroListItem;
        const itemKey = readString(raw._key);
        return {
          spans: projectSpans(raw.spans),
          ...(itemKey !== undefined ? { key: itemKey } : {}),
        };
      });
      return {
        type: "list" as const,
        ordered: orderedRaw,
        items,
        ...(key !== undefined ? { key } : {}),
      };
    }
    throw new SanityGalleryError(
      "malformed-section",
      `a gallery section intro block has an unknown type: ${String((block as { readonly _type?: unknown })._type)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// One curated placement: pure projector, no querying — AB#114's bounded query
// calls this per row it reads.
// ---------------------------------------------------------------------------

export type RawGalleryPlacementItem = {
  readonly placementId?: unknown;
  readonly order?: unknown;
  readonly media?: unknown;
  readonly sectionId?: unknown;
  readonly visible?: unknown;
  readonly altOverride?: unknown;
  readonly captionOverride?: unknown;
  readonly pinned?: unknown;
  readonly shuffledOrder?: unknown;
  readonly shuffledOrderSeed?: unknown;
};

/**
 * `order` is now an authored field on the `galleryPlacement` document
 * (AB#114 — see that schema's module comment for why it is no longer array
 * position), so it is read off the row rather than supplied by a caller.
 */
function readOrder(value: unknown, placementId: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SanityGalleryError(
      "malformed-result",
      "a gallery placement has no usable order (expected a non-negative integer)",
      placementId,
    );
  }
  return value;
}

/** A GROQ `count(...)` result, defended against a malformed store answer. */
function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SanityGalleryError(
      "malformed-result",
      `expected a non-negative integer count, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Projects one raw placement row into `CuratedGalleryPlacement`, or `undefined`
 * when its referenced media is not publicly renderable — ADR-0002 §3's AND-
 * composition ("a placement can only subtract ... it can never make a
 * non-public media visible"), applied here as *exclusion* rather than a
 * `visible: false` placement carrying an unvalidated `Media`: `Media`'s own
 * fields (alt text, a checked public rendition, ...) are guarantees
 * `projectPublicMedia` enforces for public media specifically, and a
 * photograph that is not publicly renderable has no obligation to satisfy
 * them (it may be an incomplete draft). `undefined` here means exactly what an
 * already-filtered query would have returned: no candidate row at all — never
 * a thrown error that would abort reading the rest of the gallery. This never
 * throws for a media-visibility reason; it still throws (as
 * `SanityGalleryError`) for a genuinely malformed row — a missing
 * `placementId`, an unresolved media reference, or media claiming to be
 * public while failing `projectPublicMedia`'s own content checks, all of
 * which are content defects distinct from ADR-0002 §3's ordinary visibility
 * composition.
 *
 * `order` is read from the row itself, not supplied by a caller: it is an
 * authored field on the `galleryPlacement` document (AB#114), not array
 * position — see `readOrder` and `gallery-placement.ts`'s module comment.
 * Pure and unit-tested independently of any query — this is the function
 * AB#114's bounded query calls per row, not something AB#113 calls itself
 * from an eager "fetch everything" read.
 *
 * `ordering` (AB#129): for a `seeded-random` gallery this also carries
 * `pinned` and the materialized `shuffledOrder` (64-hex) onto the result, so
 * `gallery-pagination.ts`'s tiered comparator has what it needs. A gallery-wide
 * staleness check already happened in the basics query
 * (`readSanityCuratedGalleryPage`), so a per-row mismatch here is defense in
 * depth: a non-pinned row whose `shuffledOrder` is missing or was computed from
 * a different seed raises `ordering-stale` rather than being silently
 * mis-sorted. Under `manual` these fields are ignored.
 */
export function projectGalleryPlacement(
  raw: RawGalleryPlacementItem,
  options: PublicMediaLanguage & {
    readonly config: SanityConfig;
    readonly ordering?: GalleryOrdering;
  },
): CuratedGalleryPlacement | undefined {
  const placementId = readString(raw.placementId);
  if (placementId === undefined) {
    throw new SanityGalleryError("malformed-result", "a gallery placement has no placementId");
  }
  const order = readOrder(raw.order, placementId);
  if (!isRecord(raw.media)) {
    throw new SanityGalleryError(
      "malformed-result",
      "a gallery placement's media did not resolve",
      placementId,
    );
  }

  const rawMedia = raw.media as RawPublicMediaDocument;
  if (!isPubliclyRenderable(rawMedia)) {
    return undefined;
  }

  const media = projectPublicMedia(rawMedia, options);
  const sectionId = readString(raw.sectionId);
  const altOverride = readString(raw.altOverride);
  const captionOverride = readString(raw.captionOverride);

  const seeded =
    options.ordering !== undefined && options.ordering.kind === "seeded-random"
      ? projectSeededOrderingFields(raw, placementId, options.ordering.seed)
      : {};

  return {
    placementId,
    order,
    visible: raw.visible === true,
    media,
    ...(sectionId !== undefined ? { sectionId } : {}),
    ...(altOverride !== undefined ? { altOverride } : {}),
    ...(captionOverride !== undefined ? { captionOverride } : {}),
    ...seeded,
  };
}

/**
 * `pinned` / `shuffledOrder` for one row of a `seeded-random` gallery. A
 * pinned lead carries no `shuffledOrder` (it sorts by manual `order`); a
 * non-pinned row must carry a 64-hex `shuffledOrder` whose `shuffledOrderSeed`
 * matches the gallery's current seed, else `ordering-stale` (defense in depth
 * behind the basics-query aggregate).
 */
function projectSeededOrderingFields(
  raw: RawGalleryPlacementItem,
  placementId: string,
  seed: string,
): { readonly pinned?: boolean; readonly shuffledOrder?: string } {
  if (raw.pinned === true) {
    return { pinned: true };
  }
  // Read raw, not via `readString` (which trims): GROQ orders and filters on
  // the stored value verbatim, so a whitespace-padded `shuffledOrder` that
  // `readString` trimmed to 64-hex would make the cursor boundary this row
  // mints disagree with the store's own keyset comparison and skip later
  // rows. Any deviation from a clean 64-hex value / matching seed is
  // `ordering-stale` — the recompute step repatches it.
  const shuffledOrder =
    typeof raw.shuffledOrder === "string" ? raw.shuffledOrder : undefined;
  const shuffledOrderSeed =
    typeof raw.shuffledOrderSeed === "string" ? raw.shuffledOrderSeed : undefined;
  if (
    shuffledOrder === undefined ||
    !/^[0-9a-f]{64}$/.test(shuffledOrder) ||
    shuffledOrderSeed !== seed
  ) {
    throw new SanityGalleryError(
      "ordering-stale",
      "a placement's shuffledOrder is missing or does not match the gallery's current orderingSeed",
      placementId,
    );
  }
  return { shuffledOrder };
}

// ---------------------------------------------------------------------------
// Bounded windowed placement query (AB#114): CuratedGallerySectionSource over
// galleryPlacement documents, composed with readCuratedGallerySectionPage.
// ---------------------------------------------------------------------------

/** The document type AB#114's placements live in — see gallery-placement.ts. */
export const GALLERY_PLACEMENT_DOCUMENT_TYPE = "galleryPlacement";

const GALLERY_PLACEMENT_ITEM_PROJECTION = `{
  placementId,
  order,
  sectionId,
  visible,
  altOverride,
  captionOverride,
  "pinned": coalesce(pinned, false),
  shuffledOrder,
  shuffledOrderSeed,
  "media": media->${PUBLIC_MEDIA_PROJECTION}
}`;

/**
 * The clauses every bounded placement query needs, regardless of section
 * filter or cursor: this gallery, visible, and its media already publicly
 * renderable. Filtered by direct reference identity (`gallery._ref ==
 * $galleryDocumentId`), not a `gallery->contentId`/`gallery->language` join —
 * verified against Sanity's own "Avoiding joins in filters" guidance
 * (https://www.sanity.io/docs/developer-guides/high-performance-groq), which
 * recommends filtering on a reference's `_ref` over its dereferenced fields
 * for exactly this reason, and shows the same `field._ref == "doc-id"` shape
 * used here. This filter runs on every row a bounded window scans, not once
 * per page. The
 * caller resolves `galleryDocumentId` once, from the same basics read that
 * already looks the gallery up by `contentId`+`language` (see
 * `readSanityCuratedGalleryPage`), so this never re-derives it per row.
 * Filtering visibility and public renderability in GROQ itself, not after the
 * fetch, is what keeps a bounded window inside `CuratedGallerySectionSource`'s
 * contract: every returned row is already usable, so nothing here can
 * silently shrink a page below its requested size by dropping a row after the
 * fact.
 */
function buildPlacementFilter(sectionId: string | undefined): string {
  const sectionClause = sectionId === undefined ? "" : " && sectionId == $sectionId";
  // The `media->privateOnly` clause mirrors `PUBLIC_MEDIA_FILTER` exactly,
  // fail-closed shape and all: a private client-gallery asset (ADR-0002 /
  // ADR-0014 §2) is excluded from the bounded window server-side, the same as a
  // hidden placement or a non-renderable one, so a returned row is already
  // within `CuratedGallerySectionSource`'s contract and `buildCuratedGalleryPage`
  // never has to drop one after the fetch.
  return `_type == "${GALLERY_PLACEMENT_DOCUMENT_TYPE}" && gallery._ref == $galleryDocumentId && visible == true && media->publiclyRenderable == true && (media->privateOnly == false || !defined(media->privateOnly))${sectionClause}`;
}

function sectionIdOf(filter: GallerySectionFilter): string | undefined {
  return filter.kind === "section" ? filter.section.sectionId : undefined;
}

function readPlacementRow(value: unknown): RawGalleryPlacementItem {
  if (!isRecord(value)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered a placement query with something other than a placement row",
    );
  }
  return value as RawGalleryPlacementItem;
}

function readPlacementRows(value: unknown): readonly RawGalleryPlacementItem[] {
  if (!Array.isArray(value)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered a placement query with something other than a list of rows",
    );
  }
  return value.map(readPlacementRow);
}

type RawGalleryWindowQueryResult = {
  readonly boundary?: unknown;
  readonly candidates?: unknown;
};

function readWindowQueryResult(value: unknown): {
  readonly boundary: RawGalleryPlacementItem | undefined;
  readonly candidates: readonly RawGalleryPlacementItem[];
} {
  if (!isRecord(value)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered a windowed placement query with something other than the expected {boundary, candidates} shape",
    );
  }
  const raw = value as RawGalleryWindowQueryResult;
  const boundary =
    raw.boundary === null || raw.boundary === undefined
      ? undefined
      : readPlacementRow(raw.boundary);
  return { boundary, candidates: readPlacementRows(raw.candidates) };
}

/**
 * Turns a projected `CuratedGalleryPlacement | undefined` back into a
 * required value, for a row this function's own GROQ filter already
 * guarantees is publicly renderable. `projectGalleryPlacement` only returns
 * `undefined` when `!isPubliclyRenderable`, and every row reaching this point
 * already matched `media->publiclyRenderable == true` and the fail-closed
 * `media->privateOnly` clause in the same query — so `undefined` here can only
 * mean the store's own filter and the adapter's own re-check disagree, which
 * is a contract violation to raise, not a row to quietly drop and shrink the
 * page.
 */
function assertAlreadyPublic(
  placement: CuratedGalleryPlacement | undefined,
): CuratedGalleryPlacement {
  if (placement === undefined) {
    throw new SanityGalleryError(
      "malformed-result",
      "a bounded placement query returned a row the store's own publiclyRenderable filter should already have excluded",
    );
  }
  return placement;
}

/**
 * The keyset predicate for one lane, following Sanity's own documented
 * two-field idiom (`key > $after || (key == $after && placementId > $afterId)`,
 * GROQ's recommended alternative to array-slice pagination — verified against
 * https://www.sanity.io/docs/developer-guides/paginating-with-groq).
 */
function laneKeysetPredicate(keyField: string, afterParam: string): string {
  return `(${keyField} > ${afterParam} || (${keyField} == ${afterParam} && placementId > $afterPlacementId))`;
}

type PlannedWindowQuery = {
  readonly query: string;
  readonly params: Record<string, unknown>;
  readonly readResult: (result: unknown) => {
    readonly boundary: RawGalleryPlacementItem | undefined;
    readonly candidates: readonly RawGalleryPlacementItem[];
  };
};

/**
 * The bounded window query for a `manual` gallery — unchanged since AB#114: a
 * bare array projection for the first page, a `{boundary, candidates}` object
 * for a continuation, both ordered by `(order, placementId)`.
 */
function planManualWindowQuery(
  placementFilter: string,
  window: GalleryWindowRequest,
): PlannedWindowQuery {
  const after = window.after;
  if (after === undefined) {
    return {
      query: `*[${placementFilter}] | order(order asc, placementId asc) [0...$candidateLimit]${GALLERY_PLACEMENT_ITEM_PROJECTION}`,
      params: {},
      readResult: (result) => ({
        boundary: undefined,
        candidates: readPlacementRows(result),
      }),
    };
  }
  return {
    query: `{
      "boundary": *[${placementFilter} && placementId == $afterPlacementId][0]${GALLERY_PLACEMENT_ITEM_PROJECTION},
      "candidates": *[${placementFilter} && ${laneKeysetPredicate("order", "$afterOrder")}] | order(order asc, placementId asc) [0...$candidateLimit]${GALLERY_PLACEMENT_ITEM_PROJECTION}
    }`,
    params: { ...boundaryQueryParams(after), afterPlacementId: after.placementId },
    readResult: readWindowQueryResult,
  };
}

/**
 * The bounded window query for a `seeded-random` gallery (AB#129). ADR-0009
 * §3's tiered `(pinnedTier, key, placementId)` order — pinned leads by manual
 * `order`, then the rest by materialized `shuffledOrder` — is served as two
 * lanes in one round trip rather than one GROQ `order()` clause: expressing
 * the tier switch inline would need a `select()` in `order()` whose behaviour a
 * unit test over a fake store cannot pin, and `compareOrderingBoundaries` is
 * the contract that must match exactly. Every pinned row sorts before every
 * shuffled row, so concatenating `pinnedLane` then `shuffledLane` and slicing
 * to `candidateLimit` reproduces the tiered order.
 *
 * `$orderingScope` (an always-true comparison) makes the seed a genuine,
 * serialized parameter of the request URL, so the Next fetch cache key varies
 * by seed — belt-and-suspenders over `sanity:galleries` tag invalidation
 * (ADR-0009 §5 / 2026-08-28 amendment). It changes no row match.
 */
function planSeededWindowQuery(
  placementFilterBase: string,
  window: GalleryWindowRequest,
): PlannedWindowQuery {
  const filter = `${placementFilterBase} && $orderingScope == $orderingScope`;
  const after = window.after;
  const tier = after?.pinnedTier;
  const candidateLimit = window.candidateLimit;

  const pinnedKeyset =
    tier === undefined
      ? "true"
      : tier === 0
        ? laneKeysetPredicate("order", "$afterOrder")
        : "false";
  const shuffledKeyset =
    tier === undefined || tier === 0
      ? "true"
      : laneKeysetPredicate("shuffledOrder", "$afterShuffledOrder");

  const params: Record<string, unknown> =
    after === undefined
      ? {}
      : { ...boundaryQueryParams(after), afterPlacementId: after.placementId };

  const boundaryLine =
    after === undefined
      ? ""
      : `"boundary": *[${filter} && placementId == $afterPlacementId][0]${GALLERY_PLACEMENT_ITEM_PROJECTION},\n      `;

  return {
    query: `{
      ${boundaryLine}"pinnedLane": *[${filter} && coalesce(pinned, false) == true && (${pinnedKeyset})] | order(order asc, placementId asc) [0...$candidateLimit]${GALLERY_PLACEMENT_ITEM_PROJECTION},
      "shuffledLane": *[${filter} && coalesce(pinned, false) == false && (${shuffledKeyset})] | order(shuffledOrder asc, placementId asc) [0...$candidateLimit]${GALLERY_PLACEMENT_ITEM_PROJECTION}
    }`,
    params,
    readResult: (result) => {
      if (!isRecord(result)) {
        throw new SanityGalleryError(
          "malformed-result",
          "the content store answered a seeded windowed query with something other than the expected {pinnedLane, shuffledLane} shape",
        );
      }
      const raw = result as {
        readonly boundary?: unknown;
        readonly pinnedLane?: unknown;
        readonly shuffledLane?: unknown;
      };
      return {
        boundary:
          raw.boundary === null || raw.boundary === undefined
            ? undefined
            : readPlacementRow(raw.boundary),
        // Every pinned row sorts before every shuffled row, so the first
        // `candidateLimit` of `pinned ++ shuffled` is the tiered window
        // `buildCuratedGalleryPage` expects (each lane was already bounded to
        // `candidateLimit` server-side; the concatenation can hold up to
        // twice that until this slice).
        candidates: [
          ...readPlacementRows(raw.pinnedLane),
          ...readPlacementRows(raw.shuffledLane),
        ].slice(0, candidateLimit),
      };
    },
  };
}

/**
 * `CuratedGallerySectionSource` (`gallery-sections.ts`) over `galleryPlacement`
 * documents: one HTTP round trip per page — an id lookup for the boundary
 * (only when the request names one) plus a keyset range query for the rest,
 * both scoped to this gallery's own document identity (`galleryDocumentId`,
 * resolved once by the caller) and the resolved section filter, never "every
 * placement matching this filter" (AB#134). The query shape is chosen by the
 * active ordering rule (AB#129) — `planManualWindowQuery` /
 * `planSeededWindowQuery`.
 */
function createSanityCuratedGallerySource(
  client: SanityClient,
  options: {
    readonly config: SanityConfig;
    readonly fallbackLanguage: string;
    readonly galleryDocumentId: string;
    readonly ordering: GalleryOrdering;
    /**
     * The gallery is mid-rotation (its basics `staleShuffledOrderCount` was
     * non-zero). Refuse here, not in `readSanityCuratedGalleryPage`, so
     * `readCuratedGallerySectionPage` has already validated `?cursor=` and
     * resolved `?section=` — a bad token/section still 404s during a rotation.
     */
    readonly orderingStale: boolean;
  },
): CuratedGallerySectionSource {
  return async ({ locale, filter, window }) => {
    if (options.orderingStale) {
      throw new SanityGalleryError(
        "ordering-stale",
        "this seeded-random gallery's shuffledOrder keys do not all match its current orderingSeed — run \"npm run recompute:shuffled-order\"",
      );
    }
    const language = toLanguageSubtag(locale);
    const sectionId = sectionIdOf(filter);
    const placementFilter = buildPlacementFilter(sectionId);
    const planned =
      options.ordering.kind === "manual"
        ? planManualWindowQuery(placementFilter, window)
        : planSeededWindowQuery(placementFilter, window);

    const { boundary: rawBoundary, candidates: rawCandidates } = planned.readResult(
      await client.query({
        query: planned.query,
        params: {
          galleryDocumentId: options.galleryDocumentId,
          candidateLimit: window.candidateLimit,
          ...(sectionId === undefined ? {} : { sectionId }),
          ...(options.ordering.kind === "seeded-random"
            ? { orderingScope: orderingScopeString(options.ordering) }
            : {}),
          ...planned.params,
        },
        tag: "gallery.placements.window",
      }),
    );

    const languages: PublicMediaLanguage = {
      language,
      fallbackLanguage: options.fallbackLanguage,
    };
    const projectOptions = {
      ...languages,
      config: options.config,
      ordering: options.ordering,
    };

    const boundary =
      rawBoundary === undefined
        ? undefined
        : assertAlreadyPublic(projectGalleryPlacement(rawBoundary, projectOptions));
    const candidates = rawCandidates.map((row) =>
      assertAlreadyPublic(projectGalleryPlacement(row, projectOptions)),
    );

    return { ...(boundary === undefined ? {} : { boundary }), candidates };
  };
}

// ---------------------------------------------------------------------------
// Ordering + section catalog basics, and the top-level bounded page read.
// ---------------------------------------------------------------------------

/**
 * The only rule this adapter applies. `gallery.ts`'s schema already lets an
 * author declare `seeded-random`; ADR-0009 decides that rule's contract and
 * Both `manual` and `seeded-random` are served (AB#129 PR2 lifted the
 * `seeded-random` refusal). A `seeded-random` gallery needs a non-empty
 * `orderingSeed` within the same length ceiling the pagination boundary
 * enforces; a missing one is a content defect, not a transient state.
 */
function resolveOrdering(
  orderingRule: unknown,
  orderingSeed: unknown,
  contentId: string,
): GalleryOrdering {
  if (orderingRule === "manual") return { kind: "manual" };
  if (orderingRule === "seeded-random") {
    // Read raw, not via `readString` (which trims): the seed is used verbatim
    // downstream — `orderingScopeString` embeds it, the recompute step writes
    // it as `shuffledOrderSeed`, and the basics stale-count query compares that
    // marker against `^.orderingSeed`. A seed with surrounding whitespace
    // (rejected by the Studio schema, still possible via an API import) would
    // trim inconsistently across that chain and strand the gallery
    // `ordering-stale` forever, so it is a content defect here.
    const seed = typeof orderingSeed === "string" ? orderingSeed : undefined;
    if (
      seed === undefined ||
      seed.length === 0 ||
      seed.length > MAX_GALLERY_ORDERING_SEED_LENGTH ||
      seed !== seed.trim()
    ) {
      throw new SanityGalleryError(
        "malformed-result",
        `a seeded-random gallery has no usable orderingSeed (expected 1-${MAX_GALLERY_ORDERING_SEED_LENGTH} characters, no surrounding whitespace)`,
        contentId,
      );
    }
    return { kind: "seeded-random", seed };
  }
  throw new SanityGalleryError(
    "malformed-result",
    `the gallery has no usable orderingRule: ${JSON.stringify(orderingRule)}`,
    contentId,
  );
}

/**
 * The `$after*` GROQ params a bounded window query needs, from the decoded
 * cursor boundary. Under `manual` (and a seeded gallery's pinned tier) the
 * boundary key is the numeric `order`; under a seeded gallery's shuffled tier
 * it is the 64-hex `shuffledOrder` string.
 */
function boundaryQueryParams(after: NonNullable<GalleryWindowRequest["after"]>): {
  readonly afterOrder?: number;
  readonly afterShuffledOrder?: string;
} {
  if (after.pinnedTier === 0) {
    if (typeof after.key !== "number") {
      throw new SanityGalleryError(
        "malformed-result",
        `a pinned-tier window boundary carried a non-numeric key: ${JSON.stringify(after.key)}`,
      );
    }
    return { afterOrder: after.key };
  }
  if (typeof after.key !== "string") {
    throw new SanityGalleryError(
      "malformed-result",
      `a shuffled-tier window boundary carried a non-string key: ${JSON.stringify(after.key)}`,
    );
  }
  return { afterShuffledOrder: after.key };
}

type RawGalleryPaginationSection = RawGallerySectionSummary & { readonly intro?: unknown };

function projectGalleryPaginationSection(
  raw: RawGalleryPaginationSection,
  order: number,
  contentId: string,
): GallerySection {
  const summary = projectGallerySectionSummary(raw, order, contentId);
  const intro = projectGallerySectionIntro(
    raw.intro as readonly RawGallerySectionIntroBlock[] | undefined,
  );
  return { ...summary, ...(intro.length > 0 ? { intro } : {}) };
}

/**
 * Studio's own document-level validation (`gallery-validation.ts`) restates
 * `gallery-sections.ts#assertGallerySections`'s bounds — count, unique
 * id/slug, slug shape, the reserved `all` slug — but only binds the ordinary
 * Publish action. An API write reaches the Content Lake without going
 * through Studio at all, so this bounded read calls that same function
 * directly, in the spirit of the backstop `sanity-content-tree.ts` and
 * `sanity-article.ts` already keep for their own API-write-bypass cases,
 * rather than trusting a section catalog is well-formed just because it was
 * published. `assertGallerySections` only ever throws `TypeError` (see its
 * own implementation), so the catch below rewraps that one documented type
 * into this file's own classified `SanityGalleryError` — it does not need to
 * handle an arbitrary thrown value.
 */
function readGallerySections(value: unknown, contentId: string): readonly GallerySection[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered with something other than a list of gallery sections",
      contentId,
    );
  }
  const sections = (value as readonly RawGalleryPaginationSection[]).map((raw, index) =>
    projectGalleryPaginationSection(raw, index, contentId),
  );
  try {
    assertGallerySections(sections);
  } catch (cause) {
    throw new SanityGalleryError(
      "malformed-section",
      cause instanceof TypeError ? cause.message : String(cause),
      contentId,
    );
  }
  return sections;
}

type RawGalleryPaginationBasicsDocument = {
  readonly _id?: unknown;
  readonly orderingRule?: unknown;
  readonly orderingSeed?: unknown;
  readonly sections?: unknown;
  readonly latestPlacementUpdatedAt?: unknown;
  readonly staleShuffledOrderCount?: unknown;
};

/**
 * Fetches at most two matching documents, not one, purely to detect the
 * `ambiguous-content-id` state (two published documents claiming one
 * identity) the same way `readPublicGalleryPage`'s own `[0...2]` read does —
 * this bounded read never scales with gallery size. `latestPlacementUpdatedAt`
 * and `staleShuffledOrderCount` are computed inside this same query via `^._id`,
 * the parent-scope operator, so they filter placements by direct reference
 * identity (`gallery._ref == ^._id`) instead of a
 * `gallery->contentId`/`gallery->language` join, without costing a second HTTP
 * round trip.
 *
 * `staleShuffledOrderCount` is the gallery-wide consistency guard AB#129's
 * `ordering-stale` state needs: a bounded `count()` of this seeded gallery's
 * non-pinned placements whose materialized `shuffledOrder` is missing or was
 * computed from a seed other than the gallery's current `orderingSeed`. The
 * bounded placement *window* only ever sees `pageSize + 1` rows, so a per-row
 * check on the read path cannot prove the whole order is one generation —
 * this count can, in one bounded aggregate (ADR-0009 2026-08-28 amendment).
 *
 * The aggregate carries the **same eligibility filter as the window**
 * (`visible`, `media->publiclyRenderable`, and the fail-closed
 * `media->privateOnly`): a placement that is never served cannot make the
 * served order inconsistent, and — critically — a hidden or `privateOnly`
 * placement added without a rotation must not push the public gallery into the
 * `ordering-stale` state (a degraded detail page, a 503 continuation) until an
 * owner happens to re-run the recompute. This keeps a private asset from
 * affecting public availability (ADR-0014 §2).
 */
const GALLERY_PAGINATION_BASICS_QUERY = `*[${GALLERY_FILTER} && contentId == $contentId][0...2]{
  _id,
  orderingRule,
  orderingSeed,
  sections[]{sectionId, slug, label, intro},
  "latestPlacementUpdatedAt": *[
    _type == "${GALLERY_PLACEMENT_DOCUMENT_TYPE}" && gallery._ref == ^._id
  ] | order(_updatedAt desc) [0]._updatedAt,
  "staleShuffledOrderCount": count(*[
    _type == "${GALLERY_PLACEMENT_DOCUMENT_TYPE}" && gallery._ref == ^._id &&
    visible == true && media->publiclyRenderable == true &&
    (media->privateOnly == false || !defined(media->privateOnly)) &&
    !coalesce(pinned, false) &&
    (!defined(shuffledOrder) || shuffledOrderSeed != ^.orderingSeed)
  ])
}`;

function readGalleryDocumentId(value: unknown, contentId: string): string {
  const id = readString(value);
  if (id === undefined) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered a gallery document with no usable _id",
      contentId,
    );
  }
  return id;
}

/**
 * One bounded page of a Sanity-backed curated gallery, mirroring
 * `mock-gallery.ts#getMockGalleryResult`'s call shape so `gallery.ts`'s route-
 * facing seam can switch sources without a route or component change (AB#114's
 * own acceptance criterion). Two HTTP round trips per page: this gallery's
 * ordering rule, section catalog, and `visibilityVersion` input, then the
 * bounded placement window `readCuratedGallerySectionPage` requests from
 * `createSanityCuratedGallerySource` above — never a gallery's complete
 * placement list.
 *
 * `visibilityVersion` is the most recently updated matching placement's
 * `_updatedAt`, read through the same bounded `order() [0]` shape as every
 * other query here — not a dedicated authored counter. This is a deliberately
 * conservative approximation of `GalleryCursorScope.visibilityVersion`'s
 * documented ideal ("appends and presentation-only edits deliberately keep
 * the same version"): it is *safe* (a reorder, hide/show, or section
 * reassignment always bumps a placement's own `_updatedAt`, so it can never
 * fail to invalidate a boundary that moved) but not *precise* (a caption-only
 * edit, or a brand-new placement's own first `_updatedAt`, also bumps it,
 * invalidating outstanding cursors that a perfectly precise version would
 * have left alone). Getting this exactly right needs a dedicated field this
 * story does not add.
 */
export async function readSanityCuratedGalleryPage(
  locale: string,
  contentId: string,
  options: {
    readonly cursor?: string;
    readonly sectionSlug?: string;
    readonly cursorCodec?: GalleryCursorCodec;
    readonly client?: SanityClient;
    readonly config?: SanityConfig;
  } = {},
): Promise<CuratedGalleryPage | undefined> {
  const client = options.client ?? getSanityClient();
  const config = options.config ?? getSanityConfig();
  const language = toLanguageSubtag(locale);
  const fallbackLanguage = getFallbackLocale();

  const raw = await client.query({
    query: GALLERY_PAGINATION_BASICS_QUERY,
    params: { contentId, language },
    tag: "gallery.placements.basics",
  });

  const basics = resolveUniqueDocument<RawGalleryPaginationBasicsDocument>(raw, contentId);
  if (basics === undefined) return undefined;

  const galleryDocumentId = readGalleryDocumentId(basics._id, contentId);
  const ordering = resolveOrdering(basics.orderingRule, basics.orderingSeed, contentId);

  // Gallery-wide consistency guard (ADR-0009 2026-08-28 amendment). A
  // `seeded-random` gallery whose non-pinned placements do not all carry a
  // `shuffledOrder` matching the current `orderingSeed` is mid-rotation: the
  // route serves an accessible "temporarily unavailable" page rather than a
  // mis-paginated one, and the gallery recovers on its own once
  // `npm run recompute:shuffled-order` lands and the `sanity:galleries` cache
  // tag is invalidated. This adapter holds no sticky state — every uncached
  // basics read re-evaluates the count.
  //
  // The refusal is deferred to the *source* call rather than thrown here, so
  // `readCuratedGallerySectionPage` first resolves `?section=` and decodes
  // `?cursor=`: a malformed/tampered cursor or an unknown section must still
  // 404 during a rotation, not return the reordering page (and an existence
  // probe must not treat a garbage token as redirectable).
  const orderingStale =
    ordering.kind === "seeded-random" &&
    readCount(basics.staleShuffledOrderCount) > 0;

  const sections = readGallerySections(basics.sections, contentId);
  const visibilityVersion = readString(basics.latestPlacementUpdatedAt) ?? "none";

  const source = createSanityCuratedGallerySource(client, {
    config,
    fallbackLanguage,
    galleryDocumentId,
    ordering,
    orderingStale,
  });

  return readCuratedGallerySectionPage({
    query: {
      locale,
      contentId,
      pageSize: GALLERY_PAGE_SIZE,
      ordering,
      visibilityVersion,
      ...(options.sectionSlug === undefined ? {} : { sectionSlug: options.sectionSlug }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    },
    sections,
    source,
    ...(options.cursorCodec === undefined ? {} : { cursorCodec: options.cursorCodec }),
  });
}
