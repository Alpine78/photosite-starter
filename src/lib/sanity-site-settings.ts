/** Published Sanity site settings projected into the project's own contract. */

import "server-only";

import type { LocaleRouteConfig } from "@/lib/locale-routes";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { isRecord } from "@/lib/sanity-values";
import {
  projectNavigationItems,
  readLocalizedText,
  readOptionalLocalizedText,
  readOptionalString,
  readRequiredString,
} from "@/lib/sanity-site-values";
import type { SiteSettings, SocialLink } from "@/lib/site-settings";

export const SITE_SETTINGS_DOCUMENT_TYPE = "siteSettings";

export const PROJECTED_SITE_SETTINGS_FIELDS = [
  "siteName",
  "photographerName",
  "tagline",
  "featuredGalleryId",
  "navigation",
  "contact",
  "socialLinks",
  "footerLinks",
  "copyrightHolder",
  "defaultSeo",
] as const;

export const SITE_SETTINGS_PROJECTION = `{
  siteName,
  photographerName,
  tagline[]{language, value},
  featuredGalleryId,
  navigation[]{label[]{language, value}, target, href},
  contact{
    email,
    phone,
    address[]{language, value},
    businessId,
    privacyNotice{
      collected[]{language, value},
      purpose[]{language, value},
      recipient[]{language, value},
      retention[]{language, value}
    }
  },
  socialLinks[]{platform, url, label[]{language, value}},
  footerLinks[]{label[]{language, value}, target, href},
  copyrightHolder,
  defaultSeo{
    titleTemplate[]{language, value},
    description[]{language, value}
  }
}`;

export type SanitySiteSettingsRejection =
  | "missing-document"
  | "ambiguous-document"
  | "incomplete-document"
  | "invalid-navigation"
  | "malformed-result";

export class SanitySiteSettingsError extends Error {
  readonly rejection: SanitySiteSettingsRejection;

  constructor(rejection: SanitySiteSettingsRejection, detail: string) {
    super(`[sanity-site-settings] ${detail}`);
    this.name = "SanitySiteSettingsError";
    this.rejection = rejection;
  }
}

export type RawSiteSettingsDocument = Readonly<Record<string, unknown>>;

const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLATFORM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@,;:<>"'\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu;

function readRecord(
  value: unknown,
  field: string,
  reject: (detail: string) => never,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) reject(`${field} is missing or malformed`);
  return value;
}

