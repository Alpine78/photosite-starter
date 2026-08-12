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

import { getContentTrees } from "@/lib/content";
import { getPublicContentRoute } from "@/lib/content-routes";
import {
  getDefaultLocaleLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { buildStoryPath } from "@/lib/locale-routes";
import type { Media } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";
import { getSiteSettings } from "@/lib/site-settings";

export type HomeSectionLink = {
  title: string;
  href: string;
  description: string;
};

/** The hero's primary call to action. */
export type HomeAction = {
  label: string;
  href: string;
};

export type HomeContent = {
  hero: {
    media: Media;
    /**
     * Absent when the featured gallery leads nowhere in this locale — an
     * unpublished, unplaced, or unconfigured one. A hero button into the site's
     * own 404 is worse than a hero without one.
     */
    action?: HomeAction;
  };
  intro: string;
  sections: HomeSectionLink[];
};

/**
 * Built lazily rather than as a module constant: the story section's href is
 * composed from the deployment's configured namespace, and the featured
 * gallery's from the content tree. Reading either at import time would fail
 * every context that has no deployment environment.
 *
 * The featured gallery is reached by the identity site settings hold, resolved
 * to its canonical route here, so the home page links to the same gallery the
 * header and footer do and none of the three writes a path down.
 */
async function buildMockHomeContent(): Promise<HomeContent> {
  const { localeRoutes } = getDeploymentConfig();
  const locale = localeRoutes.defaultLocale;
  const [settings, trees] = await Promise.all([
    getSiteSettings(),
    getContentTrees(),
  ]);
  const labels = getDefaultLocaleLabels();

  const featuredGalleryHref =
    settings.featuredGalleryId === undefined
      ? undefined
      : getPublicContentRoute(
          localeRoutes,
          trees.get(locale),
          locale,
          settings.featuredGalleryId,
          // The same check the chrome makes: a setting that named an article
          // would put "View portfolio" in front of one.
          "gallery",
        );

  return {
    hero: {
      media: mockImages.coastalLandscape,
      ...(featuredGalleryHref === undefined
        ? {}
        : {
            action: {
              label: labels.actions.viewPortfolio,
              href: featuredGalleryHref,
            },
          }),
    },
    intro:
      "A short introduction to the studio and the work — replaced with real copy from the CMS. Structure and responsiveness first, visual polish later.",
    sections: [
      {
        title: "Services",
        href: "/services",
        description:
          "An overview of what I offer and how we can work together.",
      },
      ...(featuredGalleryHref === undefined
        ? []
        : [
            {
              title: labels.pages.portfolio,
              href: featuredGalleryHref,
              description: "Selected work across recent projects.",
            },
          ]),
      {
        title: "Stories",
        href: buildStoryPath(localeRoutes, locale),
        description:
          "Photographic series and notes on gear, technique, and work in progress.",
      },
    ],
  };
}

export async function getHomeContent(): Promise<HomeContent> {
  return buildMockHomeContent();
}
