import { getDefaultLocaleLabels } from "@/lib/deployment-config";

/**
 * Site-wide brand, contact, and navigation settings live here, never
 * hardcoded in components. Currently backed by mock data; authored values
 * will be served by the CMS (Sanity) once integrated, which is why the
 * accessor is async.
 */

export type NavigationItem = {
  label: string;
  href: string;
};

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
  navigation: NavigationItem[];
  contact: ContactInfo;
  socialLinks: SocialLink[];
  /** Footer quick links; often a subset of navigation */
  footerLinks: NavigationItem[];
  copyrightHolder: string;
  defaultSeo: DefaultSeo;
};

/**
 * Built lazily rather than as a module constant: the page labels below are
 * resolved from the deployment's configured locale, and reading that
 * configuration at import time would fail every context that has no deployment
 * environment.
 */
function buildMockSiteSettings(): SiteSettings {
  const labels = getDefaultLocaleLabels();

  return {
    siteName: "Studio Example",
    photographerName: "Jane Example",
    tagline: "Timeless photography for life's important moments",
    // These labels describe application-owned static routes, so they come from
    // deployment config rather than authored CMS content. Only routes that exist
    // are listed; a nav entry without a route is a 404 on every page of the site.
    // "About" is added once that page lands.
    navigation: [
      { label: labels.pages.home, href: "/" },
      { label: labels.pages.services, href: "/services" },
      { label: labels.pages.portfolio, href: "/portfolio" },
      { label: labels.pages.blog, href: "/blog" },
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
      { label: labels.pages.portfolio, href: "/portfolio" },
      { label: labels.pages.blog, href: "/blog" },
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

export async function getSiteSettings(): Promise<SiteSettings> {
  return buildMockSiteSettings();
}