function readHttpsUrl(
  value: unknown,
  field: string,
  reject: (detail: string) => never,
): string {
  const url = readRequiredString(value, field, reject);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    reject(`${field} is not a URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    reject(`${field} is not a public HTTPS URL without credentials or a fragment`);
  }
  return url;
}

function readSocialLinks(
  value: unknown,
  language: string,
  reject: (detail: string) => never,
): readonly SocialLink[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    reject("socialLinks is not a list");
  }

  const platforms = new Set<string>();
  return value.map((link, index) => {
    const platform = readRequiredString(
      link.platform,
      `socialLinks[${index}].platform`,
      reject,
    );
    if (!PLATFORM_ID.test(platform) || platforms.has(platform)) {
      reject(`socialLinks has an invalid or repeated platform "${platform}"`);
    }
    platforms.add(platform);
    return {
      platform,
      url: readHttpsUrl(link.url, `socialLinks[${index}].url`, reject),
      label: readLocalizedText(
        link.label,
        language,
        `socialLinks[${index}].label`,
        reject,
      ),
    };
  });
}

export function projectSiteSettings(
  document: RawSiteSettingsDocument,
  options: {
    readonly language: string;
    readonly locale: string;
    readonly config: LocaleRouteConfig;
  },
): SiteSettings {
  const rejectIncomplete = (detail: string): never => {
    throw new SanitySiteSettingsError("incomplete-document", detail);
  };
  const rejectNavigation = (detail: string): never => {
    throw new SanitySiteSettingsError("invalid-navigation", detail);
  };

  const featuredGalleryId = readOptionalString(
    document.featuredGalleryId,
    "featuredGalleryId",
    rejectIncomplete,
  );
  if (featuredGalleryId !== undefined && !CONTENT_ID.test(featuredGalleryId)) {
    rejectIncomplete("featuredGalleryId is not a stable content identity");
  }

  const navigation = projectNavigationItems(document.navigation, {
    ...options,
    field: "navigation",
    reject: rejectNavigation,
  });
  const footerLinks = projectNavigationItems(document.footerLinks, {
    ...options,
    field: "footerLinks",
    reject: rejectNavigation,
  });
  if (
    featuredGalleryId === undefined &&
    [...navigation, ...footerLinks].some((item) => item.featured === true)
  ) {
    rejectNavigation("a featured-gallery link exists without featuredGalleryId");
  }

  const contact = readRecord(document.contact, "contact", rejectIncomplete);
  const privacy = readRecord(
    contact.privacyNotice,
    "contact.privacyNotice",
    rejectIncomplete,
  );
  const email = readRequiredString(contact.email, "contact.email", rejectIncomplete);
  if (email.length > 254 || !EMAIL.test(email)) {
    rejectIncomplete("contact.email is not a usable email address");
  }

  const defaultSeo = readRecord(
    document.defaultSeo,
    "defaultSeo",
    rejectIncomplete,
  );
  const titleTemplate = readLocalizedText(
    defaultSeo.titleTemplate,
    options.language,
    "defaultSeo.titleTemplate",
    rejectIncomplete,
  );
  if ((titleTemplate.match(/%s/g) ?? []).length !== 1) {
    rejectIncomplete("defaultSeo.titleTemplate must contain exactly one %s placeholder");
  }
  const phone = readOptionalString(contact.phone, "contact.phone", rejectIncomplete);
  const address = readOptionalLocalizedText(
    contact.address,
    options.language,
    "contact.address",
    rejectIncomplete,
  );
  const businessId = readOptionalString(
    contact.businessId,
    "contact.businessId",
    rejectIncomplete,
  );

  return {
    siteName: readRequiredString(document.siteName, "siteName", rejectIncomplete),
    photographerName: readRequiredString(
      document.photographerName,
      "photographerName",
      rejectIncomplete,
    ),
    tagline: readLocalizedText(
      document.tagline,
      options.language,
      "tagline",
      rejectIncomplete,
    ),
    navigation: [...navigation],
    ...(featuredGalleryId === undefined ? {} : { featuredGalleryId }),
    contact: {
      email,
      ...(phone === undefined ? {} : { phone }),
      ...(address === undefined ? {} : { address }),
      ...(businessId === undefined ? {} : { businessId }),
      privacyNotice: {
        collected: readLocalizedText(privacy.collected, options.language, "contact.privacyNotice.collected", rejectIncomplete),
        purpose: readLocalizedText(privacy.purpose, options.language, "contact.privacyNotice.purpose", rejectIncomplete),
        recipient: readLocalizedText(privacy.recipient, options.language, "contact.privacyNotice.recipient", rejectIncomplete),
        retention: readLocalizedText(privacy.retention, options.language, "contact.privacyNotice.retention", rejectIncomplete),
      },
    },
    socialLinks: [...readSocialLinks(document.socialLinks, options.language, rejectIncomplete)],
    footerLinks: [...footerLinks],
    copyrightHolder: readRequiredString(
      document.copyrightHolder,
      "copyrightHolder",
      rejectIncomplete,
    ),
    defaultSeo: {
      titleTemplate,
      description: readLocalizedText(
        defaultSeo.description,
        options.language,
        "defaultSeo.description",
        rejectIncomplete,
      ),
    },
  };
}

function readSingleton(result: unknown): RawSiteSettingsDocument {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanitySiteSettingsError(
      "malformed-result",
      "the content store answered with something other than a list",
    );
  }
  if (result.length === 0) {
    throw new SanitySiteSettingsError(
      "missing-document",
      "no published site settings document exists",
    );
  }
  if (result.length > 1) {
    throw new SanitySiteSettingsError(
      "ambiguous-document",
      "more than one published site settings document exists",
    );
  }
  return result[0];
}

export async function readSanitySiteSettings(options: {
  readonly language: string;
  readonly locale: string;
  readonly config: LocaleRouteConfig;
  readonly client?: SanityClient;
}): Promise<SiteSettings> {
  const client = options.client ?? getSanityClient();
  const result = await client.query({
    query: `*[_type == "${SITE_SETTINGS_DOCUMENT_TYPE}"]${SITE_SETTINGS_PROJECTION}`,
    tag: "site-settings",
  });
  return projectSiteSettings(readSingleton(result), options);
}
