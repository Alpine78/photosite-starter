import type { ImageMedia, Media } from "@/lib/media";

declare const galleryCursorBrand: unique symbol;

/**
 * Server-issued continuation token. It is opaque to routes and clients: they
 * may transport it, but only the gallery adapter creates or interprets it.
 */
export type GalleryCursor = string & {
  readonly [galleryCursorBrand]: true;
};

export type GalleryResultItem<TMedia extends Media = ImageMedia> = {
  /** Result identity used by UI selection, navigation, and focus restoration. */
  readonly itemId: string;
  /** Stable media identity used by media-level enquiry and later sales flows. */
  readonly mediaId: string;
  /** Curated placement identity; dynamic adapters omit it. */
  readonly placementId?: string;
  readonly media: TMedia;
  /** Placement-owned section membership; AB#105 owns section metadata. */
  readonly sectionId?: string;
};

export type CuratedGalleryResultItem<TMedia extends Media = ImageMedia> = Omit<
  GalleryResultItem<TMedia>,
  "placementId"
> & {
  readonly placementId: string;
};

export type DynamicGalleryResultItem<TMedia extends Media = ImageMedia> = Omit<
  GalleryResultItem<TMedia>,
  "placementId" | "sectionId"
> & {
  readonly placementId?: never;
  readonly sectionId?: never;
};

export type GalleryPageInfo =
  | {
      readonly size: number;
      readonly hasNextPage: true;
      readonly endCursor: GalleryCursor;
    }
  | {
      readonly size: number;
      readonly hasNextPage: false;
      readonly endCursor: null;
    };

/**
 * Vendor-neutral bounded result shared by curated and future dynamic sources.
 * The current MVP adapter supports validated public images; the generic keeps
 * the core result shape reusable when another public media variant is added.
 */
export type GalleryPage<
  TItem extends GalleryResultItem<Media> = GalleryResultItem<ImageMedia>,
> = {
  readonly items: readonly TItem[];
  /** `size` is the requested upper bound; a final page may contain fewer. */
  readonly page: GalleryPageInfo;
};

// The curated gallery page's section metadata (`sections`, `selectedSection`) is
// `CuratedGalleryPage` in `gallery-sections.ts`, layered on `GalleryPage` here — not
// defined in this leaf module, to avoid a circular import with the section types.
