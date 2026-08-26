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

import { getDeploymentConfig } from "@/lib/deployment-config";
import type { Media } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";
import { getSiteSettings } from "@/lib/site-settings";

export type ServicePricePackage = {
  /** Package name, e.g. "Half day", "Full day". */
  name: string;
  /** Display price, e.g. "From € 450" or "€ 900" — formatted in content, not derived. */
  price: string;
  /** Optional one-line note about what the package includes. */
  note?: string;
};

export type Service = {
  /** URL segment under /services/<slug>. */
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

/**
 * Services carry no locale of their own (see the module comment), so the
 * language passed to the Sanity adapter exists only to resolve a referenced
 * cover photograph's alt text and caption — the deployment's own default
 * locale, matching the still-unlocalized `/services` route.
 */
function defaultLanguage(): string {
  return new Intl.Locale(getDeploymentConfig().locale).language;
}

export async function getServices(): Promise<Service[]> {
  const { contentSource } = getDeploymentConfig();
  if (contentSource === "sanity") {
    // Dynamic, not a static top-level import: `sanity-services.ts` carries
    // the `server-only` marker, and a static import would pull it into this
    // module's graph unconditionally — reachable from e2e Playwright specs
    // (e.g. `getServices` imported directly for fixture data), which run
    // outside Next's own bundler and cannot satisfy that package's
    // build-time "react-server" export condition. Loading it only once the
    // sanity branch actually runs means the mock path never touches it.
    const { readPublicServices } = await import("@/lib/sanity-services");
    return [...(await readPublicServices({ language: defaultLanguage() }))];
  }
  return mockServices;
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

export async function getService(slug: string): Promise<Service | undefined> {
  const { contentSource } = getDeploymentConfig();
  if (contentSource === "sanity") {
    const { readPublicServiceBySlug } = await import("@/lib/sanity-services");
    return readPublicServiceBySlug(slug, { language: defaultLanguage() });
  }
  return mockServices.find((service) => service.slug === slug);
}
