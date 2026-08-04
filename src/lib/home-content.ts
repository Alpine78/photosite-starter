/**
 * Home page content: hero media, intro copy, and links to main sections.
 * Mock data for now; will be served by the CMS once integrated, which is
 * why the accessor is async — mirrors src/lib/site-settings.ts.
 *
 * Media uses the shared discriminated model. Only images are rendered today;
 * video playback remains a later feature.
 *
 * The hero renders at the image's native ratio and is never cropped, so the
 * wide-banner look comes from the photographer supplying a wide-format image,
 * not from a fixed-height crop band. The placeholder here is a 3:2 frame from
 * the demo gallery.
 *
 * Demo assets must stay generic: no watermark, signature, studio name, or URL
 * burned into the pixels. A clone inherits every file in `public/`.
 */

import type { Media } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

export type HomeSectionLink = {
  title: string;
  href: string;
  description: string;
};

export type HomeContent = {
  hero: {
    media: Media;
  };
  intro: string;
  sections: HomeSectionLink[];
};

const mockHomeContent: HomeContent = {
  hero: {
    media: mockImages.coastalLandscape,
  },
  intro:
    "A short introduction to the studio and the work — replaced with real copy from the CMS. Structure and responsiveness first, visual polish later.",
  sections: [
    {
      title: "Services",
      href: "/services",
      description: "An overview of what I offer and how we can work together.",
    },
    {
      title: "Portfolio",
      href: "/portfolio",
      description: "Selected work across recent projects.",
    },
    {
      title: "Blog",
      href: "/blog",
      description: "Notes on gear, technique, and work in progress.",
    },
  ],
};

export async function getHomeContent(): Promise<HomeContent> {
  return mockHomeContent;
}
