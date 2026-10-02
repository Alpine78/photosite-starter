import { cache } from "react";

import type { ContactCallToAction } from "@/lib/contact-call-to-action";
import type { GalleryPresentationFields } from "@/lib/gallery-presentation";
import type { ImageMedia } from "@/lib/media";
import { getMockImages, mockSiteMark, mockSiteMarkDark } from "@/lib/mock-media";
import { dispatchContentSource } from "@/lib/content-source";
import {
  getDefaultLocaleLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { buildServicePath, buildStoryPath } from "@/lib/locale-routes";
import type { StaticNavigationLink } from "@/lib/site-navigation";

/**
 * Site-wide brand, contact, and navigation settings live here, never
 * hardcoded in components. The async accessor below dispatches between the
 * fixture layer and the authored Sanity singleton without exposing either
 * implementation to a route or component.
 */

/**
 * One authored menu or footer entry: a static route path, or the stable
 * identity of one featured content page. `site-navigation.ts` resolves the
 * second into this locale's canonical route, so settings never carry a
 * deployment-specific content path that a rename or translation would break.
 */
export type NavigationItem = StaticNavigationLink;

export type SocialLink = {
  /** Platform identifier, e.g. "instagram", "facebook", "youtube" */
  platform: string;
  url: string;
  /** Accessible name for the link, e.g. "Studio Example on Instagram" */
  label: string;
};

/**
 * What the contact form tells a visitor about their own message, before they
 * send it.
 *
 * Authored per deployment rather than written into the form, because the true
 * answers differ by clone: a different delivery processor, a different mailbox,
 * a different retention practice. The application supplies the headings from
 * its built-in labels and the structure of the notice; the words describing
 * this deployment's actual processing are content, and a clone that does not
 * replace them is publishing a claim about someone else's setup.
 *
 * Deliberately four plain statements rather than a legal document: the project
 * hardcodes no customer legal text, and a privacy policy page — if a
 * deployment has one — is linked from content, not generated here.
 */
export type ContactPrivacyNotice = {
  /** Which fields the form collects. */
  collected: string;
  /** Why they are collected. */
  purpose: string;
  /** Who receives the message, including any processor that carries it. */
  recipient: string;
  /** How long it is kept, and by whom. */
  retention: string;
};

export type ContactInfo = {
  /** Optional public web portrait in the contact page's side column. */
  portrait?: ImageMedia;
  email: string;
  phone?: string;
  address?: string;
  /** Business ID (e.g. Finnish Y-tunnus), shown in the footer */
  businessId?: string;
  /** Shown on the contact form, above the send button. */
  privacyNotice: ContactPrivacyNotice;
};

export type DefaultSeo = {
  /**
   * The default locale's <title> template, "Page name | siteName";
   * `resolveTitleTemplate` picks a rendered locale's.
   */
  titleTemplate: string;
  /**
   * The template in every language it is authored in, keyed by language
   * subtag. Holds the default locale's language; another language without its
   * own entry uses `titleTemplate`.
   */
  titleTemplates: Readonly<Record<string, string>>;
  description: string;
};

/**
 * Where the header's small descriptor line reads relative to the name.
 * Restated in `sanity/schemas/site-settings.ts`; a test pins the two equal.
 */
export const BRAND_DESCRIPTOR_POSITIONS = ["before", "after"] as const;

/**
 * The header brand's small line in one language (AB#187): "Valokuvaaja"
 * before the name in Finnish, "Photography" after it in English. Its position
 * is authored rather than derived from the language, so a clone decides how
 * its own languages read.
 */
export type BrandDescriptor = {
  text: string;
  position: (typeof BRAND_DESCRIPTOR_POSITIONS)[number];
};

export type SiteSettings = GalleryPresentationFields & {
  /**
   * The default locale's site name: the name on surfaces that only the default
   * locale renders (the home page heading, its structured data, and the
   * notification emails the owner receives). `resolveSiteName` picks the name
   * for a surface rendered in a given locale.
   */
  siteName: string;
  /**
   * The site name in every language it is authored in, keyed by language
   * subtag (AB#187). A photographer's name commonly reads differently per
   * language ("Valokuvaaja …" beside "… Photography"), so this is authored
   * text rather than a language-neutral identity. Holds the default locale's
   * language; another language without its own entry uses `siteName`.
   */
  siteNames: Readonly<Record<string, string>>;
  /**
   * Optional brand mark shown beside the site name in the header (AB#187),
   * at its native ratio. Decorative there: the visible site name already
   * names the link, so the header never reads its alternative text.
   */
  logo?: ImageMedia;
  /**
   * Optional variant of `logo` for the dark theme, for a mark that does not
   * read on a dark ground. Only ever set alongside `logo`.
   */
  logoDark?: ImageMedia;
  /**
   * The header brand's descriptor line per language subtag (AB#187). A
   * language without one shows its site name on one line instead: a
   * descriptor in another language would put the wrong language in the
   * brand, so there is deliberately no fallback here.
   */
  brandDescriptors: Readonly<Record<string, BrandDescriptor>>;
  photographerName: string;
  /** Short tagline shown e.g. in the home page hero */
  tagline: string;
  /**
   * Short intro shown above the configured services listing. Absent when a
   * deployment has not authored one; the page omits the paragraph and
   * `getPageMetadata` falls back to `defaultSeo.description` rather than
   * inventing one.
   */
  servicesIntro?: string;
  servicesContactCallToAction?: ContactCallToAction;
  navigation: NavigationItem[];
  /**
   * The curated gallery this deployment features as its portfolio, by stable
   * content identity — the single source for every surface that shows it.
   * Absent when a clone features none, which drops the featured entries rather
   * than inventing a destination for them. An identity that names something
   * other than a published gallery drops them too.
   */
  featuredGalleryId?: string;
  contact: ContactInfo;
  socialLinks: SocialLink[];
  /** Footer quick links; often a subset of navigation */
  footerLinks: NavigationItem[];
  copyrightHolder: string;
  defaultSeo: DefaultSeo;
};

/**
 * The curated gallery this deployment shows as its portfolio. A stable content
 * identity, not a path: the header, footer, and home page resolve it per locale
 * through the content tree, so moving or renaming the gallery — or publishing a
 * Finnish slug beside the English one — moves every link with it. A clone
 * replaces this with its own gallery's identity when it authors content.
 *
 * It is written once. Every surface that features the gallery marks its entry
 * `featured` and receives this identity from the setting below, so no two of
 * them can end up pointing at different galleries.
 */
const FEATURED_GALLERY_ID = "content-selected-work";

/**
 * Built lazily rather than as a module constant: the page labels below are
 * resolved from the deployment's configured locale, and reading that
 * configuration at import time would fail every context that has no deployment
 * environment.
 */
function mockServicesContactCallToAction(locale: string): ContactCallToAction {
  return new Intl.Locale(locale).language === "fi"
    ? { heading: "Etkö löytänyt sopivaa?", text: "Kerro mitä tarvitset, niin suunnittelemme palvelun yhdessä." }
    : { heading: "Looking for something else?", text: "Tell me what you need and we can plan a service that fits." };
}

/**
 * Fixture header descriptors, Finnish before the name and English after it,
 * the way the design proposal reads in each language.
 */
const MOCK_BRAND_DESCRIPTORS: Readonly<Record<string, BrandDescriptor>> = {
  en: { text: "Photography", position: "after" },
  fi: { text: "Valokuvaaja", position: "before" },
};

/**
 * Fixture brand names per language: the descriptor and the photographer name
 * read together, as the header shows them, so a prefixed locale's header and
 * title visibly differ from the default one. Placeholders like every other
 * value here; a deployment authors its own in site settings.
 */
const MOCK_SITE_NAMES: Readonly<Record<string, string>> = {
  en: "Jane Example Photography",
  fi: "Valokuvaaja Jane Example",
};

function buildMockSiteSettings(): SiteSettings {
  const labels = getDefaultLocaleLabels();
  const { localeRoutes } = getDeploymentConfig();
  const defaultLanguage = new Intl.Locale(localeRoutes.defaultLocale).language;
  const siteName = MOCK_SITE_NAMES[defaultLanguage] ?? MOCK_SITE_NAMES.en;
  const titleTemplates = Object.fromEntries(
    Object.entries(MOCK_SITE_NAMES).map(([language, name]) => [language, `%s | ${name}`]),
  );
  // The public content tree's root in the unprefixed route space. Composed from
  // the configured namespace rather than written out, so a deployment that
  // routes its stories elsewhere does not leave a dead link in the chrome.
  const storyRoot = buildStoryPath(localeRoutes, localeRoutes.defaultLocale);
  const serviceRoot = buildServicePath(
    localeRoutes,
    localeRoutes.defaultLocale,
  );

  return {
    siteName,
    siteNames: { ...MOCK_SITE_NAMES, [defaultLanguage]: siteName },
    logo: mockSiteMark,
    logoDark: mockSiteMarkDark,
    brandDescriptors: MOCK_BRAND_DESCRIPTORS,
    photographerName: "Jane Example",
    tagline: "Timeless photography for life's important moments",
    servicesIntro:
      "An overview of what I offer and how we can work together. Placeholder copy; replaced with real wording from the CMS.",
    servicesContactCallToAction: mockServicesContactCallToAction(localeRoutes.defaultLocale),
    featuredGalleryId: FEATURED_GALLERY_ID,
    // These labels describe application-owned static routes, so they come from
    // deployment config rather than authored CMS content. Only routes that exist
    // are listed; a nav entry without a route is a 404 on every page of the site.
    // "About" is added once that page lands.
    //
    // The story-root entry is the one exception: `buildSiteNavigation` does not
    // render it as a link. Settings own where the content section sits in the
    // menu and what it is called, while the route it opens and every category
    // beneath it come from the route config and the tree (ADR-0003). A clone
    // that drops the entry still gets the section — at the end of the menu.
    navigation: [
      { label: labels.pages.home, href: "/" },
      { label: labels.pages.services, href: serviceRoot },
      { label: labels.pages.portfolio, featured: true },
      { label: labels.pages.stories, href: storyRoot },
      { label: labels.pages.contact, href: "/contact" },
    ],
    contact: {
      portrait: getMockImages(new Intl.Locale(localeRoutes.defaultLocale).language).photographerIntroduction,
      email: "hello@studio-example.com",
      phone: "+358 40 123 4567",
      address: "Example Street 1, 00100 Helsinki",
      businessId: "1234567-8",
      // Placeholder wording, like every other value in this mock layer. A clone
      // replaces it with what its own deployment actually does — the processor
      // it configured, the mailbox that receives enquiries, and the retention it
      // keeps — before it publishes the form.
      privacyNotice: {
        collected: "Your name, email address, message, subject, and any phone number or preferred date you provide.",
        purpose:
          "Answering your enquiry. Nothing is used for marketing or profiling.",
        recipient:
          "Studio Example, delivered by our email provider. The message is not stored by this website.",
        retention:
          "Kept in our mailbox for as long as answering you requires, then deleted.",
      },
    },
    socialLinks: [
      {
        platform: "instagram",
        url: "https://instagram.com/studioexample",
        label: "Studio Example on Instagram",
      },
      {
        platform: "facebook",
        url: "https://facebook.com/studioexample",
        label: "Studio Example on Facebook",
      },
    ],
    footerLinks: [
      { label: labels.pages.services, href: serviceRoot },
      { label: labels.pages.portfolio, featured: true },
      { label: labels.pages.stories, href: storyRoot },
      { label: labels.pages.contact, href: "/contact" },
    ],
    copyrightHolder: "Studio Example",
    defaultSeo: {
      titleTemplate: `%s | ${siteName}`,
      titleTemplates: { ...titleTemplates, [defaultLanguage]: `%s | ${siteName}` },
      description:
        "Professional photography services: portraits, weddings, events, and more.",
    },
  };
}

/** One language's entry of a per-language settings value, else the default's. */
function forLocale(
  byLanguage: Readonly<Record<string, string>>,
  fallback: string,
  locale: string,
): string {
  return byLanguage[new Intl.Locale(locale).language] ?? fallback;
}

/** The site name a surface rendered in `locale` shows (AB#187). */
export function resolveSiteName(
  settings: Pick<SiteSettings, "siteName" | "siteNames">,
  locale: string,
): string {
  return forLocale(settings.siteNames, settings.siteName, locale);
}

/**
 * The header descriptor for `locale`, or none when that language has none of
 * its own (AB#187). Never another language's: see `brandDescriptors`.
 */
export function resolveBrandDescriptor(
  settings: Pick<SiteSettings, "brandDescriptors">,
  locale: string,
): BrandDescriptor | undefined {
  return settings.brandDescriptors[new Intl.Locale(locale).language];
}

/** The <title> template a page rendered in `locale` uses (AB#187). */
export function resolveTitleTemplate(
  settings: Pick<SiteSettings, "defaultSeo">,
  locale: string,
): string {
  return forLocale(
    settings.defaultSeo.titleTemplates,
    settings.defaultSeo.titleTemplate,
    locale,
  );
}

/**
 * Settings are not yet locale-aware (`docs/feature-status.md`): every
 * source reads this deployment's own default locale regardless of which
 * route space asked, matching `buildMockSiteSettings`'s existing behavior.
 * The brand is the exception (AB#187): `siteNames` and
 * `defaultSeo.titleTemplates` carry every authored language from this same
 * read, and `resolveSiteName`/`resolveTitleTemplate` pick one per locale.
 *
 * Wrapped in React's `cache()` (AB#139): this singleton is read from several
 * independent seams within one request — the site chrome layout
 * (`site-root.tsx`), page metadata (`page-metadata.ts`), and page-specific
 * content (`home-content.ts`, `services.ts`) each call this with no
 * coordination between them. `sanity-client.ts` attaches an `AbortSignal` to
 * every fetch, which per Next.js's own documentation opts every one of those
 * reads out of the framework's automatic per-render fetch memoization, so
 * without this `cache()` wrapper each call independently repeats the same
 * live Sanity read — up to several times for one page view, and with no
 * shared result if one of them races a webhook-driven cache invalidation
 * differently than another. Mirrors `content.ts`'s `buildSanityPublicContent`,
 * which documents the same reasoning for the same class of seam.
 *
 * The dedup itself is not, and cannot be, asserted by this project's own
 * Vitest suite: `cache()` only memoizes within an actual React render, and
 * Vitest provides none. Verified directly while building this fix: calling a
 * `cache()`-wrapped function concurrently outside of a render — exactly what
 * a plain Vitest test does — runs its body once per call with no
 * memoization at all, since there is no render for React to scope a cache
 * to. The fix still holds where it matters, a real Next.js Server Component
 * render, the same way `content.ts`'s own equally Vitest-unverifiable
 * `cache()` usage already does; this file's own tests cover the dispatch
 * logic (which source, which arguments) rather than the dedup itself.
 *
 * A real integration test would need to render inside an actual React
 * Server Components tree — `cache()` is an RSC-only primitive, not a plain
 * SSR one, so a `react-dom/server` render does not provide it either. This
 * repository has no such harness today (no `@testing-library/react`, no
 * `react-server-dom-*` usage anywhere), and standing one up for this one
 * assertion — with no existing precedent to build on — is a disproportionate
 * amount of new, fragile test infrastructure for a fix whose dispatch
 * behavior is otherwise already fully covered. Deliberately left
 * unattempted rather than reached for.
 *
 * Caching the mock branch too is harmless: `buildMockSiteSettings()` is
 * already pure and deterministic, so memoizing it changes nothing
 * observable.
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  const { contentSource, locale, localeRoutes } = getDeploymentConfig();

  return dispatchContentSource(contentSource, {
    // See dispatchContentSource's own doc comment for why this import is dynamic.
    sanity: async () => {
      const { readSanitySiteSettings } = await import(
        "@/lib/sanity-site-settings"
      );
      const language = new Intl.Locale(locale).language;
      return readSanitySiteSettings({ language, locale, config: localeRoutes });
    },
    mock: async () => buildMockSiteSettings(),
  });
});

/** The optional services band in a requested locale, independent of global settings copy. */
export async function getServicesContactCallToAction(
  locale: string,
): Promise<ContactCallToAction | undefined> {
  const deployment = getDeploymentConfig();
  if (locale === deployment.localeRoutes.defaultLocale) {
    return (await getSiteSettings()).servicesContactCallToAction;
  }
  return dispatchContentSource(deployment.contentSource, {
    sanity: async () => {
      const { readSanityServicesContactCallToAction } = await import(
        "@/lib/sanity-site-settings"
      );
      return readSanityServicesContactCallToAction(new Intl.Locale(locale).language);
    },
    mock: async () => mockServicesContactCallToAction(locale),
  });
}
