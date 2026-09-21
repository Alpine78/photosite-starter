/**
 * Services content: the list of services offered, each with its own detail
 * page. The async accessors dispatch between fixture data and authored Sanity
 * documents — mirrors src/lib/site-settings.ts and src/lib/home-content.ts.
 *
 * Generic by design: no real photographer's service names, prices, or copy
 * are baked into the template. Both the cover image and pricing are optional
 * per service, so a card renders cleanly with or without them.
 *
 * Covers are never cropped, so a card is as tall as its cover's native ratio
 * makes it. In a multi-column card grid that means wildly different ratios
 * (a 2:3 portrait beside a 3:2 landscape) tear large gaps into the rows.
 * Keep demo covers within a similar ratio range; tall frames belong in the
 * gallery grid and in article bodies, which are single-column.
 */

import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import type { Media } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";
import { getSiteSettings } from "@/lib/site-settings";
import {
  buildServiceRoutes,
  findServiceRoute,
  type ResolvedService,
} from "@/lib/service-routes";
import { buildServicePath, type LocaleVersion } from "@/lib/locale-routes";

export type ServicePricePackage = {
  /** Package name, e.g. "Half day", "Full day". */
  name: string;
  /** Display price, e.g. "From € 450" or "€ 900" — formatted in content, not derived. */
  price: string;
  /** Optional one-line note about what the package includes. */
  note?: string;
};

export type Service = {
  /** Stable identity shared by every localized version of this service. */
  serviceId: string;
  /** ISO language subtag owning this published version. */
  language: string;
  /** Optional stable identity of the service's parent. */
  parentServiceId?: string;
  /** One path segment below the service's locale-specific namespace. */
  slug: string;
  name: string;
  /** One- to two-line summary shown on the listing card. */
  shortDescription: string;
  /** Full description as paragraphs; rendered on the detail page. */
  description: string[];
  /** Optional cover media; current views render its image variant. */
  coverMedia?: Media;
  /**
   * Optional scannable "from" price for the listing card, e.g. "From 450 €".
   * Pre-formatted string, not a number — currency and wording come from content.
   */
  startingPrice?: string;
  /** Optional full pricing breakdown shown on the detail page. */
  pricing?: ServicePricePackage[];
};

const mockServices: Service[] = [
  {
    serviceId: "portrait-sessions",
    language: "en",
    slug: "portrait-sessions",
    name: "Portrait sessions",
    shortDescription:
      "Relaxed, natural portraits for individuals, couples, and families.",
    description: [
      "A short, friendly session focused on natural light and genuine expressions. We start with a quick chat about the look you want, then shoot in a location that suits you — studio, home, or outdoors.",
      "You receive a curated set of edited images, delivered through an online gallery. Placeholder copy; replaced with real wording from the CMS.",
    ],
    coverMedia: mockImages.coastalLandscape,
    startingPrice: "From 250 €",
    pricing: [
      {
        name: "Mini session",
        price: "From 250 €",
        note: "30 minutes, one location, 10 edited images.",
      },
      {
        name: "Full session",
        price: "450 €",
        note: "90 minutes, two locations, 30 edited images.",
      },
    ],
  },
  {
    serviceId: "weddings",
    language: "en",
    slug: "weddings",
    name: "Weddings",
    shortDescription:
      "Full-day storytelling coverage, from preparations to the last dance.",
    description: [
      "Documentary-style coverage that captures the day as it unfolds, with a calm, unobtrusive presence. Every wedding is quoted individually based on hours, locations, and second-shooter needs.",
      "Placeholder copy; replaced with real wording from the CMS.",
    ],
    coverMedia: mockImages.openMarsh,
    startingPrice: "From 1 400 €",
    pricing: [
      {
        name: "Essential",
        price: "From 1 400 €",
        note: "Six hours of coverage, online gallery.",
      },
      {
        name: "Full day",
        price: "2 200 €",
        note: "Up to twelve hours, second shooter, printed album.",
      },
    ],
  },
  {
    serviceId: "events",
    language: "en",
    // Intentionally has no cover media: the card must render cleanly without one.
    slug: "events",
    name: "Events",
    shortDescription:
      "Coverage for corporate events, parties, and celebrations of every size.",
    description: [
      "Reliable, flexible coverage that documents the atmosphere and the key moments of your event. Pricing depends on duration and scope.",
      "Placeholder copy; replaced with real wording from the CMS.",
    ],
    startingPrice: "From 350 €",
    pricing: [
      {
        name: "Hourly",
        price: "From 350 €",
        note: "Minimum two hours, online gallery.",
      },
    ],
  },
  {
    serviceId: "commercial",
    language: "en",
    // Intentionally has no pricing: the card and detail page must omit price gracefully.
    slug: "commercial",
    name: "Commercial & brand",
    shortDescription:
      "Product, interior, and brand imagery tailored to your project.",
    description: [
      "Commissioned photography for businesses — product shoots, interiors, team portraits, and brand campaigns. Every project is scoped and quoted individually, so there is no fixed price list.",
      "Get in touch with a brief and I'll prepare a tailored proposal. Placeholder copy; replaced with real wording from the CMS.",
    ],
    coverMedia: mockImages.lakesideReeds,
  },
];

