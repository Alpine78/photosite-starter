/**
 * AB#65 spike — the pure analytical models that answer the parts of the
 * story a live query cannot: selection canonicalization (AC4), the
 * cache-cardinality and invalidation fan-out estimate (AC6), and the
 * hierarchy-move write-amplification model (AC7). It also carries the
 * reference JS comparator for the public-media order (AC5 / ADR-0012 §9),
 * so the live keyset walk can be checked against it.
 *
 * Everything here is deterministic and store-free. The orchestrator feeds it
 * the same `keyword-benchmark-fixtures.mts` corpus the live run is measured
 * against, so the modelled numbers and the measured numbers describe one
 * taxonomy.
 */

import type { BenchmarkKeyword, BenchmarkMedium } from "./keyword-benchmark-fixtures.mts";
import { computeExpandedKeywordIds, MAX_CANONICAL_KEYWORDS } from "./keyword-benchmark-fixtures.mts";

export { MAX_CANONICAL_KEYWORDS };

// ---------------------------------------------------------------------------
// AC4 — selection canonicalization (ADR-0012 §3, steps 2-4)
// ---------------------------------------------------------------------------

export type KeywordIndex = ReadonlyMap<string, Pick<BenchmarkKeyword, "keywordId" | "ancestorKeywordIds">>;

export function buildKeywordIndex(keywords: readonly BenchmarkKeyword[]): KeywordIndex {
  return new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));
}

/** True iff `ancestorId` is a proper ancestor of `descendantId` in the taxonomy. */
export function isAncestor(index: KeywordIndex, ancestorId: string, descendantId: string): boolean {
  return index.get(descendantId)?.ancestorKeywordIds.includes(ancestorId) ?? false;
}

export type CanonicalizationResult = {
  /** Deduped, ancestor-collapsed, ascending — the form both the URL and the cursor scope are built from. */
  readonly canonical: readonly string[];
  /** Ids dropped because a selected descendant made them redundant (ADR-0012 §3 step 3). */
  readonly collapsedAncestors: readonly string[];
  /** Ids dropped as exact duplicates (step 2). */
  readonly duplicates: readonly string[];
  /** Whether `canonical.length` is within the ADR-0012 §3 step 5 bound. */
  readonly withinBound: boolean;
};

/**
 * ADR-0012 §3 steps 2-4 (dedupe -> collapse ancestors -> sort). Step 1
 * (alias resolution) and step 5's failure handling belong to the route, not
 * this model; `withinBound` is reported so the caller can apply step 5.
 * Applied repeatedly until no ancestor/descendant pair remains, so a
 * grandparent-parent-child chain collapses to the child alone.
 */
export function canonicalizeSelection(
  rawKeywordIds: readonly string[],
  index: KeywordIndex,
): CanonicalizationResult {
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const id of rawKeywordIds) {
    if (seen.has(id)) duplicates.push(id);
    else seen.add(id);
  }

  let working = [...seen];
  const collapsedAncestors: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of working) {
      const hasSelectedDescendant = working.some(
        (other) => other !== candidate && isAncestor(index, candidate, other),
      );
      if (hasSelectedDescendant) {
        collapsedAncestors.push(candidate);
        working = working.filter((id) => id !== candidate);
        changed = true;
        break;
      }
    }
  }

  working.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    canonical: working,
    collapsedAncestors,
    duplicates,
    withinBound: working.length >= 1 && working.length <= MAX_CANONICAL_KEYWORDS,
  };
}

// ---------------------------------------------------------------------------
// AC5 — reference comparator for `order(coalesce(capturedAt, "") desc, mediaId asc)`
// ---------------------------------------------------------------------------

export type OrderableMedium = Pick<BenchmarkMedium, "capturedAt" | "mediaId">;

