/**
 * The public article adapter: Sanity `article` documents in, three things out
 * — the `ContentPlacementInput` `content-tree.ts` needs to place the page, the
 * `ContentListingRecord` a category branch's card reads, and the full
 * `ArticleContentPage` (`content-page.ts`) a detail route renders.
 *
 * Three separate reads rather than one, matching `content-listing.ts`'s module
 * comment: a listing card must never load an article body, and a branch page
 * must never read a whole content page to show one row of it. Each read
 * embeds only the projection it needs — `ARTICLE_PLACEMENT_PROJECTION`,
 * `ARTICLE_LISTING_PROJECTION`, `ARTICLE_DETAIL_PROJECTION` — so a field added
 * to the schema tomorrow does not silently start arriving in a smaller
 * payload today.
 *
 * ## One document per language
 *
 * `article.ts`'s module comment explains why: unlike a category, an article
 * has its own per-language publication lifecycle, so `language` and the
 * immutable `contentId` together identify one version. Every read here takes
 * a language and queries only that language's documents; a `contentId` that
 * exists in another language but not this one is exactly ADR-0003 decision
 * 7's normal bilingual state, and returns `undefined`, not an error.
 *
 * ## Resolving category references without dereferencing in GROQ
 *
 * `sanity-content-tree.ts`'s module comment explains why `parentRef` is read
 * raw and resolved locally rather than dereferenced with `->`: dereferencing
 * would collapse "no reference" and "a reference that does not resolve" into
 * the same `null`. `canonicalCategory` and `secondaryCategories` need the same
 * distinction — `missing-canonical-category` is a different `content-tree.ts`
 * issue than an unplaced page — so this adapter reads both raw and resolves
 * them through `readCategoryDocumentIndex`, the same index `sanity-content-
 * tree.ts` builds for its own `parent` field.
 *
 * ## Published is not a field
 *
 * `sanity-client.ts` asks only for the published perspective, so a document
 * this adapter reads is already published in Sanity's own sense — the same
 * reasoning `sanity-content-tree.ts` gives for categories. `article.ts`
 * additionally requires `canonicalCategory` before Studio allows a publish, so
 * `projectArticlePlacementInput` always emits `published: true` with a
 * non-null canonical id; `content-tree.ts`'s `unplaced-published-content`
 * check remains the backstop for a document an API import wrote without
 * Studio validation.
 */

import "server-only";

import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  orderContentListingRecords,
  type ContentListingQuery,
  type ContentListingRecord,
} from "@/lib/content-listing";
import type { ArticleContentPage } from "@/lib/content-page";
import type { ContentPlacementInput } from "@/lib/content-tree";
import {
  CONTENT_BLOCK_PROJECTION,
  readContentBlocks,
} from "@/lib/sanity-content-blocks";
import {
  readCategoryDocumentIndex,
} from "@/lib/sanity-content-tree";
import {
  getSanityClient,
  MAX_SANITY_GET_URL_BYTES,
  type SanityClient,
} from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import { isRecord, readString, toLanguageSubtag } from "@/lib/sanity-values";

/**
 * The document type this adapter reads. Declared here rather than imported
 * from `sanity/schemas`: the Studio schema is content-store configuration, not
 * application code (ADR-0006). A test pins the two names together.
 */
export const ARTICLE_DOCUMENT_TYPE = "article";

export const PROJECTED_ARTICLE_PLACEMENT_FIELDS = [
  "contentId",
  "slug",
  "canonicalCategory",
  "secondaryCategories",
] as const;

export const PROJECTED_ARTICLE_LISTING_FIELDS = [
  "contentId",
  "title",
  "summary",
  "publishedAt",
  "cover",
] as const;

export const PROJECTED_ARTICLE_DETAIL_FIELDS = [
  "contentId",
  "title",
  "summary",
  "publishedAt",
  "cover",
  "tags",
  "body",
] as const;

