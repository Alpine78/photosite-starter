/**
 * Sanity Studio's publication guard for one article's URL identity.
 *
 * `content-tree.ts` remains the authoritative backstop — it validates the
 * whole tree once every category and article/gallery adapter's placements
 * are read together — but that check only runs when a route reads the tree.
 * A standard Studio publish must not be able to produce a public content
 * tree with a colliding local slug or a canonical category that has no
 * published version in this article's own language, because both states
 * turn "publish this one article" into "the story namespace fails to build"
 * for a visitor. Catching them here, against the published tree with this
 * document's own prospective change overlaid, mirrors the guard `category-
 * validation.ts` already gives the category tree — this module gives the
 * same guarantee to the document that *places itself* in that tree, per the
 * split ADR-0003 decision 5 and `category.ts`'s module comment describe.
 *
 * A second, independent rule freezes `language`, `slug`, and
 * `canonicalCategory` once a document has been published at all, the same
 * way `category-validation.ts#validatePublishedUrlFields` freezes a
 * category's `parent` and path segments. Without it, an ordinary edit could
 * silently retire a live canonical URL — or, because `language` plus
 * `contentId` together are this document's whole identity, silently turn one
 * language's published page into a different language's, rather than the new
 * language being started as its own linked document the way AB#125's
 * workflow requires. A warned, project-owned URL-change workflow is where
 * that action belongs; this validator only refuses its silent, unreviewed
 * form.
 */

import type {
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

function exactString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && !/\s/.test(value)
    ? value
    : undefined;
}

type RawReference = { readonly _ref?: unknown };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReference(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const ref = (value as RawReference)._ref;
  return typeof ref === "string" ? ref : undefined;
}

export type ProspectiveArticleFields = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  /** Published `categoryId`-space identity; `null` means not yet placed. */
  readonly canonicalCategoryId: string | null;
};

/**
 * Reads the four fields this guard needs from the document being edited.
 * Returns `undefined` when one is missing or malformed — the field-level
 * `required()`/pattern rules already report that, so this guard has nothing
 * useful to add until they resolve.
 */
function parseCurrentArticle(
  document: Readonly<Record<string, unknown>>,
): ProspectiveArticleFields | undefined {
  const documentId = exactString(document._id);
  const contentId = exactString(document.contentId);
  const language = exactString(document.language);
  const slug = exactString(document.slug);
  if (
    documentId === undefined ||
    contentId === undefined ||
    language === undefined ||
    !LANGUAGE_SUBTAG.test(language) ||
    slug === undefined
  ) {
    return undefined;
  }

  const ref = readReference(document.canonicalCategory);
  return {
    documentId,
    contentId,
    language,
    slug,
    canonicalCategoryId: ref === undefined ? null : publishedIdOf(ref),
  };
}

export type PublishedArticleSnapshot = {
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
};

/**
 * Pure comparison: does a prospective edit change any of the three fields a
 * published canonical URL depends on? Exported so a fixture test can cover
 * every combination without a network.
 */
export function changesPublishedUrlFields(
  published: PublishedArticleSnapshot,
  current: ProspectiveArticleFields,
): boolean {
  return (
    published.language !== current.language ||
    published.slug !== current.slug ||
    published.canonicalCategoryId !== current.canonicalCategoryId
  );
}

export type ArticleSibling = {
  readonly contentId: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
};

/**
 * Pure structural check: whether the canonical category has a published
 * version in this article's language, and whether another article already
 * claims the same slug beneath it. Exported for the same reason
 * `changesPublishedUrlFields` is.
 *
 * A `null` canonical category is not this guard's concern — the field's own
 * `required()` rule blocks publishing an unplaced article, and ADR-0003
 * decision 5 explicitly allows a draft to stay unplaced while authored.
 */
