/**
 * Gallery content backed by mock data until the CMS is integrated.
 *
 * Gallery items wrap the shared Media union rather than defining a parallel
 * image shape. The current grid renders image variants only; video UI remains
 * outside the MVP slice.
 */

import type { Media } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

export type MediaItem = {
  placementId: string;
  media: Media;
};

export type Gallery = {
  slug: string;
  title: string;
  description?: string;
  items: MediaItem[];
};

const mockPortfolioGallery: Gallery = {
  slug: "portfolio",
  title: "Portfolio",
  description:
    "A selection of recent work. Placeholder gallery content; replaced with real projects from the CMS.",
  items: [
    {
      placementId: "portfolio-coastal-landscape",
      media: {
        ...mockImages.coastalLandscape,
        caption: "Quiet coast",
      },
    },
    {
      placementId: "portfolio-misty-birch",
      media: {
        ...mockImages.mistyBirch,
        caption: "Morning mist",
      },
    },
    {
      placementId: "portfolio-lakeside-reeds",
      media: mockImages.lakesideReeds,
    },
    {
      placementId: "portfolio-forest-stream",
      media: {
        ...mockImages.forestStream,
        caption: "Forest stream",
      },
    },
    {
      placementId: "portfolio-open-marsh",
      media: {
        ...mockImages.openMarsh,
        caption: "After the rain",
      },
    },
    {
      placementId: "portfolio-lichen-stones",
      media: {
        ...mockImages.lichenStones,
        caption: "Shoreline details",
      },
    },
  ],
};

export async function getPortfolioGallery(): Promise<Gallery> {
  return mockPortfolioGallery;
}
