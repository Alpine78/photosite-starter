/**
 * AB#65 spike — the GROQ query builders and an in-memory reference
 * evaluator for the keyword-intersection matrix (AC2, AC3, AC5).
 *
 * Every builder is a pure function of a `MatchSpec` and returns a
 * `{ label, query, params }` the measurement transport
 * (`keyword-benchmark-http.mts`) sends verbatim. The three ancestor
 * strategies ADR-0012 §4 leaves open are each a separate builder over the
 * same spec:
 *
 * - **`media-expansion`** — one round trip, `$k in expandedKeywordIds` per
 *   selected keyword. No join.
 * - **`materialized-ancestors`** — resolve each selected keyword's
 *   descendant closure from the keyword documents (`keywordId == $k || $k in
 *   ancestorKeywordIds`), then match media whose `leafKeywordIds` intersect
 *   it. Offered both as a single correlated query and as an explicit
 *   two-step (`resolvedDescendantsByKeyword` supplied), so the join cost is
 *   measured with and without a second request.
 * - **`query-time-traversal`** — no materialized closure at all: walk the
 *   authored `parentKeywordId` edge one level at a time
 *   (`buildLevelExpansionQuery`), accumulating descendants, then match as in
 *   the two-step form. Round trips scale with taxonomy depth.
 *
 * The in-memory evaluator (`evaluateMatch`) computes the same result set in
 * plain JS for every strategy, so a test can assert all three agree before
 * any live timing is trusted, and that a keyset page walk reproduces the
 * full ordered list across the duplicate-`capturedAt` cluster.
 *
 * GROQ note (Codex plan-review finding #5): a slice range with a parameter
 * bound (`[0...$n]`) is not something the GROQ specification guarantees, so
 * every builder interpolates a validated non-negative integer literal into
 * the slice instead. `_type` and every id value stay parameters.
 */

import {
  BENCHMARK_KEYWORD_TYPE,
  BENCHMARK_MEDIA_TYPE,
  type BenchmarkKeyword,
  type BenchmarkMedium,
  type KeywordBenchmarkFixtures,
} from "./keyword-benchmark-fixtures.mts";
import { comparePublicMediaOrder } from "./keyword-benchmark-model.mts";

export type AncestorStrategy = "media-expansion" | "materialized-ancestors" | "query-time-traversal";

export type MatchSpec = {
  readonly benchmarkRun: string;
  readonly selectionKeywordIds: readonly string[];
  readonly strategy: AncestorStrategy;
  /** ADR-0012 §2: a dynamic result additionally requires `dynamicallyDiscoverable`. */
  readonly requireDynamicallyDiscoverable: boolean;
};

export type BenchmarkQuery = {
  readonly label: string;
  readonly query: string;
  readonly params: Readonly<Record<string, unknown>>;
};

const PUBLIC_MEDIA_ORDER = `order(coalesce(capturedAt, "") desc, mediaId asc)`;

function assertSliceBound(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`[keyword-benchmark-queries] ${name} must be a non-negative integer, received ${value}`);
  }
}

function eligibilityPredicate(spec: MatchSpec): string {
  const parts = [`_type == $mediaType`, `benchmarkRun == $run`, `publiclyRenderable == true`];
  if (spec.requireDynamicallyDiscoverable) parts.push(`dynamicallyDiscoverable == true`);
  return parts.join(" && ");
}

function selectionParams(spec: MatchSpec): Record<string, unknown> {
  const params: Record<string, unknown> = {
    mediaType: BENCHMARK_MEDIA_TYPE,
    keywordType: BENCHMARK_KEYWORD_TYPE,
    run: spec.benchmarkRun,
  };
  spec.selectionKeywordIds.forEach((id, index) => {
    params[`k${index}`] = id;
  });
  return params;
}

/** Resolves one keyword's descendant closure (self-inclusive) from the keyword documents. */
export function buildDescendantResolutionQuery(keywordId: string, benchmarkRun: string): BenchmarkQuery {
  return {
    label: `resolve descendants of ${keywordId}`,
    query: `*[_type == $keywordType && benchmarkRun == $run && (keywordId == $k || $k in ancestorKeywordIds)].keywordId`,
    params: { keywordType: BENCHMARK_KEYWORD_TYPE, run: benchmarkRun, k: keywordId },
  };
}

