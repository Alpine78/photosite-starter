/**
 * One authored sentence in one language.
 *
 * ADR-0008 decides the shape: authored text that a visitor reads is an array of
 * these, keyed by language subtag rather than by fields named after this
 * deployment's languages. A clone that publishes Swedish and German adds
 * entries; it does not edit a schema.
 *
 * The subtag is the language, not the locale: `en-GB` and `en-US` are two route
 * spaces reading the same English sentence, exactly as the built-in interface
 * labels already work (`getBuiltInLabels`, `src/lib/deployment-config.ts`).
 */

import type {
  SchemaTypeDefinition,
  SchemaValidationRule,
} from "./schema-types";

/** ISO 639 language subtag: two or three lowercase letters. */
const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

export const LOCALIZED_TEXT_TYPE_NAME = "localizedText";

export const localizedTextType: SchemaTypeDefinition = {
  name: LOCALIZED_TEXT_TYPE_NAME,
  title: "Text in one language",
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
      title: "Text",
      type: "text",
      validation: (rule) => rule.required(),
    },
  ],
  preview: {
    select: { title: "value", subtitle: "language" },
  },
};

type LocalizedTextEntry = {
  readonly language?: string;
};

/**
 * Rejects two entries for one language.
 *
 * Without it a photograph can carry two Finnish captions, and which one a page
 * shows becomes array order — an editorial accident that reads as a bug.
 */
export function uniqueLanguages(
  rule: SchemaValidationRule,
): SchemaValidationRule {
  return rule.custom<readonly LocalizedTextEntry[]>((entries) => {
    const languages = (entries ?? []).map((entry) => entry.language);
    const duplicated = languages.filter(
      (language, index) => language !== undefined && languages.indexOf(language) !== index,
    );

    return duplicated.length === 0
      ? true
      : `One entry per language: ${[...new Set(duplicated)].join(", ")} appears more than once`;
  });
}