/**
 * The exact ordering `PUBLIC_MEDIA_ORDER` (`src/lib/sanity-media.ts`)
 * declares, as a JS comparator: `coalesce(capturedAt, "")` descending, then
 * `mediaId` ascending. Plain code-unit string comparison on both keys —
 * ADR-0012 §9 flags that this is the first keyset-paginated consumer of this
 * order and that GROQ's own ORDER BY must be verified to agree, especially
 * across `capturedAt` values differing only in sub-second precision. The
 * live run compares its page walk against this function.
 */
export function comparePublicMediaOrder(a: OrderableMedium, b: OrderableMedium): number {
  const keyA = a.capturedAt ?? "";
  const keyB = b.capturedAt ?? "";
  if (keyA !== keyB) return keyA < keyB ? 1 : -1; // desc
  if (a.mediaId !== b.mediaId) return a.mediaId < b.mediaId ? -1 : 1; // asc
  return 0;
}

export function orderByPublicMediaOrder<T extends OrderableMedium>(media: readonly T[]): T[] {
  return [...media].sort(comparePublicMediaOrder);
}

// ---------------------------------------------------------------------------
// AC6 — cache cardinality and invalidation fan-out
// ---------------------------------------------------------------------------

function binomial(n: number, k: number): bigint {
  if (k < 0 || k > n) return BigInt(0);
  let result = BigInt(1);
  for (let i = 0; i < k; i += 1) {
    result = (result * BigInt(n - i)) / BigInt(i + 1);
  }
  return result;
}

/**
 * The naive upper bound on distinct canonical selections: every size-1..K
 * subset of the vocabulary, ignoring the ancestor collapse. `Σ C(V, k)`.
 * This is what the cursor/cache key space looks like if collapse bought
 * nothing — the ceiling the real, collapse-aware number sits under.
 */
export function naiveSelectionCardinality(
  vocabularySize: number,
  maxKeywords = MAX_CANONICAL_KEYWORDS,
): bigint {
  let total = BigInt(0);
  for (let k = 1; k <= maxKeywords; k += 1) total += binomial(vocabularySize, k);
  return total;
}

type ForestNode = { readonly id: string; readonly childIds: readonly string[] };

function buildForest(keywords: readonly BenchmarkKeyword[]): {
  nodes: ReadonlyMap<string, ForestNode>;
  roots: readonly string[];
} {
  const childIds = new Map<string, string[]>();
  for (const keyword of keywords) childIds.set(keyword.keywordId, []);
  const roots: string[] = [];
  for (const keyword of keywords) {
    if (keyword.parentKeywordId === null) roots.push(keyword.keywordId);
    else childIds.get(keyword.parentKeywordId)?.push(keyword.keywordId);
  }
  const nodes = new Map<string, ForestNode>();
  for (const [id, kids] of childIds) nodes.set(id, { id, childIds: kids });
  return { nodes, roots };
}

/** Convolve two size-capped polynomials (choosing disjoint antichains from disjoint subtrees). */
function convPoly(a: readonly bigint[], b: readonly bigint[], maxK: number): bigint[] {
  const out = new Array<bigint>(maxK + 1).fill(BigInt(0));
  for (let i = 0; i <= maxK && i < a.length; i += 1) {
    if (a[i] === BigInt(0)) continue;
    for (let j = 0; j + i <= maxK && j < b.length; j += 1) {
      out[i + j] += a[i]! * b[j]!;
    }
  }
  return out;
}

/**
 * Tree DP over the taxonomy forest: the number of antichains (pairwise
 * incomparable node sets) of every size 0..maxK. After the ADR-0012 §3
 * collapse, a *valid* canonical selection is exactly a size-1..5 antichain —
 * so this, not `Σ C(V, k)`, is the real distinct-selection count, and it
 * depends on the tree's shape (depth, branching), not just its node count.
 *
 * `g[v]` = antichains fully inside subtree(v). Either none touch `v`
 * (convolve the children's `g`) or exactly `{v}` does (which forbids every
 * descendant, contributing one antichain of size 1).
 */