/** One level of a `parentKeywordId` walk — the `query-time-traversal` primitive. */
export function buildLevelExpansionQuery(frontierKeywordIds: readonly string[], benchmarkRun: string): BenchmarkQuery {
  return {
    label: `expand ${frontierKeywordIds.length} frontier node(s) one level`,
    query: `*[_type == $keywordType && benchmarkRun == $run && parentKeywordId in $frontier].keywordId`,
    params: { keywordType: BENCHMARK_KEYWORD_TYPE, run: benchmarkRun, frontier: [...frontierKeywordIds] },
  };
}

function perKeywordPredicate(
  spec: MatchSpec,
  index: number,
  resolvedDescendantsByKeyword: ReadonlyMap<string, readonly string[]> | undefined,
): string {
  const kParam = `$k${index}`;
  if (spec.strategy === "media-expansion") {
    return `${kParam} in expandedKeywordIds`;
  }
  // materialized-ancestors / query-time-traversal both intersect leafKeywordIds
  // with a descendant-id set — inline when it was pre-resolved, subquery when not.
  if (resolvedDescendantsByKeyword) {
    return `count(leafKeywordIds[@ in $desc${index}]) > 0`;
  }
  return `count(leafKeywordIds[@ in *[_type == $keywordType && benchmarkRun == $run && (keywordId == ${kParam} || ${kParam} in ancestorKeywordIds)].keywordId]) > 0`;
}

function matchFilter(
  spec: MatchSpec,
  resolvedDescendantsByKeyword: ReadonlyMap<string, readonly string[]> | undefined,
): { filter: string; params: Record<string, unknown> } {
  const params = selectionParams(spec);
  const predicates = spec.selectionKeywordIds.map((keywordId, index) => {
    if (resolvedDescendantsByKeyword && spec.strategy !== "media-expansion") {
      params[`desc${index}`] = [...(resolvedDescendantsByKeyword.get(keywordId) ?? [])];
    }
    return perKeywordPredicate(spec, index, resolvedDescendantsByKeyword);
  });
  const filter = [eligibilityPredicate(spec), ...predicates].join(" && ");
  return { filter, params };
}

export function buildMatchQuery(
  spec: MatchSpec,
  resolvedDescendantsByKeyword?: ReadonlyMap<string, readonly string[]>,
): BenchmarkQuery {
  const { filter, params } = matchFilter(spec, resolvedDescendantsByKeyword);
  return {
    label: `${spec.strategy} match (${spec.selectionKeywordIds.length} keyword${spec.selectionKeywordIds.length === 1 ? "" : "s"})`,
    query: `*[${filter}] | ${PUBLIC_MEDIA_ORDER} { "mediaId": mediaId, capturedAt }`,
    params,
  };
}

export function buildCountQuery(
  spec: MatchSpec,
  resolvedDescendantsByKeyword?: ReadonlyMap<string, readonly string[]>,
): BenchmarkQuery {
  const { filter, params } = matchFilter(spec, resolvedDescendantsByKeyword);
  return { label: `${spec.strategy} count`, query: `count(*[${filter}])`, params };
}

export function buildIdProjectionQuery(
  spec: MatchSpec,
  resolvedDescendantsByKeyword?: ReadonlyMap<string, readonly string[]>,
): BenchmarkQuery {
  const { filter, params } = matchFilter(spec, resolvedDescendantsByKeyword);
  return {
    label: `${spec.strategy} id projection (ordered)`,
    query: `*[${filter}] | ${PUBLIC_MEDIA_ORDER} { "mediaId": mediaId }`,
    params,
  };
}

export type KeysetCursor = { readonly afterKey: string; readonly afterId: string };

/**
 * ADR-0012 §7's descending keyset "next page": strictly *before* the
 * boundary key (descending field), or equal key and `mediaId` strictly
 * after. `coalesce(capturedAt, "")` mirrors `PUBLIC_MEDIA_ORDER` exactly.
 */
export function buildKeysetPageQuery(
  spec: MatchSpec,
  pageSize: number,
  cursor: KeysetCursor | undefined,
  resolvedDescendantsByKeyword?: ReadonlyMap<string, readonly string[]>,
): BenchmarkQuery {
  assertSliceBound(pageSize, "pageSize");
  const { filter, params } = matchFilter(spec, resolvedDescendantsByKeyword);
  let fullFilter = filter;
  const pageParams = { ...params };
  if (cursor) {
    fullFilter = `${filter} && (coalesce(capturedAt, "") < $afterKey || (coalesce(capturedAt, "") == $afterKey && mediaId > $afterId))`;
    pageParams.afterKey = cursor.afterKey;
    pageParams.afterId = cursor.afterId;
  }
  return {
    label: `${spec.strategy} keyset page (size ${pageSize}${cursor ? ", continued" : ""})`,
    query: `*[${fullFilter}] | ${PUBLIC_MEDIA_ORDER} [0...${pageSize}] { "mediaId": mediaId, capturedAt }`,
    params: pageParams,
  };
}

