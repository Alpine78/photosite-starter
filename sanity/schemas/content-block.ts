import {
  readContentInlineSpans,
  readContentRichItems,
  isContentInlineHref,
  MAX_CONTENT_INLINE_SPANS,
  MAX_CONTENT_INLINE_TEXT,
  MAX_CONTENT_RICH_ITEMS,
} from "./content-inline";
/**
 * The shared rich-content body blocks ADR-0003 decision 2 gives both public
 * content variants: paragraph, heading, blockquote, media placement, list, a
 * privacy-first YouTube embed, a mini-gallery, a data table, a poll, an
 * image comparison, and a tab group.
 *
 * Deliberately not named after either variant. `article.ts` is the first
 * consumer, `defineContentBodyField({ name: "body" })` with every block type
 * allowed. A gallery's own optional body (AB#104/AB#113) reuses the same call
 * unchanged; a smaller context — the gallery section introduction ADR-0003
 * decision 3 restricts to paragraphs, lists, and inline emphasis — reuses these
 * block types too, through `defineContentBodyField`'s `allowedTypes`, rather
 * than inventing a second body-block schema for a narrower authoring surface.
 *
 * Each block object type is named `content<Kind>Block` rather than its bare
 * domain discriminant (`paragraph`, `media`, …): Sanity schema type names share
 * one namespace across the whole Studio, and `media.ts` already claims `media`
 * for the shared photograph document. `src/lib/sanity-content-blocks.ts` is the
 * other half, projecting a query result of these object types back onto
 * `content-page.ts`'s `ContentBlock` union — the map between the two lives
 * there as `CONTENT_BLOCK_OBJECT_TYPES`, restated rather than imported for the
 * same reason `sanity-content-tree.ts` restates `CATEGORY_DOCUMENT_TYPE`.
 *
 * Every array item Sanity stores carries its own stable `_key` automatically;
 * nothing here has to mint one. A heading's fragment anchor is derived from its
 * projected `text` by `src/lib/content-headings.ts`, not from that key, so a
 * reordered or edited heading still gets a deterministic, unique anchor.
 */

import { MEDIA_TYPE_NAME } from "./media";
import { POLL_TYPE_NAME } from "./poll";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

/**
 * The shared block kinds, extended by polls (ADR-0018), two-image
 * comparisons (ADR-0019, AB#23), and tab groups (ADR-0020, AB#163). Both
 * variants use the same authoring set.
 */
export const CONTENT_BLOCK_KINDS = [
  "paragraph",
  "heading",
  "list",
  "blockquote",
  "media",
  "youtube",
  "mini-gallery",
  "table",
  "poll",
  "image-comparison",
  "tab-group",
] as const;

export type ContentBlockKind = (typeof CONTENT_BLOCK_KINDS)[number];

/**
 * Domain discriminant → Sanity object type name. Exported so an adapter can
 * restate the same map without guessing a naming convention, and so a test can
 * pin both sides of it.
 */
export const CONTENT_BLOCK_OBJECT_TYPES: Readonly<
  Record<ContentBlockKind, string>
> = {
  paragraph: "contentParagraphBlock",
  heading: "contentHeadingBlock",
  list: "contentListBlock",
  blockquote: "contentQuoteBlock",
  media: "contentMediaBlock",
  youtube: "contentYoutubeBlock",
  "mini-gallery": "contentGalleryBlock",
  table: "contentTableBlock",
  poll: "contentPollBlock",
  "image-comparison": "contentImageComparisonBlock",
  "tab-group": "contentTabGroupBlock",
};

/**
 * Standard YouTube video id: eleven characters from the URL-safe base64
 * alphabet. Rejects a pasted full URL, which is a common authoring mistake a
 * privacy-first embed cannot silently repair.
 */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Restated by the public reader; tests pin both bounds. */
export const MAX_MINI_GALLERY_ITEMS = 12;
export const MAX_MINI_GALLERY_TITLE_LENGTH = 120;

/** Restated from `src/lib/content-table.ts`; a test pins both copies. */
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 20;

/** Restated from `src/lib/content-tab-group.ts`; a test pins both copies. */
export const MIN_TAB_GROUP_TABS = 2;
export const MAX_TAB_GROUP_TABS = 8;
export const MAX_TAB_LABEL_LENGTH = 80;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

/**
 * Rejects a blank item anywhere in the list. `required().min(1)` alone lets a
 * whitespace-only entry through the Studio editor, while the read-time
 * projector (`src/lib/sanity-content-blocks.ts#projectContentBlock`) requires
 * every item to be non-empty and rejects the whole block otherwise — so an
 * ordinary publish must not be able to create a list the adapter refuses.
 */
