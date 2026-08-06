/**
 * Settings-driven page metadata: titles, canonical URLs, alternate-language
 * links, and Open Graph values for every public route.
 *
 * Routes never spell out a site name, domain, locale, description, or brand
 * image. Authored values come from SiteSettings and the content itself, while
 * the canonical base URL, locale, and default social image come from the
 * deployment configuration module — the one owner of those values. A page
 * supplies only what is specific to it.
 *
 * Sitemap, robots policy, and structured data belong to their own stories and
 * are deliberately absent here.
 */

import type { Metadata } from "next";
import {
  getDeploymentConfig,
  type DeploymentConfig,
} from "@/lib/deployment-config";
import { getLocaleRoute, type LocaleVersion } from "@/lib/locale-routes";
import type { ImageMedia, Media } from "@/lib/media";
import { getSiteSettings, type SiteSettings } from "@/lib/site-settings";

export type MetadataContext = {
  readonly settings: SiteSettings;
  readonly deployment: DeploymentConfig;
};

export type PageMetadataInput = {
  /**
   * Canonical, parameter-free route path, e.g. `/` or `/services/weddings`.
   * A filtered view of a listing passes the unfiltered path, so alternate
   * filters of one result set do not claim separate canonical URLs.
   */
  readonly path: string;
  /** Omitted by the site root, which keeps the SiteSettings site name. */
  readonly title?: string;
  /** Falls back to the site's default description when the page has none. */
  readonly description?: string;
  /**
   * This page's own media. Only the image variant yields an Open Graph image:
   * the media model is video-capable, but video posters are not modeled yet, so
   * a video-covered page uses the deployment default rather than a guess.
   */
  readonly image?: Media;
  /** ISO 8601 date. Its presence marks the page as an Open Graph article. */
  readonly publishedTime?: string;
  /**
   * Locale of the route space this page lives in. Defaults to the deployment's
   * default locale, which owns the unprefixed routes.
   */
  readonly locale?: string;
  /**
   * Every published locale version of this page's stable identity, including
   * this page's own — `listPublishedLocaleVersions` produces exactly this set.
   * Omitted on a page that has no localized identity to name, which emits no
   * alternate-language metadata at all rather than an incomplete set.
   */
  readonly localeVersions?: readonly LocaleVersion[];
};

type OpenGraphImage = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string;
};

/**
 * Open Graph wants `language_TERRITORY`, while the deployment locale is BCP 47.
 * A locale carrying no territory produces no `og:locale`: maximizing `fi` to
 * `fi_FI` would state a market the deployment never configured.
 */
function toOpenGraphLocale(locale: string): string | undefined {
  const { language, region } = new Intl.Locale(locale);
  return region ? `${language}_${region}` : undefined;
}

/**
 * Absolute canonical URL for a route path. ADR-0003 gives canonical paths no
 * trailing slash and makes the site root the single exception. Next.js applies
 * the project's own `trailingSlash` setting to the value it emits, so the tag
 * on the site root reads as the bare origin.
 */
function resolveCanonicalUrl(path: string, canonicalBaseUrl: URL): string {
  const url = new URL(path, canonicalBaseUrl);
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.href;
}

type AlternateLanguages = NonNullable<
  NonNullable<Metadata["alternates"]>["languages"]
>;

/**
 * The locale a page's route space belongs to. An unconfigured locale is a
 * programming error rather than a visitor-facing state: a page can only render
 * inside a route space the deployment configured.
 */
function resolvePageLocale(
  locale: string | undefined,
  deployment: DeploymentConfig,
): string {
  if (locale === undefined) return deployment.locale;

  const route = getLocaleRoute(deployment.localeRoutes, locale);
  if (route === undefined) {
    throw new TypeError(`locale "${locale}" is not configured`);
  }
  return route.locale;
}

/**
 * `hreflang` alternates for one stable identity: every published locale
 * version, including the page's own self-referencing entry.
 *
 * `x-default` names the default locale's version, which is the unprefixed
 * canonical URL. When the default locale publishes no version of this content,
 * both its alternate and `x-default` are absent — the set names only versions
 * that exist, and pointing `x-default` at another language would invent a
 * translation.
 */
