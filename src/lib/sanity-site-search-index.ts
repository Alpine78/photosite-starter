/**
 * The Sanity side of the site search's story index (ADR-0033): one read per
 * language returning every published article and gallery's searched fields.
 *
 * Why a whole-set read rather than a query per search: Sanity's `match` cannot
 * express "every word somewhere across title, tags and lead" (a literal array
 * on its left makes all patterns hit a single string), does not fold
 * diacritics, and would send each visitor's search term to the CMS. Reading
 * the candidate set once — through the same tagged cache every listing uses,
 * so the signed webhook (AB#83) invalidates it — lets the pure matcher in
 * `site-search-query.ts` do the matching in memory with no per-keystroke
 * request.
 *
 * The read is unbounded in rows like `readPublicArticlePlacements`, which the
 * content tree needs whole too, and bounded in *bytes*: exceeding
 * {@link SITE_SEARCH_INDEX_MAX_RESPONSE_BYTES} fails closed rather than
 * truncating, because a silently partial index would hide stories. ADR-0033
 * names that ceiling as the trigger to revisit this design.
 *
 * It applies the same scheduled-end gate as every listing read. Whether a story
 * is routable at all is decided later, against the public content tree.
 */

import "server-only";

import { getDeploymentConfig } from "@/lib/deployment-config";
import type { SiteSearchStoryRecord } from "@/lib/site-search-index";
import {
  ARTICLE_DOCUMENT_TYPE,
  projectArticleListingRecord,
  type RawArticleListingDocument,
} from "@/lib/sanity-article";
import { createSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  GALLERY_DOCUMENT_TYPE,
  projectGalleryListingRecord,
  type RawGalleryListingDocument,
} from "@/lib/sanity-gallery";
import { PUBLIC_MEDIA_PROJECTION } from "@/lib/sanity-media";
import { isRecord, toLanguageSubtag } from "@/lib/sanity-values";

/** The cache-policy tag (`sanity-cache.ts`) naming this read's dependencies. */
export const SITE_SEARCH_QUERY_TAG = "site-search.stories";

/** The client's own ceiling on any bounded response; the index must fit well inside. */
export const SITE_SEARCH_INDEX_MAX_RESPONSE_BYTES = 1024 * 1024;

const NOT_ENDED_FILTER = `(!defined(endDate) || dateTime(endDate) > dateTime(now()))`;

/**
 * The fields searched and displayed, and nothing else: no body, no author, no
 * image count (a per-gallery subquery that would be paid for every gallery).
 */
export const SITE_SEARCH_STORY_QUERY = `*[(_type == "${ARTICLE_DOCUMENT_TYPE}" || _type == "${GALLERY_DOCUMENT_TYPE}") && language == $language && ${NOT_ENDED_FILTER}] | order(coalesce(eventDate, publishedAt) desc, contentId asc) {
  "documentType": _type,
  contentId,
  title,
  summary,
  tags,
  publishedAt,
  eventDate,
  "cover": cover->${PUBLIC_MEDIA_PROJECTION}
}`;

/**
 * The fields the query reads from a story document. A test pins each to both
 * schemas, so the query and the Studio cannot drift apart unnoticed.
 */
export const PROJECTED_SITE_SEARCH_FIELDS = [
  "contentId",
  "title",
  "summary",
  "tags",
  "publishedAt",
  "eventDate",
  "endDate",
  "cover",
] as const;

type RawStoryDocument = RawArticleListingDocument &
  RawGalleryListingDocument & {
    readonly documentType?: unknown;
    readonly tags?: unknown;
  };

export type SiteSearchIndexReadOptions = {
  /** A bare language subtag, or a locale tag reduced to one. */
  readonly language: string;
  /** Injected in tests; production resolves the deployment's own client. */
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

/** A malformed result is an adapter defect, not an empty index. */
export class SiteSearchIndexError extends Error {
  constructor(detail: string) {
    super(`[sanity-site-search-index] ${detail}`);
    this.name = "SiteSearchIndexError";
  }
}

function readTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tag): string[] =>
    typeof tag === "string" && tag.trim().length > 0 ? [tag.trim()] : [],
  );
}

export async function readPublicSiteSearchStoryRecords(
  options: SiteSearchIndexReadOptions,
): Promise<readonly SiteSearchStoryRecord[]> {
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();
  const client =
    options.client ??
    createSanityClient({
      config,
      maxResponseBytes: SITE_SEARCH_INDEX_MAX_RESPONSE_BYTES,
    });
  const languages = {
    language,
    fallbackLanguage: getDeploymentConfig().localeRoutes.defaultLocale,
    config,
  };

  const result = await client.query({
    query: SITE_SEARCH_STORY_QUERY,
    params: { language },
    tag: SITE_SEARCH_QUERY_TAG,
  });
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SiteSearchIndexError(
      "the content store answered with something other than a list of story documents",
    );
  }

  return (result as readonly RawStoryDocument[]).map((document) => {
    // The two listing projectors validate identity, title, dates and cover, and
    // throw a classified error naming the document, exactly as a listing does.
    // The gallery projector insists on a photograph count that a search row
    // never shows and that costs a per-gallery subquery to compute, so the
    // read leaves it out and supplies the neutral value here.
    const record =
      document.documentType === GALLERY_DOCUMENT_TYPE
        ? projectGalleryListingRecord({ ...document, imageCount: 0 }, languages)
        : projectArticleListingRecord(document, languages);
    return {
      contentId: record.contentId,
      title: record.title,
      eventDate: record.eventDate,
      ...(record.summary === undefined ? {} : { summary: record.summary }),
      ...(record.cover === undefined ? {} : { cover: record.cover }),
      tags: readTags(document.tags),
    };
  });
}
