/**
 * Project-owned public content category tree and canonical placement contract.
 *
 * ADR-0003 decides these rules; this module is their vendor-neutral
 * implementation. It knows nothing about routes, breadcrumb rendering,
 * navigation, or CMS documents. An adapter maps provider records onto the
 * input types, and the route layer prepends the locale base and story
 * namespace to the path segments resolved here.
 *
 * One tree describes one locale. ADR-0003 requires only that stable identifiers
 * associate language versions; those versions may differ in label, slug, text,
 * publication state, and placement. Building one tree per locale satisfies that
 * without deciding the multilingual authoring model, which AB#125 owns, or the
 * locale-aware routing AB#128 owns.
 *
 * The domain rejects invalid structure rather than repairing it: repairing an
 * orphan, cycle, or slug collision would publish a path the author never chose.
 */

/** Authored category levels beneath the implicit, routeless site root. */
export const MAX_CATEGORY_DEPTH = 5;

/**
 * Canonical path segments are lowercase with hyphens between words.
 *
 * Exported so a Sanity-facing test can pin `localized-slug.ts`'s restated copy
 * to this one, the same way `sanity-media.ts` pins its restated delivery
 * constants against the Studio schema's.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ContentVariant = "gallery" | "article";

// ---------------------------------------------------------------------------
// Adapter-facing input
// ---------------------------------------------------------------------------

export type ContentCategoryInput = {
  /** Immutable project identity; survives label, slug, and parent changes. */
  readonly categoryId: string;
  /** `null` places the category at the top level beneath the implicit root. */
  readonly parentId: string | null;
  /** Editable path segment. Stable across label edits (ADR-0003 decision 7). */
  readonly slug: string;
  /** Editable display label; keeps its authored casing. */
  readonly label: string;
  /** Explicit author-defined sibling order. */
  readonly order: number;
};

export type ContentPlacementInput = {
  /** Immutable project identity of the gallery or article page. */
  readonly contentId: string;
  readonly variant: ContentVariant;
  readonly slug: string;
  /** Unpublished content may stay unplaced while it is being authored. */
  readonly published: boolean;
  readonly canonicalCategoryId: string | null;
  /** Listing-only placements. They own no detail route and no slug. */
  readonly secondaryCategoryIds?: readonly string[];
};

export type ContentTreeInput = {
  readonly categories: readonly ContentCategoryInput[];
  readonly placements: readonly ContentPlacementInput[];
};

// ---------------------------------------------------------------------------
// Validated domain
// ---------------------------------------------------------------------------

export type ContentCategory = ContentCategoryInput & {
  /** Top-level categories are depth 1; the implicit root is not a level. */
  readonly depth: number;
};

export type ContentPlacement = ContentPlacementInput & {
  readonly secondaryCategoryIds: readonly string[];
};

export type ContentTree = {
  readonly categories: ReadonlyMap<string, ContentCategory>;
  readonly placements: ReadonlyMap<string, ContentPlacement>;
  /**
   * Child ids per parent in sibling order, keyed by `null` at the top level.
   * Ties in `order` break by immutable `categoryId`.
   */
  readonly childCategoryIds: ReadonlyMap<string | null, readonly string[]>;
  /**
   * Categories that belong in public navigation, category routes, and the
   * sitemap: they carry a published placement of their own or have a public
   * descendant. A secondary listing counts, because such a category has
   * something to show; only an empty leaf drops out.
   */
  readonly publicCategoryIds: ReadonlySet<string>;
};

export type ContentTreeIssueCode =
  | "duplicate-category-id"
  | "invalid-category-slug"
  | "invalid-category-order"
  | "empty-category-label"
  | "self-parenting"
  | "missing-parent"
  | "category-cycle"
  | "max-depth-exceeded"
  | "sibling-slug-collision"
  | "duplicate-content-id"
  | "invalid-content-slug"
  | "unplaced-published-content"
  | "missing-canonical-category"
  | "missing-secondary-category"
  | "canonical-category-in-secondary"
  | "duplicate-secondary-category"
  | "local-slug-collision";

export type ContentTreeIssue = {
  readonly code: ContentTreeIssueCode;
  /** The `categoryId` or `contentId` the issue is reported against. */
  readonly subject: string;
  readonly message: string;
};