export const ARTICLE_FILTER = `_type == "${ARTICLE_DOCUMENT_TYPE}" && language == $language`;

export const ARTICLE_PLACEMENT_PROJECTION = `{
  contentId,
  slug,
  "canonicalCategoryRef": canonicalCategory._ref,
  "secondaryCategoryRefs": secondaryCategories[]._ref
}`;

export const ARTICLE_LISTING_PROJECTION = `{
  contentId,
  title,
  summary,
  publishedAt,
  "cover": cover->${PUBLIC_MEDIA_PROJECTION}
}`;

export const ARTICLE_DETAIL_PROJECTION = `{
  contentId,
  title,
  summary,
  publishedAt,
  "cover": cover->${PUBLIC_MEDIA_PROJECTION},
  tags,
  body[]${CONTENT_BLOCK_PROJECTION}
}`;

/** The GROQ order `content-listing.ts`'s `CONTENT_LISTING_ORDERING` names. */
export const ARTICLE_LISTING_ORDER = `order(publishedAt desc, contentId asc)`;

/** Why a document could not become a published article projection. */
export type SanityArticleRejection =
  /** Required identity, title, or publication date is missing or unusable. */
  | "incomplete-document"
  /** A category reference on the document is malformed. */
  | "malformed-placement"
  /** Two published documents claim one `contentId` in one language. */
  | "ambiguous-content-id"
  /** The store answered with something that is not a list of documents. */
  | "malformed-result";

export class SanityArticleError extends Error {
  readonly rejection: SanityArticleRejection;
  readonly contentId: string | undefined;

  constructor(
    rejection: SanityArticleRejection,
    detail: string,
    contentId?: string,
  ) {
    super(
      `[sanity-article] ${detail}${contentId === undefined ? "" : ` (contentId "${contentId}")`}`,
    );
    this.name = "SanityArticleError";
    this.rejection = rejection;
    this.contentId = contentId;
  }
}

/** The identity form `article.ts`'s Studio validation enforces, enforced again here. */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type RawArticlePlacementDocument = {
  readonly contentId?: unknown;
  readonly slug?: unknown;
  readonly canonicalCategoryRef?: unknown;
  readonly secondaryCategoryRefs?: unknown;
};

export type RawArticleListingDocument = {
  readonly contentId?: unknown;
  readonly title?: unknown;
  readonly summary?: unknown;
  readonly publishedAt?: unknown;
  readonly cover?: unknown;
};

export type RawArticleDetailDocument = RawArticleListingDocument & {
  readonly tags?: unknown;
  readonly body?: unknown;
};

function readContentId(value: unknown, context?: string): string {
  const contentId = readString(value);
  if (contentId === undefined || !CONTENT_ID.test(contentId)) {
    throw new SanityArticleError(
      "incomplete-document",
      `an article document has no usable contentId, so nothing can reference it${context === undefined ? "" : ` (${context})`}`,
    );
  }
  return contentId;
}

/** A bare ISO date, or a UTC ISO datetime — the two forms Sanity's `datetime` field emits. */
const ISO_DATE_OR_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z)?$/;

/**
 * Whether `value` is not just parseable but a real calendar date. `Date.parse`
 * is lenient about overflow — it silently normalizes `2026-02-31` to March 3
 * rather than rejecting it — which is exactly wrong for a public-facing
 * publication date. Reconstructing the timestamp from the authored fields via
 * `Date.UTC` and reading them back catches that: an overflowing day, month,
 * hour, minute, or second changes what comes back, and the round trip fails.
 */
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

/**
 * Rejects a `publishedAt` that is not a real ISO calendar date or datetime.
 * The schema's own `datetime` field type binds only the ordinary Studio
 * editor, not an API import, and an invalid value reaching
 * `content-listing.ts`'s ordering key or a route's `<time>`/Open Graph
 * metadata fails — or worse, silently renders a rolled-over date — far from
 * its actual cause. Rejecting it here, with the article's identity attached,
 * is the earliest point that failure can be attributed correctly.
 */
