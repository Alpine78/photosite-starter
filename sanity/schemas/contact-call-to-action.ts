import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import type { SchemaTypeDefinition } from "./schema-types";

/** Inline fields so home and services keep independent authored copy. */
export const contactCallToActionFields: SchemaTypeDefinition["fields"] = [
  {
    name: "heading",
    title: "Heading",
    type: "array",
    of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
    validation: uniqueLanguages,
  },
  {
    name: "text",
    title: "Text",
    type: "array",
    of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
    validation: uniqueLanguages,
  },
];