/** The offset baseline AC5 measures the keyset page against. */
export function buildOffsetPageQuery(
  spec: MatchSpec,
  start: number,
  end: number,
  resolvedDescendantsByKeyword?: ReadonlyMap<string, readonly string[]>,
): BenchmarkQuery {
  assertSliceBound(start, "start");
  assertSliceBound(end, "end");
  if (end < start) throw new TypeError(`[keyword-benchmark-queries] end (${end}) < start (${start})`);
  const { filter, params } = matchFilter(spec, resolvedDescendantsByKeyword);
  return {
    label: `${spec.strategy} offset page [${start}...${end}]`,
    query: `*[${filter}] | ${PUBLIC_MEDIA_ORDER} [${start}...${end}] { "mediaId": mediaId, capturedAt }`,
    params,
  };
}

// ---------------------------------------------------------------------------
// In-memory reference evaluator
// ---------------------------------------------------------------------------

function resolveDescendantClosure(
  keywords: readonly BenchmarkKeyword[],
  keywordId: string,
): Set<string> {
  const closure = new Set<string>([keywordId]);
  for (const keyword of keywords) {
    if (keyword.ancestorKeywordIds.includes(keywordId)) closure.add(keyword.keywordId);
  }
  return closure;
}

export type EvaluatedMedium = Pick<BenchmarkMedium, "mediaId" | "capturedAt">;

/**
 * The result set a strategy *should* return, computed in JS. Every strategy
 * must agree; the differences the benchmark measures are cost, never
 * membership.
 */
export function evaluateMatch(fixtures: KeywordBenchmarkFixtures, spec: MatchSpec): EvaluatedMedium[] {
  if (spec.selectionKeywordIds.length === 0) return [];

  const descendantSets = spec.selectionKeywordIds.map((keywordId) => {
    if (spec.strategy === "media-expansion") return null;
    return resolveDescendantClosure(fixtures.keywords, keywordId);
  });

  const matched = fixtures.media.filter((medium) => {
    if (medium.publiclyRenderable !== true) return false;
    if (spec.requireDynamicallyDiscoverable && !medium.dynamicallyDiscoverable) return false;
    return spec.selectionKeywordIds.every((keywordId, index) => {
      if (spec.strategy === "media-expansion") {
        return medium.expandedKeywordIds.includes(keywordId);
      }
      const closure = descendantSets[index]!;
      return medium.leafKeywordIds.some((leaf) => closure.has(leaf));
    });
  });

  return matched
    .map((medium) => ({ mediaId: medium.mediaId, capturedAt: medium.capturedAt }))
    .sort(comparePublicMediaOrder);
}

/**
 * Walks `ordered` (the full result of `evaluateMatch`) page by page using
 * the same descending-keyset boundary the GROQ builder encodes, and returns
 * the concatenation. A correct keyset walk reproduces `ordered` exactly —
 * no duplicate, no gap — including across a run of equal `capturedAt`
 * values, which is the ADR-0012 §9 risk the live run must confirm GROQ also
 * honours.
 */
export function keysetWalkInMemory(ordered: readonly EvaluatedMedium[], pageSize: number): EvaluatedMedium[] {
  assertSliceBound(pageSize, "pageSize");
  if (pageSize === 0) throw new TypeError("[keyword-benchmark-queries] pageSize must be positive for a walk");

  const walked: EvaluatedMedium[] = [];
  let cursor: KeysetCursor | undefined;
  // Bound the loop defensively; a correct walk terminates in ceil(n/pageSize).
  const maxPages = Math.ceil(ordered.length / pageSize) + 2;
  for (let page = 0; page < maxPages; page += 1) {
    const remaining = cursor
      ? ordered.filter((medium) => {
          const key = medium.capturedAt ?? "";
          if (key < cursor!.afterKey) return true;
          return key === cursor!.afterKey && medium.mediaId > cursor!.afterId;
        })
      : [...ordered];
    const slice = remaining.slice(0, pageSize);
    if (slice.length === 0) break;
    walked.push(...slice);
    const last = slice[slice.length - 1]!;
    cursor = { afterKey: last.capturedAt ?? "", afterId: last.mediaId };
    if (slice.length < pageSize) break;
  }
  return walked;
}
