/**
 * Services content: the list of services offered, each with its own detail
 * page. Mock data for now; will be served by the CMS once integrated, which
 * is why the accessors are async — mirrors src/lib/site-settings.ts and
 * src/lib/home-content.ts.
 *
 * Generic by design: no real photographer's service names, prices, or copy
 * are baked into the template. Both the cover image and pricing are optional
 * per service, so a card renders cleanly with or without them.
 *
 * Covers are never cropped, so a card is as tall as its cover's native ratio
 * makes it. In a multi-column card grid that means wildly different ratios
 * (a 2:3 portrait beside a 3:2 landscape) tear large gaps into the rows.
 * Keep demo covers within a similar ratio range; tall frames belong in the
 * portfolio masonry and in article bodies, which are single-column.
 */

import type { Media } from "@/lib/media";

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
    coverMedia: {
      type: "image",
      src: "/gallery/coastal-landscape.webp",
      alt: "Rocky shoreline beside calm water under an overcast sky",
      width: 1536,
      height: 1024,
    },
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
    coverMedia: {
      type: "image",
      src: "/gallery/open-marsh.webp",
      alt: "Reflective water channel winding through an open marsh",
      width: 1536,
      height: 1024,
    },
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
    coverMedia: {
      type: "image",
      src: "/gallery/lakeside-reeds.webp",
      alt: "Golden reeds moving beside blue lake water",
      width: 1254,
      height: 1254,
    },
  },
];

/**
 * Short intro shown above the services listing. Placeholder copy lives here,
 * not in the component, so the CMS can replace it — mirrors the home intro.
 */
const mockServicesIntro =
  "An overview of what I offer and how we can work together. Placeholder copy; replaced with real wording from the CMS.";

export async function getServices(): Promise<Service[]> {
  return mockServices;
}

export async function getServicesIntro(): Promise<string> {
  return mockServicesIntro;
}

export async function getService(slug: string): Promise<Service | undefined> {
  return mockServices.find((service) => service.slug === slug);
}
