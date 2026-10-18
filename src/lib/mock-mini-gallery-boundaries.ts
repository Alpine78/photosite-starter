import { projectPublicImageMedia } from "@/lib/media";
import { getMockImages } from "@/lib/mock-media";
import { getGalleryBoundaryImages } from "@/lib/mock-gallery-boundaries";
import type { MiniGalleryBlock } from "@/lib/content-mini-gallery";

/** Synthetic complete public frames with their actual file dimensions. */
export function miniGalleryBoundaryImages(language: string) {
  const fi = language === "fi";
  return {
    thinPortrait: projectPublicImageMedia({ mediaId: "mini-thin-portrait", publiclyRenderable: true, rendition: { sourceKind: "public-web-derivative", src: "/gallery/mini-thin-portrait.e0b40512718c.webp", version: "e0b40512718c", width: 1, height: 2048 }, alt: fi ? "Yhden pikselin levyinen pystykuva" : "One-pixel-wide vertical frame" }),
    thinPanorama: projectPublicImageMedia({ mediaId: "mini-thin-panorama", publiclyRenderable: true, rendition: { sourceKind: "public-web-derivative", src: "/gallery/mini-thin-panorama.23e65e382727.webp", version: "23e65e382727", width: 2048, height: 1 }, alt: fi ? "Yhden pikselin korkuinen panoraama" : "One-pixel-high panorama" }),
    small: projectPublicImageMedia({ mediaId: "mini-small", publiclyRenderable: true, rendition: { sourceKind: "public-web-derivative", src: "/gallery/mini-small.fb8f76548441.webp", version: "fb8f76548441", width: 32, height: 24 }, alt: fi ? "Pieni geometrinen kuva" : "Small geometric frame" }),
  };
}

/** One bounded authored set, including mid-row extremes and a normal final row. */
export function miniGalleryBoundaryBlock(language: string): MiniGalleryBlock {
  const images = getMockImages(language);
  const shapes = getGalleryBoundaryImages(language);
  const tiny = miniGalleryBoundaryImages(language);
  const fi = language === "fi";
  const longCaption = fi
    ? `Kokonainen kuva ja katkeamaton esimerkkisana: ${"kuvatekstiesimerkki".repeat(8)}`
    : `A complete frame and an unbroken example word: ${"captionexample".repeat(8)}`;
  return {
    type: "mini-gallery",
    title: fi ? "Muotoja" : "Shape studies",
    items: [
      { media: { ...images.forestStream, caption: longCaption } },
      { media: { ...images.openMarsh, caption: "" } },
      { media: { ...images.lakesideReeds, credit: "Placeholder credit" } },
      { media: { ...shapes.portrait, caption: longCaption } },
      { media: images.openMarsh },
      { media: { ...shapes.panorama, caption: longCaption } },
      { media: { ...tiny.thinPortrait, caption: longCaption } },
      { media: { ...tiny.thinPanorama, caption: longCaption } },
      { media: { ...tiny.small, caption: longCaption } },
      { media: { ...images.forestStream, caption: longCaption } },
      { media: { ...images.openMarsh, caption: "" } },
      { media: { ...images.lakesideReeds, credit: "Placeholder credit" } },
    ],
  };
}
