/**
 * Home page content: hero media, intro copy, and links to main sections.
 * Mock data for now; will be served by the CMS once integrated, which is
 * why the accessor is async — mirrors src/lib/site-settings.ts.
 *
 * Media is modeled to leave room for video later: the hero holds an
 * `image` today, and a `video` could be added without reshaping this.
 * We don't build video features yet, but we don't bake photo-only
 * assumptions into the data model either.
 */

export type HeroImage = {
  src: string;
  /** Descriptive alt text; empty string only if the image is purely decorative. */
  alt: string;
  /** Intrinsic dimensions, required so next/image can reserve space (no CLS). */
  width: number;
  height: number;
};

export type HomeSectionLink = {
  title: string;
  href: string;
  description: string;
};

export type HomeContent = {
  hero: {
    image: HeroImage;
  };
  intro: string;
  sections: HomeSectionLink[];
};

const mockHomeContent: HomeContent = {
  hero: {
    image: {
      src: "/hero-placeholder.svg",
      alt: "Placeholder hero image",
      width: 1600,
      height: 1000,
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