export function antichainSelectionCardinality(
  keywords: readonly BenchmarkKeyword[],
  maxKeywords = MAX_CANONICAL_KEYWORDS,
): { readonly bySize: readonly bigint[]; readonly total: bigint } {
  const { nodes, roots } = buildForest(keywords);
  const memo = new Map<string, bigint[]>();

  const solve = (id: string): bigint[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    const node = nodes.get(id)!;
    let notThis: bigint[] = new Array<bigint>(maxKeywords + 1).fill(BigInt(0));
    notThis[0] = BigInt(1); // the empty antichain
    for (const childId of node.childIds) {
      notThis = convPoly(notThis, solve(childId), maxKeywords);
    }
    const g = [...notThis];
    if (maxKeywords >= 1) g[1] = (g[1] ?? BigInt(0)) + BigInt(1); // the antichain {v}
    memo.set(id, g);
    return g;
  };

  let combined: bigint[] = new Array<bigint>(maxKeywords + 1).fill(BigInt(0));
  combined[0] = BigInt(1);
  for (const rootId of roots) combined = convPoly(combined, solve(rootId), maxKeywords);

  const bySize = combined.slice(0, maxKeywords + 1);
  let total = BigInt(0);
  for (let k = 1; k <= maxKeywords; k += 1) total += bySize[k] ?? BigInt(0);
  return { bySize, total };
}

/**
 * Invalidation fan-out for a single medium's keyword-membership change
 * (AC6). When one medium gains or loses keyword X, its membership in a
 * canonical selection S can only change if S names X or an ancestor of X
 * (selecting an ancestor matches X's media by descendant expansion). Every
 * node on X's root path is pairwise comparable, so any antichain contains at
 * most one of them — the fan-out is the number of size-1..K antichains that
 * include exactly one node from `chain(X) = {X} ∪ ancestors(X)`.
 *
 * Computed as `total antichains − antichains that avoid the whole chain`.
 * The chain-avoiding count is the same DP with every chain node's own
 * `{v}` contribution suppressed (its subtree still contributes through
 * descendants that are not themselves on the chain).
 */
export function membershipChangeFanOut(
  keywords: readonly BenchmarkKeyword[],
  keywordId: string,
  maxKeywords = MAX_CANONICAL_KEYWORDS,
): { readonly affectedSelections: bigint; readonly totalSelections: bigint; readonly fraction: number } {
  const index = buildKeywordIndex(keywords);
  const target = index.get(keywordId);
  if (!target) throw new Error(`[keyword-benchmark-model] unknown keywordId ${keywordId}`);
  const chain = new Set<string>([keywordId, ...target.ancestorKeywordIds]);

  const { nodes, roots } = buildForest(keywords);
  const memo = new Map<string, bigint[]>();
  const solve = (id: string): bigint[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    const node = nodes.get(id)!;
    let notThis: bigint[] = new Array<bigint>(maxKeywords + 1).fill(BigInt(0));
    notThis[0] = BigInt(1);
    for (const childId of node.childIds) notThis = convPoly(notThis, solve(childId), maxKeywords);
    const g = [...notThis];
    if (maxKeywords >= 1 && !chain.has(id)) g[1] = (g[1] ?? BigInt(0)) + BigInt(1);
    memo.set(id, g);
    return g;
  };
  let combined: bigint[] = new Array<bigint>(maxKeywords + 1).fill(BigInt(0));
  combined[0] = BigInt(1);
  for (const rootId of roots) combined = convPoly(combined, solve(rootId), maxKeywords);

  let avoiding = BigInt(0);
  for (let k = 1; k <= maxKeywords; k += 1) avoiding += combined[k] ?? BigInt(0);

  const total = antichainSelectionCardinality(keywords, maxKeywords).total;
  const affected = total - avoiding;
  return {
    affectedSelections: affected,
    totalSelections: total,
    fraction: total === BigInt(0) ? 0 : Number(affected) / Number(total),
  };
}

