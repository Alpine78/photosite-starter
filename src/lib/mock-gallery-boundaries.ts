import { projectPublicImageMedia, withLocalizedText } from "@/lib/media";

/**
 * Project-authored geometric test images, with their actual file dimensions.
 *
 * Each keeps the extreme ratio its own test needs (still comfortably over
 * `GALLERY_CAPTION_OVERLAY_MAX_RATIO`, still narrow enough to squeeze a
 * justified row neighbour to a sliver) while staying at the largest
 * resolution the public-derivative ceiling (`MAX_PUBLIC_DELIVERY_DIMENSION`,
 * 2048px) allows on the long edge — the short edge is therefore also as
 * large as that ratio and ceiling together permit. An independent Codex
 * review of AB#157 measured the previous 128px-wide files (unchanged since
 * this project's very first six demo photographs) visibly blurred once
 * stretched to fill a masonry column or justified row: `next/image`'s own
 * optimizer never upscales past a source's true resolution (confirmed
 * against a real request), so a too-small source is stretched by the
 * browser's own CSS instead, which no `sizes`/`srcset` choice can prevent.
 */
const galleryBoundaryImages = {
  panorama: projectPublicImageMedia({
    mediaId: "layout-panorama",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/layout-panorama.59129dab89c0.webp",
      version: "59129dab89c0",
      width: 2048,
      height: 256,
    },
    alt: "Geometric panorama",
  }),
  portrait: projectPublicImageMedia({
    mediaId: "layout-portrait",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/layout-portrait.682a067b563a.webp",
      version: "682a067b563a",
      width: 256,
      height: 2048,
    },
    alt: "Geometric portrait",
  }),
} as const;

export type GalleryBoundaryImages = typeof galleryBoundaryImages;

/** The same two renditions, described in Finnish, like `mock-media.ts`'s own pattern. */
const finnishGalleryBoundaryImages = {
  panorama: withLocalizedText(galleryBoundaryImages.panorama, {
    alt: "Geometrinen testikuva, panoraama",
  }),
  portrait: withLocalizedText(galleryBoundaryImages.portrait, {
    alt: "Geometrinen testikuva, pystykuva",
  }),
} as const satisfies GalleryBoundaryImages;

const galleryBoundaryImagesByLanguage: Readonly<Record<string, GalleryBoundaryImages>> = {
  en: galleryBoundaryImages,
  fi: finnishGalleryBoundaryImages,
};

/**
 * These boundary images by language, matching `getMockImages`'s own
 * fallback-to-English rule: an unauthored locale gets English text rather
 * than a two-language string mixed into one `alt` attribute.
 */
export function getGalleryBoundaryImages(language: string): GalleryBoundaryImages {
  return galleryBoundaryImagesByLanguage[language] ?? galleryBoundaryImages;
}
