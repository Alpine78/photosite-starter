/**
 * Curated gallery mock used until the CMS adapter lands.
 *
 * The builder accepts an optional cursor codec explicitly so browser-free
 * tests stay deterministic and AB#66 can choose the eventual adapter codec.
 */

import {
  buildCuratedGalleryPage,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
} from "@/lib/gallery-pagination";
import type {
  CuratedGalleryResultItem,
  GalleryPage,
} from "@/lib/gallery-result";
import { mockImages } from "@/lib/mock-media";

export type Gallery = {
  slug: string;
  title: string;
  description?: string;
  result: GalleryPage<CuratedGalleryResultItem>;
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

const portfolioCursorScope = {
  sourceId: "portfolio",
  normalizedFilter: "all",
  ordering: "manual-v1",
  visibilityVersion: "mock-portfolio-v1",
  pageSize: 24,
} as const;

export function buildPortfolioGallery({
  cursor,
  cursorCodec,
}: {
  readonly cursor?: string;
  readonly cursorCodec?: GalleryCursorCodec;
} = {}): Gallery {
  return {
    slug: "portfolio",
    title: "Portfolio",
    description:
      "A selection of recent work. Placeholder gallery content; replaced with real projects from the CMS.",
    result: buildCuratedGalleryPage({
      placements: portfolioPlacements,
      scope: portfolioCursorScope,
      cursor,
      cursorCodec,
    }),
  };
}
