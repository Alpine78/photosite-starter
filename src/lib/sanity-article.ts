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
import type {
  ContentListingQuery,
  ContentListingRecord,
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
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
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
      : (categoryIdsByDocumentId.get(canonicalRef) ?? canonicalRef);

  const secondaryRefs = readSecondaryCategoryReferences(
    document.secondaryCategoryRefs,
    contentId,
  );
  const secondaryCategoryIds = secondaryRefs.map(
    (ref) => categoryIdsByDocumentId.get(ref) ?? ref,
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

  const publishedAt = readString(document.publishedAt);
  if (publishedAt === undefined) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no publishedAt",
      contentId,
    );
  }

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
 * The bounded listing read `content-listing.ts`'s `ContentListingSource`
 * describes: at most `query.limit` records among `query.contentIds`, ordered
 * newest-published-first with `contentId` as the deterministic tie-break.
 */
export async function readPublicArticleListingRecords(
  query: ContentListingQuery,
  options: PublicArticleListingReadOptions,
): Promise<readonly ContentListingRecord[]> {
  if (query.contentIds.length === 0) return [];

  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();

  const result = await client.query({
    query: `*[${ARTICLE_FILTER} && contentId in $contentIds] | ${ARTICLE_LISTING_ORDER} [0...$limit]${ARTICLE_LISTING_PROJECTION}`,
    params: {
      language,
      contentIds: query.contentIds,
      limit: query.limit,
    },
    tag: "article.listing",
  });

  const languages = { language, fallbackLanguage: getFallbackLocale(), config };
  return readDocuments<RawArticleListingDocument>(result).map((document) =>
    projectArticleListingRecord(document, languages),
  );
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

  const publishedAt = readString(document.publishedAt);
  if (publishedAt === undefined) {
    throw new SanityArticleError(
      "incomplete-document",
      "the article has no publishedAt",
      contentId,
    );
  }

  const summary = readString(document.summary);
  const cover = isRecord(document.cover)
    ? projectPublicMedia(document.cover as RawPublicMediaDocument, options)
    : undefined;
  const tags = readTags(document.tags, contentId);
  const body = readContentBlocks(document.body, options);

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