function nonBlankItems(
  value: readonly string[] | undefined,
): SchemaValidationResult {
  return value === undefined || value.every((item) => item.trim().length > 0)
    ? true
    : "Every item must be non-empty";
}

const spansField: SchemaFieldDefinition = {
  name: "spans",
  title: "Linked text",
  description: "Use this instead of Text when the paragraph contains links.",
  type: "array",
  of: [{ type: "contentInlineSpan" }],
  validation: (rule) => rule.min(1).max(MAX_CONTENT_INLINE_SPANS),
};

export const contentInlineTypes: readonly SchemaTypeDefinition[] = [
  {
    name: "contentInlineSpan",
    title: "Text run",
    type: "object",
    fields: [
      {
        name: "text",
        title: "Text (including spaces)",
        type: "text",
        validation: (rule) => rule.required().min(1).max(MAX_CONTENT_INLINE_TEXT),
      },
      {
        name: "href",
        title: "Link",
        type: "string",
        validation: (rule) => rule.custom((value) =>
          value == null || isContentInlineHref(value)
            ? true
            : "Enter an http(s) URL, root-relative path, or fragment",
        ),
      },
    ],
    preview: { select: { title: "text" } },
  },
  {
    name: "contentRichListItem",
    title: "Linked list item",
    type: "object",
    fields: [{ ...spansField, description: "The list item, including its links." }],
    preview: { select: { title: "spans.0.text" } },
  },
];

export function validateInlineChoice(value: unknown, kind: "paragraph" | "list"): SchemaValidationResult {
  if (!value || typeof value !== "object") return "Enter content";
  const row = value as Record<string, unknown>;
  const plain = kind === "paragraph" ? row.text : row.items;
  const rich = kind === "paragraph" ? row.spans : row.richItems;
  if ((plain != null) === (rich != null)) return "Choose either plain text or linked text";
  try {
    if (rich != null) {
      if (kind === "paragraph") readContentInlineSpans(rich);
      else readContentRichItems(rich);
    } else {
      const valid = kind === "paragraph"
        ? typeof plain === "string" && !!plain.trim()
        : Array.isArray(plain) && plain.length > 0 && plain.every(v => typeof v === "string" && v.trim());
      if (!valid) return "Enter non-empty text";
    }
    return true;
  } catch {
    return "Invalid linked text or link destination";
  }
}

const contentParagraphBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.paragraph,
  title: "Paragraph",
  type: "object",
  validation: rule => rule.custom(value => validateInlineChoice(value, "paragraph")),
  fields: [
    spansField,
    {
      name: "text",
      title: "Text",
      type: "text",
      validation: (rule) => rule.custom<string>(value => value == null ? true : nonBlank(value)),
    },
  ],
  preview: { select: { title: "text" } },
};

const contentHeadingBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.heading,
  title: "Heading",
  type: "object",
  description:
    "The page title owns the single h1, so a body heading starts at level 2.",
  fields: [
    {
      name: "level",
      title: "Level",
      type: "number",
      options: {
        list: [
          { title: "Heading 2", value: 2 },
          { title: "Heading 3", value: 3 },
          { title: "Heading 4", value: 4 },
        ],
        layout: "radio",
      },
      validation: (rule) =>
        rule.required().custom<number>((value) =>
          value === 2 || value === 3 || value === 4
            ? true
            : "Choose heading level 2, 3, or 4",
        ),
    },
    {
      name: "text",
      title: "Text",
      type: "string",
      validation: (rule) => rule.required().custom(nonBlank),
    },
  ],
  preview: { select: { title: "text", subtitle: "level" } },
};

const contentListBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.list,
  title: "List",
  type: "object",
  validation: rule => rule.custom(value => validateInlineChoice(value, "list")),
  fields: [
    {
      name: "richItems",
      title: "Linked list items",
      description: "Use this instead of Items when the list contains links.",
      type: "array",
      of: [{ type: "contentRichListItem" }],
      validation: (rule) => rule.min(1).max(MAX_CONTENT_RICH_ITEMS),
    },
    {
      name: "ordered",
      title: "Ordered",
      type: "boolean",
      description: "On for a numbered list, off for a bulleted one.",
      initialValue: false,
      validation: (rule) => rule.required(),
    },
    {
      name: "items",
      title: "Items",
      type: "array",
      of: [{ type: "string" }],
      validation: (rule) => rule.min(1).custom(nonBlankItems),
    },
  ],
  preview: { select: { title: "items.0", subtitle: "ordered" } },
};

const contentQuoteBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.blockquote,
  title: "Quote",
  type: "object",
  fields: [
    {
      name: "text",
      title: "Text",
      type: "text",
      validation: (rule) => rule.required().custom(nonBlank),
    },
    {
      name: "attribution",
      title: "Attribution",
      type: "string",
      description: "Optional: who or what is being quoted.",
    },
  ],
  preview: { select: { title: "text", subtitle: "attribution" } },
};

const contentMediaBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.media,
  title: "Media",
  type: "object",
  description:
    "A content placement, separate from a gallery's curated result set: it never enters the image grid, lightbox sequence, sections, or pagination (ADR-0003 decision 2).",
  fields: [
    {
      name: "media",
      title: "Media",
      type: "reference",
      to: [{ type: MEDIA_TYPE_NAME }],
      validation: (rule) => rule.required(),
    },
    {
      name: "caption",
      title: "Caption",
      type: "text",
      description: "Optional for this placement. It overrides the media's default caption only in this body.",
      validation: (rule) => rule.max(500).custom(nonBlank),
    },
  ],
  preview: { select: { title: "media.mediaId", media: "media.image" } },
};

/** Restated by the public adapter and converter; tests pin these bounds. */
export const MAX_COMPARISON_LABEL_LENGTH = 200;
export const MAX_COMPARISON_TITLE_LENGTH = 120;

const contentImageComparisonBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES["image-comparison"],
  title: "Image comparison",
  type: "object",
  description: "Two full-frame public images. Use matching aspect ratios for the interactive reveal; incompatible ratios remain complete images. Separate from all lightbox sequences.",
  fields: [
    {
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.max(MAX_COMPARISON_TITLE_LENGTH).custom<string>(
        (value) => value === undefined || value.trim().length > 0
          ? true : "Enter a non-empty title or leave it unset",
      ),
    },
    ...["first", "second"].map((name): SchemaFieldDefinition => ({
      name,
      title: name === "first" ? "First image" : "Second image",
      type: "reference",
      to: [{ type: MEDIA_TYPE_NAME }],
      validation: (rule) => rule.required(),
    })),
    ...["firstLabel", "secondLabel"].map((name): SchemaFieldDefinition => ({
      name,
      title: name === "firstLabel" ? "First image label" : "Second image label",
      type: "string",
      description: "Names this side of the comparison; does not replace the image's descriptive alt text.",
      validation: (rule) => rule.required().max(MAX_COMPARISON_LABEL_LENGTH).custom(nonBlank),
    })),
  ],
  preview: { select: { title: "title", subtitle: "firstLabel", media: "first.image" } },
};

const contentYoutubeBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.youtube,
  title: "YouTube (click to load)",
  type: "object",
  description:
    "Does not contact YouTube until the visitor explicitly loads the player, preserving the site's no-tracking-by-default policy.",
  fields: [
    {
      name: "videoId",
      title: "Video ID",
      type: "string",
      description:
        "The eleven-character id from the video's URL, e.g. dQw4w9WgXcQ — not the full link.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && YOUTUBE_VIDEO_ID_PATTERN.test(value)
            ? true
            : "Enter the eleven-character YouTube video id, not the full URL",
        ),
    },
    {
      name: "title",
      title: "Accessible title",
      type: "string",
      description: "Used as the load button's label and link text.",
      validation: (rule) => rule.required().custom(nonBlank),
    },
  ],
  preview: { select: { title: "title", subtitle: "videoId" } },
};

const contentGalleryBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES["mini-gallery"],
  title: "Mini-gallery",
  type: "object",
  description:
    "A small ordered set within the body, with its own viewer and no pagination.",
  fields: [
    {
      name: "title",
      title: "Title",
      type: "string",
      description: "Optional short title above the photographs.",
      validation: (rule) => rule.max(MAX_MINI_GALLERY_TITLE_LENGTH).custom<string>(
        (value) => value === undefined || value.trim().length > 0
          ? true
          : "Leave the title unset or enter non-empty text",
      ),
    },
    {
      name: "images",
      title: "Images",
      type: "array",
      of: [{
        type: "object",
        fields: [{
          name: "media",
          title: "Image",
          type: "reference",
          to: [{ type: MEDIA_TYPE_NAME }],
          validation: (rule) => rule.required(),
        }],
      }],
      validation: (rule) => rule.required().min(1).max(MAX_MINI_GALLERY_ITEMS),
    },
  ],
  preview: { select: { title: "title", media: "images.0.media.image" } },
};