function readPublishedAt(value: unknown, contentId: string): string {
  const publishedAt = readString(value);
  if (publishedAt === undefined || !isValidIsoDate(publishedAt)) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no publishedAt, or it is not a real ISO calendar date",
      contentId,
    );
  }
  return publishedAt;
}

/**
 * Marks a Sanity document id that did not resolve through
 * `categoryIdsByDocumentId`. `categoryId`s are lowercase-hyphenated
 * (`CONTENT_ID`'s pattern has no colon), so this prefix can never collide
 * with a real one — an unresolved reference must report as a missing
 * category to `content-tree.ts`, never accidentally match an unrelated
 * category whose `categoryId` happens to equal the raw document id string.
 */
const UNRESOLVED_CATEGORY_PREFIX = "unresolved-ref:";

function resolveCategoryId(
  ref: string,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): string {
  return (
    categoryIdsByDocumentId.get(ref) ?? `${UNRESOLVED_CATEGORY_PREFIX}${ref}`
  );
}

function readCategoryReference(
  value: unknown,
  contentId: string,
): string | null {
  if (value === undefined || value === null) return null;
  const ref = readString(value);
  if (ref !== undefined) return ref;
  throw new SanityArticleError(
    "malformed-placement",
    "the article's canonical category reference is malformed",
    contentId,
  );
}

function readSecondaryCategoryReferences(
  value: unknown,
  contentId: string,
): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new SanityArticleError(
      "malformed-placement",
      "the article's secondary categories are not a list",
      contentId,
    );
  }
  return value.map((entry) => {
    const ref = readString(entry);
    if (ref === undefined) {
      throw new SanityArticleError(
        "malformed-placement",
        "the article has a malformed secondary category reference",
        contentId,
      );
    }
    return ref;
  });
}

/**
 * Projects one document into the placement `content-tree.ts` needs. Pure and
 * exported so a fixture test can exercise it without a network — the same
 * shape `sanity-content-tree.ts#projectPublicCategoryInput` takes.
 */
export function projectArticlePlacementInput(
  document: RawArticlePlacementDocument,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ContentPlacementInput {
  const contentId = readContentId(document.contentId);

  const slug = readString(document.slug);
  if (slug === undefined) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no slug",
      contentId,
    );
  }

  const canonicalRef = readCategoryReference(
    document.canonicalCategoryRef,
    contentId,
  );
  const canonicalCategoryId =
    canonicalRef === null
      ? null
      : resolveCategoryId(canonicalRef, categoryIdsByDocumentId);

  const secondaryRefs = readSecondaryCategoryReferences(
    document.secondaryCategoryRefs,
    contentId,
  );
  const secondaryCategoryIds = secondaryRefs.map((ref) =>
    resolveCategoryId(ref, categoryIdsByDocumentId),
  );

  return {
    contentId,
    variant: "article",
    slug,
    published: true,
    canonicalCategoryId,
    ...(secondaryCategoryIds.length > 0 ? { secondaryCategoryIds } : {}),
  };
}

function readDocuments<T>(result: unknown): readonly T[] {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityArticleError(
      "malformed-result",
      "the content store answered with something other than a list of article documents",
    );
  }
  return result as readonly T[];
}

/** The locale that owns the unprefixed routes — read from the deployment. */
function getFallbackLocale(): string {
  return getDeploymentConfig().localeRoutes.defaultLocale;
}

export type PublicArticlePlacementReadOptions = {
  readonly language: string;
  /** Injected in tests; production resolves the deployment's own client. */
  readonly client?: SanityClient;
};

/**
 * Every published article in one language, as the placements
 * `readPublicContentTree` composes with categories into one validated tree.
 * Unbounded, matching `readPublicCategoryInputs`: the tree needs the whole set
 * to detect a slug collision.
 */
