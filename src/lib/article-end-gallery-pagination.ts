/** Provider-neutral bounded article end-gallery composition. */

import { createHash } from "node:crypto";

import {
  buildCuratedGalleryPage,
  assertBoundedString,
  MANUAL_ORDERING_SCOPE,
  resolveGalleryWindowRequest,
  type GalleryCursorCodec,
  type GalleryWindowRequest,
  type GalleryWindowResult,
} from "@/lib/gallery-pagination";
import type { CuratedGalleryResultItem, GalleryPage } from "@/lib/gallery-result";
import { MAX_SECTION_ID_LENGTH } from "@/lib/gallery-sections";

export { GalleryCursorError } from "@/lib/gallery-pagination";

export const ARTICLE_END_GALLERY_PAGE_SIZE = 24;
export const ARTICLE_END_GALLERY_VISIBILITY_VERSION = "public-v1";

export type ArticleEndGalleryQuery = {
  readonly locale: string;
  readonly contentId: string;
  readonly endGalleryId: string;
  /** Already resolved against the article's catalog, never a raw query slug. */
  readonly sectionId?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
};

export type ArticleEndGallerySource = (request: {
  readonly locale: string;
  readonly contentId: string;
  readonly endGalleryId: string;
  /** Apply this predicate BEFORE both the boundary and bounded candidate query. */
  readonly sectionId?: string;
  readonly window: GalleryWindowRequest;
}) => Promise<(GalleryWindowResult & {
  /** A section-capable source must acknowledge the exact selected predicate. */
  readonly appliedSectionId?: string;
}) | undefined>;

function normalizedFilter(query: ArticleEndGalleryQuery): string {
  // Keep issued All tokens compatible, including the exact legacy scope string.
  if (query.sectionId === undefined) return `article-end-gallery:${query.endGalleryId}`;
  assertBoundedString(query.sectionId, "section.sectionId", MAX_SECTION_ID_LENGTH);
  assertBoundedString(query.endGalleryId, "endGalleryId", 128);
  const digest = createHash("sha256")
    .update(JSON.stringify([query.endGalleryId, query.sectionId]), "utf8")
    .digest("hex");
  return `article-end-section:${digest}`;
}

/** Compose one bounded manual-order page from a provider-neutral source. */
export async function readArticleEndGalleryPage({
  query,
  source,
  cursorCodec,
}: {
  readonly query: ArticleEndGalleryQuery;
  readonly source: ArticleEndGallerySource;
  readonly cursorCodec?: GalleryCursorCodec;
}): Promise<GalleryPage<CuratedGalleryResultItem> | undefined> {
  const pageSize = query.pageSize ?? ARTICLE_END_GALLERY_PAGE_SIZE;
  const scope = {
    sourceId: `${query.contentId}@${query.locale}`,
    normalizedFilter: normalizedFilter(query),
    ordering: MANUAL_ORDERING_SCOPE,
    visibilityVersion: ARTICLE_END_GALLERY_VISIBILITY_VERSION,
    pageSize,
  };
  const ordering = { kind: "manual" } as const;
  const windowRequest = resolveGalleryWindowRequest({
    scope,
    ordering,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(cursorCodec === undefined ? {} : { cursorCodec }),
  });
  const windowResult = await source({
    locale: query.locale,
    contentId: query.contentId,
    endGalleryId: query.endGalleryId,
    ...(query.sectionId === undefined ? {} : { sectionId: query.sectionId }),
    window: windowRequest,
  });
  if (windowResult === undefined) return undefined;
  if (windowResult.appliedSectionId !== query.sectionId) {
    // Existing non-section sources must not silently seal All rows as selected.
    // This is a source-contract defect, not an invalid visitor cursor.
    throw new TypeError("Article end-gallery source did not acknowledge the requested section.");
  }
  if (query.sectionId !== undefined && (
    windowResult.candidates.some((row) => row.sectionId !== query.sectionId) ||
    (windowResult.boundary !== undefined && windowResult.boundary.sectionId !== query.sectionId)
  )) {
    throw new TypeError("Article end-gallery source returned a row outside the requested section.");
  }

  return buildCuratedGalleryPage({
    windowResult,
    scope,
    ordering,
    windowRequest,
    ...(cursorCodec === undefined ? {} : { cursorCodec }),
  });
}
