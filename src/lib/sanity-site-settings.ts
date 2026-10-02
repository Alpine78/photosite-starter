/** Published Sanity site settings projected into the project's own contract. */

import "server-only";

import type { ContactCallToAction } from "@/lib/contact-call-to-action";
import { readGalleryPresentationFields } from "@/lib/gallery-presentation";
import { projectOptionalContactCallToAction } from "@/lib/sanity-contact-call-to-action";

import type { LocaleRouteConfig } from "@/lib/locale-routes";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  MEDIA_DOCUMENT_TYPE,
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import { isRecord, toLanguageSubtag } from "@/lib/sanity-values";
import {
  projectNavigationItems,
  readLocalizedText,
  readLocalizedTextByLanguage,
  readOptionalLocalizedText,
  readOptionalString,
  readRequiredString,
  readSingletonDocument,
} from "@/lib/sanity-site-values";
import type { ImageMedia } from "@/lib/media";
import {
  BRAND_DESCRIPTOR_POSITIONS,
  type BrandDescriptor,
  type SiteSettings,
  type SocialLink,
} from "@/lib/site-settings";

export const SITE_SETTINGS_DOCUMENT_TYPE = "siteSettings";

export const PROJECTED_SITE_SETTINGS_FIELDS = [
  "siteName",
  "logo",
  "logoDark",
  "brandDescriptor",
  "photographerName",
  "tagline",
  "servicesIntro",
  "servicesContactCallToAction",
  "featuredGalleryId",
  "galleryLayout",
  "galleryCaptionPlacement",
  "navigation",
  "contact",
  "socialLinks",
  "footerLinks",
  "copyrightHolder",
  "defaultSeo",
] as const;

/**
 * `siteName` is read whole rather than as `siteName[]{language, value}`: a
 * document authored before AB#187 still holds one plain string there, which
 * an array projection would silently turn into `null`.
 *
 * Each logo's raw reference is read beside its dereference so a reference
 * that does not resolve is told apart from no logo at all, and its target's
 * type is read so a reference to anything but a media document is refused.
 */
