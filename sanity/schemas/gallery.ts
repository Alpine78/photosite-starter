/**
 * The public gallery document: the `gallery` variant of `content-page.ts`'s
 * shared content page (ADR-0003 decision 1), and the Studio-facing half of
 * `gallery-pagination.ts`'s `CuratedGalleryPlacement` and `gallery-
 * sections.ts`'s `GallerySection` (AB#113).
 *
 * ## One document per language, like `article.ts` — not like `category.ts`
 *
 * `CuratedGalleryPlacement.altOverride`/`captionOverride` are plain `string`
 * (not language-keyed arrays), and `GallerySection.label`/`intro` are plain
 * `string`/blocks. That matches `GalleryContentPage`'s own shape (`title`,
 * `summary`, `body` are plain per-language fields, exactly like
 * `ArticleContentPage`) — not `category.ts`'s one-document-every-language
 * model. So this is one document per language, identified by `contentId` +
 * `language` together, mirroring `article.ts` field for field on the page-level
 * fields. Placements and sections are gallery-local (AB#105: "membership is
 * placement-owned, never media-owned"), so they live as object arrays directly
 * on this document rather than as separate document types.
 *
 * ## ADR-0002 obligations
 *
 * `placementId` is public and site-wide unique, with an immutable media/
 * container binding (ADR-0002 §1) — enforced document-level by
 * `validateGalleryPlacements` in `gallery-validation.ts`, since it needs to
 * compare against every other gallery in the dataset, not just this document's
 * own array. Repeating a `mediaId` within one gallery is allowed but the
 * `placements` field below carries a `warning()` (ADR-0002 §2) — Sanity's
 * non-blocking severity, not `custom`'s hard error. Visibility composes by AND
 * (ADR-0002 §3): the `visible` field here is only the placement's own
 * subtractive bit; whether the referenced media is itself publicly renderable
 * is read separately by the adapter (`src/lib/sanity-gallery.ts`) and ANDed in
 * at project time — a placement referencing non-public media is never a reason
 * to reject this document.
 *
 * ## What is deliberately not here
 *
 * **The bounded placement/section query and the cover fallback to the first
 * visible placement.** AB#114 owns both; this schema only stores an explicit
 * `cover` override.
 *
 * **AB#129's shuffle algorithm.** `orderingRule`/`orderingSeed` exist and are
 * validated so a gallery can already declare intent to use a seeded-random
 * order and carry the seed input, but nothing here computes or consumes an
 * order from them — manual (array position) is the only rule actually applied
 * anywhere yet.
 */

import { CATEGORY_TYPE_NAME } from "./category";
import {
  CONTENT_BLOCK_KINDS,
  defineContentBodyField,
} from "./content-block";
import {
  makeContentIdentityValidator,
  rejectsSecondaryCategoryOverlap,
} from "./content-placement-validation";
import { validateGalleryPublication } from "./gallery-validation";
import { defineGallerySectionIntroField } from "./gallery-section-intro";
import { LANGUAGE_SUBTAG } from "./localized-text";
import { LOCALIZED_SLUG_PATTERN } from "./localized-slug";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

export const GALLERY_TYPE_NAME = "gallery";

/** Same shape as `article.ts`'s `contentId` — never derived, hand-minted. */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Site-wide unique (ADR-0002 §1); same shape as every other hand-minted id. */
const PLACEMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Restates `gallery-sections.ts`'s `RESERVED_ALL_SECTION_SLUG`. */
const RESERVED_ALL_SECTION_SLUG = "all";

const ORDERING_RULES = ["manual", "seeded-random"] as const;
type OrderingRule = (typeof ORDERING_RULES)[number];

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

/**
 * Syntax, per-language uniqueness across every public content type, and
 * immutability — the same three questions `article.ts`'s `validateArticleIdentity`
 * asks, sharing the exact implementation, so a `contentId` cannot be claimed by
 * both an article and a gallery, and cannot change variant between its own
 * language versions.
 */
const validateGalleryIdentity = makeContentIdentityValidator({
  ownType: GALLERY_TYPE_NAME,
  siblingTypes: ["article", "gallery"],
  idPattern: CONTENT_ID,
  idHint: "Use lowercase letters, digits, and single hyphens, e.g. northern-coast-2026",
});

type RawOrderingDocument = { readonly orderingRule?: unknown };

