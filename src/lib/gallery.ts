/**
 * Gallery content backed by mock data until the CMS is integrated.
 *
 * Gallery items wrap the shared Media union rather than defining a parallel
 * image shape. The current grid renders image variants only; video UI remains
 * outside the MVP slice.
 */

import {
  buildCuratedGalleryPage,
  type CuratedGalleryPlacement,
  type GalleryPage,
} from "@/lib/gallery-result";
import { mockImages } from "@/lib/mock-media";

export type Gallery = {
  slug: string;
  title: string;
  description?: string;
  result: GalleryPage;
};

const portfolioPlacements: readonly CuratedGalleryPlacement[] = [
  {
    placementId: "portfolio-coastal-landscape",
    order: 0,
    visible: true,
    media: mockImages.coastalLandscape,
    captionOverride: "Quiet coast",
  },
  {
    placementId: "portfolio-misty-birch",
    order: 1,
    visible: true,
    media: mockImages.mistyBirch,
    captionOverride: "Morning mist",
  },
  {
    placementId: "portfolio-lakeside-reeds",
    order: 2,
    visible: true,
    media: mockImages.lakesideReeds,
  },
  {
    placementId: "portfolio-forest-stream",
    order: 3,
    visible: true,
    media: mockImages.forestStream,
    captionOverride: "Forest stream",
  },
  {
    placementId: "portfolio-open-marsh",
    order: 4,
    visible: true,
    media: mockImages.openMarsh,
    captionOverride: "After the rain",
  },
  {
    placementId: "portfolio-lichen-stones",
    order: 5,
    visible: true,
    media: mockImages.lichenStones,
    captionOverride: "Shoreline details",
  },
];

const mockPortfolioGallery: Gallery = {
  slug: "portfolio",
  title: "Portfolio",
  description:
    "A selection of recent work. Placeholder gallery content; replaced with real projects from the CMS.",
  result: buildCuratedGalleryPage({
    placements: portfolioPlacements,
    scope: {
      sourceId: "portfolio",
      normalizedFilter: "all",
      ordering: "manual-v1",
      visibilityVersion: "mock-portfolio-v1",
      pageSize: 24,
    },
  }),
};

export async function getPortfolioGallery(): Promise<Gallery> {
  return mockPortfolioGallery;
}
