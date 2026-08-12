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

/** Three-column card grid inside the bounded 1152px content container. */
const contentCardGridSizes = boundedImageSizes(
  1152,
  347,
  "(min-width: 1024px) calc(33.333vw - 37.333px), (min-width: 640px) calc(50vw - 40px), calc(100vw - 32px)",
);

/**
 * Slot-accurate profiles for the current bounded layouts.
 *
 * These values belong to presentation contexts rather than media records: the
 * same image can appear in a card, article, and lightbox without changing its
 * public rendition identity or intrinsic dimensions.
 */
export const imageRenderProfiles = {
  /** The curated gallery grid: three equal columns inside the 1152px container. */
  galleryGrid: {
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
  /** The category branch listing: same container, same three-column grid. */
  contentListingGrid: {
    sizes: contentCardGridSizes,
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

/**
 * Widest CSS slot the lightbox will ever present an image in. The lightbox
 * enforces it as a zoom cap, so the hint below and the rendered slot agree.
 */
export const LIGHTBOX_MAX_CSS_WIDTH = 3840;

/**
 * Highest magnification at which an image of `declaredWidth` CSS pixels still
 * fits the widest slot the lightbox declares.
 *
 * A lightbox magnifies what it was given rather than fetching more pixels, so
 * an uncapped zoom level would render a slot the `sizes` hint never described.
 * Every zoom level the presentation offers — the one it opens at, the one a
 * click or double-tap goes to, and the ceiling a pinch can reach — passes
 * through here, because the library derives its effective maximum from all
 * three and capping only some of them leaves the declaration untrue.
 *
 * Returns positive infinity for a non-positive width: an unknown size is not
 * evidence of an oversized one, and the caller's own fit level still bounds it.
 */
export function getLightboxZoomCap(declaredWidth: number): number {
  return declaredWidth > 0
    ? LIGHTBOX_MAX_CSS_WIDTH / declaredWidth
    : Number.POSITIVE_INFINITY;
}

/**
 * Produces the lightbox `sizes` hint.
 *
 * Its job is to describe the widest slot the image can occupy, which is what
 * makes the optimizer emit width-descriptor candidates instead of pixel-density
 * ones. The attribute the browser finally selects against is narrower and
 * exact: the lightbox replaces it with the slide's rendered CSS width once the
 * viewport is known, and never lowers it again within one slide.
 *
 * The fluid slot is the whole viewport, with no gutter subtracted, because the
 * lightbox presents each frame edge to edge: whichever of width or height binds
 * first, the photograph reaches that edge and no margin is held back from it.
 */
export function getLightboxImageSizes(
  rendition: Pick<PublicImageRendition, "width">,
): string {
  const maxCssWidth = Math.min(rendition.width, LIGHTBOX_MAX_CSS_WIDTH);

  return boundedImageSizes(maxCssWidth, maxCssWidth, "100vw");
}
