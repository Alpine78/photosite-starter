/** Bounded Sanity adapter for an article's optional end gallery (AB#161). */

import "server-only";

import {
  ARTICLE_END_GALLERY_PAGE_SIZE,
  readArticleEndGalleryPage,
  type ArticleEndGalleryQuery,
} from "@/lib/article-end-gallery-pagination";
import { getDeploymentConfig } from "@/lib/deployment-config";
import type {
  GalleryCursorCodec,
  GalleryWindowRequest,
} from "@/lib/gallery-pagination";
import {
  projectGalleryPlacement,
  type RawGalleryPlacementItem,
} from "@/lib/sanity-gallery";
import {
  getSanityClient,
  type SanityClient,
} from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import { PUBLIC_MEDIA_PROJECTION } from "@/lib/sanity-media";
import { isRecord, readString, toLanguageSubtag } from "@/lib/sanity-values";

export const ARTICLE_END_GALLERY_PLACEMENT_DOCUMENT_TYPE =
  "articleEndGalleryPlacement";

export class SanityArticleEndGalleryError extends Error {
  readonly rejection: "malformed-result" | "ambiguous-content-id";

  constructor(
    rejection: "malformed-result" | "ambiguous-content-id",
    detail: string,
  ) {
    super(`[sanity-article-end-gallery] ${detail}`);
    this.name = "SanityArticleEndGalleryError";
    this.rejection = rejection;
  }
}

const ITEM_PROJECTION = `{
  placementId,
  order,
  visible,
  altOverride,
  captionOverride,
  "pinned": false,
  "media": media->${PUBLIC_MEDIA_PROJECTION}
}`;

const ARTICLE_FILTER = `_type == "article" && language == $language && contentId == $contentId && (!defined(endDate) || dateTime(endDate) > dateTime(now()))`;

const BASICS_QUERY = `*[${ARTICLE_FILTER}][0...2]{
  _id,
  endGalleryId
}`;

type RawBasics = {
  readonly _id?: unknown;
  readonly endGalleryId?: unknown;
};

function readBasics(raw: unknown): RawBasics | undefined {
  if (!Array.isArray(raw) || !raw.every(isRecord)) {
    throw new SanityArticleEndGalleryError(
      "malformed-result",
      "the article lookup did not return a document list",
    );
  }
  if (raw.length === 0) return undefined;
  if (raw.length > 1) {
    throw new SanityArticleEndGalleryError(
      "ambiguous-content-id",
      "two published articles claim one identity in this language",
    );
  }
  return raw[0] as RawBasics;
}

function readRows(raw: unknown): readonly RawGalleryPlacementItem[] {
  if (!Array.isArray(raw) || !raw.every(isRecord)) {
    throw new SanityArticleEndGalleryError(
      "malformed-result",
      "the placement window did not return a row list",
    );
  }
  return raw as readonly RawGalleryPlacementItem[];
}

const placementFilter = `_type == "${ARTICLE_END_GALLERY_PLACEMENT_DOCUMENT_TYPE}" && article._ref == $articleDocumentId && visible == true && media->publiclyRenderable == true && (media->privateOnly == false || !defined(media->privateOnly))`;

function windowQuery(window: GalleryWindowRequest): string {
  if (window.after === undefined) {
    return `*[${placementFilter}] | order(order asc, placementId asc) [0...$candidateLimit]${ITEM_PROJECTION}`;
  }
  return `{
    "boundary": *[${placementFilter} && placementId == $afterPlacementId][0]${ITEM_PROJECTION},
    "candidates": *[${placementFilter} && (order > $afterOrder || (order == $afterOrder && placementId > $afterPlacementId))] | order(order asc, placementId asc) [0...$candidateLimit]${ITEM_PROJECTION}
  }`;
}

