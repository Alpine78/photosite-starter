/**
 * The public article document: the `article` variant of `content-page.ts`'s
 * shared content page (ADR-0003 decision 1).
 *
 * ## One document per language, unlike a category
 *
 * `category.ts` is one document describing every published language, because a
 * category has no per-language publication lifecycle of its own to preserve.
 * An article does: ADR-0003 decision 7 lets a page's languages be authored,
 * reviewed, and published independently, and AB#125's later localized-version
 * workflow starts a new language as its own linked draft. So this document
 * carries one language's text directly — `title`, `slug`, `summary`, and `body`
 * are plain fields, not `localizedText`/`localizedSlug` arrays — and `language`
 * plus the immutable `contentId` together identify one version. Two documents
 * may legitimately share a `contentId` (one per published language); no two may
 * share both `contentId` and `language`.
 *
 * ## Canonical placement follows AB#102, tags stay separate
 *
 * `category.ts`'s module comment reserves `canonicalCategory` and
 * `secondaryCategories` for the documents that place themselves — this is one
 * of the two (`sanity/schemas/README` at AB#113 time adds the other, for
 * galleries). `content-tree.ts` remains the authoritative backstop; this
 * schema only keeps a standard Studio publish from creating the state that
 * backstop exists to catch: `canonicalCategory` is required, so the ordinary
 * editor cannot publish an article with no canonical placement (Sanity's own
 * validation model blocks *publishing*, not saving a draft, which is exactly
 * ADR-0003 decision 5's "draft content may remain unplaced while it is being
 * authored"). `tags` are free keywords, unrelated to categories and consuming
 * no tree depth (ADR-0003 decision 4).
 *
 * ## Body
 *
 * `body` is `defineContentBodyField` with every shared block kind allowed
 * (ADR-0003 decision 2) — the same call a gallery's own optional body will
 * make. Media placed there is a body placement, never the gallery's curated
 * result set.
 *
 * ## What is deliberately not here
 *
 * **The gallery variant.** A separate `gallery` document type is AB#113's,
 * once the project-owned gallery, section, and media-placement contracts are
 * stable — this schema does not grow a variant switch.
 *
 * **Publication state.** Native Sanity draft/publish, exactly as `media.ts` and
 * `category.ts` reason: `sanity-client.ts` asks only for the published
 * perspective, so an unpublished article is not filtered out, it is not in the
 * data at all.
 */

import { validateArticlePublication } from "./article-validation";
import {
  CONTENT_BLOCK_KINDS,
  defineContentBodyField,
} from "./content-block";
import { CATEGORY_TYPE_NAME } from "./category";
import {
  makeContentIdentityValidator,
  rejectsSecondaryCategoryOverlap,
} from "./content-placement-validation";
import { LANGUAGE_SUBTAG } from "./localized-text";
import { LOCALIZED_SLUG_PATTERN } from "./localized-slug";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaTypeDefinition,
  SchemaValidationResult,
} from "./schema-types";

export const ARTICLE_TYPE_NAME = "article";

/**
 * `contentId` is minted by hand, like `categoryId` and `mediaId`: never
 * derived from `_id`, `slug`, or `title`, none of which is stable across a
 * rename, a URL change, or a translation.
 */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0
    ? true
    : "Enter a non-empty value";
}

/**
 * Syntax, per-language uniqueness (across every public content type, not just
 * other articles — AB#113 widens this from article-only), and immutability, in
 * one round trip — the same three questions `media.ts`'s `validateMediaIdentity`
 * asks, scoped by `language` because unlike a photograph's `mediaId`, one
 * `contentId` legitimately identifies several documents: one per published
 * language. Also refuses a `contentId` already claimed by a gallery in another
 * language, since a page's variant cannot change between language versions.
 */
const validateArticleIdentity = makeContentIdentityValidator({
  ownType: ARTICLE_TYPE_NAME,
  siblingTypes: ["article", "gallery"],
  idPattern: CONTENT_ID,
  idHint: "Use lowercase letters, digits, and single hyphens, e.g. reading-coastal-light",
});

