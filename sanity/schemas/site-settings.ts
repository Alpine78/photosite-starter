/** Global brand, contact, and static-navigation content for one deployment. */

import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import {
  isStaticSitePath,
  NAVIGATION_ITEM_TYPE_NAME,
} from "./site-link";
import type {
  SchemaTypeDefinition,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

export const SITE_SETTINGS_TYPE_NAME = "siteSettings";

export type SiteSettingsSchemaOptions = {
  /**
   * Generated story root in every configured locale's route space, one path
   * per `SITE_LOCALE_ROUTES` entry (the default locale's is unprefixed, each
   * other locale's carries its own prefix). A static link may collide with
   * any of them, not only the default locale's.
   */
  readonly storyRootPaths: readonly string[];
};

/**
 * Restated in `src/lib/sanity-site-settings.ts`'s `CONTENT_ID`: the adapter
 * cannot import a Studio schema (ADR-0006), so this pattern is necessarily
 * duplicated rather than shared. Pinned equal by `site-settings.test.ts` so
 * the two copies cannot silently drift. Also used for a social link's
 * `platform` identity, which shares the same lowercase-hyphenated shape.
 */
export const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Restated in `src/lib/sanity-site-settings.ts`'s `EMAIL` (and, outside the
 * Sanity boundary, in `src/lib/contact-message.ts`'s `EMAIL_SHAPE`, which the
 * contact form independently needs). Pinned equal to both by
 * `site-settings.test.ts` so the three copies cannot silently drift.
 */
export const EMAIL = /^[^\s@,;:<>"'\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

function platformIdentity(value: string | undefined): SchemaValidationResult {
  return value !== undefined && CONTENT_ID.test(value)
    ? true
    : "Use lowercase letters, digits, and single hyphens";
}

export function validateTitleTemplates(
  entries: readonly { readonly value?: unknown }[] | undefined,
): SchemaValidationResult {
  for (const entry of entries ?? []) {
    if (
      typeof entry.value !== "string" ||
      (entry.value.match(/%s/g) ?? []).length !== 1
    ) {
      return "Every title template must contain exactly one %s placeholder";
    }
  }
  return true;
}

function titleTemplates(rule: SchemaValidationRule): SchemaValidationRule {
  return uniqueLanguages(rule).custom(validateTitleTemplates);
}

function contentIdentity(value: string | undefined): SchemaValidationResult {
  return value === undefined || CONTENT_ID.test(value)
    ? true
    : "Use lowercase letters, digits, and single hyphens";
}

function emailAddress(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.length <= 254 && EMAIL.test(value)
    ? true
    : "Enter a deliverable email address";
}

function httpsUrl(value: string | undefined): SchemaValidationResult {
  if (value === undefined) return "Enter an HTTPS URL";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash
      ? true
      : "Use an HTTPS URL without credentials or a fragment";
  } catch {
    return "Enter a valid HTTPS URL";
  }
}

type RawNavigationItem = {
  readonly target?: unknown;
  readonly href?: unknown;
};

export function validateNavigationList(
  value: readonly RawNavigationItem[] | undefined,
  storyRootPaths: readonly string[],
): SchemaValidationResult {
  const claimed = new Set<string>();
  for (const item of value ?? []) {
    // A story-root link occupies every configured locale's resolved path,
    // not only the default locale's, so a static link duplicating any one of
    // them is a real collision. The literal "story-root" sentinel keeps two
    // story-root entries colliding with each other even if storyRootPaths
    // were ever empty.
    const destinations =
      item.target === "static"
        ? [String(item.href)]
        : item.target === "story-root"
          ? ["story-root", ...storyRootPaths]
          : [String(item.target)];
    const repeated = destinations.find((destination) => claimed.has(destination));
    if (repeated !== undefined) {
      return `Navigation contains the destination "${repeated}" more than once`;
    }
    for (const destination of destinations) claimed.add(destination);
  }
  return true;
}

type RawSocialLink = {
  readonly platform?: unknown;
};

export function validateSocialLinks(
  value: readonly RawSocialLink[] | undefined,
): SchemaValidationResult {
  const seen = new Set<string>();
  for (const item of value ?? []) {
    const platform = String(item.platform);
    if (seen.has(platform)) {
      return `Social links contains the platform "${platform}" more than once`;
    }
    seen.add(platform);
  }
  return true;
}

type RawSiteSettings = {
  readonly featuredGalleryId?: unknown;
  readonly navigation?: unknown;
  readonly footerLinks?: unknown;
};

function validateSiteSettings(
  value: RawSiteSettings | undefined,
): SchemaValidationResult {
  if (value === undefined) return true;
  const lists = [value.navigation, value.footerLinks];
  const hasFeaturedTarget = lists.some(
    (list) => Array.isArray(list) && list.some((item) => item?.target === "featured-gallery"),
  );
  return hasFeaturedTarget && typeof value.featuredGalleryId !== "string"
    ? "A featured-gallery navigation item requires Featured gallery ID"
    : true;
}

