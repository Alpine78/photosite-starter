/**
 * Shared link targets for site chrome and the home page.
 *
 * A link may name an application-owned static route, the generated story root,
 * or the one gallery selected in site settings. Category paths never live here:
 * ADR-0003 makes the public category tree their only owner.
 */

import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import type {
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

export const NAVIGATION_ITEM_TYPE_NAME = "navigationItem";
export const HOME_ACTION_TYPE_NAME = "homeAction";
export const HOME_SECTION_TYPE_NAME = "homeSection";

export const SITE_LINK_TARGETS = [
  "static",
  "story-root",
  "featured-gallery",
] as const;

type SiteLinkTarget = (typeof SITE_LINK_TARGETS)[number];

const ROOT_RELATIVE_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

type RawSiteLink = {
  readonly target?: unknown;
  readonly href?: unknown;
};

export function isStaticSitePath(value: unknown): value is string {
  return typeof value === "string" && ROOT_RELATIVE_PATH.test(value);
}

export function validateSiteLinkTarget(
  value: RawSiteLink | undefined,
): SchemaValidationResult {
  if (value === undefined) return true;

  const target = value.target;
  if (!SITE_LINK_TARGETS.includes(target as SiteLinkTarget)) {
    return "Choose a static route, the generated story root, or the featured gallery";
  }

  if (target === "static") {
    return isStaticSitePath(value.href)
      ? true
      : "A static link needs a root-relative path without a query, fragment, or trailing slash, e.g. /services";
  }

  return value.href === undefined || value.href === ""
    ? true
    : "Generated story and featured-gallery links must not store a path";
}

const targetFields = [
  {
    name: "target",
    title: "Target",
    type: "string",
    description:
      "Static routes store their path. The story root is generated from locale routing, and the featured gallery resolves from its stable content identity.",
    options: {
      list: [
        { title: "Static route", value: "static" },
        { title: "Generated story root", value: "story-root" },
        { title: "Featured gallery", value: "featured-gallery" },
      ],
      layout: "radio" as const,
    },
    validation: (rule: Parameters<NonNullable<SchemaTypeDefinition["validation"]>>[0]) =>
      rule.required(),
  },
  {
    name: "href",
    title: "Static route path",
    type: "string",
    description:
      "Only for a static target: a root-relative application route such as /services. Never write a category or featured-gallery path here.",
  },
] as const;

export const navigationItemType: SchemaTypeDefinition = {
  name: NAVIGATION_ITEM_TYPE_NAME,
  title: "Navigation item",
  type: "object",
  validation: (rule) => rule.custom<RawSiteLink>(validateSiteLinkTarget),
  fields: [
    {
      name: "label",
      title: "Label",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    ...targetFields,
  ],
  preview: { select: { title: "label.0.value", subtitle: "target" } },
};

export const homeActionType: SchemaTypeDefinition = {
  name: HOME_ACTION_TYPE_NAME,
  title: "Home action",
  type: "object",
  validation: (rule) => rule.custom<RawSiteLink>(validateSiteLinkTarget),
  fields: [
    {
      name: "label",
      title: "Label",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    ...targetFields,
  ],
  preview: { select: { title: "label.0.value", subtitle: "target" } },
};

export const homeSectionType: SchemaTypeDefinition = {
  name: HOME_SECTION_TYPE_NAME,
  title: "Home section link",
  type: "object",
  validation: (rule) => rule.custom<RawSiteLink>(validateSiteLinkTarget),
  fields: [
    {
      name: "title",
      title: "Title",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    {
      name: "description",
      title: "Description",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    ...targetFields,
  ],
  preview: { select: { title: "title.0.value", subtitle: "target" } },
};