export const articleType: SchemaTypeDefinition = {
  name: ARTICLE_TYPE_NAME,
  title: "Article",
  type: "document",
  description:
    "One editorial page, in one language. Its body is the page — it does not gain a gallery result set from media placed in it (ADR-0003 decision 1).",
  validation: (rule) =>
    rule.custom<Readonly<Record<string, unknown>>>((value, context) =>
      validateArticlePublication(value, context, ARTICLE_TYPE_NAME)),
  fields: [
    {
      name: "contentId",
      title: "Content ID",
      type: "string",
      description:
        "Stable identity shared by every language version of this page. Mint it once and never change it — moves, renames, and translations must leave it alone.",
      validation: (rule) => rule.required().custom(validateArticleIdentity),
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
      description: "Owns the page's single h1; a body heading starts at level 2.",
      validation: (rule) => rule.required().custom(nonBlank),
    },
    {
      name: "slug",
      title: "Path segment",
      type: "string",
      description:
        "Lowercase, hyphenated path segment for this language, e.g. reading-coastal-light. Stable once published (ADR-0003 decision 7); an explicit URL-change workflow records redirect history for a later change.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && LOCALIZED_SLUG_PATTERN.test(value)
            ? true
            : "Use lowercase letters, digits, and single hyphens, e.g. reading-coastal-light",
        ),
    },
    {
      name: "summary",
      title: "Short lead",
      type: "text",
      description: "Shown on listing cards and at the head of the page.",
    },
    {
      name: "publishedAt",
      title: "Published",
      type: "datetime",
      description:
        "When this page went live here. Technical bookkeeping only (AB#150, ADR-0017) — it no longer orders listings or renders anywhere; set Event date below if the page should be ordered and dated by something else.",
      validation: (rule) => rule.required(),
    },
    {
      name: "eventDate",
      title: "Event date",
      type: "datetime",
      description:
        "Optional. When the real-world event or session this page documents actually happened, if that differs from when it was published here — for example, publishing an earlier trip's gallery after a later one is already live. Left empty, the page is ordered and dated by Published above, exactly as before (AB#150, ADR-0017).",
    },
    {
      name: "endDate",
      title: "Scheduled end date",
      type: "datetime",
      description:
        "Optional. Once this time passes, the page is automatically treated as unpublished everywhere — removed from listings and the sitemap, and its own address answers not found — without unpublishing it by hand. Leave empty for a page with no scheduled end (AB#150, ADR-0017).",
    },
    {
      name: "cover",
      title: "Cover",
      type: "reference",
      to: [{ type: MEDIA_TYPE_NAME }],
      description:
        "Optional. A page with none renders as a text card rather than borrowing another page's image.",
    },
    {
      name: "tags",
      title: "Tags",
      type: "array",
      of: [{ type: "string" }],
      description:
        "Free keywords, separate from categories: they consume no tree depth and own no public route (ADR-0003 decision 4).",
    },
    {
      name: "canonicalCategory",
      title: "Canonical category",
      type: "reference",
      to: [{ type: CATEGORY_TYPE_NAME }],
      description:
        "The one category that owns this page's public detail route and breadcrumb (ADR-0003 decision 5). Required to publish; a draft may stay unplaced.",
      validation: (rule) => rule.required(),
    },
    {
      name: "secondaryCategories",
      title: "Secondary categories",
      type: "array",
      of: [{ type: "reference", to: [{ type: CATEGORY_TYPE_NAME }] }],
      description:
        "Additional listing categories. Each links to the one canonical detail route rather than creating a second page.",
      validation: (rule) =>
        rule.custom<readonly { readonly _ref?: unknown }[]>(
          rejectsSecondaryCategoryOverlap,
        ),
    },
    defineContentBodyField({
      name: "body",
      title: "Body",
      description: `The page's editorial content: ${CONTENT_BLOCK_KINDS.join(", ")}.`,
      validation: (rule) => rule.required().min(1),
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "slug", media: "cover.image" },
  },
};
