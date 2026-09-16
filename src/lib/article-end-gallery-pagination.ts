/** Provider-neutral bounded article end-gallery composition. */

import {
  buildCuratedGalleryPage,
  MANUAL_ORDERING_SCOPE,
  resolveGalleryWindowRequest,
  type GalleryCursorCodec,
  type GalleryWindowRequest,
  type GalleryWindowResult,
} from "@/lib/gallery-pagination";
import type { CuratedGalleryResultItem, GalleryPage } from "@/lib/gallery-result";

export { GalleryCursorError } from "@/lib/gallery-pagination";

export const ARTICLE_END_GALLERY_PAGE_SIZE = 24;
export const ARTICLE_END_GALLERY_VISIBILITY_VERSION = "public-v1";

export type ArticleEndGalleryQuery = {
  readonly locale: string;
  readonly contentId: string;
  readonly endGalleryId: string;
  readonly cursor?: string;
  readonly pageSize?: number;
};

export type ArticleEndGallerySource = (request: {
  readonly locale: string;
  readonly contentId: string;
  readonly endGalleryId: string;
  readonly window: GalleryWindowRequest;
}) => Promise<GalleryWindowResult | undefined>;

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
    normalizedFilter: `article-end-gallery:${query.endGalleryId}`,
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
    window: windowRequest,
  });
  if (windowResult === undefined) return undefined;

  return buildCuratedGalleryPage({
    windowResult,
    scope,
    ordering,
    windowRequest,
    ...(cursorCodec === undefined ? {} : { cursorCodec }),
  });
}
