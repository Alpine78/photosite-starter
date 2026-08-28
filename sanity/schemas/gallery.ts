/**
 * The public gallery document: the `gallery` variant of `content-page.ts`'s
 * shared content page (ADR-0003 decision 1), and the Studio-facing half of
 * `gallery-pagination.ts`'s `CuratedGalleryPlacement` and `gallery-
 * sections.ts`'s `GallerySection` (AB#113).
 *
 * ## One document per language, like `article.ts` — not like `category.ts`
 *
 * `GallerySection.label`/`intro` are plain `string`/blocks, matching
 * `GalleryContentPage`'s own shape (`title`, `summary`, `body` are plain
 * per-language fields, exactly like `ArticleContentPage`) — not `category.ts`'s
 * one-document-every-language model. So this is one document per language,
 * identified by `contentId` + `language` together, mirroring `article.ts`
 * field for field on the page-level fields. Sections are gallery-local (AB#105:
 * "membership is placement-owned, never media-owned") and stay embedded here —
 * a gallery declares at most `MAX_GALLERY_SECTIONS` (20), never the pagination
 * bottleneck a placement list is.
 *
 * ## Placements live in `gallery-placement.ts`, not here
 *
 * AB#113 originally embedded a gallery's placements as one array field on this
 * document. AB#114 found that incompatible with its own "bounded, without
 * loading the complete gallery" requirement — Sanity's Content Lake filters
 * and projects whole documents, with no way to keyset-paginate a slice of one
 * document's array field, and a ~400-placement gallery at ADR-0002 §1's field
 * set already approaches Sanity's own 1,000-attribute document ceiling
 * (verified against Sanity's technical-limits documentation). Each placement
 * is therefore its own `galleryPlacement` document, referencing this one by
 * `gallery` — see that file's module comment for what stayed the same
 * (identity, uniqueness, immutability, visibility composing by AND per
 * ADR-0002 §3) and what changed (`order` is authored, not array position).
 *
 * ## What is deliberately not here
 *
 * **The bounded placement/section query and the cover fallback to the first
 * visible placement.** AB#114 owns both; this schema only stores an explicit
 * `cover` override.
 *
 * **AB#129's shuffle key.** `orderingRule`/`orderingSeed` declare a
 * seeded-random gallery; the materialized sort key each placement needs lives
 * on `galleryPlacement` (`shuffledOrder`/`shuffledOrderSeed`), written by
 * `npm run recompute:shuffled-order`, not here. This schema no longer blocks
 * publishing `seeded-random` (AB#129 PR2 lifted that): a routine publish is
 * allowed, and if the placements' keys do not yet match the current seed the
 * public adapter serves the gallery as temporarily unavailable
 * (`SanityGalleryError "ordering-stale"`) until the recompute runs. ADR-0009
 * and its 2026-08-28 amendment decide that two-step contract.
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
const SECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Restates `gallery-sections.ts`'s `RESERVED_ALL_SECTION_SLUG`. */
const RESERVED_ALL_SECTION_SLUG = "all";

/**
 * Restates `gallery-sections.ts`'s own bounds for its `sections` array and
 * each entry's fields — schemas cannot import `src/lib` (ADR-0006), so these
 * are duplicated here and pinned equal by a test, the same as
 * `MAX_PLACEMENT_ID_LENGTH` in `gallery-placement.ts`. Without them, an
 * ordinary Studio publish can create a section catalog
 * `assertGallerySections` refuses at read time — too many sections, or an
 * overlong id/slug/label — rejecting the whole gallery for something Studio
 * itself allowed onto the page.
 */
export const MAX_GALLERY_SECTIONS = 20;
export const MAX_SECTION_ID_LENGTH = 248;
export const MAX_SECTION_SLUG_LENGTH = 256;
export const MAX_SECTION_LABEL_LENGTH = 256;

export const ORDERING_RULES = ["manual", "seeded-random"] as const;
type OrderingRule = (typeof ORDERING_RULES)[number];