export function defineSiteSettingsType(
  options: SiteSettingsSchemaOptions,
): SchemaTypeDefinition {
  if (options.storyRootPaths.length === 0) {
    throw new TypeError(
      "storyRootPaths must name at least one configured locale's generated story root",
    );
  }
  for (const path of options.storyRootPaths) {
    if (!isStaticSitePath(path) || path === "/") {
      throw new TypeError(
        "storyRootPaths must be non-root, root-relative route paths without a query, fragment, or trailing slash",
      );
    }
  }

  const fields: SchemaTypeDefinition["fields"] = [
    { name: "siteName", title: "Site name", type: "string", validation: (rule) => rule.required().custom(nonBlank) },
    { name: "photographerName", title: "Photographer name", type: "string", validation: (rule) => rule.required().custom(nonBlank) },
    {
      name: "tagline",
      title: "Tagline",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    {
      name: "servicesIntro",
      title: "Services listing intro",
      type: "array",
      description:
        "Optional short intro shown above the /services listing. A deployment with none omits the paragraph rather than showing a fixture placeholder.",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: uniqueLanguages,
    },
    {
      name: "featuredGalleryId",
      title: "Featured gallery ID",
      type: "string",
      description:
        "Stable content identity of the one gallery featured by the header, footer, and home page. Never store its route path.",
      validation: (rule) => rule.custom(contentIdentity),
    },
    {
      name: "navigation",
      title: "Header navigation",
      type: "array",
      of: [{ type: NAVIGATION_ITEM_TYPE_NAME }],
      validation: (rule) =>
        rule
          .required()
          .min(1)
          .custom<readonly RawNavigationItem[]>((value) =>
            validateNavigationList(value, options.storyRootPaths),
          ),
    },
    {
      name: "contact",
      title: "Contact",
      type: "object",
      validation: (rule) => rule.required(),
      fields: [
        { name: "email", title: "Email", type: "string", validation: (rule) => rule.required().custom(emailAddress) },
        { name: "phone", title: "Phone", type: "string" },
        {
          name: "address",
          title: "Address",
          type: "array",
          of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
          validation: uniqueLanguages,
        },
        { name: "businessId", title: "Business ID", type: "string" },
        {
          name: "privacyNotice",
          title: "Contact privacy notice",
          type: "object",
          validation: (rule) => rule.required(),
          fields: ["collected", "purpose", "recipient", "retention"].map((name) => ({
            name,
            title: name[0].toUpperCase() + name.slice(1),
            type: "array",
            of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
            validation: (rule) => uniqueLanguages(rule.required().min(1)),
          })),
        },
      ],
    },
    {
      name: "socialLinks",
      title: "Social links",
      type: "array",
      validation: (rule) => rule.required().custom(validateSocialLinks),
      of: [{
        type: "object",
        fields: [
          { name: "platform", title: "Platform", type: "string", validation: (rule) => rule.required().custom(platformIdentity) },
          { name: "url", title: "URL", type: "url", validation: (rule) => rule.required().custom(httpsUrl) },
          {
            name: "label",
            title: "Accessible label",
            type: "array",
            of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
            validation: (rule) => uniqueLanguages(rule.required().min(1)),
          },
        ],
      }],
    },
    {
      name: "footerLinks",
      title: "Footer links",
      type: "array",
      of: [{ type: NAVIGATION_ITEM_TYPE_NAME }],
      validation: (rule) =>
        rule
          .required()
          .custom<readonly RawNavigationItem[]>((value) =>
            validateNavigationList(value, options.storyRootPaths),
          ),
    },
    { name: "copyrightHolder", title: "Copyright holder", type: "string", validation: (rule) => rule.required().custom(nonBlank) },
    {
      name: "defaultSeo",
      title: "Default search metadata",
      type: "object",
      validation: (rule) => rule.required(),
      fields: [
        {
          name: "titleTemplate",
          title: "Title template",
          type: "array",
          description: "One %s placeholder is replaced with the page title.",
          of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
          validation: (rule) => titleTemplates(rule.required().min(1)),
        },
        {
          name: "description",
          title: "Description",
          type: "array",
          of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
          validation: (rule) => uniqueLanguages(rule.required().min(1)),
        },
      ],
    },
  ];

  return {
    name: SITE_SETTINGS_TYPE_NAME,
    title: "Site settings",
    type: "document",
    description:
      "The deployment-wide brand, contact details, and static navigation. Publish exactly one document.",
    validation: (rule) => rule.custom<RawSiteSettings>(validateSiteSettings),
    fields,
    preview: { select: { title: "siteName", subtitle: "photographerName" } },
  };
}
