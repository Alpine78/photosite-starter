/**
 * Home page content: hero media, intro copy, and links to main sections.
 * Mock data for now; will be served by the CMS once integrated, which is
 * why the accessor is async — mirrors src/lib/site-settings.ts.
 *
 * Media uses the shared discriminated model. Only images are rendered today;
 * video playback remains a later feature.
 */

import type { Media } from "@/lib/media";

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
    media: {
      type: "image",
      src: "/hero-sample.jpg",
      alt: "Placeholder hero image",
      width: 1920,
      height: 1080,
    },
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
      title: "Contact",
      href: "/contact",
      description: "Get in touch to discuss your project.",
    },
  ],
};

export async function getHomeContent(): Promise<HomeContent> {
  return mockHomeContent;
}