/**
 * A local copy, the same way `article-validation.ts`, `category-validation.ts`,
 * and `gallery-validation.ts` each keep their own: these schemas import nothing
 * from `src/` (ADR-0006) and share no helper module of their own.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawTableRow = { readonly cells?: unknown };

/**
 * A table must be rectangular: every row carries exactly one cell per column
 * header. Checked on the object itself rather than on the `rows` field,
 * because a field-level rule is only handed its own value — `schema-types.ts`'s
 * `SchemaValidationContext` deliberately declares no `parent` — while the
 * object's own validator receives the whole `{caption, headers, rows}` value
 * and so can compare the two fields without widening a shared declaration.
 *
 * Deliberately silent about states another rule already reports: a missing or
 * non-array `headers`/`rows` is the field's own `required()`/`min()` business,
 * and an editor halfway through adding a row should see that one message, not
 * a second one blaming the row's width. It must also never throw — a
 * validator that dies mid-edit blocks Publish with no usable message at all.
 */
function validatesTableIsRectangular(
  value: unknown,
): SchemaValidationResult {
  if (!isRecord(value)) return true;
  const { headers, rows } = value as {
    readonly headers?: unknown;
    readonly rows?: unknown;
  };
  if (!Array.isArray(headers) || headers.length === 0) return true;
  if (!Array.isArray(rows)) return true;

  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const { cells } = row as RawTableRow;
    if (!Array.isArray(cells)) continue;
    if (cells.length !== headers.length) {
      return `Row ${index + 1} has ${cells.length} cell(s) but there are ${headers.length} column header(s). Every row needs one cell per column; leave a cell empty rather than dropping it.`;
    }
  }
  return true;
}

const contentTableBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.table,
  title: "Data table",
  type: "object",
  description:
    "A small comparison table. Plain text only, rendered as authored — no sorting, filtering, or column resizing.",
  fields: [
    {
      name: "caption",
      title: "Caption",
      type: "string",
      description:
        "Optional. Also names the table's scrollable region for screen readers and keyboard users.",
      validation: (rule) =>
        rule.custom<string>((value) =>
          value === undefined || value.trim().length > 0
            ? true
            : "Leave the caption unset or enter non-empty text",
        ),
    },
    {
      name: "headers",
      title: "Column headers",
      type: "array",
      of: [{ type: "string" }],
      description:
        "One per column. Every row below needs exactly this many cells.",
      validation: (rule) =>
        rule.required().min(1).max(MAX_TABLE_COLUMNS).custom(nonBlankItems),
    },
    {
      name: "rows",
      title: "Rows",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            {
              name: "cells",
              title: "Cells",
              type: "array",
              of: [{ type: "string" }],
              description:
                "One per column header, in order. A cell may be left empty.",
              validation: (rule) => rule.required().min(1).max(MAX_TABLE_COLUMNS),
            },
          ],
        },
      ],
      validation: (rule) => rule.required().min(1).max(MAX_TABLE_ROWS),
    },
  ],
  validation: (rule) => rule.custom(validatesTableIsRectangular),
  preview: { select: { title: "caption", subtitle: "headers.0" } },
};

/**
 * A bounded set of named tabs, each holding one data table (AB#163,
 * ADR-0020) — scoped to exactly the shape the legacy Bootstrap
 * `nav-tabs`/`tab-content` pattern that motivated it actually carried. A tab
 * is not a generic rich sub-body: its `table` field reuses
 * `contentTableBlockType` by name rather than restating headers/rows/caption
 * a second time, so a tab's own table gets the same rectangularity check for
 * free and the two can never drift apart.
 */
function nonBlankTabLabel(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0 && value.length <= MAX_TAB_LABEL_LENGTH
    ? true
    : `Enter a non-empty label of at most ${MAX_TAB_LABEL_LENGTH} characters`;
}

const contentTabGroupBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES["tab-group"],
  title: "Tab group",
  type: "object",
  description:
    "A bounded set of named tabs, each holding one data table. Every tab's table renders, stacked and labelled, without JavaScript.",
  fields: [
    {
      name: "tabs",
      title: "Tabs",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            {
              name: "label",
              title: "Label",
              type: "string",
              description: "The tab control's visible and accessible name.",
              validation: (rule) => rule.required().custom(nonBlankTabLabel),
            },
            {
              name: "table",
              title: "Table",
              type: CONTENT_BLOCK_OBJECT_TYPES.table,
              validation: (rule) => rule.required(),
            },
          ],
        },
      ],
      validation: (rule) => rule.required().min(MIN_TAB_GROUP_TABS).max(MAX_TAB_GROUP_TABS),
    },
  ],
  preview: { select: { title: "tabs.0.label" } },
};

