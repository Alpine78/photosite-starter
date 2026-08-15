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
 * for a visitor.
 *
 * ADR-0003 decision 6 gives *public child categories and canonically placed
 * content beneath one parent* one shared local slug namespace — not just
 * other articles beneath the same category. So this guard fetches every
 * category and every other published article in this language, overlays the
 * document being edited, and restates the same two computations
 * `content-tree.ts` runs at read time: which categories are public (a
 * category is public when it — or a descendant — holds a canonical or
 * secondary placement, propagated upward through the parent chain), and
 * whether the prospective article's own local slug claim collides with any
 * other public category or canonically placed content sharing its parent.
 * Restated rather than imported: `sanity/schemas` cannot import `src/lib`
 * (see `sanity/README.md`), the same reason `category-validation.ts` already
 * restates category-tree validation instead of importing `content-tree.ts`.
 *
 * Gallery documents are not fetched here yet — no gallery schema exists
 * before AB#113 — so a collision between an article and a not-yet-modelled
 * gallery cannot be caught early. `content-tree.ts` still catches it at read
 * time once AB#113 lands; AB#113 extends the query this guard runs to
 * include gallery placements the same way it already includes categories.
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

import { CATEGORY_TYPE_NAME } from "./category";
import { CATEGORY_VALIDATION_QUERY } from "./category-validation";
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawReference = { readonly _ref?: unknown };

function readReference(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const ref = (value as RawReference)._ref;
  return typeof ref === "string" ? ref : undefined;
}

/**
 * Marks a Sanity document id that did not resolve through a
 * `categoryIdsByDocumentId` index. `categoryId`s are lowercase-hyphenated
 * (see `sanity-article.ts`'s identical `UNRESOLVED_CATEGORY_PREFIX`), so this
 * prefix can never collide with a real one — an unresolved reference must
 * compare and report as missing, never accidentally alias an unrelated
 * category whose `categoryId` happens to equal the raw document id string.
 */
const UNRESOLVED_CATEGORY_PREFIX = "unresolved-ref:";

function resolveCategoryId(
  ref: string,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): string {
  return (
    categoryIdsByDocumentId.get(ref) ?? `${UNRESOLVED_CATEGORY_PREFIX}${ref}`
  );
}

// ---------------------------------------------------------------------------
// The document being edited
// ---------------------------------------------------------------------------

export type ProspectiveArticleFields = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  /** Published `categoryId`-space identity; `null` means not yet placed. */
  readonly canonicalCategoryId: string | null;
  readonly secondaryCategoryIds: readonly string[];
};

/**
 * The document being edited, before its category references are resolved
 * from Sanity document ids to `categoryId`s — that resolution needs the
 * fetched category set, which is not available yet at parse time.
 */
type ParsedArticleDocument = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryRef: string | null;
  readonly secondaryCategoryRefs: readonly string[];
};

/**
 * Reads the fields this guard needs from the document being edited. Returns
 * `undefined` when a required one is missing or malformed — the field-level
 * `required()`/pattern rules already report that, so this guard has nothing
 * useful to add until they resolve.
 */
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

/**
 * Resolves the parsed document's raw category references against the
 * fetched category set's own Sanity-id → `categoryId` index — the same
 * resolution `sanity-content-tree.ts` performs for a category's own `parent`,
 * and for the same reason: dereferencing in GROQ instead would collapse "no
 * reference" and "a reference that does not resolve" into the same value. An
 * unresolved reference is passed through unchanged, so it matches no real
 * category and the placement check below reports it as one with no published
 * version in this language, rather than silently treating it as unplaced.
 */