function toAlternateLanguages(
  versions: readonly LocaleVersion[],
  deployment: DeploymentConfig,
): AlternateLanguages | undefined {
  if (versions.length === 0) return undefined;

  const languages: Record<string, string> = {};
  for (const version of versions) {
    const locale = resolvePageLocale(version.locale, deployment);
    const url = resolveCanonicalUrl(version.path, deployment.canonicalBaseUrl);
    languages[locale] = url;
    if (locale === deployment.localeRoutes.defaultLocale) {
      languages["x-default"] = url;
    }
  }
  return languages;
}

/**
 * Open Graph image for a page. Every image reaches this point as a validated
 * public rendition — the page's own or the deployment default — so the emitted
 * URL is a versioned public derivative and the dimensions are that derivative's
 * real ones: never a master, never a guess.
 *
 * An empty alt marks a decorative image, so it is omitted rather than emitted
 * as an empty attribute.
 */
function toOpenGraphImage(
  image: Media | undefined,
  deployment: DeploymentConfig,
): OpenGraphImage {
  const rendered: ImageMedia =
    image?.type === "image" ? image : deployment.defaultSocialImage;

  const alt = rendered.alt.trim();
  return {
    url: new URL(rendered.rendition.src, deployment.canonicalBaseUrl).href,
    width: rendered.rendition.width,
    height: rendered.rendition.height,
    ...(alt.length === 0 ? {} : { alt }),
  };
}

/**
 * Site-wide defaults for the root layout: the metadata base, the title
 * template, and the Open Graph values that are true on every page.
 *
 * It deliberately sets no canonical URL and no `og:url`. Both identify one
 * page, and a route that forgot to declare its own would silently inherit the
 * site root's identity — worse than emitting nothing.
 */
export function buildSiteMetadata({
  settings,
  deployment,
}: MetadataContext): Metadata {
  const openGraphLocale = toOpenGraphLocale(deployment.locale);

  return {
    metadataBase: deployment.canonicalBaseUrl,
    title: {
      default: settings.siteName,
      template: settings.defaultSeo.titleTemplate,
    },
    description: settings.defaultSeo.description,
    openGraph: {
      type: "website",
      siteName: settings.siteName,
      ...(openGraphLocale === undefined ? {} : { locale: openGraphLocale }),
      description: settings.defaultSeo.description,
      images: [toOpenGraphImage(undefined, deployment)],
    },
  };
}

/**
 * Metadata for one public page.
 *
 * The Open Graph title is left unset on purpose: Next.js fills it from the
 * page's resolved title, which already carries the SiteSettings title template.
 * Setting it here would restate that value and let the two drift.
 */
export function buildPageMetadata(
  input: PageMetadataInput,
  { settings, deployment }: MetadataContext,
): Metadata {
  const canonical = resolveCanonicalUrl(
    input.path,
    deployment.canonicalBaseUrl,
  );
  const description = input.description ?? settings.defaultSeo.description;
  const locale = resolvePageLocale(input.locale, deployment);
  const openGraphLocale = toOpenGraphLocale(locale);
  const languages = toAlternateLanguages(
    input.localeVersions ?? [],
    deployment,
  );

  const openGraphBase = {
    url: canonical,
    siteName: settings.siteName,
    ...(openGraphLocale === undefined ? {} : { locale: openGraphLocale }),
    description,
    images: [toOpenGraphImage(input.image, deployment)],
  };

  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    description,
    alternates: {
      canonical,
      ...(languages === undefined ? {} : { languages }),
    },
    openGraph:
      input.publishedTime === undefined
        ? { ...openGraphBase, type: "website" }
        : {
            ...openGraphBase,
            type: "article",
            publishedTime: input.publishedTime,
          },
  };
}

async function getMetadataContext(): Promise<MetadataContext> {
  return {
    settings: await getSiteSettings(),
    deployment: getDeploymentConfig(),
  };
}

/** Route-facing wrapper that loads the settings and deployment context. */
export async function getSiteMetadata(): Promise<Metadata> {
  return buildSiteMetadata(await getMetadataContext());
}

/** Route-facing wrapper that loads the settings and deployment context. */
export async function getPageMetadata(
  input: PageMetadataInput,
): Promise<Metadata> {
  return buildPageMetadata(input, await getMetadataContext());
}
