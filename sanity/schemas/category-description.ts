/**
 * Localized, restricted rich text for a category landing page. The category
 * label supplies the page h1, so descriptions deliberately permit no heading,
 * media, embed, or arbitrary HTML block.
 */

import { LANGUAGE_SUBTAG, uniqueLanguages } from "./localized-text";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

export const CATEGORY_DESCRIPTION_TYPE_NAME = "categoryDescription";
export const CATEGORY_DESCRIPTION_INLINE_SPAN_TYPE_NAME = "categoryDescriptionInlineSpan";
export const CATEGORY_DESCRIPTION_PARAGRAPH_TYPE_NAME = "categoryDescriptionParagraph";
export const CATEGORY_DESCRIPTION_LIST_ITEM_TYPE_NAME = "categoryDescriptionListItem";
export const CATEGORY_DESCRIPTION_LIST_TYPE_NAME = "categoryDescriptionList";

export const MAX_CATEGORY_DESCRIPTION_BLOCKS = 6;
export const MAX_CATEGORY_DESCRIPTION_SPANS = 20;
export const MAX_CATEGORY_DESCRIPTION_LIST_ITEMS = 20;
export const MAX_CATEGORY_DESCRIPTION_SPAN_TEXT_LENGTH = 300;
export const CATEGORY_DESCRIPTION_INTERNAL_LINK_PATH =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

function validHref(value: string | undefined): SchemaValidationResult {
  if (value === undefined) return true;
  if (CATEGORY_DESCRIPTION_INTERNAL_LINK_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? true
      : "Enter an internal path or an http(s) URL";
  } catch {
    return "Enter an internal path or an http(s) URL";
  }
}

const inlineSpanType: SchemaTypeDefinition = {
  name: CATEGORY_DESCRIPTION_INLINE_SPAN_TYPE_NAME,
  title: "Text",
  type: "object",
  fields: [
    {
      name: "text",
      title: "Text",
      type: "string",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && value.length <= MAX_CATEGORY_DESCRIPTION_SPAN_TEXT_LENGTH
            ? nonBlank(value)
            : `Keep each run of text to ${MAX_CATEGORY_DESCRIPTION_SPAN_TEXT_LENGTH} characters or fewer`,
        ),
    },
    {
      name: "marks",
      title: "Emphasis",
      type: "array",
      of: [{ type: "string" }],
      options: { list: [{ title: "Emphasis", value: "emphasis" }] },
      // There is one supported mark, so a one-item bound also prevents Studio
      // from publishing the duplicate mark that the public reader rejects.
      validation: (rule) => rule.max(1),
    },
    {
      name: "href",
      title: "Link",
      type: "string",
      description: "An internal path (e.g. /stories/portfolio) or an http(s) URL.",
      validation: (rule) => rule.custom(validHref),
    },
  ],
  preview: { select: { title: "text" } },
};

const paragraphType: SchemaTypeDefinition = {
  name: CATEGORY_DESCRIPTION_PARAGRAPH_TYPE_NAME,
  title: "Paragraph",
  type: "object",
  fields: [
    {
      name: "spans",
      title: "Text",
      type: "array",
      of: [{ type: CATEGORY_DESCRIPTION_INLINE_SPAN_TYPE_NAME }],
      validation: (rule) => rule.required().min(1).max(MAX_CATEGORY_DESCRIPTION_SPANS),
    },
  ],
  preview: { select: { title: "spans.0.text" } },
};

const listItemType: SchemaTypeDefinition = {
  name: CATEGORY_DESCRIPTION_LIST_ITEM_TYPE_NAME,
  title: "Item",
  type: "object",
  fields: [
    {
      name: "spans",
      title: "Text",
      type: "array",
      of: [{ type: CATEGORY_DESCRIPTION_INLINE_SPAN_TYPE_NAME }],
      validation: (rule) => rule.required().min(1).max(MAX_CATEGORY_DESCRIPTION_SPANS),
    },
  ],
  preview: { select: { title: "spans.0.text" } },
};

const listType: SchemaTypeDefinition = {
  name: CATEGORY_DESCRIPTION_LIST_TYPE_NAME,
  title: "List",
  type: "object",
  fields: [
    {
      name: "ordered",
      title: "Ordered",
      type: "boolean",
      initialValue: false,
      validation: (rule) => rule.required(),
    },
    {
      name: "items",
      title: "Items",
      type: "array",
      of: [{ type: CATEGORY_DESCRIPTION_LIST_ITEM_TYPE_NAME }],
      validation: (rule) => rule.required().min(1).max(MAX_CATEGORY_DESCRIPTION_LIST_ITEMS),
    },
  ],
  preview: { select: { title: "items.0.spans.0.text", subtitle: "ordered" } },
};

const descriptionType: SchemaTypeDefinition = {
  name: CATEGORY_DESCRIPTION_TYPE_NAME,
  title: "Category description in one language",
  type: "object",
  fields: [
    {
      name: "language",
      title: "Language",
      type: "string",
      description: "Language subtag, e.g. fi or en.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LANGUAGE_SUBTAG.test(value)
            ? true
            : "Use a two- or three-letter lowercase language subtag, e.g. fi or en",
        ),
    },
    {
      name: "blocks",
      title: "Description",
      type: "array",
      of: [
        { type: CATEGORY_DESCRIPTION_PARAGRAPH_TYPE_NAME },
        { type: CATEGORY_DESCRIPTION_LIST_TYPE_NAME },
      ],
      validation: (rule) => rule.required().min(1).max(MAX_CATEGORY_DESCRIPTION_BLOCKS),
    },
  ],
  preview: { select: { title: "language", subtitle: "blocks.0.spans.0.text" } },
};

export const categoryDescriptionTypes: readonly SchemaTypeDefinition[] = [
  inlineSpanType,
  paragraphType,
  listItemType,
  listType,
  descriptionType,
];

export function defineCategoryDescriptionField(): SchemaFieldDefinition {
  return {
    name: "description",
    title: "Category description",
    type: "array",
    description:
      "Optional localized introduction shown below the category title and before its child categories and content.",
    of: [{ type: CATEGORY_DESCRIPTION_TYPE_NAME }],
    validation: (rule) => uniqueLanguages(rule.max(20)),
  };
}