/**
 * The three distinct cache-invalidation events ADR-0012 §6 names, sized
 * against this taxonomy. Only the first is a per-keyword fan-out; the other
 * two are, by ADR-0012's own decision, coarse and near-total.
 */
export function describeInvalidationEvents(
  keywords: readonly BenchmarkKeyword[],
  sampleKeywordIds: { readonly root: string; readonly internal: string; readonly leaf: string },
): {
  readonly totalCanonicalSelections: bigint;
  readonly singleMediumMembershipChange: Record<"root" | "internal" | "leaf", ReturnType<typeof membershipChangeFanOut>>;
  readonly taxonomyStructuralChange: { readonly invalidates: "every outstanding dynamic cursor site-wide"; readonly reason: string };
  readonly visibilityVersionChange: { readonly invalidates: string; readonly reason: string };
} {
  const total = antichainSelectionCardinality(keywords).total;
  return {
    totalCanonicalSelections: total,
    singleMediumMembershipChange: {
      root: membershipChangeFanOut(keywords, sampleKeywordIds.root),
      internal: membershipChangeFanOut(keywords, sampleKeywordIds.internal),
      leaf: membershipChangeFanOut(keywords, sampleKeywordIds.leaf),
    },
    taxonomyStructuralChange: {
      invalidates: "every outstanding dynamic cursor site-wide",
      reason:
        "ADR-0012 §6: the taxonomy version is one global counter at v1, folded into normalizedFilter; any structural edit bumps it and every cursor minted before it is wrong-scope.",
    },
    visibilityVersionChange: {
      invalidates:
        "every outstanding cursor for every query the changed medium matches (per-query scoped, but near-total for a broad or popular query)",
      reason:
        "ADR-0012 §6: the dynamic visibilityVersion is the same class of coarse over-approximation the curated adapter already ships, sized for a much larger pool.",
    },
  };
}

// ---------------------------------------------------------------------------
// AC7 — hierarchy-move write amplification
// ---------------------------------------------------------------------------

const MUTATION_BATCH_SIZE = 100; // restates scripts/sanity-seed-http.mts

export type HierarchyMoveAmplification = {
  readonly movedKeywordId: string;
  readonly newParentKeywordId: string;
  readonly subtreeKeywordIds: readonly string[];
  /** Strategy A: rewrite `ancestorKeywordIds` on the moved node and every descendant. */
  readonly strategyA: {
    readonly keywordDocsRewritten: number;
    readonly mediaDocsRewritten: 0;
    readonly mutationBatches: number;
    readonly note: string;
  };
  /** Strategy B: rewrite `expandedKeywordIds` only on media whose closure actually changes. */
  readonly strategyB: {
    readonly keywordDocsRewritten: 1;
    /** Media tagged anywhere in the subtree — the naive over-count. */
    readonly mediaTaggedInSubtree: number;
    /** Of those, the ones whose recomputed closure genuinely differs — the real write count. */
    readonly mediaDocsRewritten: number;
    /** Tagged in the subtree but the new ancestor(s) are already present via another tag, so nothing to write. */
    readonly mediaDocsUnchanged: number;
    readonly mutationBatches: number;
    readonly note: string;
  };
};

function collectSubtree(keywords: readonly BenchmarkKeyword[], rootId: string): string[] {
  const { nodes } = buildForest(keywords);
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    for (const childId of nodes.get(id)?.childIds ?? []) stack.push(childId);
  }
  return out;
}

/**
 * The `ancestorKeywordIds` of every keyword *after* moving `movedKeywordId`
 * under `newParentKeywordId`. Unchanged for a keyword outside the moved
 * subtree; for the moved node and its descendants the old root-path prefix
 * up to and including `movedKeywordId` is replaced by
 * `[...newParent.ancestors, newParentKeywordId, movedKeywordId]`.
 *
 * Shared by the analytical model here and the live `move` command, so the
 * modelled and measured write counts are computed the same way.
 */
