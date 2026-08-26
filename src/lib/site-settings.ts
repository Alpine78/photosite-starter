import {
  getDefaultLocaleLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { buildStoryPath } from "@/lib/locale-routes";
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
  email: string;
  phone?: string;
  address?: string;
  /** Business ID (e.g. Finnish Y-tunnus), shown in the footer */
  businessId?: string;
  /** Shown on the contact form, above the send button. */
  privacyNotice: ContactPrivacyNotice;
};

export type DefaultSeo = {
  /** Used as <title> suffix: "Page name | siteName" */
  titleTemplate: string;
  description: string;
};

export type SiteSettings = {
  siteName: string;
  photographerName: string;
  /** Short tagline shown e.g. in the home page hero */
  tagline: string;
  /**
   * Short intro shown above the `/services` listing. Absent when a
   * deployment has not authored one; the page omits the paragraph and
   * `getPageMetadata` falls back to `defaultSeo.description` rather than
   * inventing one.
   */
  servicesIntro?: string;
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
function buildMockSiteSettings(): SiteSettings {
  const labels = getDefaultLocaleLabels();
  const { localeRoutes } = getDeploymentConfig();
  // The public content tree's root in the unprefixed route space. Composed from
  // the configured namespace rather than written out, so a deployment that
  // routes its stories elsewhere does not leave a dead link in the chrome.
  const storyRoot = buildStoryPath(localeRoutes, localeRoutes.defaultLocale);

  return {
    siteName: "Studio Example",
    photographerName: "Jane Example",
    tagline: "Timeless photography for life's important moments",
    servicesIntro:
      "An overview of what I offer and how we can work together. Placeholder copy; replaced with real wording from the CMS.",
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
      { label: labels.pages.services, href: "/services" },
      { label: labels.pages.portfolio, featured: true },
      { label: labels.pages.stories, href: storyRoot },
      { label: labels.pages.contact, href: "/contact" },
    ],
    contact: {
      email: "hello@studio-example.com",
      phone: "+358 40 123 4567",
      address: "Example Street 1, 00100 Helsinki",
      businessId: "1234567-8",
      // Placeholder wording, like every other value in this mock layer. A clone
      // replaces it with what its own deployment actually does — the processor
      // it configured, the mailbox that receives enquiries, and the retention it
      // keeps — before it publishes the form.
      privacyNotice: {
        collected: "Your name, email address, and message.",
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
      { label: labels.pages.services, href: "/services" },
      { label: labels.pages.portfolio, featured: true },
      { label: labels.pages.stories, href: storyRoot },
      { label: labels.pages.contact, href: "/contact" },
    ],
    copyrightHolder: "Studio Example",
    defaultSeo: {
      titleTemplate: "%s | Studio Example",
      description:
        "Professional photography services: portraits, weddings, events, and more.",
    },
  };
}

/**
 * Settings are not yet locale-aware (AGENTS.md's "not yet built" note): every
 * source reads this deployment's own default locale regardless of which
 * route space asked, matching `buildMockSiteSettings`'s existing behavior.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  const { contentSource, locale, localeRoutes } = getDeploymentConfig();

  if (contentSource === "sanity") {
    // Dynamic, not static: `sanity-site-settings.ts` carries the
    // `server-only` marker, and a static import would pull it into this
    // seam's module graph unconditionally — including from contexts (e2e
    // Playwright specs, which run outside Next's own bundler) that cannot
    // satisfy that package's build-time "react-server" export condition.
    const { readSanitySiteSettings } = await import(
      "@/lib/sanity-site-settings"
    );
    const language = new Intl.Locale(locale).language;
    return readSanitySiteSettings({ language, locale, config: localeRoutes });
  }

  return buildMockSiteSettings();
}