async function readWindow(
  client: SanityClient,
  config: SanityConfig,
  articleDocumentId: string,
  locale: string,
  window: GalleryWindowRequest,
) {
  const after = window.after;
  if (after !== undefined && (after.pinnedTier !== 0 || typeof after.key !== "number")) {
    throw new SanityArticleEndGalleryError(
      "malformed-result",
      "a manual-order cursor carried a non-numeric boundary",
    );
  }
  const raw = await client.query({
    query: windowQuery(window),
    params: {
      articleDocumentId,
      candidateLimit: window.candidateLimit,
      ...(after === undefined
        ? {}
        : { afterOrder: after.key, afterPlacementId: after.placementId }),
    },
    tag: "article.end-gallery.window",
  });

  let rawBoundary: RawGalleryPlacementItem | undefined;
  let rawCandidates: readonly RawGalleryPlacementItem[];
  if (after === undefined) {
    rawCandidates = readRows(raw);
  } else {
    if (!isRecord(raw)) {
      throw new SanityArticleEndGalleryError(
        "malformed-result",
        "the continuation window did not return boundary and candidates",
      );
    }
    const boundary = raw.boundary;
    if (boundary !== undefined && boundary !== null && !isRecord(boundary)) {
      throw new SanityArticleEndGalleryError(
        "malformed-result",
        "the continuation boundary is not a placement row",
      );
    }
    rawBoundary = boundary == null ? undefined : (boundary as RawGalleryPlacementItem);
    rawCandidates = readRows(raw.candidates);
  }

  if (rawCandidates.length > window.candidateLimit) {
    throw new SanityArticleEndGalleryError("malformed-result", "the source exceeded its candidate limit");
  }
  const projectionOptions = {
    language: toLanguageSubtag(locale),
    fallbackLanguage: getDeploymentConfig().localeRoutes.defaultLocale,
    config,
    ordering: { kind: "manual" } as const,
  };
  const project = (row: RawGalleryPlacementItem) => {
    if (typeof row.placementId !== "string" || row.placementId.length > 256 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.placementId)) {
      throw new SanityArticleEndGalleryError("malformed-result", "invalid placement identity");
    }
    const placement = projectGalleryPlacement(row, projectionOptions);
    if (placement === undefined) {
      throw new SanityArticleEndGalleryError(
        "malformed-result",
        "a publicly filtered placement failed the public-media projection",
      );
    }
    return placement;
  };
  return {
    ...(rawBoundary === undefined ? {} : { boundary: project(rawBoundary) }),
    candidates: rawCandidates.map(project),
  };
}

export async function readSanityArticleEndGalleryPage({
  query,
  cursorCodec,
  client = getSanityClient(),
  config = getSanityConfig(),
}: {
  readonly query: ArticleEndGalleryQuery;
  readonly cursorCodec?: GalleryCursorCodec;
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
}) {
  const language = toLanguageSubtag(query.locale);
  const basics = readBasics(
    await client.query({
      query: BASICS_QUERY,
      params: { language, contentId: query.contentId },
      tag: "article.end-gallery.basics",
    }),
  );
  if (basics === undefined) return undefined;
  const articleDocumentId = readString(basics._id);
  if (articleDocumentId === undefined || articleDocumentId !== basics._id) {
    throw new SanityArticleEndGalleryError("malformed-result", "invalid article document identity");
  }
  if (basics.endGalleryId != null && (
    typeof basics.endGalleryId !== "string" || basics.endGalleryId.length > 128 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(basics.endGalleryId)
  )) {
    throw new SanityArticleEndGalleryError("malformed-result", "invalid end-gallery identity");
  }
  const endGalleryId = readString(basics.endGalleryId);
  if (
    endGalleryId === undefined ||
    endGalleryId !== query.endGalleryId
  ) {
    return undefined;
  }

  return readArticleEndGalleryPage({
    query: { ...query, pageSize: query.pageSize ?? ARTICLE_END_GALLERY_PAGE_SIZE },
    cursorCodec,
    source: async ({ window }) =>
      readWindow(client, config, articleDocumentId, query.locale, window),
  });
}
