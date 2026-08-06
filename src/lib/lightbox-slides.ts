/**
 * Browser-facing lightbox slide contract.
 *
 * The lightbox presents a result; it is not a second source of truth about
 * one. Order and identity come from the shared gallery result list, so the
 * slide a visitor sees at position n is the item the adapter placed at
 * position n — never whatever the grid happens to have laid out there.
 *
 * `itemId` and `mediaId` stay separate all the way to the browser. They differ
 * in meaning: a result item is where a photo appears, a media id is which photo
 * it is, and the same photo can be placed more than once. Collapsing them here
 * would restore focus to the wrong trigger and would misidentify the subject of
 * a later media-level action.
 */

import type { GalleryResultItem } from "@/lib/gallery-result";
import type { ImageMedia, Media } from "@/lib/media";

export type LightboxSlide = {
  /** Result identity: which trigger opened this slide, and returns focus. */
  readonly itemId: string;
  /** Media identity: which photo this is, independent of its placement. */
  readonly mediaId: string;
  /** Public delivery source for the full-frame view. */
  readonly src: string;
  /** Candidate set for the same public derivative, as width descriptors. */
  readonly srcset?: string;
  /** True intrinsic dimensions of the public derivative, never a crop box. */
  readonly width: number;
  readonly height: number;
  readonly alt: string;
};

/**
 * The one public source the lightbox may deliver, resolved by the caller.
 *
 * Resolution is injected rather than performed here: it depends on the image
 * pipeline of the host, while everything else in this module is a property of
 * the result contract and stays browser-free and testable.
 */
export type LightboxRendition = {
  readonly src: string;
  readonly srcset?: string;
};

export type LightboxRenditionResolver = (
  media: ImageMedia,
) => LightboxRendition;

/**
 * Projects an ordered result list into ordered slides.
 *
 * Unsupported media fails the whole list rather than being skipped, matching
 * the paginated result rule: an item that was counted into a page may not
 * quietly vanish from the sequence a visitor navigates.
 */
export function buildLightboxSlides(
  items: readonly GalleryResultItem<Media>[],
  resolveRendition: LightboxRenditionResolver,
): readonly LightboxSlide[] {
  return items.map((item) => {
    if (item.media.type !== "image") {
      throw new TypeError(
        `Unsupported public lightbox media type: ${item.media.type}`,
      );
    }

    const { src, srcset } = resolveRendition(item.media);
    if (typeof src !== "string" || src.length === 0) {
      throw new TypeError(
        `Lightbox rendition for item ${item.itemId} resolved to no public source`,
      );
    }

    return {
      itemId: item.itemId,
      mediaId: item.mediaId,
      src,
      ...(srcset === undefined ? {} : { srcset }),
      width: item.media.rendition.width,
      height: item.media.rendition.height,
      alt: item.media.alt,
    };
  });
}