function validatesOrderingSeed(
  value: string | undefined,
  context: { readonly document?: Readonly<Record<string, unknown>> },
): SchemaValidationResult {
  const rule = (context.document as RawOrderingDocument | undefined)?.orderingRule;
  if (rule === "seeded-random") {
    return value !== undefined && value.trim().length > 0
      ? true
      : "orderingSeed is required while orderingRule is seeded-random";
  }
  return value === undefined
    ? true
    : "orderingSeed is only used while orderingRule is seeded-random";
}

type RawPlacementItem = { readonly media?: { readonly _ref?: unknown } };

/**
 * ADR-0002 §2: allowed, but flagged. Pure array scan, no query — a placement's
 * uniqueness against other *documents'* placements is `validateGalleryPlacements`
 * (`gallery-validation.ts`)'s job, which does need a query.
 */
function warnsAboutRepeatedMedia(
  value: readonly RawPlacementItem[] | undefined,
): SchemaValidationResult {
  if (value === undefined) return true;
  const seen = new Set<string>();
  for (const item of value) {
    const ref = item.media?._ref;
    if (typeof ref !== "string") continue;
    if (seen.has(ref)) {
      return "This gallery repeats a photograph across more than one placement. Allowed (ADR-0002 §2), but confirm it is intentional — an accidental repeat is otherwise easy to miss in a large gallery.";
    }
    seen.add(ref);
  }
  return true;
}

const placementsField: SchemaFieldDefinition = {
  name: "placements",
  title: "Placements",
  type: "array",
  description:
    "The gallery's curated, ordered items. Position in this list is the manual order (ADR-0002).",
  of: [
    {
      type: "object",
      fields: [
        {
          name: "placementId",
          title: "Placement ID",
          type: "string",
          description:
            "Site-wide unique occurrence identity (ADR-0002 §1). Replacing the media or moving this placement to another gallery requires a new placement id.",
          validation: (rule) =>
            rule.required().custom<string>((value) =>
              value !== undefined && PLACEMENT_ID.test(value)
                ? true
                : "Use lowercase letters, digits, and single hyphens, e.g. northern-coast-2026-01",
            ),
        },
        {
          name: "media",
          title: "Media",
          type: "reference",
          to: [{ type: MEDIA_TYPE_NAME }],
          validation: (rule) => rule.required(),
        },
        {
          name: "sectionId",
          title: "Section",
          type: "string",
          description:
            "This gallery's own section id, if any (AB#105). Validated against the sections declared below.",
        },
        {
          name: "visible",
          title: "Visible",
          type: "boolean",
          description:
            "This placement's own visibility. Can only subtract from a publicly renderable photograph's visibility, never add to it (ADR-0002 §3).",
          initialValue: true,
          validation: (rule) => rule.required(),
        },
        {
          name: "pinned",
          title: "Pinned lead",
          type: "boolean",
          description:
            "Keeps this placement first when a seeded-random ordering rule is active (AB#129). Not yet consumed by any ordering logic.",
          initialValue: false,
        },
        {
          name: "altOverride",
          title: "Alt text override",
          type: "string",
          description:
            "Optional, exceptional context override. May be left empty when this occurrence is decorative or redundant here.",
        },
        {
          name: "captionOverride",
          title: "Caption override",
          type: "string",
          description: "Optional. Falls back to the photograph's own caption.",
        },
      ],
    },
  ],
  validation: (rule) =>
    rule.warning<readonly RawPlacementItem[]>(warnsAboutRepeatedMedia),
};

const sectionsField: SchemaFieldDefinition = {
  name: "sections",
  title: "Sections",
  type: "array",
  description: "Named, ordered subsets of this gallery's placements (AB#105).",
  of: [
    {
      type: "object",
      fields: [
        {
          name: "sectionId",
          title: "Section ID",
          type: "string",
          validation: (rule) =>
            rule.required().custom<string>((value) =>
              value !== undefined && SECTION_ID.test(value)
                ? true
                : "Use lowercase letters, digits, and single hyphens",
            ),
        },
        {
          name: "slug",
          title: "Path segment",
          type: "string",
          validation: (rule) =>
            rule.required().custom<string>((value) => {
              if (value === undefined || !SECTION_SLUG_PATTERN.test(value)) {
                return "Use lowercase letters, digits, and single hyphens";
              }
              return value === RESERVED_ALL_SECTION_SLUG
                ? `"${RESERVED_ALL_SECTION_SLUG}" is reserved for the unfiltered view`
                : true;
            }),
        },
        {
          name: "label",
          title: "Label",
          type: "string",
          validation: (rule) => rule.required().custom(nonBlank),
        },
        defineGallerySectionIntroField({
          name: "intro",
          title: "Introduction",
          description: "A short introduction shown once, on this section's first page.",
        }),
      ],
    },
  ],
};

