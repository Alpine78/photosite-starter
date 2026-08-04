/**
 * Public mock media used until the CMS adapter lands.
 *
 * Each path names immutable, content-versioned web bytes. Replacing an image
 * requires a new filename and therefore a new public source URL.
 */

import {
  projectPublicImageMedia,
  type ImageMedia,
} from "@/lib/media";

export const mockImages = {
  coastalLandscape: projectPublicImageMedia({
    mediaId: "coastal-landscape",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/coastal-landscape.1683eecb7e65.webp",
      version: "1683eecb7e65",
      width: 1536,
      height: 1024,
    },
    alt: "Rocky shoreline beside calm water under an overcast sky",
  }),
  forestStream: projectPublicImageMedia({
    mediaId: "forest-stream",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/forest-stream.4707752d81a6.webp",
      version: "4707752d81a6",
      width: 1024,
      height: 1536,
    },
    alt: "Forest stream flowing over dark moss-covered stones",
  }),
  lakesideReeds: projectPublicImageMedia({
    mediaId: "lakeside-reeds",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/lakeside-reeds.ddbe8db0379c.webp",
      version: "ddbe8db0379c",
      width: 1254,
      height: 1254,
    },
    alt: "Golden reeds moving beside blue lake water",
  }),
  lichenStones: projectPublicImageMedia({
    mediaId: "lichen-stones",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/lichen-stones.013e44e81dda.webp",
      version: "013e44e81dda",
      width: 1254,
      height: 1254,
    },
    alt: "Rain-darkened stones patterned with pale lichen",
  }),
  mistyBirch: projectPublicImageMedia({
    mediaId: "misty-birch",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/misty-birch.dac688b96d85.webp",
      version: "dac688b96d85",
      width: 1024,
      height: 1536,
    },
    alt: "Silver birch standing in a misty green forest",
  }),
  openMarsh: projectPublicImageMedia({
    mediaId: "open-marsh",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/open-marsh.e679c408d1ee.webp",
      version: "e679c408d1ee",
      width: 1536,
      height: 1024,
    },
    alt: "Reflective water channel winding through an open marsh",
  }),
} as const satisfies Record<string, ImageMedia>;
