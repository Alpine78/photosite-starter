import type { PublicImageRendition } from "@/lib/media";

/**
 * Longest edge a public web derivative may have.
 *
 * This is export policy, not a contract limit: `MAX_PUBLIC_IMAGE_DIMENSION`
 * (8192) is what the public media type will accept at all, and this is what a
 * deployment's own delivery copies are allowed to be. The number is the widest
 * candidate the optimizer is configured to emit, and a test pins the two
 * together — a derivative wider than that could never be delivered in full
 * anyway, because every candidate the browser can ask for is narrower, so the
 * extra pixels are cost with no reader.
 *
 * It is also the mechanical part of the "public derivatives only" rule. A
 * camera master is several times this wide, so uploading one into the content
 * store fails at the boundary instead of being served from a public URL and
 * cached beyond recall. Editorial intent is not a control; a bound is.
 *
 * Raising it is one deliberate change, not three: the export policy here, the
 * optimizer's candidate list in `next.config.ts`, and AB#15's lightbox
 * verification move together or not at all.
 */
export const MAX_PUBLIC_DELIVERY_DIMENSION = 2048;

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
  /**
   * The shared body-block renderer's reading column, tuned for the article
   * variant's own `<main className="max-w-3xl px-4 sm:px-6">`: at the 768px
   * container cap its content width is 768 minus that container's own
   * horizontal padding, i.e. 720px.
   */
  contentBody: {
    sizes: boundedImageSizes(
      768,
      720,
      "(min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
    ),
  },
  /**
   * The same shared body renderer, tuned instead for the gallery variant's
   * reading column: a plain `max-w-3xl` div with no padding of its own,
   * nested inside the gallery's already-padded, wider `<main>`. Below its own
   * 768px cap it tracks that `<main>`'s content width exactly (the identical
   * `px-4`/`sm:px-6` padding both containers share), which is why the fluid
   * clause is unchanged from `contentBody`; only the terminal width is flat
   * 768px rather than 720px, and only above 816px viewport width — the point
   * at which `<main>`'s own content width first exceeds 768px and this div's
   * cap, not `<main>`'s padding, becomes the binding constraint.
   */
  galleryBody: {
    sizes: boundedImageSizes(
      816,
      768,
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

/**
 * How many adjacent slides the lightbox loads ahead of a visitor's own
 * navigation: one behind, two ahead (AB#79).
 *
 * The underlying library ships this same pair as its own unstated default, so
 * leaving it unset would make the window an inherited accident rather than a
 * project decision the way `LIGHTBOX_MAX_CSS_WIDTH` and the zoom cap above
 * already are. Restating the identical numbers here keeps today's navigation
 * feel unchanged while making the bound explicit, reviewable, and the one
 * place a future change to it is made. It is biased slightly forward because
 * next is the more common navigation direction than previous.
 *
 * The window only ever addresses slides already present in the viewer's own
 * loaded slide array (`gallery-lightbox.tsx` builds `dataSource` from exactly
 * that array and appends to it in place as a continuation delivers more), so
 * widening or narrowing this pair can never itself cross a gallery's page
 * cursor — reaching a new page stays the separate, already-shipped mechanism
 * that fires only once a visitor's current slide is the last one loaded.
 */
export const LIGHTBOX_PRELOAD_WINDOW: readonly [number, number] = [1, 2];
