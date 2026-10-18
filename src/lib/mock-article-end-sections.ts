import type { GallerySectionSummary } from "@/lib/gallery-sections";
import { getMockImages } from "@/lib/mock-media";
import type { CuratedGalleryPlacement } from "@/lib/gallery-pagination";
export const FILTER_ARTICLE_ID = "content-filtered-image-notes";
export const FILTER_END_GALLERY_ID = "image-notes-ending";
export function mockArticleEndSections(
  locale: string,
): readonly GallerySectionSummary[] {
  const fi = new Intl.Locale(locale).language === "fi";
  return [
    {
      sectionId: "soft-light",
      slug: fi ? "pehmea-valo" : "soft-light",
      label: fi ? "Pehmeä valo" : "Soft light",
      order: 0,
    },
    {
      sectionId: "texture",
      slug: fi ? "pinnat" : "texture",
      label: fi ? "Pinnat" : "Texture",
      order: 1,
    },
    {
      sectionId: "waiting",
      slug: fi ? "odottamassa" : "waiting",
      label: fi ? "Odottamassa" : "Waiting",
      order: 2,
    },
  ];
}
export function mockSectionedArticlePlacements(
  locale: string,
): readonly CuratedGalleryPlacement[] {
  const images = Object.values(getMockImages(new Intl.Locale(locale).language));
  return Array.from({ length: 30 }, (_, i) => ({
    placementId: `image-note-${String(i + 1).padStart(2, "0")}`,
    order: i,
    visible: true,
    ...(i === 2
      ? {}
      : { sectionId: i === 1 || i === 4 ? "texture" : "soft-light" }),
    media: images[i % images.length],
  }));
}