/**
 * Restates `src/lib/gallery-pagination.ts`'s `MAX_GALLERY_ORDERING_SEED_LENGTH`
 * (a schema imports nothing from `src/` — ADR-0006), pinned equal by a test.
 * The seed rides inside `GalleryCursorScope.ordering` as
 * `seeded-random-v1:<seed>`, which is bounded to 256 chars; the 17-char prefix
 * leaves 239 for the seed itself. Without this a Studio publish could mint a
 * seed the pagination boundary later rejects.
 */
export const MAX_ORDERING_SEED_LENGTH = 256 - "seeded-random-v1:".length;

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
    if (value === undefined || value.trim().length === 0) {
      return "orderingSeed is required while orderingRule is seeded-random";
    }
    // Surrounding whitespace is rejected, not silently trimmed: the seed is
    // stored verbatim on the gallery, written verbatim as `shuffledOrderSeed`
    // on each placement by the recompute step, and compared for equality in
    // the adapter's stale-count query. A trim anywhere in that chain that is
    // not applied everywhere would leave the gallery permanently
    // `ordering-stale` (AB#129).
    if (value !== value.trim()) {
      return "orderingSeed must not begin or end with whitespace";
    }
    return value.length <= MAX_ORDERING_SEED_LENGTH
      ? true
      : `Keep the ordering seed to ${MAX_ORDERING_SEED_LENGTH} characters or fewer`;
  }
  return value === undefined
    ? true
    : "orderingSeed is only used while orderingRule is seeded-random";
}

const sectionsField: SchemaFieldDefinition = {
  name: "sections",
  title: "Sections",
  type: "array",
  description: `Named, ordered subsets of this gallery's placements (AB#105). At most ${MAX_GALLERY_SECTIONS}.`,
  validation: (rule) => rule.max(MAX_GALLERY_SECTIONS),
  of: [
    {
      type: "object",
      fields: [
        {
          name: "sectionId",
          title: "Section ID",
          type: "string",
          validation: (rule) =>
            rule.required().custom<string>((value) => {
              if (value === undefined || !SECTION_ID.test(value)) {
                return "Use lowercase letters, digits, and single hyphens";
              }
              return value.length <= MAX_SECTION_ID_LENGTH
                ? true
                : `Keep section id to ${MAX_SECTION_ID_LENGTH} characters or fewer`;
            }),
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
              if (value === RESERVED_ALL_SECTION_SLUG) {
                return `"${RESERVED_ALL_SECTION_SLUG}" is reserved for the unfiltered view`;
              }
              return value.length <= MAX_SECTION_SLUG_LENGTH
                ? true
                : `Keep the path segment to ${MAX_SECTION_SLUG_LENGTH} characters or fewer`;
            }),
        },
        {
          name: "label",
          title: "Label",
          type: "string",
          validation: (rule) =>
            rule.required().custom<string>((value) => {
              if (value === undefined || value.trim().length === 0) {
                return "Enter a non-empty value";
              }
              return value.length <= MAX_SECTION_LABEL_LENGTH
                ? true
                : `Keep the label to ${MAX_SECTION_LABEL_LENGTH} characters or fewer`;
            }),
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
        "Manual places items in each placement's authored order. Seeded-random shuffles them deterministically (ADR-0009): pinned leads stay put, the rest are ordered by a materialized key. After choosing Seeded-random, or changing the seed below, run \"npm run recompute:shuffled-order\" — until it completes the public site serves the gallery as temporarily unavailable.",
      initialValue: "manual" satisfies OrderingRule,
      options: {
        list: ORDERING_RULES.map((value) => ({
          title: value === "manual" ? "Manual (placement order)" : "Seeded random",
          value,
        })),
        layout: "radio",
      },
      validation: (rule) =>
        rule.required().custom<string>((value) => {
          if (value === undefined || !(ORDERING_RULES as readonly string[]).includes(value)) {
            return `Choose one of: ${ORDERING_RULES.join(", ")}`;
          }
          return true;
        }),
    },
    {
      name: "orderingSeed",
      title: "Ordering seed",
      type: "string",
      description:
        "Required exactly when ordering is seeded-random; unused otherwise. Changing it re-shuffles the gallery — run \"npm run recompute:shuffled-order\" afterwards (ADR-0009).",
      validation: (rule) => rule.custom(validatesOrderingSeed),
    },
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