export function validateProspectiveArticlePlacement(
  current: ProspectiveArticleFields,
  categoryPublishedInLanguage: boolean,
  siblings: readonly ArticleSibling[],
): SchemaValidationResult {
  if (current.canonicalCategoryId === null) return true;

  if (!categoryPublishedInLanguage) {
    return `The canonical category has no published "${current.language}" version yet. Publish the category in this language first, or choose a different one.`;
  }

  const collision = siblings.find(
    (sibling) =>
      sibling.contentId !== current.contentId &&
      sibling.canonicalCategoryId === current.canonicalCategoryId &&
      sibling.slug === current.slug,
  );
  if (collision !== undefined) {
    return `Article "${collision.contentId}" already uses slug "${current.slug}" in this category and language.`;
  }

  return true;
}

type RawLocalizedEntry = { readonly language?: unknown; readonly value?: unknown };

function hasLanguageEntry(entries: unknown, language: string): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some(
    (entry) =>
      isRecord(entry) &&
      (entry as RawLocalizedEntry).language === language &&
      typeof (entry as RawLocalizedEntry).value === "string",
  );
}

type RawArticleQueryResult = {
  readonly published: {
    readonly language?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
  } | null;
  readonly category: {
    readonly slug?: unknown;
    readonly label?: unknown;
  } | null;
  readonly siblings: readonly {
    readonly contentId?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
  }[];
};

function readSiblingCanonicalCategoryId(value: unknown): string | null {
  const ref = typeof value === "string" ? value : undefined;
  return ref === undefined ? null : publishedIdOf(ref);
}

/** Document-level Studio validation; errors block the standard Publish action. */
export async function validateArticlePublication(
  value: Readonly<Record<string, unknown>> | undefined,
  context: SchemaValidationContext,
  articleType: string,
): Promise<SchemaValidationResult> {
  const document = value ?? context.document;
  if (document === undefined) return true;

  const current = parseCurrentArticle(document);
  if (current === undefined) return true;

  const published = publishedIdOf(current.documentId);
  const result = await validationClientOf(context, "published").fetch<RawArticleQueryResult>(
    `{
      "published": *[_id == $published][0]{
        language,
        slug,
        "canonicalCategoryRef": canonicalCategory._ref
      },
      "category": *[_id == $categoryId][0]{
        slug[]{language, value},
        label[]{language, value}
      },
      "siblings": *[
        _type == $type &&
        language == $language &&
        contentId != $contentId
      ]{
        contentId,
        slug,
        "canonicalCategoryRef": canonicalCategory._ref
      }
    }`,
    {
      published,
      categoryId: current.canonicalCategoryId ?? "",
      language: current.language,
      type: articleType,
      contentId: current.contentId,
    },
  );

  if (result.published !== null) {
    const publishedSnapshot: PublishedArticleSnapshot = {
      language: exactString(result.published.language) ?? "",
      slug: exactString(result.published.slug) ?? "",
      canonicalCategoryId: readSiblingCanonicalCategoryId(
        result.published.canonicalCategoryRef,
      ),
    };

    if (changesPublishedUrlFields(publishedSnapshot, current)) {
      return "This article already owns a published URL. Its language, slug, and canonical category cannot be changed in the ordinary editor because that would lose the impact preview and permanent redirect history required by ADR-0003. Use the project-owned URL-change workflow.";
    }
  }

  const categoryPublishedInLanguage =
    result.category !== null &&
    hasLanguageEntry(result.category.slug, current.language) &&
    hasLanguageEntry(result.category.label, current.language);

  const siblings: readonly ArticleSibling[] = result.siblings.flatMap((sibling) => {
    const contentId = exactString(sibling.contentId);
    const slug = exactString(sibling.slug);
    if (contentId === undefined || slug === undefined) return [];
    return [
      {
        contentId,
        slug,
        canonicalCategoryId: readSiblingCanonicalCategoryId(
          sibling.canonicalCategoryRef,
        ),
      },
    ];
  });

  return validateProspectiveArticlePlacement(
    current,
    categoryPublishedInLanguage,
    siblings,
  );
}