export function computePostMoveAncestorIndex(
  keywords: readonly BenchmarkKeyword[],
  movedKeywordId: string,
  newParentKeywordId: string,
): {
  readonly index: ReadonlyMap<string, { readonly ancestorKeywordIds: readonly string[] }>;
  readonly subtreeKeywordIds: readonly string[];
  readonly postMoveAncestorsOf: (keywordId: string) => readonly string[];
} {
  const byId = new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));
  const moved = byId.get(movedKeywordId);
  const newParent = byId.get(newParentKeywordId);
  if (!moved) throw new Error(`[keyword-benchmark-model] unknown movedKeywordId ${movedKeywordId}`);
  if (!newParent) throw new Error(`[keyword-benchmark-model] unknown newParentKeywordId ${newParentKeywordId}`);

  const subtree = collectSubtree(keywords, movedKeywordId);
  const subtreeSet = new Set(subtree);
  const newBaseAncestors = [...newParent.ancestorKeywordIds, newParent.keywordId];

  const postMoveAncestorsOf = (keywordId: string): readonly string[] => {
    const keyword = byId.get(keywordId);
    if (!keyword) return [];
    if (!subtreeSet.has(keywordId)) return keyword.ancestorKeywordIds;
    if (keywordId === movedKeywordId) return newBaseAncestors;
    const intermediate = keyword.ancestorKeywordIds.slice(moved.ancestorKeywordIds.length + 1);
    return [...newBaseAncestors, movedKeywordId, ...intermediate];
  };

  const index = new Map(
    keywords.map((keyword) => [keyword.keywordId, { ancestorKeywordIds: postMoveAncestorsOf(keyword.keywordId) }]),
  );
  return { index, subtreeKeywordIds: subtree, postMoveAncestorsOf };
}

export function hierarchyMoveAmplification(
  keywords: readonly BenchmarkKeyword[],
  media: readonly BenchmarkMedium[],
  movedKeywordId: string,
  newParentKeywordId: string,
): HierarchyMoveAmplification {
  const { index, subtreeKeywordIds } = computePostMoveAncestorIndex(
    keywords,
    movedKeywordId,
    newParentKeywordId,
  );
  const subtreeSet = new Set(subtreeKeywordIds);
  const preIndex = new Map(
    keywords.map((keyword) => [keyword.keywordId, { ancestorKeywordIds: keyword.ancestorKeywordIds }]),
  );

  const taggedInSubtree = media.filter((medium) =>
    medium.leafKeywordIds.some((leaf) => subtreeSet.has(leaf)),
  );
  const changed = taggedInSubtree.filter((medium) => {
    const before = computeExpandedKeywordIds(medium.leafKeywordIds, preIndex);
    const after = computeExpandedKeywordIds(medium.leafKeywordIds, index);
    return JSON.stringify(before) !== JSON.stringify(after);
  }).length;

  const batches = (docs: number): number => Math.max(1, Math.ceil(docs / MUTATION_BATCH_SIZE));

  return {
    movedKeywordId,
    newParentKeywordId,
    subtreeKeywordIds,
    strategyA: {
      keywordDocsRewritten: subtreeKeywordIds.length,
      mediaDocsRewritten: 0,
      mutationBatches: batches(subtreeKeywordIds.length),
      note:
        "Every node's root path changed. `descendantKeywordIds` is deliberately not stored, so no ancestor document is touched — the cost is exactly |subtree|.",
    },
    strategyB: {
      keywordDocsRewritten: 1,
      mediaTaggedInSubtree: taggedInSubtree.length,
      mediaDocsRewritten: changed,
      mediaDocsUnchanged: taggedInSubtree.length - changed,
      // The forward mutation is the changed media plus the one keyword doc
      // whose `parentKeywordId` edge moves.
      mutationBatches: batches(changed + 1),
      note:
        "Only media whose recomputed `expandedKeywordIds` genuinely differs are written; a medium already carrying the new ancestor via another tag needs no write.",
    },
  };
}