function defaultLanguage(): string {
  return new Intl.Locale(getDeploymentConfig().locale).language;
}

/** The service document contract stores an ISO language subtag, not a BCP 47 locale. */
function toServiceLanguage(localeOrLanguage: string): string {
  return new Intl.Locale(localeOrLanguage).language;
}

/**
 * The generic fixture supplies the same scaffold catalog in every configured
 * language. Production reads one authored document set per language from
 * Sanity; the fixture deliberately has no photographer-specific translations.
 */
function mockServicesForLanguage(language: string): Service[] {
  return mockServices.map((service) => ({ ...service, language }));
}

export async function getServices(language = defaultLanguage()): Promise<Service[]> {
  const serviceLanguage = toServiceLanguage(language);
  const { contentSource } = getDeploymentConfig();
  return dispatchContentSource(contentSource, {
    // See dispatchContentSource's own doc comment for why this import is dynamic.
    sanity: async () => {
      const { readPublicServices } = await import("@/lib/sanity-services");
      return [...(await readPublicServices({ language: serviceLanguage }))];
    },
    mock: async () => mockServicesForLanguage(serviceLanguage),
  });
}

/**
 * Short intro shown above the services listing, when authored. Not sourced
 * independently of site settings: `siteSettings.servicesIntro` is where it
 * lives (mirrors the home intro's own field on `homePage`), so this is a
 * proxy rather than its own mock/Sanity dispatch.
 */
export async function getServicesIntro(): Promise<string | undefined> {
  return (await getSiteSettings()).servicesIntro;
}

export async function getService(
  slug: string,
  language = defaultLanguage(),
): Promise<Service | undefined> {
  const serviceLanguage = toServiceLanguage(language);
  const { contentSource } = getDeploymentConfig();
  return dispatchContentSource(contentSource, {
    sanity: async () => {
      const { readPublicServiceBySlug } = await import("@/lib/sanity-services");
      return readPublicServiceBySlug(slug, { language: serviceLanguage });
    },
    mock: async () =>
      mockServicesForLanguage(serviceLanguage).find((service) => service.slug === slug),
  });
}

/** One locale's catalog with its canonical nested paths resolved. */
export async function getServiceRoutes(
  language = defaultLanguage(),
): Promise<readonly ResolvedService[]> {
  const serviceLanguage = toServiceLanguage(language);
  return buildServiceRoutes(
    await getServices(serviceLanguage),
    serviceLanguage,
  );
}

/** One exact nested service path in its locale, or no published service. */
export async function getServiceRoute(
  segments: readonly string[],
  language = defaultLanguage(),
): Promise<ResolvedService | undefined> {
  return findServiceRoute(await getServiceRoutes(language), segments);
}

/**
 * Every published locale version of a service identity. A service that has
 * not been authored in another locale simply has no link or `hreflang` there;
 * this method never substitutes a different-language document.
 */
export async function getServiceLocaleVersions(
  serviceId: string,
): Promise<readonly LocaleVersion[]> {
  const { localeRoutes } = getDeploymentConfig();
  const routesByLocale = await Promise.all(
    localeRoutes.locales.map(async (localeRoute) => ({
      locale: localeRoute.locale,
      routes: await getServiceRoutes(localeRoute.locale),
    })),
  );

  return routesByLocale.flatMap(({ locale, routes }) => {
    const route = routes.find((candidate) => candidate.service.serviceId === serviceId);
    return route === undefined
      ? []
      : [{ locale, path: buildServicePath(localeRoutes, locale, route.path) }];
  });
}

/** Every locale whose public service listing has at least one service. */
export async function getServiceListingLocaleVersions(): Promise<
  readonly LocaleVersion[]
> {
  const { localeRoutes } = getDeploymentConfig();
  const routesByLocale = await Promise.all(
    localeRoutes.locales.map(async (localeRoute) => ({
      locale: localeRoute.locale,
      routes: await getServiceRoutes(localeRoute.locale),
    })),
  );
  return routesByLocale.flatMap(({ locale, routes }) =>
    routes.length === 0
      ? []
      : [{ locale, path: buildServicePath(localeRoutes, locale) }],
  );
}
