/**
 * Home page content: hero media, intro copy, and links to main sections.
 * The async accessor dispatches between fixture data and the authored Sanity
 * singleton — mirrors src/lib/site-settings.ts.
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
import { buildStoryPath, type LocaleRouteConfig } from "@/lib/locale-routes";
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
 * Resolves the featured gallery's canonical route, or `undefined` when the
 * featured gallery leads nowhere in this locale (unpublished, unplaced, or
 * unconfigured). Provider-agnostic: it reads only the seams
 * (`getSiteSettings`, `getContentTrees`) both the mock and Sanity home-content
 * builders already depend on, so the same computation serves either source
 * and the home page always links to the same gallery the header and footer
 * do, whichever one is answering.
 */
async function resolveFeaturedGalleryHref(
  localeRoutes: LocaleRouteConfig,
  locale: string,
): Promise<string | undefined> {
  const [settings, trees] = await Promise.all([
    getSiteSettings(),
    getContentTrees(),
  ]);

  return settings.featuredGalleryId === undefined
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
}

/**
 * Built lazily rather than as a module constant: the story section's href is
 * composed from the deployment's configured namespace, and the featured
 * gallery's from the content tree. Reading either at import time would fail
 * every context that has no deployment environment.
 */
async function buildMockHomeContent(
  localeRoutes: LocaleRouteConfig,
  locale: string,
): Promise<HomeContent> {
  const featuredGalleryHref = await resolveFeaturedGalleryHref(
    localeRoutes,
    locale,
  );
  const labels = getDefaultLocaleLabels();

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

/**
 * Home is unprefixed-default-locale-only today, matching the mock's existing
 * behavior, so both sources resolve against `localeRoutes.defaultLocale`
 * regardless of which route space rendered it.
 */
export async function getHomeContent(): Promise<HomeContent> {
  const { contentSource, localeRoutes } = getDeploymentConfig();
  const locale = localeRoutes.defaultLocale;

  if (contentSource === "sanity") {
    // Dynamic, not static: `sanity-home-content.ts` carries the
    // `server-only` marker, and a static import would pull it into this
    // seam's module graph unconditionally — including from contexts (e2e
    // Playwright specs, which run outside Next's own bundler) that cannot
    // satisfy that package's build-time "react-server" export condition.
    const { readSanityHomeContent } = await import(
      "@/lib/sanity-home-content"
    );
    const language = new Intl.Locale(locale).language;
    const featuredGalleryHref = await resolveFeaturedGalleryHref(
      localeRoutes,
      locale,
    );

    return readSanityHomeContent({
      language,
      fallbackLanguage: language,
      locale,
      routeConfig: localeRoutes,
      ...(featuredGalleryHref === undefined ? {} : { featuredGalleryHref }),
    });
  }

  return buildMockHomeContent(localeRoutes, locale);
}