export const SITE_SETTINGS_PROJECTION = `{
  siteName,
  "logoRef": logo._ref,
  "logoType": logo->_type,
  "logo": logo->${PUBLIC_MEDIA_PROJECTION},
  "logoDarkRef": logoDark._ref,
  "logoDarkType": logoDark->_type,
  "logoDark": logoDark->${PUBLIC_MEDIA_PROJECTION},
  brandDescriptor[]{language, value, position},
  photographerName,
  tagline[]{language, value},
  servicesIntro[]{language, value},
  servicesContactCallToAction{heading[]{language, value}, text[]{language, value}},
  featuredGalleryId,
  galleryLayout,
  galleryCaptionPlacement,
  navigation[]{label[]{language, value}, target, href},
  contact{
    "portrait": portrait->${PUBLIC_MEDIA_PROJECTION},
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

export const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const EMAIL =
  /^[^\s@,;:<>"'\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu;

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
    if (!CONTENT_ID.test(platform) || platforms.has(platform)) {
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

/**
 * One optional reference to a shared public image, projected through the same
 * public-media boundary as every other photograph. Absent stays absent; any
 * other media, a private one, or a malformed one is refused.
 */
function readOptionalPublicImage(
  value: unknown,
  field: string,
  options: { readonly language: string; readonly sanityConfig?: SanityConfig },
  reject: (detail: string) => never,
): ImageMedia | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) reject(`${field} is malformed`);
  const projected = projectPublicMedia(value as RawPublicMediaDocument, {
    language: options.language,
    fallbackLanguage: options.language,
    config: options.sanityConfig ?? getSanityConfig(),
  });
  if (projected.type !== "image") reject(`${field} must be a public image`);
  return projected;
}

/**
 * The site name in every authored language. A document authored before
 * AB#187 holds one plain string; it is read as the default language's name
 * until the owner re-authors it, so deploying this change does not take a
 * live site down before its settings are edited.
 */
function readSiteNames(
  value: unknown,
  language: string,
  reject: (detail: string) => never,
): Readonly<Record<string, string>> {
  if (typeof value === "string") {
    return { [toLanguageSubtag(language)]: readRequiredString(value, "siteName", reject) };
  }
  return readLocalizedTextByLanguage(value, language, "siteName", reject);
}

/**
 * One logo field, refusing a set reference that does not resolve to a media
 * document. `field` names the projected trio: `<field>Ref`, `<field>Type`,
 * and `<field>` itself.
 */
function readLogo(
  document: RawSiteSettingsDocument,
  field: "logo" | "logoDark",
  options: { readonly language: string; readonly sanityConfig?: SanityConfig },
  reject: (detail: string) => never,
): ImageMedia | undefined {
  const reference = document[`${field}Ref`];
  const target = document[field];
  if (reference === undefined || reference === null) {
    if (target !== undefined && target !== null) {
      reject(`${field} resolved without a reference`);
    }
    return undefined;
  }
  if (typeof reference !== "string") reject(`${field} reference is malformed`);
  if (target === undefined || target === null) {
    reject(`${field} references a document that is not published`);
  }
  if (document[`${field}Type`] !== MEDIA_DOCUMENT_TYPE) {
    reject(`${field} must reference a media document`);
  }
  return readOptionalPublicImage(target, field, options, reject);
}

/** The header descriptor per language, each with the side of the name it reads on. */
function readBrandDescriptors(
  value: unknown,
  reject: (detail: string) => never,
): Readonly<Record<string, BrandDescriptor>> {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) reject("brandDescriptor is not a language-keyed list");
  const descriptors: Record<string, BrandDescriptor> = {};
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.language !== "string" ||
      !/^[a-z]{2,3}$/.test(entry.language) ||
      typeof entry.value !== "string" ||
      entry.value.trim().length === 0 ||
      !(BRAND_DESCRIPTOR_POSITIONS as readonly unknown[]).includes(entry.position)
    ) {
      reject("brandDescriptor has a malformed language entry");
    }
    if (descriptors[entry.language] !== undefined) {
      reject(`brandDescriptor has more than one entry for language "${entry.language}"`);
    }
    descriptors[entry.language] = {
      text: entry.value.trim(),
      position: entry.position as BrandDescriptor["position"],
    };
  }
  return descriptors;
}

export function projectSiteSettings(
  document: RawSiteSettingsDocument,
  options: {
    readonly language: string;
    readonly locale: string;
    readonly config: LocaleRouteConfig;
    readonly sanityConfig?: SanityConfig;
  },
): SiteSettings {
  const rejectIncomplete: (detail: string) => never = (detail) => {
    throw new SanitySiteSettingsError("incomplete-document", detail);
  };
  const rejectNavigation: (detail: string) => never = (detail) => {
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
    minItems: 1,
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
  const portrait = readOptionalPublicImage(
    contact.portrait,
    "contact.portrait",
    options,
    rejectIncomplete,
  );
  const logo = readLogo(document, "logo", options, rejectIncomplete);
  const logoDark = readLogo(document, "logoDark", options, rejectIncomplete);
  if (logoDark !== undefined && logo === undefined) {
    rejectIncomplete("logoDark is set without the logo it replaces");
  }
  const brandDescriptors = readBrandDescriptors(document.brandDescriptor, rejectIncomplete);
  const siteNames = readSiteNames(document.siteName, options.language, rejectIncomplete);
  const email = readRequiredString(contact.email, "contact.email", rejectIncomplete);
  if (email.length > 254 || !EMAIL.test(email)) {
    rejectIncomplete("contact.email is not a usable email address");
  }

  const defaultSeo = readRecord(
    document.defaultSeo,
    "defaultSeo",
    rejectIncomplete,
  );
  const titleTemplates = readLocalizedTextByLanguage(
    defaultSeo.titleTemplate,
    options.language,
    "defaultSeo.titleTemplate",
    rejectIncomplete,
  );
  for (const [language, template] of Object.entries(titleTemplates)) {
    if ((template.match(/%s/g) ?? []).length !== 1) {
      rejectIncomplete(
        `defaultSeo.titleTemplate in language "${language}" must contain exactly one %s placeholder`,
      );
    }
  }
  const titleTemplate = titleTemplates[toLanguageSubtag(options.language)];
  const phone = readOptionalString(contact.phone, "contact.phone", rejectIncomplete);
  const address = readOptionalLocalizedText(
    contact.address,
    options.language,
    "contact.address",
    rejectIncomplete,
  );
  // Optional, unlike `tagline`: a deployment with none omits the /services
  // intro paragraph (`getPageMetadata`'s own description fallback already
  // covers the metadata half) rather than borrowing fixture copy.
  const servicesIntro = readOptionalLocalizedText(
    document.servicesIntro,
    options.language,
    "servicesIntro",
    rejectIncomplete,
  );
  const servicesContactCallToAction = projectOptionalContactCallToAction(
    document.servicesContactCallToAction, options.language,
    "servicesContactCallToAction", rejectIncomplete,
  );
  const businessId = readOptionalString(
    contact.businessId,
    "contact.businessId",
    rejectIncomplete,
  );

  return {
    ...readGalleryPresentationFields(document, rejectIncomplete),
    siteName: siteNames[toLanguageSubtag(options.language)],
    siteNames,
    ...(logo === undefined ? {} : { logo }),
    ...(logoDark === undefined ? {} : { logoDark }),
    brandDescriptors,
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
    ...(servicesIntro === undefined ? {} : { servicesIntro }),
    ...(servicesContactCallToAction === undefined ? {} : { servicesContactCallToAction }),
    navigation: [...navigation],
    ...(featuredGalleryId === undefined ? {} : { featuredGalleryId }),
    contact: {
      ...(portrait === undefined ? {} : { portrait }),
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
      titleTemplates,
      description: readLocalizedText(
        defaultSeo.description,
        options.language,
        "defaultSeo.description",
        rejectIncomplete,
      ),
    },
  };
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
  const document = readSingletonDocument<RawSiteSettingsDocument>(
    result,
    "site settings",
    (rejection, detail) => {
      throw new SanitySiteSettingsError(rejection, detail);
    },
  );
  return projectSiteSettings(document, options);
}

/** A narrow read for prefixed service listings; other settings remain default-locale. */
export async function readSanityServicesContactCallToAction(
  language: string,
  client: SanityClient = getSanityClient(),
): Promise<ContactCallToAction | undefined> {
  const result = await client.query({
    query: `*[_type == "${SITE_SETTINGS_DOCUMENT_TYPE}"]{servicesContactCallToAction{heading[]{language, value}, text[]{language, value}}}`,
    tag: "site-settings",
  });
  const document = readSingletonDocument<RawSiteSettingsDocument>(
    result,
    "site settings",
    (rejection, detail) => {
      throw new SanitySiteSettingsError(rejection, detail);
    },
  );
  const rejectIncomplete: (detail: string) => never = (detail) => {
    throw new SanitySiteSettingsError("incomplete-document", detail);
  };
  return projectOptionalContactCallToAction(
    document.servicesContactCallToAction,
    language,
    "servicesContactCallToAction",
    rejectIncomplete,
  );
}