function resolveProspectiveArticleFields(
  parsed: ParsedArticleDocument,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ProspectiveArticleFields {
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

// ---------------------------------------------------------------------------
// Freezing a published URL's identity
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The prospective tree: categories and every other article's placement
// ---------------------------------------------------------------------------

/**
 * One category, restated from `CATEGORY_VALIDATION_QUERY`'s raw shape into
 * what this guard needs: its resolved parent (by `categoryId`, not Sanity's
 * own document id — see the module comment on why `parentRef` is resolved
 * rather than dereferenced), and its slug in the language being checked,
 * present only when the category has *both* a slug and a label there —
 * ADR-0003's rule for when a category exists in one language at all.
 */
export type ProspectiveCategoryNode = {
  readonly categoryId: string;
  readonly parentId: string | null;
  readonly slugInLanguage?: string;
};

export type ProspectivePlacement = {
  readonly contentId: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
  readonly secondaryCategoryIds: readonly string[];
};

type RawCategoryRow = {
  readonly _id?: unknown;
  readonly categoryId?: unknown;
  readonly parentRef?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
};

type RawLocalizedEntry = { readonly language?: unknown; readonly value?: unknown };

function readLanguageValue(entries: unknown, language: string): string | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (
      isRecord(entry) &&
      (entry as RawLocalizedEntry).language === language &&
      typeof (entry as RawLocalizedEntry).value === "string"
    ) {
      return (entry as RawLocalizedEntry).value as string;
    }
  }
  return undefined;
}

/**
 * Every fetched category row's own Sanity id, mapped to its `categoryId` —
 * the same local resolution `sanity-content-tree.ts#indexCategoryIds`
 * performs for the public read path, restated here because this module
 * cannot import it. Exported so the current document's own category
 * references resolve through the identical index rather than a second one.
 */
export function indexProspectiveCategoryDocumentIds(
  rows: readonly RawCategoryRow[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    const id = exactString(row._id);
    const categoryId = exactString(row.categoryId);
    if (id !== undefined && categoryId !== undefined) {
      index.set(id, categoryId);
    }
  }
  return index;
}

/**
 * Parses every fetched category row into `ProspectiveCategoryNode`s keyed by
 * `categoryId`, resolving each `parentRef` (a Sanity document id) through
 * `indexProspectiveCategoryDocumentIds`.
 */
export function parseProspectiveCategories(
  rows: readonly RawCategoryRow[],
  language: string,
): ReadonlyMap<string, ProspectiveCategoryNode> {
  const categoryIdsByDocumentId = indexProspectiveCategoryDocumentIds(rows);

  const nodes = new Map<string, ProspectiveCategoryNode>();
  for (const row of rows) {
    const categoryId = exactString(row.categoryId);
    if (categoryId === undefined) continue;

    const parentRef = typeof row.parentRef === "string" ? row.parentRef : undefined;
    const parentId =
      parentRef === undefined
        ? null
        : resolveCategoryId(parentRef, categoryIdsByDocumentId);

    const slugValue = readLanguageValue(row.slug, language);
    const hasLabel = readLanguageValue(row.label, language) !== undefined;

    nodes.set(categoryId, {
      categoryId,
      parentId,
      ...(slugValue !== undefined && hasLabel ? { slugInLanguage: slugValue } : {}),
    });
  }

  return nodes;
}

/**
 * Which categories belong in the public tree: one with a canonical or
 * secondary placement, or a public descendant. Restated from
 * `content-tree.ts#resolvePublicCategoryIds`. A `visited` guard makes the
 * upward walk safe even against not-yet-validated data — unlike the read
 * path, this runs before `category-validation.ts` has necessarily rejected a
 * cycle elsewhere.
 */
export function resolveProspectivePublicCategoryIds(
  categories: ReadonlyMap<string, ProspectiveCategoryNode>,
  placements: readonly ProspectivePlacement[],
): ReadonlySet<string> {
  const withContent = new Set<string>();
  for (const placement of placements) {
    if (placement.canonicalCategoryId !== null) {
      withContent.add(placement.canonicalCategoryId);
    }
    for (const categoryId of placement.secondaryCategoryIds) {
      withContent.add(categoryId);
    }
  }

  const isPublic = new Set<string>();
  for (const categoryId of withContent) {
    const visited = new Set<string>();
    let current: string | null = categoryId;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      isPublic.add(current);
      current = categories.get(current)?.parentId ?? null;
    }
  }
  return isPublic;
}

