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

import {
  CONTENT_BLOCK_KINDS,
  defineContentBodyField,
} from "./content-block";
import { CATEGORY_TYPE_NAME } from "./category";
import { LANGUAGE_SUBTAG } from "./localized-text";
import { LOCALIZED_SLUG_PATTERN } from "./localized-slug";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

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
 * Syntax, per-language uniqueness, and immutability, in one round trip — the
 * same three questions `media.ts`'s `validateMediaIdentity` asks, scoped by
 * `language` because unlike a photograph's `mediaId`, one `contentId`
 * legitimately identifies several documents: one per published language.
 */
async function validateArticleIdentity(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !CONTENT_ID.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. reading-coastal-light";
  }

  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;

  const language = context.document?.language;
  if (typeof language !== "string" || !LANGUAGE_SUBTAG.test(language)) {
    // The language field's own validation reports this defect.
    return true;
  }

  const published = publishedIdOf(documentId);
  const { taken, publishedContentId } = await validationClientOf(context).fetch<{
    taken: boolean;
    publishedContentId: string | null;
  }>(
    `{
      "taken": defined(*[
        _type == $type &&
        contentId == $contentId &&
        language == $language &&
        !sanity::versionOf($published)
      ][0]._id),
      "publishedContentId": *[_id == $published][0].contentId
    }`,
    { type: ARTICLE_TYPE_NAME, contentId: value, language, published },
  );

  if (taken) {
    return `Another ${language} article already uses "${value}", published or not. Different languages of the same page share this id; two documents in the same language must not.`;
  }

  if (publishedContentId !== null && publishedContentId !== value) {
    return `This article was published as "${publishedContentId}". Changing a content id breaks every reference and redirect already pointing at it — create a new document instead.`;
  }

  return true;
}

type RawReference = { readonly _ref?: unknown };

/**
 * Rejects a secondary placement that repeats the canonical category or repeats
 * another secondary entry. Purely local — no query needed — because both
 * values are already on the document being edited. Whether each reference
 * resolves to a category actually in the public tree remains
 * `content-tree.ts`'s job at read time, the same backstop `sanity-content-
 * tree.ts`'s module comment describes for `parent`.
 */
function rejectsSecondaryOverlap(
  value: readonly RawReference[] | undefined,
  context: SchemaValidationContext,
): SchemaValidationResult {
  if (value === undefined || value.length === 0) return true;

  const canonicalRef = (
    context.document?.canonicalCategory as RawReference | undefined
  )?._ref;
  const canonical =
    typeof canonicalRef === "string" ? publishedIdOf(canonicalRef) : undefined;

  const seen = new Set<string>();
  for (const item of value) {
    const ref = item._ref;
    if (typeof ref !== "string") continue;
    const id = publishedIdOf(ref);
    if (id === canonical) {
      return "A secondary category cannot repeat the canonical category.";
    }
    if (seen.has(id)) {
      return "Secondary categories must not repeat the same category.";
    }
    seen.add(id);
  }
  return true;
}

export const articleType: SchemaTypeDefinition = {
  name: ARTICLE_TYPE_NAME,
  title: "Article",
  type: "document",
  description:
    "One editorial page, in one language. Its body is the page — it does not gain a gallery result set from media placed in it (ADR-0003 decision 1).",
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
      description: "Primary key of the listing order (ADR-0003 decision 8).",
      validation: (rule) => rule.required(),
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
        rule.custom<readonly RawReference[]>(rejectsSecondaryOverlap),
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
