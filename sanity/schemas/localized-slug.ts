/**
 * One canonical path segment in one language.
 *
 * ADR-0003 decision 6 lets a category or content page's label *and slug* be
 * localized, while `localized-text.ts` is deliberately unsuitable for the
 * slug half: its `value` is a multi-line `text` field with no shape
 * constraint, and a public path segment is neither. This type carries the
 * same `{ language, value }` shape ADR-0008 established, with `value`
 * validated as the lowercase-hyphen form the route layer requires.
 *
 * `category.ts` is the first consumer. A gallery or article schema's own slug
 * field is expected to reuse this type rather than inventing a second one,
 * because ADR-0003 decision 6 applies the same slug grammar to both.
 */

import { LANGUAGE_SUBTAG } from "./localized-text";
import type { SchemaTypeDefinition } from "./schema-types";

export const LOCALIZED_SLUG_TYPE_NAME = "localizedSlug";

/**
 * Restated from `content-tree.ts`'s `SLUG_PATTERN`, which owns the rule: a
 * test pins the two together. It cannot be imported directly — these schemas
 * are exported to a Studio that does not have this repository's application
 * code on its import path (see `sanity/README.md`).
 */
export const LOCALIZED_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const localizedSlugType: SchemaTypeDefinition = {
  name: LOCALIZED_SLUG_TYPE_NAME,
  title: "Path segment in one language",
  type: "object",
  fields: [
    {
      name: "language",
      title: "Language",
      type: "string",
      description:
        "Language subtag, e.g. fi or en — the language itself, not the locale. Regional route spaces such as en-GB and en-US share one English entry.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LANGUAGE_SUBTAG.test(value)
            ? true
            : "Use a two- or three-letter lowercase language subtag, e.g. fi or en",
        ),
    },
    {
      name: "value",
      title: "Path segment",
      type: "string",
      description:
        "Lowercase words separated by hyphens, e.g. coastal-landscapes. This becomes part of a public URL.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LOCALIZED_SLUG_PATTERN.test(value)
            ? true
            : "Use lowercase letters, digits, and single hyphens, e.g. coastal-landscapes",
        ),
    },
  ],
  preview: {
    select: { title: "value", subtitle: "language" },
  },
};