/**
 * Ancestry from `categoryId` up to the top level, inclusive, each step
 * resolved through the same parent map `resolveProspectivePublicCategoryIds`
 * walks. A `visited` guard makes it safe even against not-yet-validated data.
 */
function categoryAncestryChain(
  categoryId: string,
  categories: ReadonlyMap<string, ProspectiveCategoryNode>,
): readonly string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null = categoryId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = categories.get(current)?.parentId ?? null;
  }
  return chain;
}

/**
 * The one local slug namespace ADR-0003 decision 6 gives every parent: its
 * public child categories and its canonically placed content together.
 * Restated from `content-tree.ts#validateLocalSlugNamespace`, checked for
 * every claim this edit could newly collide: the article's own canonical
 * placement, and every category between each canonical or secondary category
 * and the root.
 * A category further up the chain matters because *this* edit can flip it
 * from private to public for the first time — a dormant collision with one of
 * that category's own siblings only becomes visible once something makes it
 * public. No other category's or content's claim is affected by this specific
 * edit, so nothing else needs checking; an unrelated pre-existing collision
 * remains `content-tree.ts`'s finding to make at read time. Returns both typed
 * participants and their actual shared slug, or `undefined` when nothing does.
 */
export type ProspectiveLocalSlugCollision = {
  readonly checkedKind: "category" | "content";
  readonly checkedId: string;
  readonly conflictingKind: "category" | "content";
  readonly conflictingId: string;
  readonly slug: string;
};

export function findProspectiveLocalSlugCollision(
  current: ProspectiveArticleFields,
  categories: ReadonlyMap<string, ProspectiveCategoryNode>,
  publicCategoryIds: ReadonlySet<string>,
  placements: readonly ProspectivePlacement[],
): ProspectiveLocalSlugCollision | undefined {
  type Claim = {
    readonly kind: "category" | "content";
    readonly id: string;
    readonly slug: string;
    readonly key: string;
  };
  const claims: Claim[] = [];

  for (const node of categories.values()) {
    if (node.slugInLanguage === undefined) continue;
    if (!publicCategoryIds.has(node.categoryId)) continue;
    claims.push({
      kind: "category",
      id: node.categoryId,
      slug: node.slugInLanguage,
      key: `${node.parentId ?? ""}\u0000${node.slugInLanguage}`,
    });
  }

  for (const placement of placements) {
    if (placement.canonicalCategoryId === null) continue;
    claims.push({
      kind: "content",
      id: placement.contentId,
      slug: placement.slug,
      key: `${placement.canonicalCategoryId}\u0000${placement.slug}`,
    });
  }

  const toCheck: Array<Pick<Claim, "kind" | "id">> = [
    { kind: "content", id: current.contentId },
  ];
  const checkedCategoryIds = new Set<string>();
  for (const categoryId of [
    ...(current.canonicalCategoryId === null
      ? []
      : [current.canonicalCategoryId]),
    ...current.secondaryCategoryIds,
  ]) {
    for (const ancestorId of categoryAncestryChain(categoryId, categories)) {
      if (checkedCategoryIds.has(ancestorId)) continue;
      checkedCategoryIds.add(ancestorId);
      toCheck.push({ kind: "category", id: ancestorId });
    }
  }

  for (const checked of toCheck) {
    const claim = claims.find(
      (candidate) =>
        candidate.kind === checked.kind && candidate.id === checked.id,
    );
    if (claim === undefined) continue;
    const collision = claims.find(
      (candidate) =>
        (candidate.kind !== claim.kind || candidate.id !== claim.id) &&
        candidate.key === claim.key,
    );
    if (collision !== undefined) {
      return {
        checkedKind: claim.kind,
        checkedId: claim.id,
        conflictingKind: collision.kind,
        conflictingId: collision.id,
        slug: claim.slug,
      };
    }
  }

  return undefined;
}

/**
 * Orchestrates the three prospective-tree checks against fetched, parsed
 * data: an unplaced draft has nothing to check; a placed one needs its
 * canonical category to exist in its own language, and its local slug claim
 * not to collide with another public category or canonically placed content
 * beneath the same parent. Exported so a fixture test can cover every branch
 * without a network.
 */