export class ContentTreeValidationError extends Error {
  readonly issues: readonly ContentTreeIssue[];

  constructor(issues: readonly ContentTreeIssue[]) {
    super(
      `invalid public content tree: ${issues
        .map((issue) => `${issue.subject}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ContentTreeValidationError";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Ancestry =
  | { readonly ok: true; readonly depth: number }
  | { readonly ok: false; readonly code: ContentTreeIssueCode };

function resolveAncestry(
  categoryId: string,
  byId: ReadonlyMap<string, ContentCategoryInput>,
): Ancestry {
  const walked = new Set<string>();
  let current = categoryId;
  let depth = 1;

  for (;;) {
    if (walked.has(current)) {
      return { ok: false, code: "category-cycle" };
    }
    walked.add(current);

    const category = byId.get(current);
    if (!category) {
      return { ok: false, code: "missing-parent" };
    }
    if (category.parentId === null) {
      return depth > MAX_CATEGORY_DEPTH
        ? { ok: false, code: "max-depth-exceeded" }
        : { ok: true, depth };
    }
    if (category.parentId === category.categoryId) {
      // Only the self-parenting category itself is reported for it. A
      // descendant's own defect is the cycle its ancestry walks into, which
      // the next iteration detects.
      if (current === categoryId) {
        return { ok: false, code: "self-parenting" };
      }
    } else if (!byId.has(category.parentId)) {
      return { ok: false, code: "missing-parent" };
    }

    current = category.parentId;
    depth += 1;
  }
}

function compareIssues(a: ContentTreeIssue, b: ContentTreeIssue): number {
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

/**
 * Sorts issues and drops exact repeats. Sorting on all three fields means no
 * pair is left in input order, and two identical issues carry no information
 * the first does not.
 */
function normalizeIssues(
  issues: readonly ContentTreeIssue[],
): readonly ContentTreeIssue[] {
  const sorted = [...issues].sort(compareIssues);
  return sorted.filter(
    (issue, index) =>
      index === 0 || compareIssues(issue, sorted[index - 1]) !== 0,
  );
}

/**
 * One claim on a slug beneath one parent category. Categories and canonically
 * placed content compete in the same local namespace, so both are expressed as
 * claims and grouped together.
 */
type SlugClaim = {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly kind: "category" | "content";
};

/**
 * Groups claims by parent and slug. A null byte separates the two, so no
 * combination of an id and a slug can spell another pair's key.
 */
function groupSlugClaims(
  claims: readonly SlugClaim[],
): Map<string, SlugClaim[]> {
  const groups = new Map<string, SlugClaim[]>();
  for (const claim of claims) {
    const key = `${claim.parentId ?? ""}\u0000${claim.slug}`;
    const group = groups.get(key);
    if (group) {
      group.push(claim);
    } else {
      groups.set(key, [claim]);
    }
  }
  return groups;
}

const quoteIds = (ids: readonly string[]) =>
  ids.map((id) => `"${id}"`).join(", ");

function validateCategories(
  categories: readonly ContentCategoryInput[],
  issues: ContentTreeIssue[],
): Map<string, ContentCategory> {
  const byId = new Map<string, ContentCategoryInput>();

  for (const category of categories) {
    if (byId.has(category.categoryId)) {
      issues.push({
        code: "duplicate-category-id",
        subject: category.categoryId,
        message: "categoryId must be unique",
      });
      continue;
    }
    byId.set(category.categoryId, category);
  }

  for (const category of byId.values()) {
    if (!SLUG_PATTERN.test(category.slug)) {
      issues.push({
        code: "invalid-category-slug",
        subject: category.categoryId,
        message: `slug "${category.slug}" must be lowercase with hyphens between words`,
      });
    }
    if (category.label.trim().length === 0) {
      issues.push({
        code: "empty-category-label",
        subject: category.categoryId,
        message: "label must not be empty",
      });
    }
    if (!Number.isFinite(category.order)) {
      issues.push({
        code: "invalid-category-order",
        subject: category.categoryId,
        message: "order must be a finite number",
      });
    }
  }

  // Categories whose ancestry is unresolvable are reported for that instead,
  // so they are never grouped beneath a guessed parent.
  const resolved = new Map<string, ContentCategory>();
  for (const category of byId.values()) {
    const ancestry = resolveAncestry(category.categoryId, byId);
    if (!ancestry.ok) {
      issues.push({
        code: ancestry.code,
        subject: category.categoryId,
        message:
          ancestry.code === "self-parenting"
            ? "a category cannot be its own parent"
            : ancestry.code === "category-cycle"
              ? "category ancestry must not contain a cycle"
              : ancestry.code === "max-depth-exceeded"
                ? `category depth must not exceed ${MAX_CATEGORY_DEPTH}`
                : "parentId must reference a category in the tree",
      });
      continue;
    }
    resolved.set(category.categoryId, { ...category, depth: ancestry.depth });
  }

  reportSiblingSlugCollisions(resolved, issues);
  return resolved;
}

/**
 * Reports a sibling slug collision against every category taking part in it,
 * naming the participants in id order. Reporting the whole group keeps the
 * diagnostics identical however the adapter happened to order its input.
 */
function reportSiblingSlugCollisions(
  categories: ReadonlyMap<string, ContentCategory>,
  issues: ContentTreeIssue[],
): void {
  const claims: SlugClaim[] = [...categories.values()].map((category) => ({
    id: category.categoryId,
    parentId: category.parentId,
    slug: category.slug,
    kind: "category",
  }));

  for (const group of groupSlugClaims(claims).values()) {
    if (group.length < 2) continue;
    const ids = group.map((claim) => claim.id).sort();
    for (const id of ids) {
      issues.push({
        code: "sibling-slug-collision",
        subject: id,
        message: `slug "${group[0].slug}" is claimed by sibling categories ${quoteIds(ids)}`,
      });
    }
  }
}

function validatePlacements(
  placements: readonly ContentPlacementInput[],
  categories: ReadonlyMap<string, ContentCategory>,
  issues: ContentTreeIssue[],
): Map<string, ContentPlacement> {
  const resolved = new Map<string, ContentPlacement>();
  // Tracked separately from `resolved`, which an invalid first placement never
  // reaches: uniqueness is a property of the input, not of validation success.
  const seenContentIds = new Set<string>();

  for (const placement of placements) {
    let valid = true;
    const fail = (code: ContentTreeIssueCode, message: string) => {
      issues.push({ code, subject: placement.contentId, message });
      valid = false;
    };

    if (!SLUG_PATTERN.test(placement.slug)) {
      fail(
        "invalid-content-slug",
        `slug "${placement.slug}" must be lowercase with hyphens between words`,
      );
    }

    if (placement.canonicalCategoryId === null) {
      if (placement.published) {
        fail(
          "unplaced-published-content",
          "published content requires one canonical category placement",
        );
      }
    } else if (!categories.has(placement.canonicalCategoryId)) {
      fail(
        "missing-canonical-category",
        `canonical category "${placement.canonicalCategoryId}" is not in the public tree`,
      );
    }

    const secondary = placement.secondaryCategoryIds ?? [];
    const seenSecondary = new Set<string>();
    for (const categoryId of secondary) {
      if (categoryId === placement.canonicalCategoryId) {
        fail(
          "canonical-category-in-secondary",
          `canonical category "${categoryId}" cannot also be a secondary placement`,
        );
        continue;
      }
      if (seenSecondary.has(categoryId)) {
        fail(
          "duplicate-secondary-category",
          `secondary category "${categoryId}" is placed more than once`,
        );
        continue;
      }
      seenSecondary.add(categoryId);
      if (!categories.has(categoryId)) {
        fail(
          "missing-secondary-category",
          `secondary category "${categoryId}" is not in the public tree`,
        );
      }
    }

    // Checked after the fields, so a duplicated id reports the same field
    // problems whichever copy the adapter listed first.
    if (seenContentIds.has(placement.contentId)) {
      issues.push({
        code: "duplicate-content-id",
        subject: placement.contentId,
        message: "contentId must be unique",
      });
      continue;
    }
    seenContentIds.add(placement.contentId);

    if (valid) {
      resolved.set(placement.contentId, {
        ...placement,
        secondaryCategoryIds: [...secondary],
      });
    }
  }

  return resolved;
}

/**
 * Enforces the one local slug namespace that ADR-0003 gives to *public* child
 * categories and canonically placed published content: beneath one parent, a
 * public child category and a canonical content page cannot own the same slug.
 *
 * A category outside the public tree owns no route, so it reserves nothing — an
 * empty private child must not block a published page from taking its slug. If
 * that category later becomes public, this check rejects the ambiguity before
 * publication. A secondary placement owns no detail route and never collides.
 *
 * Collisions are reported against every content page in the group, naming all
 * participants in id order, so input order cannot change the diagnostics.
 */
function validateLocalSlugNamespace(
  categories: ReadonlyMap<string, ContentCategory>,
  placements: ReadonlyMap<string, ContentPlacement>,
  publicCategoryIds: ReadonlySet<string>,
  issues: ContentTreeIssue[],
): void {
  const claims: SlugClaim[] = [];

  for (const category of categories.values()) {
    if (!publicCategoryIds.has(category.categoryId)) continue;
    claims.push({
      id: category.categoryId,
      parentId: category.parentId,
      slug: category.slug,
      kind: "category",
    });
  }

  for (const placement of placements.values()) {
    if (!placement.published || placement.canonicalCategoryId === null) continue;
    claims.push({
      id: placement.contentId,
      parentId: placement.canonicalCategoryId,
      slug: placement.slug,
      kind: "content",
    });
  }

  for (const group of groupSlugClaims(claims).values()) {
    if (group.length < 2) continue;

    const contentIds = group
      .filter((claim) => claim.kind === "content")
      .map((claim) => claim.id)
      .sort();
    // A group of categories alone is a sibling collision, already reported.
    if (contentIds.length === 0) continue;

    const allIds = group.map((claim) => claim.id).sort();
    for (const contentId of contentIds) {
      issues.push({
        code: "local-slug-collision",
        subject: contentId,
        message: `slug "${group[0].slug}" is claimed beneath one category by ${quoteIds(allIds)}`,
      });
    }
  }
}

function compareSiblings(a: ContentCategory, b: ContentCategory): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0;
}

function indexChildren(
  categories: ReadonlyMap<string, ContentCategory>,
): Map<string | null, readonly string[]> {
  const grouped = new Map<string | null, ContentCategory[]>();
  for (const category of categories.values()) {
    const siblings = grouped.get(category.parentId) ?? [];
    siblings.push(category);
    grouped.set(category.parentId, siblings);
  }

  const indexed = new Map<string | null, readonly string[]>();
  for (const [parentId, siblings] of grouped) {
    indexed.set(
      parentId,
      siblings.sort(compareSiblings).map((category) => category.categoryId),
    );
  }
  return indexed;
}

function resolvePublicCategoryIds(
  categories: ReadonlyMap<string, ContentCategory>,
  placements: ReadonlyMap<string, ContentPlacement>,
): Set<string> {
  const withContent = new Set<string>();
  for (const placement of placements.values()) {
    if (!placement.published) continue;
    if (placement.canonicalCategoryId !== null) {
      withContent.add(placement.canonicalCategoryId);
    }
    for (const categoryId of placement.secondaryCategoryIds) {
      withContent.add(categoryId);
    }
  }

  // A branch category is public when a descendant is, so publicity propagates
  // upward from every category that directly holds published content.
  const isPublic = new Set<string>();
  for (const categoryId of withContent) {
    let current: string | null = categoryId;
    while (current !== null && !isPublic.has(current)) {
      isPublic.add(current);
      current = categories.get(current)?.parentId ?? null;
    }
  }
  return isPublic;
}

function resolveInput(input: ContentTreeInput) {
  const issues: ContentTreeIssue[] = [];
  const categories = validateCategories(input.categories, issues);
  const placements = validatePlacements(input.placements, categories, issues);
  // Publicity is resolved before the local namespace check, which only public
  // categories take part in.
  const publicCategoryIds = resolvePublicCategoryIds(categories, placements);
  validateLocalSlugNamespace(categories, placements, publicCategoryIds, issues);

  return {
    issues: normalizeIssues(issues),
    categories,
    placements,
    publicCategoryIds,
  };
}

/**
 * Reports every structural problem in one pass, sorted by subject and code so
 * the same input always produces the same diagnostics.
 */
export function validateContentTree(
  input: ContentTreeInput,
): readonly ContentTreeIssue[] {
  return resolveInput(input).issues;
}

/** Builds a validated tree, or throws `ContentTreeValidationError`. */
export function buildContentTree(input: ContentTreeInput): ContentTree {
  const { issues, categories, placements, publicCategoryIds } =
    resolveInput(input);
  if (issues.length > 0) {
    throw new ContentTreeValidationError(issues);
  }

  return {
    categories,
    placements,
    childCategoryIds: indexChildren(categories),
    publicCategoryIds,
  };
}

// ---------------------------------------------------------------------------
// Ancestry and placement queries
// ---------------------------------------------------------------------------

/** Ancestry from the top-level category down to `categoryId`, inclusive. */
export function getCategoryAncestry(
  tree: ContentTree,
  categoryId: string,
): readonly ContentCategory[] {
  const ancestry: ContentCategory[] = [];
  let current: string | null = categoryId;
  while (current !== null) {
    const category: ContentCategory | undefined = tree.categories.get(current);
    if (!category) return [];
    ancestry.unshift(category);
    current = category.parentId;
  }
  return ancestry;
}

/**
 * Canonical path segments of a category, relative to the story namespace. The
 * route layer owns the locale base and the namespace segment itself.
 */
export function getCategoryPath(
  tree: ContentTree,
  categoryId: string,
): readonly string[] {
  return getCategoryAncestry(tree, categoryId).map((category) => category.slug);
}

/**
 * Canonical detail path of a published content page, or `null` when it has no
 * public canonical location. Secondary placements never produce a path.
 */
export function getCanonicalContentPath(
  tree: ContentTree,
  contentId: string,
): readonly string[] | null {
  const placement = tree.placements.get(contentId);
  if (!placement?.published || placement.canonicalCategoryId === null) {
    return null;
  }
  const categoryPath = getCategoryPath(tree, placement.canonicalCategoryId);
  if (categoryPath.length === 0) return null;
  return [...categoryPath, placement.slug];
}

/** Child categories in sibling order, including ones not yet public. */
export function getChildCategories(
  tree: ContentTree,
  parentId: string | null,
): readonly ContentCategory[] {
  const ids = tree.childCategoryIds.get(parentId) ?? [];
  return ids.flatMap((id) => {
    const category = tree.categories.get(id);
    return category ? [category] : [];
  });
}

/** Child categories that belong in public navigation, in sibling order. */
export function getPublicChildCategories(
  tree: ContentTree,
  parentId: string | null,
): readonly ContentCategory[] {
  return getChildCategories(tree, parentId).filter((category) =>
    tree.publicCategoryIds.has(category.categoryId),
  );
}

export function isCategoryPublic(
  tree: ContentTree,
  categoryId: string,
): boolean {
  return tree.publicCategoryIds.has(categoryId);
}

/**
 * Published content canonically placed directly in a category. Listing order,
 * pagination, and what an entry displays belong to the category route story.
 */
export function getCanonicalContent(
  tree: ContentTree,
  categoryId: string,
): readonly ContentPlacement[] {
  return [...tree.placements.values()].filter(
    (placement) =>
      placement.published && placement.canonicalCategoryId === categoryId,
  );
}

/**
 * The published page a slug names beneath one category, or `undefined` when the
 * category holds none.
 *
 * Only a canonical placement is matched, because only it owns a detail route.
 * The local slug namespace validated above guarantees at most one claimant, so
 * this never has to choose between candidates.
 */
export function getCanonicalContentBySlug(
  tree: ContentTree,
  categoryId: string,
  slug: string,
): ContentPlacement | undefined {
  return getCanonicalContent(tree, categoryId).find(
    (placement) => placement.slug === slug,
  );
}

/**
 * Published content listed in a category through a secondary placement. Each
 * entry links to the one canonical detail route.
 */
export function getSecondaryContent(
  tree: ContentTree,
  categoryId: string,
): readonly ContentPlacement[] {
  return [...tree.placements.values()].filter(
    (placement) =>
      placement.published &&
      placement.secondaryCategoryIds.includes(categoryId),
  );
}

// ---------------------------------------------------------------------------
// Moves, renames, and removal
// ---------------------------------------------------------------------------

export type CanonicalPathChange = {
  readonly kind: "category" | "content";
  /** `categoryId` or `contentId`; identity is what survives the change. */
  readonly id: string;
  readonly previousPath: readonly string[];
  readonly currentPath: readonly string[];
};

export type CanonicalPathConflict = CanonicalPathChange & {
  /**
   * The identity that already serves `previousPath` in the current tree.
   * Redirecting it to `currentPath` would take over a live route.
   */
  readonly claimedBy: string;
};

export type CanonicalPathDiff = {
  /** Permanent redirects the route layer owes, previous path → current path. */
  readonly redirects: readonly CanonicalPathChange[];
  /**
   * Changes that must not become redirects: another identity already serves
   * the previous path, so emitting one would break ADR-0003's loop and
   * reserved-path rules. Two pages swapping slugs is the plain example — each
   * redirect would point at the other's live route. These need an authoring
   * decision, not a generated redirect.
   */
  readonly conflicts: readonly CanonicalPathConflict[];
};

/** Every public path in a tree, mapped to the identity that owns it. */
function indexPublicPaths(tree: ContentTree): Map<string, string> {
  const owners = new Map<string, string>();
  for (const categoryId of tree.publicCategoryIds) {
    owners.set(getCategoryPath(tree, categoryId).join("/"), categoryId);
  }
  for (const contentId of tree.placements.keys()) {
    const path = getCanonicalContentPath(tree, contentId);
    if (path !== null) owners.set(path.join("/"), contentId);
  }
  return owners;
}

function compareChanges(a: CanonicalPathChange, b: CanonicalPathChange): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Canonical paths that a move or rename changed, resolved by stable identity
 * rather than by comparing path strings.
 *
 * Both snapshots must describe the same locale. Redirects never cross
 * languages, so diffing a Finnish tree against an English one is meaningless.
 *
 * Only entries public in both trees are considered: content that left
 * publication 404s rather than inventing a redirect, and newly published
 * content has no history. Adding, removing, or reordering secondary placements
 * never changes a canonical path and so never appears in either list.
 *
 * A change becomes a redirect only when nothing else already serves its
 * previous path; otherwise it is reported as a conflict. The caller still owns
 * the flattened redirect registry, where history from earlier moves and the
 * deployment's legacy mapping are combined and re-checked.
 */
export function diffCanonicalPaths(
  previous: ContentTree,
  current: ContentTree,
): CanonicalPathDiff {
  const changes: CanonicalPathChange[] = [];

  for (const categoryId of previous.publicCategoryIds) {
    if (!current.publicCategoryIds.has(categoryId)) continue;
    const previousPath = getCategoryPath(previous, categoryId);
    const currentPath = getCategoryPath(current, categoryId);
    if (previousPath.join("/") !== currentPath.join("/")) {
      changes.push({
        kind: "category",
        id: categoryId,
        previousPath,
        currentPath,
      });
    }
  }

  for (const contentId of previous.placements.keys()) {
    const previousPath = getCanonicalContentPath(previous, contentId);
    const currentPath = getCanonicalContentPath(current, contentId);
    if (previousPath === null || currentPath === null) continue;
    if (previousPath.join("/") !== currentPath.join("/")) {
      changes.push({
        kind: "content",
        id: contentId,
        previousPath,
        currentPath,
      });
    }
  }

  const currentOwners = indexPublicPaths(current);
  const redirects: CanonicalPathChange[] = [];
  const conflicts: CanonicalPathConflict[] = [];

  for (const change of changes.sort(compareChanges)) {
    const claimedBy = currentOwners.get(change.previousPath.join("/"));
    if (claimedBy !== undefined && claimedBy !== change.id) {
      conflicts.push({ ...change, claimedBy });
    } else {
      redirects.push(change);
    }
  }

  return { redirects, conflicts };
}

export type CategoryDependants = {
  readonly childCategoryIds: readonly string[];
  readonly canonicalContentIds: readonly string[];
};

/**
 * What must move or leave publication before a category can be hidden or
 * removed. Secondary placements may simply be detached, so they never block.
 */
export function getCategoryDependants(
  tree: ContentTree,
  categoryId: string,
): CategoryDependants {
  return {
    childCategoryIds: getPublicChildCategories(tree, categoryId).map(
      (category) => category.categoryId,
    ),
    canonicalContentIds: getCanonicalContent(tree, categoryId).map(
      (placement) => placement.contentId,
    ),
  };
}
