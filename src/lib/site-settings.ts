/**
 * Site-wide settings: all brand, contact, and navigation data lives here,
 * never hardcoded in components. Currently backed by mock data; will be
 * served by the CMS (Sanity) once integrated, which is why the accessor
 * is async.
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

export type ContactInfo = {
  email: string;
  phone?: string;
  address?: string;
  /** Business ID (e.g. Finnish Y-tunnus), shown in the footer */
  businessId?: string;
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

const mockSiteSettings: SiteSettings = {
  siteName: "Studio Example",
  photographerName: "Jane Example",
  tagline: "Timeless photography for life's important moments",
  // Only routes that exist are listed. "About" and "Contact" are added here
  // once those pages land (contact form: AB#12) — a nav entry without a route
  // is a 404 on every page of the site.
  navigation: [
    { label: "Home", href: "/" },
    { label: "Services", href: "/services" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "Blog", href: "/blog" },
  ],
  contact: {
    email: "hello@studio-example.com",
    phone: "+358 40 123 4567",
    address: "Example Street 1, 00100 Helsinki",
    businessId: "1234567-8",
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
    { label: "Services", href: "/services" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "Blog", href: "/blog" },
  ],
  copyrightHolder: "Studio Example",
  defaultSeo: {
    titleTemplate: "%s | Studio Example",
    description:
      "Professional photography services: portraits, weddings, events, and more.",
  },
};

export async function getSiteSettings(): Promise<SiteSettings> {
  return mockSiteSettings;
}