export async function readPublicArticlePlacements(
  options: PublicArticlePlacementReadOptions,
): Promise<readonly ContentPlacementInput[]> {
  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const categoryIdsByDocumentId = await readCategoryDocumentIndex(client);

  const result = await client.query({
    query: `*[${ARTICLE_FILTER}]${ARTICLE_PLACEMENT_PROJECTION}`,
    params: { language },
    tag: "article.placements",
  });

  return readDocuments<RawArticlePlacementDocument>(result).map((document) =>
    projectArticlePlacementInput(document, categoryIdsByDocumentId),
  );
}

type ListingProjectionOptions = {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly config: SanityConfig;
};

/** Projects one document into the fields a listing card reads. */
export function projectArticleListingRecord(
  document: RawArticleListingDocument,
  options: ListingProjectionOptions,
): ContentListingRecord {
  const contentId = readContentId(document.contentId);

  const title = readString(document.title);
  if (title === undefined) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no title",
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

export type PublicArticleListingReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

/**
 * Conservative share of `sanity-client.ts`'s whole-URL GET budget reserved
 * for the serialized `contentIds` array itself, leaving room for the origin,
 * API version, dataset path, the rest of the query string, and the other
 * params. A category holding a few hundred articles can otherwise put more
 * candidate ids in this one array than the whole request budget allows.
 */
const MAX_CONTENT_IDS_BYTES = Math.floor(MAX_SANITY_GET_URL_BYTES / 2);

/**
 * The exact byte cost one chunk adds to the request URL:
 * `sanity-client.ts#buildSanityQueryUrl` turns a parameter value into
 * `encodeURIComponent(JSON.stringify(value))` before measuring the assembled
 * URL with `TextEncoder`. A raw per-id character estimate systematically
 * under-counts here — `encodeURIComponent` expands every JSON quote, comma,
 * and bracket to a three-byte `%XX` escape — so this measures the same
 * encoded form the real request builds, not an approximation of it.
 */
export function encodedContentIdsBytes(contentIds: readonly string[]): number {
  return new TextEncoder().encode(encodeURIComponent(JSON.stringify(contentIds)))
    .length;
}

/**
 * Splits candidate ids into groups whose exact encoded size — measured the
 * same way `buildSanityQueryUrl` measures the real request — stays under
 * `maxBytes`, so a large category's listing read never builds one query the
 * transport refuses outright.
 *
 * `CONTENT_ID`'s own pattern has no length bound, so one pathological id —
 * from a hand-written import, not Studio, which has no length limit of its
 * own either — could be too large to fit a chunk by itself; a singleton
 * chunk skips the "does adding this overflow the chunk" comparison because
 * there is nothing yet to compare against, so that case needs its own
 * check. Rejecting it here, identifying the offending id, is clearer than
 * letting it become the generic byte-count error `buildSanityQueryUrl`
 * raises once the request is actually built.
 */
export function chunkContentIds(
  contentIds: readonly string[],
  maxBytes: number,
): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const id of contentIds) {
    if (encodedContentIdsBytes([id]) > maxBytes) {
      throw new SanityArticleError(
        "incomplete-document",
        "a content id is too large to fit any bounded listing request by itself",
        id,
      );
    }

    const candidate = [...current, id];
    if (current.length > 0 && encodedContentIdsBytes(candidate) > maxBytes) {
      chunks.push(current);
      current = [id];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

/**
 * The bounded listing read `content-listing.ts`'s `ContentListingSource`
 * describes: at most `query.limit` records among `query.contentIds`, ordered
 * newest-published-first with `contentId` as the deterministic tie-break.
 *
 * `query.contentIds` is chunked to stay inside the GET URL budget rather than
 * assuming it always fits. Each chunk is queried for its own top
 * `query.limit` — the minimum any chunk needs to contribute, since the true
 * overall top `query.limit` can only be drawn from candidates that are
 * already among their own chunk's leaders — and the merged candidates are
 * re-ordered and re-bounded exactly as `content-listing.ts` orders a single
 * page, so chunking never changes the result a caller with an unbounded URL
 * budget would have received.
 */
export async function readPublicArticleListingRecords(
  query: ContentListingQuery,
  options: PublicArticleListingReadOptions,
): Promise<readonly ContentListingRecord[]> {
  if (query.contentIds.length === 0) return [];

  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();
  const languages = { language, fallbackLanguage: getFallbackLocale(), config };

  const chunks = chunkContentIds(query.contentIds, MAX_CONTENT_IDS_BYTES);

  const chunkedRecords = await Promise.all(
    chunks.map(async (contentIds) => {
      const result = await client.query({
        query: `*[${ARTICLE_FILTER} && contentId in $contentIds] | ${ARTICLE_LISTING_ORDER} [0...$limit]${ARTICLE_LISTING_PROJECTION}`,
        params: { language, contentIds, limit: query.limit },
        tag: "article.listing",
      });

      return readDocuments<RawArticleListingDocument>(result).map((document) =>
        projectArticleListingRecord(document, languages),
      );
    }),
  );

  return orderContentListingRecords(chunkedRecords.flat()).slice(0, query.limit);
}

function readTags(value: unknown, contentId: string): readonly string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article's tags are not a list of strings",
      contentId,
    );
  }
  return value;
}

