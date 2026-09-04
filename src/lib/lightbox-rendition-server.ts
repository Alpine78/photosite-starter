/**
 * The public derivative candidates the fullscreen viewer may deliver.
 *
 * Extracted so the curated gallery slice projector and the content-body slide
 * builder resolve a lightbox rendition the exact same way: off the same public
 * web-delivery derivative (ADR-0005), through `next/image`'s own optimizer,
 * with the lightbox `sizes` hint. `getImageProps` stays behind this
 * `server-only` boundary; the browser-safe slide contract lives in
 * `lightbox-slides.ts`.
 */

import "server-only";
import { getImageProps } from "next/image";
import { getLightboxImageSizes } from "@/lib/image-delivery";
import type { LightboxRendition } from "@/lib/lightbox-slides";
import type { ImageMedia } from "@/lib/media";

export function resolveLightboxRendition(media: ImageMedia): LightboxRendition {
  const { props } = getImageProps({
    src: media.rendition.src,
    alt: media.alt,
    width: media.rendition.width,
    height: media.rendition.height,
    sizes: getLightboxImageSizes(media.rendition),
  });

  return {
    src: props.src,
    ...(props.srcSet === undefined ? {} : { srcset: props.srcSet }),
  };
}