/**
 * A placement, not an embed: this block carries no poll content of its own
 * (ADR-0018 §1) — question, options, and close date all live on the
 * referenced `poll` document, so an editor authors a poll once and can, in
 * principle, place it more than once without a copy to keep in sync.
 */
const contentPollBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.poll,
  title: "Poll",
  type: "object",
  description: "A vote on the referenced poll's question, open until its close date (ADR-0018).",
  fields: [
    {
      name: "poll",
      title: "Poll",
      type: "reference",
      to: [{ type: POLL_TYPE_NAME }],
      validation: (rule) => rule.required(),
    },
  ],
  preview: { select: { title: "poll.question", subtitle: "poll.pollId" } },
};

/** Every block object type, in one list a Studio's `schema.types` can spread in. */
export const contentBlockTypes: readonly SchemaTypeDefinition[] = [
  contentParagraphBlockType,
  contentHeadingBlockType,
  contentListBlockType,
  contentQuoteBlockType,
  contentMediaBlockType,
  contentYoutubeBlockType,
  contentGalleryBlockType,
  contentTableBlockType,
  contentPollBlockType,
  contentImageComparisonBlockType,
  contentTabGroupBlockType,
];

type RawHeadingItem = { readonly _type?: unknown; readonly level?: unknown };

/**
 * The page title owns the single h1 (see `contentHeadingBlockType`'s own
 * description), so a body's first heading has to be level 2. Beyond that, a
 * heading may stay level, descend one level deeper, or return to any
 * shallower level, but never skip a level going deeper (AB#21, generalizing
 * the original two-level rule). Restates
 * `content-page.ts#assertSemanticHeadingOrder` as a Studio-facing message
 * rather than a thrown error: schemas import nothing from `src/` (ADR-0006),
 * so the two sides are pinned equal by a test instead. The field-level
 * `level` validator on `contentHeadingBlockType` above only ever sees one
 * heading's own value, never the body's order, so this array-level check is
 * the only place that can see the whole sequence.
 */
function validatesSemanticHeadingOrder(
  value: readonly RawHeadingItem[] | undefined,
): SchemaValidationResult {
  if (value === undefined) return true;
  let previousLevel: number | undefined;
  for (const item of value) {
    if (item._type !== CONTENT_BLOCK_OBJECT_TYPES.heading) continue;
    // Deliberately `=== 2 || 3 || 4`, not "anything that isn't the expected
    // next level": a heading block an editor has just added and not yet
    // assigned a level to has `level === undefined`, which the field's own
    // `required()` rule already reports. Treating that transient, mid-edit
    // state as an order violation would show a second, misleading message
    // for a block that has no heading level at all yet — and it must not
    // reset `previousLevel` either, the same way a non-heading block doesn't.
    if (item.level !== 2 && item.level !== 3 && item.level !== 4) continue;
    if (previousLevel === undefined) {
      if (item.level !== 2) {
        return "The body's first heading must be level 2. The page title owns h1, so nothing may appear above it.";
      }
    } else if (item.level > previousLevel + 1) {
      return `A heading skips from level ${previousLevel} to level ${item.level}. A heading may only stay level, descend one level, or return to any shallower level.`;
    }
    previousLevel = item.level;
  }
  return true;
}

/**
 * Builds a body field restricted to the given block kinds — every kind by
 * default, matching ADR-0003 decision 2's shared allow-list. A narrower
 * context, such as a future gallery section introduction, passes its own
 * smaller `allowedTypes` instead of a second field-building function.
 *
 * `validatesSemanticHeadingOrder` always applies, regardless of a caller's
 * own `validation` option: it is composed onto the same rule rather than
 * replaced by it, the way `rule.required().custom(fn)` chains in the Sanity
 * docs — so `article.ts`'s `.required().min(1)` and this heading-order check
 * both bind the same field, and a caller cannot accidentally opt out of the
 * structural invariant just by supplying its own extra rules.
 */
export function defineContentBodyField(options: {
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly allowedTypes?: readonly ContentBlockKind[];
  readonly validation?: SchemaFieldDefinition["validation"];
}): SchemaFieldDefinition {
  const allowed = options.allowedTypes ?? CONTENT_BLOCK_KINDS;
  return {
    name: options.name,
    title: options.title,
    type: "array",
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    of: allowed.map((kind) => ({ type: CONTENT_BLOCK_OBJECT_TYPES[kind] })),
    validation: (rule) => {
      const withHeadingOrder = rule.custom<readonly RawHeadingItem[]>(
        validatesSemanticHeadingOrder,
      );
      return options.validation === undefined
        ? withHeadingOrder
        : options.validation(withHeadingOrder);
    },
  };
}
