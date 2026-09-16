/**
 * Route-facing boundary for an article's optional end-gallery result (AB#161).
 * The article owns the public identity; this seam returns one bounded media
 * window and exposes no provider document identifiers.
 */

import { cache } from "react";

import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { galleryCursorCodec } from "@/lib/gallery-cursor";
import type { CuratedGalleryResultItem, GalleryPage } from "@/lib/gallery-result";
export { GalleryCursorError } from "@/lib/gallery-pagination";

/** Share one bounded slice across metadata and page rendering per RSC request. */
export const getArticleEndGalleryPage = cache(async function getArticleEndGalleryPage(
  locale: string,
  contentId: string,
  endGalleryId: string,
  cursor?: string,
): Promise<GalleryPage<CuratedGalleryResultItem> | undefined> {
  const { contentSource } = getDeploymentConfig();
  const options = {
    query: {
      locale,
      contentId,
      endGalleryId,
      ...(cursor === undefined ? {} : { cursor }),
    },
    cursorCodec: galleryCursorCodec,
  };

  return dispatchContentSource(contentSource, {
    sanity: async () => {
      const { readSanityArticleEndGalleryPage } = await import(
        "@/lib/sanity-article-end-gallery"
      );
      return readSanityArticleEndGalleryPage(options);
    },
    mock: async () => {
      const { getMockArticleEndGalleryPage } = await import(
        "@/lib/mock-article-end-gallery"
      );
      return getMockArticleEndGalleryPage(options);
    },
  });
});
