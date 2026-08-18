/**
 * Content-type-agnostic core shared by every public content-page document's
 * Studio publication guard (`article-validation.ts`, `gallery-validation.ts`).
 *
 * `content-tree.ts` remains the authoritative backstop — it validates the whole
 * tree once every article/gallery adapter's placements are read together — but
 * that check only runs when a route reads the tree. A standard Studio publish
 * must not be able to produce a public content tree with a colliding local slug
 * or a canonical category with no published version in this document's own
 * language, regardless of whether the document being published is an article or
 * a gallery: ADR-0003 decision 6 gives *public child categories and canonically
 * placed content* one shared local slug namespace, and `content-tree.ts`'s own
 * `duplicate-content-id` check (`src/lib/content-tree.ts`) is variant-agnostic —
 * one `contentId` may not be claimed by both an article and a gallery. So this
 * module's functions take `contentType` as data rather than assuming "article",
 * and every caller queries siblings across every public content type, not just
 * its own.
 *
 * Restated rather than imported: `sanity/schemas` cannot import `src/lib` (see
 * `sanity/README.md`).
 */

import type {
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

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
 * `categoryIdsByDocumentId` index. `categoryId`s are lowercase-hyphenated (see
 * `sanity-article.ts`'s identical `UNRESOLVED_CATEGORY_PREFIX`), so this prefix
 * can never collide with a real one — an unresolved reference must compare and
 * report as missing, never accidentally alias an unrelated category whose
 * `categoryId` happens to equal the raw document id string.
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

export type ProspectivePlacementFields = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  /** Published `categoryId`-space identity; `null` means not yet placed. */
  readonly canonicalCategoryId: string | null;
  readonly secondaryCategoryIds: readonly string[];
};

// ---------------------------------------------------------------------------
// Freezing a published URL's identity
// ---------------------------------------------------------------------------

export type PublishedPlacementSnapshot = {
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
};

/**
 * Pure comparison: does a prospective edit change any of the three fields a
 * published canonical URL depends on? Exported so a fixture test can cover
 * every combination without a network. Content-type-agnostic: an article and a
 * gallery freeze the identical three fields once published.
 */
export function changesPublishedUrlFields(
  published: PublishedPlacementSnapshot,
  current: ProspectivePlacementFields,
): boolean {
  return (
    published.language !== current.language ||
    published.slug !== current.slug ||
    published.canonicalCategoryId !== current.canonicalCategoryId
  );
}

// ---------------------------------------------------------------------------
// The prospective tree: categories and every other document's placement
// ---------------------------------------------------------------------------

/**
 * One category, restated from `CATEGORY_VALIDATION_QUERY`'s raw shape into
 * what this guard needs: its resolved parent (by `categoryId`, not Sanity's own
 * document id), and its slug in the language being checked, present only when
 * the category has *both* a slug and a label there — ADR-0003's rule for when a
 * category exists in one language at all.
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
 * Every fetched category row's own Sanity id, mapped to its `categoryId` — the
 * same local resolution `sanity-content-tree.ts#indexCategoryIds` performs for
 * the public read path. Exported so a document's own category references
 * resolve through the identical index rather than a second one.
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
 * upward walk safe even against not-yet-validated data.
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
 * Restated from `content-tree.ts#validateLocalSlugNamespace`, checked for every
 * claim this edit could newly collide: the document's own canonical placement,
 * and every category between each canonical or secondary category and the
 * root. Returns both typed participants and their actual shared slug, or
 * `undefined` when nothing does. Content-type-agnostic: `placements` may mix
 * article and gallery siblings, since they share one namespace.
 */
export type ProspectiveLocalSlugCollision = {
  readonly checkedKind: "category" | "content";
  readonly checkedId: string;
  readonly conflictingKind: "category" | "content";
  readonly conflictingId: string;
  readonly slug: string;
};

export function findProspectiveLocalSlugCollision(
  current: ProspectivePlacementFields,
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
      key: `${node.parentId ?? ""} ${node.slugInLanguage}`,
    });
  }

  for (const placement of placements) {
    if (placement.canonicalCategoryId === null) continue;
    claims.push({
      kind: "content",
      id: placement.contentId,
      slug: placement.slug,
      key: `${placement.canonicalCategoryId} ${placement.slug}`,
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
 * Orchestrates the three prospective-tree checks against fetched, parsed data:
 * an unplaced draft has nothing to check; a placed one needs its canonical
 * category to exist in its own language, and its local slug claim not to
 * collide with another public category or canonically placed content beneath
 * the same parent — regardless of whether that other content is an article or
 * a gallery. Exported so a fixture test can cover every branch without a
 * network.
 */
export function validateProspectivePlacement(
  current: ProspectivePlacementFields,
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

/**
 * Rejects a secondary placement that repeats the canonical category or repeats
 * another secondary entry. Purely local — no query needed — because both
 * values are already on the document being edited. Whether each reference
 * resolves to a category actually in the public tree remains
 * `content-tree.ts`'s job at read time. Content-type-agnostic: both
 * `article.ts` and `gallery.ts` use it unchanged.
 */
export function rejectsSecondaryCategoryOverlap(
  value: readonly RawReference[] | undefined,
  context: SchemaValidationContext,
): SchemaValidationResult {
  if (value === undefined || value.length === 0) return true;

  const canonicalRef = readReference(context.document?.canonicalCategory);
  const canonical =
    canonicalRef === undefined ? undefined : publishedIdOf(canonicalRef);

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

// ---------------------------------------------------------------------------
// Cross-variant contentId identity (syntax / uniqueness / immutability)
// ---------------------------------------------------------------------------

type RawContentIdentityQueryResult = {
  readonly taken: boolean;
  readonly publishedContentId: string | null;
  readonly otherLanguageType: string | null;
};

/**
 * Builds a `contentId` field validator shared by `article.ts` and `gallery.ts`:
 * syntax, per-language uniqueness across *every* public content type (not just
 * this document's own), immutability once published, and — new for AB#113 —
 * that a `contentId`'s content type cannot change between its own language
 * versions (`content-tree.ts`'s `duplicate-content-id` check is variant-
 * agnostic: one `contentId` belongs to exactly one variant, site-wide).
 */
export function makeContentIdentityValidator(options: {
  readonly ownType: string;
  readonly siblingTypes: readonly string[];
  readonly idPattern: RegExp;
  readonly idHint: string;
}) {
  return async function validateContentIdentity(
    value: string | undefined,
    context: SchemaValidationContext,
  ): Promise<SchemaValidationResult> {
    if (value === undefined || !options.idPattern.test(value)) {
      return options.idHint;
    }

    const documentId = context.document?._id;
    if (typeof documentId !== "string") return true;

    const language = context.document?.language;
    if (typeof language !== "string" || language.length === 0) {
      // The language field's own validation reports this defect.
      return true;
    }

    const published = publishedIdOf(documentId);
    const result = await validationClientOf(context).fetch<RawContentIdentityQueryResult>(
      `{
        "taken": defined(*[
          _type in $siblingTypes &&
          contentId == $contentId &&
          language == $language &&
          !sanity::versionOf($published)
        ][0]._id),
        "publishedContentId": *[_id == $published][0].contentId,
        "otherLanguageType": *[
          _type in $siblingTypes &&
          contentId == $contentId &&
          language != $language &&
          !sanity::versionOf($published)
        ][0]._type
      }`,
      {
        siblingTypes: options.siblingTypes,
        contentId: value,
        language,
        published,
      },
    );

    if (result.taken) {
      return `Another ${language} page already uses "${value}", published or not. Different languages of the same page share this id; two documents in the same language must not.`;
    }

    if (result.publishedContentId !== null && result.publishedContentId !== value) {
      return `This page was published as "${result.publishedContentId}". Changing a content id breaks every reference and redirect already pointing at it — create a new document instead.`;
    }

    const otherLanguageType = result.otherLanguageType ?? null;
    if (otherLanguageType !== null && otherLanguageType !== options.ownType) {
      return `Content id "${value}" is already used by a ${otherLanguageType} in another language. A page's variant (article or gallery) cannot change between its language versions.`;
    }

    return true;
  };
}