export const galleryType: SchemaTypeDefinition = {
  name: GALLERY_TYPE_NAME,
  title: "Gallery",
  type: "document",
  description:
    "One curated gallery, in one language. Its placements are the image grid; its optional body is separate editorial content (ADR-0003 decision 2/5).",
  validation: (rule) =>
    rule.custom<Readonly<Record<string, unknown>>>((value, context) =>
      validateGalleryPublication(value, context, GALLERY_TYPE_NAME)),
  fields: [
    {
      name: "contentId",
      title: "Content ID",
      type: "string",
      description:
        "Stable identity shared by every language version of this page. Mint it once and never change it.",
      validation: (rule) => rule.required().custom(validateGalleryIdentity),
    },
    {
      name: "language",
      title: "Language",
      type: "string",
      description: "Language subtag this document is written in, e.g. fi or en.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LANGUAGE_SUBTAG.test(value)
            ? true
            : "Use a two- or three-letter lowercase language subtag, e.g. fi or en",
        ),
    },
    {
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required().custom(nonBlank),
    },
    {
      name: "slug",
      title: "Path segment",
      type: "string",
      description:
        "Lowercase, hyphenated path segment for this language. Stable once published; an explicit URL-change workflow records redirect history for a later change.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LOCALIZED_SLUG_PATTERN.test(value)
            ? true
            : "Use lowercase letters, digits, and single hyphens",
        ),
    },
    {
      name: "summary",
      title: "Short lead",
      type: "text",
      description: "Shown at the head of the page, above the grid (AB#106).",
    },
    {
      name: "publishedAt",
      title: "Published",
      type: "datetime",
      validation: (rule) => rule.required(),
    },
    {
      name: "cover",
      title: "Cover",
      type: "reference",
      to: [{ type: MEDIA_TYPE_NAME }],
      description:
        "Optional explicit listing cover. Left empty, the public read falls back to the first visible placement (AB#114) — that fallback is not resolved here.",
    },
    {
      name: "tags",
      title: "Tags",
      type: "array",
      of: [{ type: "string" }],
    },
    {
      name: "canonicalCategory",
      title: "Canonical category",
      type: "reference",
      to: [{ type: CATEGORY_TYPE_NAME }],
      description:
        "The one category that owns this page's public detail route and breadcrumb. Required to publish; a draft may stay unplaced.",
      validation: (rule) => rule.required(),
    },
    {
      name: "secondaryCategories",
      title: "Secondary categories",
      type: "array",
      of: [{ type: "reference", to: [{ type: CATEGORY_TYPE_NAME }] }],
      validation: (rule) =>
        rule.custom<readonly { readonly _ref?: unknown }[]>(
          rejectsSecondaryCategoryOverlap,
        ),
    },
    {
      name: "orderingRule",
      title: "Ordering",
      type: "string",
      description:
        "Manual is the only rule actually applied today. Seeded-random is reserved for AB#129.",
      initialValue: "manual" satisfies OrderingRule,
      options: {
        list: ORDERING_RULES.map((value) => ({
          title: value === "manual" ? "Manual (placement order)" : "Seeded random",
          value,
        })),
        layout: "radio",
      },
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && (ORDERING_RULES as readonly string[]).includes(value)
            ? true
            : `Choose one of: ${ORDERING_RULES.join(", ")}`,
        ),
    },
    {
      name: "orderingSeed",
      title: "Ordering seed",
      type: "string",
      description:
        "Required exactly when ordering is seeded-random; unused otherwise (AB#129).",
      validation: (rule) => rule.custom(validatesOrderingSeed),
    },
    placementsField,
    sectionsField,
    defineContentBodyField({
      name: "body",
      title: "Body",
      description: `Optional long-form editorial content, separate from the curated grid above: ${CONTENT_BLOCK_KINDS.join(", ")}.`,
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "slug", media: "cover.image" },
  },
};
