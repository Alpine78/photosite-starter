/**
 * The lightbox slides for a content body's own image sequence.
 *
 * A gallery variant page has both a curated grid and a body: the two are
 * separate sequences with separate provider instances (ADR-0003 decision 2), so
 * this builder never touches the gallery result and the gallery projector never
 * touches the body. Both resolve a slide's public derivative through the same
 * `resolveLightboxRendition`, so a body photograph and a grid photograph reach
 * the viewer through the identical ADR-0005 rendition boundary.
 */

import "server-only";
import { listContentBodyImages } from "@/lib/content-body-media";
import type { ContentBlock } from "@/lib/content-page";
import { resolveLightboxRendition } from "@/lib/lightbox-rendition-server";
import {
  buildLightboxSlides,
  type LightboxSlide,
} from "@/lib/lightbox-slides";

/**
 * One slide per image placement, in authored source order. Empty when the body
 * has no image placements, in which case no provider is mounted at all.
 */
export function buildContentBodyLightboxSlides(
  blocks: readonly ContentBlock[],
): readonly LightboxSlide[] {
  const images = listContentBodyImages(blocks);
  if (images.length === 0) return [];

  return buildLightboxSlides(
    images.map((image) => ({
      itemId: image.itemId,
      mediaId: image.media.mediaId,
      media: image.media,
    })),
    resolveLightboxRendition,
  );
}
