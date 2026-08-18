/**
 * Sanity Studio's publication guard for one article's URL identity.
 *
 * The content-type-agnostic core (category-tree resolution, local-slug-
 * namespace collision, and the published-URL freeze) now lives in
 * `content-placement-validation.ts`, shared with `gallery-validation.ts`
 * (AB#113): ADR-0003 decision 6 gives *public child categories and canonically
 * placed content* one shared local slug namespace across every content type,
 * not just other articles, so a single shared implementation is what keeps an
 * article and a gallery from silently disagreeing about the rule. This file
 * keeps the article-specific pieces: the entry point's query (now including
 * sibling galleries, not only sibling articles) and the exported type aliases
 * existing call sites and tests already use.
 */

import { CATEGORY_TYPE_NAME } from "./category";
import { CATEGORY_VALIDATION_QUERY } from "./category-validation";
import {
  changesPublishedUrlFields as changesPublishedPlacementUrlFields,
  findProspectiveLocalSlugCollision,
  indexProspectiveCategoryDocumentIds,
  parseProspectiveCategories,
  resolveProspectivePublicCategoryIds,
  validateProspectivePlacement,
  type ProspectiveCategoryNode,
  type ProspectivePlacement,
  type ProspectivePlacementFields,
  type PublishedPlacementSnapshot,
} from "./content-placement-validation";
import type {
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export type {
  ProspectiveCategoryNode,
  ProspectivePlacement,
  ProspectivePlacementFields,
};
/** @deprecated use `ProspectivePlacementFields` — kept for existing call sites. */
export type ProspectiveArticleFields = ProspectivePlacementFields;
/** @deprecated use `PublishedPlacementSnapshot` — kept for existing call sites. */
export type PublishedArticleSnapshot = PublishedPlacementSnapshot;

export {
  findProspectiveLocalSlugCollision,
  indexProspectiveCategoryDocumentIds,
  parseProspectiveCategories,
  resolveProspectivePublicCategoryIds,
};
export const changesPublishedUrlFields = changesPublishedPlacementUrlFields;
/** @deprecated use `validateProspectivePlacement` — kept for existing call sites. */
export const validateProspectiveArticlePlacement = validateProspectivePlacement;

function exactString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && !/\s/.test(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawReference = { readonly _ref?: unknown };

function readReference(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const ref = (value as RawReference)._ref;
  return typeof ref === "string" ? ref : undefined;
}

const UNRESOLVED_CATEGORY_PREFIX = "unresolved-ref:";

function resolveCategoryId(
  ref: string,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): string {
  return (
    categoryIdsByDocumentId.get(ref) ?? `${UNRESOLVED_CATEGORY_PREFIX}${ref}`
  );
}

const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

type ParsedArticleDocument = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryRef: string | null;
  readonly secondaryCategoryRefs: readonly string[];
};

function parseCurrentArticleDocument(
  document: Readonly<Record<string, unknown>>,
): ParsedArticleDocument | undefined {
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

  const canonicalRef = readReference(document.canonicalCategory);
  const secondaryRaw = document.secondaryCategories;
  const secondaryCategoryRefs = Array.isArray(secondaryRaw)
    ? secondaryRaw.flatMap((entry) => {
        const ref = readReference(entry);
        return ref === undefined ? [] : [publishedIdOf(ref)];
      })
    : [];

  return {
    documentId,
    contentId,
    language,
    slug,
    canonicalCategoryRef: canonicalRef === undefined ? null : publishedIdOf(canonicalRef),
    secondaryCategoryRefs,
  };
}

function resolveProspectiveArticleFields(
  parsed: ParsedArticleDocument,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ProspectivePlacementFields {
  const resolve = (ref: string) => resolveCategoryId(ref, categoryIdsByDocumentId);
  return {
    documentId: parsed.documentId,
    contentId: parsed.contentId,
    language: parsed.language,
    slug: parsed.slug,
    canonicalCategoryId:
      parsed.canonicalCategoryRef === null ? null : resolve(parsed.canonicalCategoryRef),
    secondaryCategoryIds: parsed.secondaryCategoryRefs.map(resolve),
  };
}

type RawArticleQueryResult = {
  readonly published: {
    readonly language?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
  } | null;
  readonly categories: Parameters<typeof parseProspectiveCategories>[0];
  readonly siblings: readonly {
    readonly contentId?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
    readonly secondaryCategoryRefs?: unknown;
  }[];
};

function readSiblingPlacement(
  sibling: RawArticleQueryResult["siblings"][number],
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ProspectivePlacement | undefined {
  const contentId = exactString(sibling.contentId);
  const slug = exactString(sibling.slug);
  if (contentId === undefined || slug === undefined) return undefined;

  const resolve = (ref: string) => resolveCategoryId(ref, categoryIdsByDocumentId);
  const canonicalRef =
    typeof sibling.canonicalCategoryRef === "string" ? sibling.canonicalCategoryRef : undefined;
  const secondaryRefs = Array.isArray(sibling.secondaryCategoryRefs)
    ? sibling.secondaryCategoryRefs.filter(
        (ref): ref is string => typeof ref === "string",
      )
    : [];

  return {
    contentId,
    slug,
    canonicalCategoryId: canonicalRef === undefined ? null : resolve(publishedIdOf(canonicalRef)),
    secondaryCategoryIds: secondaryRefs.map((ref) => resolve(publishedIdOf(ref))),
  };
}

/**
 * Document-level Studio validation; errors block the standard Publish action.
 * `articleType` is threaded through as a parameter (rather than the imported
 * `ARTICLE_TYPE_NAME` constant) only because `article.ts` already called it
 * that way; the sibling query now also includes every published `gallery`
 * document in this language, alongside every other article, since both share
 * ADR-0003 decision 6's one local slug namespace and `content-tree.ts`'s
 * variant-agnostic `contentId` uniqueness.
 */
export async function validateArticlePublication(
  value: Readonly<Record<string, unknown>> | undefined,
  context: SchemaValidationContext,
  articleType: string,
): Promise<SchemaValidationResult> {
  const document = value ?? context.document;
  if (document === undefined) return true;

  const parsed = parseCurrentArticleDocument(document);
  if (parsed === undefined) return true;

  const published = publishedIdOf(parsed.documentId);
  const result = await validationClientOf(context, "published").fetch<RawArticleQueryResult>(
    `{
      "published": *[_id == $published][0]{
        language,
        slug,
        "canonicalCategoryRef": canonicalCategory._ref
      },
      "categories": ${CATEGORY_VALIDATION_QUERY},
      "siblings": *[
        _type in ["article", "gallery"] &&
        language == $language &&
        contentId != $contentId
      ]{
        contentId,
        slug,
        "canonicalCategoryRef": canonicalCategory._ref,
        "secondaryCategoryRefs": secondaryCategories[]._ref
      }
    }`,
    {
      published,
      // `CATEGORY_VALIDATION_QUERY` names its own document-type parameter
      // `$type`; unused here now that the sibling filter is a literal type
      // list, kept bound for compatibility with that query's own reference.
      type: CATEGORY_TYPE_NAME,
      articleType,
      language: parsed.language,
      contentId: parsed.contentId,
    },
  );

  const categoryIdsByDocumentId = indexProspectiveCategoryDocumentIds(result.categories);
  const current = resolveProspectiveArticleFields(parsed, categoryIdsByDocumentId);

  if (result.published !== null) {
    const publishedCanonicalRef =
      typeof result.published.canonicalCategoryRef === "string"
        ? publishedIdOf(result.published.canonicalCategoryRef)
        : null;
    const publishedSnapshot: PublishedPlacementSnapshot = {
      language: exactString(result.published.language) ?? "",
      slug: exactString(result.published.slug) ?? "",
      canonicalCategoryId:
        publishedCanonicalRef === null
          ? null
          : resolveCategoryId(publishedCanonicalRef, categoryIdsByDocumentId),
    };

    if (changesPublishedPlacementUrlFields(publishedSnapshot, current)) {
      return "This article already owns a published URL. Its language, slug, and canonical category cannot be changed in the ordinary editor because that would lose the impact preview and permanent redirect history required by ADR-0003. Use the project-owned URL-change workflow.";
    }
  }

  const categories = parseProspectiveCategories(result.categories, current.language);
  const siblings = result.siblings.flatMap((sibling) => {
    const placement = readSiblingPlacement(sibling, categoryIdsByDocumentId);
    return placement === undefined ? [] : [placement];
  });

  return validateProspectivePlacement(current, categories, siblings);
}
