/** Authored presentation only; never changes gallery membership, order or cursors. */
export const GALLERY_LAYOUTS = ["grid", "masonry", "justified"] as const;
export const GALLERY_CAPTION_PLACEMENTS = ["below", "overlay"] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];
export type GalleryCaptionPlacement = (typeof GALLERY_CAPTION_PLACEMENTS)[number];
export type GalleryPresentation = {
  readonly layout: GalleryLayout;
  readonly captionPlacement: GalleryCaptionPlacement;
};
export type GalleryPresentationFields = {
  readonly galleryLayout?: GalleryLayout;
  readonly galleryCaptionPlacement?: GalleryCaptionPlacement;
};
export const DEFAULT_GALLERY_PRESENTATION: GalleryPresentation = {
  layout: "grid",
  captionPlacement: "below",
};

/**
 * Unknown CMS values are defects, never CSS classes or silently accepted
 * defaults.
 *
 * `reject` is typed `never`-returning because every current caller throws a
 * classified error from it, but nothing in this function's own control flow
 * depends on that: whether or not `reject` actually throws, an invalid value
 * is never cast and returned as if it were valid. A field the reject callback
 * merely warned about (rather than throwing on) is omitted here, falling back
 * to the default through `effectiveGalleryPresentation`'s `??` chain, rather
 * than smuggled through as an unchecked cast.
 */
export function readGalleryPresentationFields(
  source: { readonly galleryLayout?: unknown; readonly galleryCaptionPlacement?: unknown },
  reject: (detail: string) => never,
): GalleryPresentationFields {
  const { galleryLayout, galleryCaptionPlacement } = source;
  const layoutIsValid =
    galleryLayout == null || GALLERY_LAYOUTS.some((value) => value === galleryLayout);
  if (!layoutIsValid) reject("galleryLayout is not a supported layout");
  const captionPlacementIsValid =
    galleryCaptionPlacement == null ||
    GALLERY_CAPTION_PLACEMENTS.some((value) => value === galleryCaptionPlacement);
  if (!captionPlacementIsValid) {
    reject("galleryCaptionPlacement is not a supported caption placement");
  }

  return {
    ...(layoutIsValid && galleryLayout != null
      ? { galleryLayout: galleryLayout as GalleryLayout }
      : {}),
    ...(captionPlacementIsValid && galleryCaptionPlacement != null
      ? { galleryCaptionPlacement: galleryCaptionPlacement as GalleryCaptionPlacement }
      : {}),
  };
}

/**
 * How much larger a rendition's width may be than its height before it
 * cannot hold two readable caption lines over the photograph, forcing a
 * reserved strip below it regardless of the authored caption placement.
 *
 * The one number both a `GalleryFigure`'s render decision and a masonry
 * layout's reserved-space calculation must agree on: see
 * `resolvesToBelowCaption`'s own doc comment for why they cannot each carry
 * their own copy.
 */
export const GALLERY_CAPTION_OVERLAY_MAX_RATIO = 4;

/**
 * Whether a caption renders below its photograph rather than as the
 * authored `captionPlacement` — true for `"below"` itself, and also true for
 * `"overlay"` when the image is too low (a wide panorama) to hold two
 * readable caption lines over it.
 *
 * `GalleryFigure` calls this to decide where the caption actually renders;
 * `GalleryMasonryList` calls the identical predicate to decide how much
 * vertical space `placeMasonry` must reserve under that same image. Two
 * different consumers need the same decision, so it lives here once rather
 * than as a bare `ratio > 4` literal repeated in both call sites, which could
 * silently drift apart if one were ever tuned without the other.
 */
export function resolvesToBelowCaption(
  captionPlacement: GalleryCaptionPlacement,
  rendition: { readonly width: number; readonly height: number },
): boolean {
  return (
    captionPlacement === "below" ||
    rendition.width / rendition.height > GALLERY_CAPTION_OVERLAY_MAX_RATIO
  );
}

/** One resolution seam for both sources; clearing either override restores only that field. */
export function effectiveGalleryPresentation(
  gallery: GalleryPresentationFields,
  settings: GalleryPresentationFields,
): GalleryPresentation {
  return {
    layout: gallery.galleryLayout ?? settings.galleryLayout ?? DEFAULT_GALLERY_PRESENTATION.layout,
    captionPlacement: gallery.galleryCaptionPlacement ?? settings.galleryCaptionPlacement ??
      DEFAULT_GALLERY_PRESENTATION.captionPlacement,
  };
}
