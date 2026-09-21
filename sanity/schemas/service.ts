/**
 * The public service document: one entry in the services listing, each with
 * its own detail page — `src/lib/services.ts`'s `Service`, as it is described
 * once by a customer's Studio.
 *
 * Every published language version is its own document, joined to its peers
 * through the immutable `serviceId`. `src/lib/services.ts` reads exactly one
 * language at a time and resolves paths from those same-language documents,
 * so a missing translation is absent rather than borrowed from another route
 * space (ADR-0021).
 *
 * A service has no separate category placement, tag set, or redirect history —
 * it is not part of the ADR-0003 public content tree, and nothing here invents
 * one. `slug` identifies one sibling service page within one language; the
 * route layer verifies the parent graph and sibling uniqueness after reading.
 */

import { MEDIA_TYPE_NAME } from "./media";
import { LANGUAGE_SUBTAG } from "./localized-text";
import type {
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export const SERVICE_TYPE_NAME = "service";

/** Restated in `src/lib/sanity-services.ts`'s `SERVICE_SLUG`; a test pins the two. */
const SERVICE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

/**
 * Service identity is shared across language documents, but only one document
 * may claim a given identity in one language. Once published it is immutable:
 * routes, translation links, and child parentServiceId values all depend on it.
 */
async function validateServiceIdentity(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !SERVICE_SLUG.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. wedding-photography";
  }
  const documentId = context.document?._id;
  const language = context.document?.language;
  if (
    typeof documentId !== "string" ||
    typeof language !== "string" ||
    !LANGUAGE_SUBTAG.test(language)
  ) {
    return true;
  }
  const published = publishedIdOf(documentId);
  const result = await validationClientOf(context).fetch<{
    taken: boolean;
    publishedServiceId: string | null;
  }>(
    `{
      "taken": defined(*[
        _type == $type &&
        serviceId == $serviceId &&
        language == $language &&
        !sanity::versionOf($published)
      ][0]._id),
      "publishedServiceId": *[_id == $published][0].serviceId
    }`,
    {
      type: SERVICE_TYPE_NAME,
      serviceId: value,
      language,
      published,
    },
  );
  if (result.taken) {
    return `Another ${language} service already uses "${value}", published or not. A service ID identifies one localized route version.`;
  }
  if (
    result.publishedServiceId !== null &&
    result.publishedServiceId !== value
  ) {
    return `This service was published as "${result.publishedServiceId}". Create a new service instead of changing its stable identity.`;
  }
  return true;
}

/**
 * Rejects a blank paragraph anywhere in the description. `required().min(1)`
 * alone lets a whitespace-only entry through the Studio editor, while
 * `src/lib/sanity-services.ts#readDescription` requires every paragraph to be
 * non-empty and rejects the whole document otherwise — so an ordinary publish
 * must not be able to create a description the adapter refuses.
 */
function nonBlankParagraphs(
  value: readonly string[] | undefined,
): SchemaValidationResult {
  return value === undefined || value.every((item) => item.trim().length > 0)
    ? true
    : "Every paragraph must be non-empty";
}

function rejectsSelfParentService(
  value: string | undefined,
  context: SchemaValidationContext,
): SchemaValidationResult {
  return value === undefined || value !== context.document?.serviceId
    ? true
    : "A service cannot be its own parent.";
}

/**
 * Syntax and uniqueness, the same two of `media.ts`'s three identity checks —
 * a service has no redirect history requiring immutability, unlike a
 * photograph or a category whose slug is referenced by permanent redirects.
 */
async function validateServiceSlug(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !SERVICE_SLUG.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. portrait-sessions";
  }

  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;
  const language = context.document?.language;
  // The language field carries its own syntax validation. Until it has been
  // filled in, avoid a misleading global-slug verdict from this companion
  // field; the document cannot publish without the language rule succeeding.
  if (typeof language !== "string" || !LANGUAGE_SUBTAG.test(language)) {
    return true;
  }

  const published = publishedIdOf(documentId);
  const taken = await validationClientOf(context).fetch<boolean>(
    `defined(*[
      _type == $type &&
      slug == $slug &&
      language == $language &&
      !sanity::versionOf($published)
    ][0]._id)`,
    { type: SERVICE_TYPE_NAME, slug: value, language, published },
  );

  return taken
    ? `Another ${language} service already uses "${value}", published or not. A service slug identifies one public page in its language.`
    : true;
}