/** Projects one document into the full detail page a route renders. */
export function projectArticleContentPage(
  document: RawArticleDetailDocument,
  options: ListingProjectionOptions,
): ArticleContentPage {
  const contentId = readContentId(document.contentId);

  const title = readString(document.title);
  if (title === undefined) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no title",
      contentId,
    );
  }

  const publishedAt = readPublishedAt(document.publishedAt, contentId);

  const summary = readString(document.summary);
  const cover = isRecord(document.cover)
    ? projectPublicMedia(document.cover as RawPublicMediaDocument, options)
    : undefined;
  const tags = readTags(document.tags, contentId);
  const body = readContentBlocks(document.body, options);
  if (body.length === 0) {
    // `article.ts` requires at least one block to publish, but that rule
    // binds the ordinary Studio editor, not an API import. `readContentBlocks`
    // itself treats a missing body as an authored empty one because a
    // gallery's own optional body legitimately has none (ADR-0003 decision
    // 3) — for an article, whose body *is* the page, an empty one is a
    // content defect that must not publish silently.
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no body blocks",
      contentId,
    );
  }

  return {
    contentId,
    variant: "article",
    title,
    publishedAt,
    ...(summary === undefined ? {} : { summary }),
    ...(cover === undefined ? {} : { cover }),
    ...(tags.length > 0 ? { tags } : {}),
    body,
  };
}

export type PublicArticleReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

/**
 * One article's full page by its stable identity, or `undefined` when this
 * language publishes none under that id — the normal bilingual state ADR-0003
 * decision 7 describes, not an error.
 *
 * Reads two documents where it needs one, the same defense
 * `readPublicMediaById` uses: a second row can only mean two published
 * documents claim one `(contentId, language)` pair, which breaks the
 * assumption every route, redirect, and sibling-navigation query rests on.
 */
export async function readPublicArticlePage(
  contentId: string,
  options: PublicArticleReadOptions,
): Promise<ArticleContentPage | undefined> {
  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();

  const result = await client.query({
    query: `*[${ARTICLE_FILTER} && contentId == $contentId][0...2]${ARTICLE_DETAIL_PROJECTION}`,
    params: { language, contentId },
    tag: "article.detail",
  });

  const documents = readDocuments<RawArticleDetailDocument>(result);
  if (documents.length === 0) return undefined;
  if (documents.length > 1) {
    throw new SanityArticleError(
      "ambiguous-content-id",
      "two published documents claim one content identity in this language",
      contentId,
    );
  }

  return projectArticleContentPage(documents[0], {
    language,
    fallbackLanguage: getFallbackLocale(),
    config,
  });
}
