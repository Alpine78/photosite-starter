import type { PublicImageRendition } from "@/lib/media";

export type ImageRenderProfile = {
  /** Browser source-size hint passed directly to `next/image`. */
  readonly sizes: string;
};

function boundedImageSizes(
  terminalViewportWidth: number,
  terminalCssWidth: number,
  fluidSizes: string,
): string {
  return `(min-width: ${terminalViewportWidth}px) ${terminalCssWidth}px, ${fluidSizes}`;
}

/**
 * Slot-accurate profiles for the current bounded layouts.
 *
 * These values belong to presentation contexts rather than media records: the
 * same image can appear in a card, article, and lightbox without changing its
 * public rendition identity or intrinsic dimensions.
 */
export const imageRenderProfiles = {
  portfolioGrid: {
    sizes: boundedImageSizes(
      1152,
      358,
      "(min-width: 1024px) calc(33.333vw - 26.667px), (min-width: 640px) calc(50vw - 32px), calc(100vw - 32px)",
    ),
  },
  serviceGrid: {
    sizes: boundedImageSizes(
      1152,
      352,
      "(min-width: 1024px) calc(33.333vw - 32px), (min-width: 640px) calc(50vw - 36px), calc(100vw - 32px)",
    ),
  },
  blogGrid: {
    sizes: boundedImageSizes(
      1152,
      347,
      "(min-width: 1024px) calc(33.333vw - 37.333px), (min-width: 640px) calc(50vw - 40px), calc(100vw - 32px)",
    ),
  },
  serviceContent: {
    sizes: boundedImageSizes(
      1152,
      736,
      "(min-width: 1024px) calc(100vw - 416px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
    ),
  },
  articleContent: {
    sizes: boundedImageSizes(
      768,
      720,
      "(min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
    ),
  },
} as const satisfies Record<string, ImageRenderProfile>;

export const HERO_IMAGE_SIZES = "100vw";

const LIGHTBOX_MAX_CSS_WIDTH = 3840;
const LIGHTBOX_VIEWPORT_GUTTER = 32;

/**
 * Produces the `sizes` hint reserved for the later lightbox implementation.
 * AB#15 must apply the matching CSS cap and revisit the global optimizer width
 * list before this calculation becomes a runtime guarantee.
 */
export function getLightboxImageSizes(
  rendition: Pick<PublicImageRendition, "width">,
): string {
  const maxCssWidth = Math.min(rendition.width, LIGHTBOX_MAX_CSS_WIDTH);

  return boundedImageSizes(
    maxCssWidth + LIGHTBOX_VIEWPORT_GUTTER,
    maxCssWidth,
    `calc(100vw - ${LIGHTBOX_VIEWPORT_GUTTER}px)`,
  );
}
