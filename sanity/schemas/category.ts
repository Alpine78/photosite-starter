/**
 * The public content category document: one node in ADR-0003's category tree.
 *
 * `content-tree.ts` is the vendor-neutral tree domain — identity, parent
 * reference, slug, label, order, cycle/orphan/collision rejection, and
 * canonical-versus-secondary content placement. This schema is that domain's
 * Sanity-facing half: it describes one authored category exactly as
 * `ContentCategoryInput` needs it, and nothing more. `src/lib/sanity-content-
 * tree.ts` is the other half, projecting a query result back onto that type.
 *
 * ## One document, every language
 *
 * A category is one place in the tree regardless of what language a visitor
 * reads it in — unlike a gallery or article, it has no per-language
 * publication lifecycle of its own to preserve. So `label` and `slug` are
 * language-keyed arrays on one document, exactly the shape `media.ts` already
 * established for `alt` and `caption` (ADR-0008). A category "existing in one
 * locale before the other" — the mock fixture's `cat-gear` — is simply a
 * document whose `slug`/`label` arrays have no entry for that language yet;
 * `sanity-content-tree.ts` omits such a category from that language's tree
 * rather than publishing a half-translated node.
 *
 * `slug` cannot reuse `localizedText`: a path segment is single-line and
 * pattern-constrained, which is exactly what `localized-slug.ts` adds.
 *
 * ## What is deliberately not here
 *
 * **Canonical and secondary category placement.** ADR-0003 decision 5 places
 * that responsibility on the gallery or article being placed, not on the
 * category receiving it — AB#113 and AB#81 add a `canonicalCategory`
 * reference and a `secondaryCategories` array to their own document schemas.
 * Nothing here needs to change for either story to do that: a category is an
 * ordinary referenceable document already, and `sanity-content-tree.ts`
 * accepts placements as project-owned `ContentPlacementInput` values from
 * whatever adapter reads them.
 *
 * **Cycle, orphan, max-depth, and sibling-slug-collision rejection.** All four
 * are already implemented and exhaustively tested in `content-tree.ts`, which
 * ADR-0003 decision 4 names the *authoritative* backstop precisely because a
 * future CMS is only asked to *prevent publishing* these states, not to own
 * detecting them. Reimplementing a graph walk in Studio validation would be a
 * second, independently maintained copy of that logic. What *is* checked here
 * is the one thing only Studio validation can catch before a document is even
 * saved, and that a read-time backstop catches too late to be useful
 * editorially: a category naming itself as its own parent.
 *
 * **Publication state.** Native Sanity draft/publish, exactly as `media.ts`
 * reasons: `sanity-client.ts` asks only for the published perspective, so an
 * unpublished category is not filtered out, it is not in the data at all.
 */

import {
  clientOf,
  publishedIdOf,
} from "./media";
import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import { LOCALIZED_SLUG_TYPE_NAME } from "./localized-slug";
import type {
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";

export const CATEGORY_TYPE_NAME = "category";

/**
 * `categoryId` is minted by hand, like `mediaId`: never derived from the
 * document's own `_id`, which changes shape under a draft or a release and
 * says nothing portable to a redirect history or a route.
 */
const CATEGORY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Syntax, uniqueness, and immutability, in one round trip — the same three
 * questions `media.ts`'s `validateMediaIdentity` asks, asked here about a
 * category instead of a photograph. Uniqueness is global rather than
 * per-language: one document is one category, described in as many languages
 * as it has entries for, so two documents can never legitimately share an id.
 */
async function validateCategoryIdentity(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !CATEGORY_ID.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. coastal-landscapes";
  }

  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;

  const published = publishedIdOf(documentId);
  const { taken, publishedCategoryId } = await clientOf(context).fetch<{
    taken: boolean;
    publishedCategoryId: string | null;
  }>(
    `{
      "taken": defined(*[
        _type == $type &&
        categoryId == $categoryId &&
        !sanity::versionOf($published)
      ][0]._id),
      "publishedCategoryId": *[_id == $published][0].categoryId
    }`,
    { type: CATEGORY_TYPE_NAME, categoryId: value, published },
  );

  if (taken) {
    return `Another category already uses "${value}", published or not. A category id identifies one place in the tree across the whole site.`;
  }

  if (publishedCategoryId !== null && publishedCategoryId !== value) {
    return `This category was published as "${publishedCategoryId}". Changing a category id breaks every reference already pointing at it, including its children's own parent links — create a new category instead.`;
  }

  return true;
}

/**
 * The one tree-structure defect Studio validation catches before a save:
 * naming a category as its own parent. `content-tree.ts` also rejects this,
 * but only once an adapter reads the tree back — this rule stops it at
 * authoring time instead, the same way `media.ts` stops a camera master
 * before it is part of a page. Everything past one hop — an indirect cycle —
 * needs the graph the Studio does not have in front of it and is left to that
 * same backstop, deliberately: see the module comment.
 */
function rejectsSelfParent(
  value: { readonly _ref?: unknown } | undefined,
  context: SchemaValidationContext,
): SchemaValidationResult {
  if (value === undefined) return true;

  const ref = value._ref;
  const documentId = context.document?._id;
  if (typeof ref !== "string" || typeof documentId !== "string") return true;

  return publishedIdOf(ref) === publishedIdOf(documentId)
    ? "A category cannot be its own parent."
    : true;
}

export const categoryType: SchemaTypeDefinition = {
  name: CATEGORY_TYPE_NAME,
  title: "Category",
  type: "document",
  description:
    "One node in the public content tree. A gallery or article places itself here; this document never lists its own content.",
  fields: [
    {
      name: "categoryId",
      title: "Category ID",
      type: "string",
      description:
        "Stable identity for this place in the tree: lowercase words separated by hyphens, e.g. coastal-landscapes. Mint it once and never change it — moves, renames, and translations must leave it alone, because child categories and placed content reference it.",
      validation: (rule) => rule.required().custom(validateCategoryIdentity),
    },
    {
      name: "parent",
      title: "Parent category",
      type: "reference",
      to: [{ type: CATEGORY_TYPE_NAME }],
      description:
        "Leave empty for a top-level category. Every other category has exactly one parent.",
      validation: (rule) => rule.custom(rejectsSelfParent),
    },
    {
      name: "slug",
      title: "Path segment",
      type: "array",
      of: [{ type: LOCALIZED_SLUG_TYPE_NAME }],
      description:
        "One lowercase, hyphenated path segment per published language. Unique among this category's siblings in each language; stable once published (ADR-0003 decision 7) — change it only through a deliberate URL-change action.",
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    {
      name: "label",
      title: "Display label",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      description:
        "This category's name in each published language, shown in navigation and breadcrumbs. Free to edit at any time — it never changes the URL.",
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    {
      name: "order",
      title: "Order",
      type: "number",
      description:
        "Where this category sits among its siblings, lowest first. Ties are broken by category id, so an unset or repeated order is still deterministic — but not necessarily in the order you intended.",
      validation: (rule) => rule.required(),
    },
  ],
  preview: {
    select: { title: "categoryId", subtitle: "order" },
  },
};
