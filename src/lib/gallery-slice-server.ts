/**
 * Projects one bounded gallery page into the serializable slice the browser
 * renders and later appends to.
 *
 * The first page and every endpoint response pass through this one projection,
 * so an appended item is indistinguishable from one present at the server
 * render: same identities, captions, delivery sources, and authoritative order.
 * `getImageProps` stays behind this server-only boundary; the client-safe slice
 * type and append rule live separately in `gallery-slice.ts`.
 */

import "server-only";
import type {
  CuratedGalleryResultItem,
  GalleryPage,
} from "@/lib/gallery-result";
import type { GallerySlice } from "@/lib/gallery-slice";
import { resolveLightboxRendition } from "@/lib/lightbox-rendition-server";
import { buildLightboxSlides } from "@/lib/lightbox-slides";

/** Projects one adapter result into the two ordered views the browser needs. */
export function projectGallerySlice(
  page: GalleryPage<CuratedGalleryResultItem>,
): GallerySlice {
  return {
    items: page.items,
    slides: buildLightboxSlides(page.items, resolveLightboxRendition),
    nextCursor: page.page.hasNextPage ? page.page.endCursor : null,
  };
}
