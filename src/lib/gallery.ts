/**
 * Gallery content backed by mock data until the CMS is integrated.
 *
 * Gallery items wrap the shared Media union rather than defining a parallel
 * image shape. The current grid renders image variants only; video UI remains
 * outside the MVP slice.
 */

import type { Media } from "@/lib/media";

export type MediaItem = {
  id: string;
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
      id: "coastal-landscape",
      media: {
        type: "image",
        src: "/gallery/coastal-landscape.webp",
        alt: "Rocky shoreline beside calm water under an overcast sky",
        width: 1536,
        height: 1024,
        caption: "Quiet coast",
      },
    },
    {
      id: "misty-birch",
      media: {
        type: "image",
        src: "/gallery/misty-birch.webp",
        alt: "Silver birch standing in a misty green forest",
        width: 1024,
        height: 1536,
        caption: "Morning mist",
      },
    },
    {
      id: "lakeside-reeds",
      media: {
        type: "image",
        src: "/gallery/lakeside-reeds.webp",
        alt: "Golden reeds moving beside blue lake water",
        width: 1254,
        height: 1254,
      },
    },
    {
      id: "forest-stream",
      media: {
        type: "image",
        src: "/gallery/forest-stream.webp",
        alt: "Forest stream flowing over dark moss-covered stones",
        width: 1024,
        height: 1536,
        caption: "Forest stream",
      },
    },
    {
      id: "open-marsh",
      media: {
        type: "image",
        src: "/gallery/open-marsh.webp",
        alt: "Reflective water channel winding through an open marsh",
        width: 1536,
        height: 1024,
        caption: "After the rain",
      },
    },
    {
      id: "lichen-stones",
      media: {
        type: "image",
        src: "/gallery/lichen-stones.webp",
        alt: "Rain-darkened stones patterned with pale lichen",
        width: 1254,
        height: 1254,
        caption: "Shoreline details",
      },
    },
  ],
};

export async function getPortfolioGallery(): Promise<Gallery> {
  return mockPortfolioGallery;
}