export function validateProspectiveArticlePlacement(
  current: ProspectiveArticleFields,
  categories: ReadonlyMap<string, ProspectiveCategoryNode>,
  siblings: readonly ProspectivePlacement[],
): SchemaValidationResult {
  if (current.canonicalCategoryId === null) return true;

  const canonicalNode = categories.get(current.canonicalCategoryId);
  if (canonicalNode?.slugInLanguage === undefined) {
    return `The canonical category has no published "${current.language}" version yet. Publish the category in this language first, or choose a different one.`;
  }

  for (const secondaryCategoryId of current.secondaryCategoryIds) {
    if (categories.get(secondaryCategoryId)?.slugInLanguage === undefined) {
      return `Secondary category "${secondaryCategoryId}" has no published "${current.language}" version yet. Publish the category in this language first, or remove the secondary placement.`;
    }
  }

  const placements: readonly ProspectivePlacement[] = [
    ...siblings,
    {
      contentId: current.contentId,
      slug: current.slug,
      canonicalCategoryId: current.canonicalCategoryId,
      secondaryCategoryIds: current.secondaryCategoryIds,
    },
  ];

  const publicCategoryIds = resolveProspectivePublicCategoryIds(categories, placements);
  const collision = findProspectiveLocalSlugCollision(
    current,
    categories,
    publicCategoryIds,
    placements,
  );

  if (collision !== undefined) {
    return `${collision.conflictingKind === "category" ? "Category" : "Content"} "${collision.conflictingId}" already uses slug "${collision.slug}" beneath the same category. A public child category and canonically placed content share one local slug namespace (ADR-0003 decision 6).`;
  }

  return true;
}

// ---------------------------------------------------------------------------
// The Studio entry point
// ---------------------------------------------------------------------------

type RawArticleQueryResult = {
  readonly published: {
    readonly language?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
  } | null;
  readonly categories: readonly RawCategoryRow[];
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

/** Document-level Studio validation; errors block the standard Publish action. */
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
        _type == $articleType &&
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
      // `$type`; the sibling article filter below uses `$articleType` instead
      // of reusing that name, so one combined query can bind both without one
      // overwriting the other.
      type: CATEGORY_TYPE_NAME,
      articleType,
      language: parsed.language,
      contentId: parsed.contentId,
    },
  );

  // Every category reference on this document or on a sibling is a Sanity
  // document id, resolved through the same index the fetched category set
  // itself is keyed by — never compared against a raw ref directly, which
  // would silently fail to match the `categoryId`-keyed data everywhere else
  // in this module.
  const categoryIdsByDocumentId = indexProspectiveCategoryDocumentIds(result.categories);
  const current = resolveProspectiveArticleFields(parsed, categoryIdsByDocumentId);

  if (result.published !== null) {
    const publishedCanonicalRef =
      typeof result.published.canonicalCategoryRef === "string"
        ? publishedIdOf(result.published.canonicalCategoryRef)
        : null;
    const publishedSnapshot: PublishedArticleSnapshot = {
      language: exactString(result.published.language) ?? "",
      slug: exactString(result.published.slug) ?? "",
      canonicalCategoryId:
        publishedCanonicalRef === null
          ? null
          : resolveCategoryId(publishedCanonicalRef, categoryIdsByDocumentId),
    };

    if (changesPublishedUrlFields(publishedSnapshot, current)) {
      return "This article already owns a published URL. Its language, slug, and canonical category cannot be changed in the ordinary editor because that would lose the impact preview and permanent redirect history required by ADR-0003. Use the project-owned URL-change workflow.";
    }
  }

  const categories = parseProspectiveCategories(result.categories, current.language);
  const siblings = result.siblings.flatMap((sibling) => {
    const placement = readSiblingPlacement(sibling, categoryIdsByDocumentId);
    return placement === undefined ? [] : [placement];
  });

  return validateProspectiveArticlePlacement(current, categories, siblings);
}
