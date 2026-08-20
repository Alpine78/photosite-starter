/**
 * The shared rich-content body blocks ADR-0003 decision 2 gives both public
 * content variants: paragraph, heading, blockquote, media placement, list, and
 * a privacy-first YouTube embed.
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
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

/** The six block kinds ADR-0003 decision 2 names, in the order it lists them. */
export const CONTENT_BLOCK_KINDS = [
  "paragraph",
  "heading",
  "list",
  "blockquote",
  "media",
  "youtube",
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
};

/**
 * Standard YouTube video id: eleven characters from the URL-safe base64
 * alphabet. Rejects a pasted full URL, which is a common authoring mistake a
 * privacy-first embed cannot silently repair.
 */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

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

const contentParagraphBlockType: SchemaTypeDefinition = {
  name: CONTENT_BLOCK_OBJECT_TYPES.paragraph,
  title: "Paragraph",
  type: "object",
  fields: [
    {
      name: "text",
      title: "Text",
      type: "text",
      validation: (rule) => rule.required().custom(nonBlank),
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
        ],
        layout: "radio",
      },
      validation: (rule) =>
        rule.required().custom<number>((value) =>
          value === 2 || value === 3 ? true : "Choose heading level 2 or 3",
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
  fields: [
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
      validation: (rule) => rule.required().min(1).custom(nonBlankItems),
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
  ],
  preview: { select: { title: "media.mediaId", media: "media.image" } },
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

/** Every block object type, in one list a Studio's `schema.types` can spread in. */
export const contentBlockTypes: readonly SchemaTypeDefinition[] = [
  contentParagraphBlockType,
  contentHeadingBlockType,
  contentListBlockType,
  contentQuoteBlockType,
  contentMediaBlockType,
  contentYoutubeBlockType,
];

type RawHeadingItem = { readonly _type?: unknown; readonly level?: unknown };

/**
 * The page title owns the single h1 (see `contentHeadingBlockType`'s own
 * description), so a body's first heading has to be level 2 — a level-3
 * heading appearing before any level-2 heading would skip a level. Restates
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
  let sawLevel2 = false;
  for (const item of value) {
    if (item._type !== CONTENT_BLOCK_OBJECT_TYPES.heading) continue;
    if (item.level === 2) {
      sawLevel2 = true;
    } else if (item.level === 3 && !sawLevel2) {
      // Deliberately `=== 3`, not "anything that isn't 2": a heading block
      // an editor has just added and not yet assigned a level to has
      // `level === undefined`, which the field's own `required()` rule
      // already reports. Treating that transient, mid-edit state as "a
      // level-3 heading out of order" would show a second, misleading
      // message for a block that has no heading level at all yet.
      return "A level-3 heading appears before any level-2 heading. The page title owns h1, so the body's first heading must be level 2.";
    }
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