export const serviceType: SchemaTypeDefinition = {
  name: SERVICE_TYPE_NAME,
  title: "Service",
  type: "document",
  description: "One entry in the services listing, with its own detail page.",
  fields: [
    {
      name: "serviceId",
      title: "Service ID",
      type: "string",
      description:
        "Stable identity shared by every language version. Mint it once and never change it.",
      validation: (rule) =>
        rule.required().custom(validateServiceIdentity),
    },
    {
      name: "language",
      title: "Language",
      type: "string",
      description:
        "Language subtag for this version, e.g. fi or en. Every public service version belongs to exactly one language.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LANGUAGE_SUBTAG.test(value)
            ? true
            : "Use a two- or three-letter lowercase language subtag, e.g. fi or en",
        ),
    },
    {
      name: "parentServiceId",
      title: "Parent service ID",
      type: "string",
      description:
        "Optional stable ID of this service's parent. Use the same ID in every language version; leave empty for a top-level service.",
      validation: (rule) =>
        rule.custom<string>((value, context) => {
          if (value !== undefined && !SERVICE_SLUG.test(value)) {
            return "Use lowercase letters, digits, and single hyphens";
          }
          return rejectsSelfParentService(value, context);
        }),
    },
    {
      name: "slug",
      title: "Path segment",
      type: "string",
      description:
        "Lowercase, hyphenated path segment below this language's configured services route, e.g. portrait-sessions.",
      validation: (rule) => rule.required().custom(validateServiceSlug),
    },
    {
      name: "name",
      title: "Name",
      type: "string",
      validation: (rule) => rule.required().custom(nonBlank),
    },
    {
      name: "shortDescription",
      title: "Short description",
      type: "text",
      description: "One or two lines shown on the listing card.",
      validation: (rule) => rule.required().custom(nonBlank),
    },
    {
      name: "description",
      title: "Description",
      type: "array",
      of: [{ type: "text" }],
      description: "Full description as paragraphs, rendered on the detail page.",
      validation: (rule) => rule.required().min(1).custom(nonBlankParagraphs),
    },
    {
      name: "coverMedia",
      title: "Cover media",
      type: "reference",
      to: [{ type: MEDIA_TYPE_NAME }],
      description:
        "Optional. A card and detail page must both render cleanly without one.",
    },
    {
      name: "startingPrice",
      title: "Starting price",
      type: "string",
      description:
        "Optional scannable \"from\" price for the listing card, e.g. \"From 250 €\". A pre-formatted string: currency and wording come from content.",
    },
    {
      name: "pricing",
      title: "Pricing",
      type: "array",
      description: "Optional full pricing breakdown shown on the detail page.",
      of: [
        {
          type: "object",
          fields: [
            {
              name: "name",
              title: "Package name",
              type: "string",
              validation: (rule) => rule.required().custom(nonBlank),
            },
            {
              name: "price",
              title: "Display price",
              type: "string",
              description: "Pre-formatted, e.g. \"From € 450\" or \"€ 900\".",
              validation: (rule) => rule.required().custom(nonBlank),
            },
            {
              name: "note",
              title: "Note",
              type: "string",
              description: "Optional one-line note about what the package includes.",
            },
          ],
        },
      ],
    },
    {
      name: "order",
      title: "Order",
      type: "number",
      description:
        "Where this service sits in the listing, lowest first. Ties are broken by slug.",
      validation: (rule) => rule.required(),
    },
  ],
  preview: {
    select: { title: "name", subtitle: "shortDescription", media: "coverMedia.image" },
  },
};
