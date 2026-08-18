/**
 * A gallery section's optional introduction (AB#105, ADR-0003 decision 3):
 * paragraphs and lists only, with inline emphasis and links — restricted rich
 * text, not the shared six-kind `ContentBlock`/`defineContentBodyField` set
 * (`content-block.ts`), because a section intro has no heading, media, or
 * embed, and its paragraphs/lists need inline structure (a link, emphasis)
 * that `ContentBlock`'s own plain-string `paragraph`/`list` kinds do not
 * carry.
 *
 * Modeled as a dedicated object per kind, the same way `content-block.ts`
 * models its six blocks, rather than Sanity's native portable-text `block`
 * type: this project's schema layer (`schema-types.ts`) deliberately has no
 * native block/portable-text support, and every array item — including a
 * nested `items` array inside the list block below — gets its own stable
 * `_key` from Sanity automatically, so no manual key-minting or "grouping
 * consecutive blocks" logic is needed either in the Studio or in the read-side
 * projector.
 *
 * `src/lib/gallery-sections.ts` is the domain half this projects onto:
 * `GallerySectionInlineSpan`, `GallerySectionParagraphBlock`,
 * `GallerySectionListBlock`. The bounds below restate that module's own
 * `MAX_INTRO_BLOCKS`/`MAX_SPANS_PER_BLOCK`/`MAX_LIST_ITEMS`/
 * `MAX_SPAN_TEXT_LENGTH` — schemas cannot import `src/lib` (ADR-0006) — and are
 * pinned equal to it by a test, the same pattern `media.ts` uses for
 * `MAX_PUBLIC_DELIVERY_DIMENSION`.
 */

import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

export const GALLERY_SECTION_INLINE_SPAN_TYPE_NAME = "gallerySectionInlineSpan";
export const GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME =
  "gallerySectionIntroParagraphBlock";
export const GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME =
  "gallerySectionIntroListItem";
export const GALLERY_SECTION_INTRO_LIST_TYPE_NAME = "gallerySectionIntroListBlock";

/** Restates `gallery-sections.ts`'s identical constants; pinned by a test. */
export const MAX_INTRO_BLOCKS = 6;
export const MAX_SPANS_PER_BLOCK = 20;
export const MAX_LIST_ITEMS = 20;
export const MAX_SPAN_TEXT_LENGTH = 300;

/** Restates `gallery-sections.ts`'s `GallerySectionInlineMark` values. */
const KNOWN_MARKS: readonly { readonly title: string; readonly value: string }[] = [
  { title: "Emphasis", value: "emphasis" },
];

/** Restates `gallery-sections.ts`'s `INTERNAL_LINK_PATH`; pinned by a test. */
export const INTERNAL_LINK_PATH =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

function validSpanHref(value: string | undefined): SchemaValidationResult {
  if (value === undefined) return true;
  if (INTERNAL_LINK_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? true
      : "Enter an internal path or an http(s) URL";
  } catch {
    return "Enter an internal path or an http(s) URL";
  }
}

const gallerySectionInlineSpanType: SchemaTypeDefinition = {
  name: GALLERY_SECTION_INLINE_SPAN_TYPE_NAME,
  title: "Text",
  type: "object",
  fields: [
    {
      name: "text",
      title: "Text",
      type: "string",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && value.length <= MAX_SPAN_TEXT_LENGTH
            ? nonBlank(value)
            : `Keep each run of text to ${MAX_SPAN_TEXT_LENGTH} characters or fewer`,
        ),
    },
    {
      name: "marks",
      title: "Emphasis",
      type: "array",
      of: [{ type: "string" }],
      options: { list: KNOWN_MARKS },
    },
    {
      name: "href",
      title: "Link",
      type: "string",
      description: "An internal path (e.g. /stories/gear) or an http(s) URL.",
      validation: (rule) => rule.custom(validSpanHref),
    },
  ],
  preview: { select: { title: "text" } },
};

const gallerySectionIntroParagraphType: SchemaTypeDefinition = {
  name: GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME,
  title: "Paragraph",
  type: "object",
  fields: [
    {
      name: "spans",
      title: "Text",
      type: "array",
      of: [{ type: GALLERY_SECTION_INLINE_SPAN_TYPE_NAME }],
      validation: (rule) => rule.required().min(1).max(MAX_SPANS_PER_BLOCK),
    },
  ],
  preview: { select: { title: "spans.0.text" } },
};

const gallerySectionIntroListItemType: SchemaTypeDefinition = {
  name: GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME,
  title: "Item",
  type: "object",
  fields: [
    {
      name: "spans",
      title: "Text",
      type: "array",
      of: [{ type: GALLERY_SECTION_INLINE_SPAN_TYPE_NAME }],
      validation: (rule) => rule.required().min(1).max(MAX_SPANS_PER_BLOCK),
    },
  ],
  preview: { select: { title: "spans.0.text" } },
};

const gallerySectionIntroListType: SchemaTypeDefinition = {
  name: GALLERY_SECTION_INTRO_LIST_TYPE_NAME,
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
      of: [{ type: GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME }],
      validation: (rule) => rule.required().min(1).max(MAX_LIST_ITEMS),
    },
  ],
  preview: { select: { title: "items.0.spans.0.text", subtitle: "ordered" } },
};

/** Every gallery-section-intro object type, spread into a Studio's `schema.types`. */
export const gallerySectionIntroTypes: readonly SchemaTypeDefinition[] = [
  gallerySectionInlineSpanType,
  gallerySectionIntroParagraphType,
  gallerySectionIntroListItemType,
  gallerySectionIntroListType,
];

/** Builds a gallery section's `intro` field: paragraphs and lists, bounded. */
export function defineGallerySectionIntroField(options: {
  readonly name: string;
  readonly title: string;
  readonly description?: string;
}): SchemaFieldDefinition {
  return {
    name: options.name,
    title: options.title,
    type: "array",
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    of: [
      { type: GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME },
      { type: GALLERY_SECTION_INTRO_LIST_TYPE_NAME },
    ],
    validation: (rule) => rule.max(MAX_INTRO_BLOCKS),
  };
}
