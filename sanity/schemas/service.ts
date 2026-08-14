/**
 * The public service document: one entry in the services listing, each with
 * its own detail page — `src/lib/services.ts`'s `Service`, as it is described
 * once by a customer's Studio.
 *
 * Unlike a category, a gallery, or an article, a service carries no per-
 * language field or document split: `src/lib/services.ts#getServices` takes
 * no locale, matching the current unlocalized `/services` route (ADR-0003
 * decision 6's localized story namespace does not reach static routes yet).
 * Adding language-keyed fields here ahead of that would describe a capability
 * nothing reads.
 *
 * A service has no separate category placement, tag set, or redirect history —
 * it is not part of the ADR-0003 public content tree, and nothing here invents
 * one. `slug` is the service's own identity: unique among published services,
 * checked the same asynchronous way `media.ts` and `category.ts` check theirs.
 */

import { MEDIA_TYPE_NAME } from "./media";
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

  const published = publishedIdOf(documentId);
  const taken = await validationClientOf(context).fetch<boolean>(
    `defined(*[
      _type == $type &&
      slug == $slug &&
      !sanity::versionOf($published)
    ][0]._id)`,
    { type: SERVICE_TYPE_NAME, slug: value, published },
  );

  return taken
    ? `Another service already uses "${value}", published or not. A service slug identifies one public page.`
    : true;
}

export const serviceType: SchemaTypeDefinition = {
  name: SERVICE_TYPE_NAME,
  title: "Service",
  type: "document",
  description: "One entry in the services listing, with its own detail page.",
  fields: [
    {
      name: "slug",
      title: "Path segment",
      type: "string",
      description:
        "Lowercase, hyphenated path segment under /services/, e.g. portrait-sessions.",
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
      validation: (rule) => rule.required().min(1),
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
