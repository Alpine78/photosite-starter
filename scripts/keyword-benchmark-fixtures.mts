/**
 * AB#65 spike — the pure, no-IO half of the keyword-hierarchy query benchmark.
 *
 * This module builds a deterministic, entirely synthetic corpus that models
 * "roughly 8000 public media records" tagged against a controlled keyword
 * taxonomy, so the query and hierarchy strategies AB#55's taxonomy ADR and
 * ADR-0012's dynamic-gallery contract leave open can be measured against a
 * realistic archive shape before either commits a production schema.
 *
 * ## What it is NOT
 *
 * - Not a Sanity schema. These documents are written straight through the
 *   mutate HTTP API by `scripts/keyword-benchmark.mts`; no Studio, no
 *   `sanity/schemas/*` entry, no `sanity` package. Their `_type`s
 *   (`benchmarkKeyword`, `benchmarkMedia`) are spike-local and never appear
 *   in the application.
 * - Not production data. Every label is drawn from a fixed synthetic
 *   vocabulary (`Root`, `Rally-*`, `Marque-*`, `Team-*`, `Driver-A1`,
 *   `Stage-*`, `Surface-*`, `Era-*`, `Class-*`). There is no real
 *   photographer, person, place, event, filename, URL, or credential
 *   anywhere in the output — `validateKeywordBenchmarkFixtures` enforces
 *   that mechanically (AC8).
 * - Not the real `media` model. It carries only the handful of fields a
 *   keyword-intersection query needs (`mediaId`, `publiclyRenderable`,
 *   `dynamicallyDiscoverable`, `capturedAt`, and the two keyword-closure
 *   representations being compared). No rendition, no dimensions, no asset.
 *
 * ## The two hierarchy representations, on one corpus
 *
 * A single seeded dataset carries both representations so the read side of
 * every strategy can be measured without reseeding (the write-amplification
 * cost that only strategy B pays is measured separately, as a real move
 * operation, by the orchestrator — see `keyword-benchmark-model.mts` and the
 * findings doc):
 *
 * - **Strategy A — materialized ancestors on the keyword document.** Each
 *   `benchmarkKeyword` carries `ancestorKeywordIds`: the ids on its path to
 *   the root, **excluding itself**. A descendant lookup is then
 *   `keywordId == $k || $k in ancestorKeywordIds`.
 * - **Strategy B — ancestor expansion on the medium.** Each `benchmarkMedia`
 *   carries `expandedKeywordIds`: the union of its directly-authored
 *   `leafKeywordIds` and every ancestor of each, **self-inclusive** (a
 *   directly-tagged keyword is always in the closure). A match is then
 *   `$k in expandedKeywordIds`, no join.
 * - **Strategy C — query-time traversal** uses only the authored
 *   `parentKeywordId` edge (a plain string, not a Sanity reference — the
 *   spike never dereferences it), walked level by level.
 *
 * `descendantKeywordIds` is deliberately **not** stored on the keyword
 * document: parent-edge traversal does not need it, and maintaining it would
 * distort the hierarchy-move amplification figure (a move would then also
 * rewrite the old and new ancestors' descendant lists, breaking the clean
 * `|subtree|` formula strategy A is supposed to demonstrate). The benchmark
 * computes descendant sets in memory where it needs them.
 *
 * ## Determinism
 *
 * `buildKeywordBenchmarkFixtures()` with the same options returns
 * byte-identical output on every call: all randomness comes from a seeded
 * `mulberry32` PRNG with a fixed default seed. The corpus can therefore be
 * rebuilt locally (to know exactly which ids a measurement addresses)
 * without reading it back from Sanity.
 */

export const BENCHMARK_ID_PREFIX = "kwbench--";
export const BENCHMARK_KEYWORD_TYPE = "benchmarkKeyword";
export const BENCHMARK_MEDIA_TYPE = "benchmarkMedia";

/**
 * The canonical selection bound from ADR-0012 §3 step 5. Restated here (not
 * imported from `src/lib`) for the same plain-`node`-resolution reason every
 * other `scripts/*.mts` file restates its constants; the model module's test
 * pins it against the documented value.
 */
export const MAX_CANONICAL_KEYWORDS = 5;

/** ADR-0012 §3 / AB#55: the taxonomy stays shallow. Excess depth is a rejected state, not a supported one. */
export const MAX_KEYWORD_DEPTH = 5;

/** AC1: "approximately 8000 public media records". */
export const DEFAULT_MEDIA_COUNT = 8000;

/**
 * The one exact instant a large block of media share, so ordering and
 * keyset pagination are exercised against a real duplicate-sort-key cluster
 * (AC1 "duplicate sort values"), not just distinct timestamps.
 */
export const DUPLICATE_CAPTURED_AT = "2024-06-15T12:00:00Z";

export type BenchmarkKeyword = {
  readonly _id: string;
  readonly _type: typeof BENCHMARK_KEYWORD_TYPE;
  readonly benchmarkRun: string;
  readonly keywordId: string;
  readonly label: string;
  readonly parentKeywordId: string | null;
  /** Path to the root, excluding this keyword. Strategy A. */
  readonly ancestorKeywordIds: readonly string[];
  readonly depth: number;
};

export type BenchmarkMedium = {
  readonly _id: string;
  readonly _type: typeof BENCHMARK_MEDIA_TYPE;
  readonly benchmarkRun: string;
  readonly mediaId: string;
  readonly publiclyRenderable: true;
  readonly dynamicallyDiscoverable: boolean;
  /** ISO-8601 UTC instant, or null for the undated block (`coalesce` fallback). */
  readonly capturedAt: string | null;
  /** Directly authored tags. Strategy C walks up from these. */
  readonly leafKeywordIds: readonly string[];
  /** Self-inclusive ancestor closure of `leafKeywordIds`. Strategy B. */
  readonly expandedKeywordIds: readonly string[];
};

export type BenchmarkPinnedIntersection = {
  readonly label: string;
  readonly keywordIds: readonly string[];
  readonly expectedCount: number;
};

/**
 * The specific keyword ids each measurement in the matrix addresses.
 * Rebuilt deterministically alongside the corpus so the orchestrator and
 * the findings doc name the same ids the fixture actually contains.
 */
export type BenchmarkScenario = {
  readonly benchmarkRun: string;
  /** Root of the wide, shallow subtree — matches a large fraction of the corpus. */
  readonly broadRootKeywordId: string;
  /** Leaf of the deep, thin chain — matches a single-digit number of media. */
  readonly narrowLeafKeywordId: string;
  /** ADR-0012 §3 / AC4: an ancestor and one of its descendants. `Cars + Peugeot -> Peugeot`. */
  readonly parentDescendantPair: { readonly ancestorKeywordId: string; readonly descendantKeywordId: string };
  /** A genuine internal node (has children) on the same root path as the pair, for the AC6 root/internal/leaf fan-out comparison. */
  readonly internalNodeKeywordId: string;
  /** Five pairwise-incomparable leaves — the maximum-width AND, the §3 bound's boundary case. */
  readonly fiveWideKeywordIds: readonly string[];
  /** A canonical selection whose AND is provably empty (the zero-result path). */
  readonly emptyIntersectionKeywordIds: readonly string[];
  /**
   * 1..5-keyword intersections whose query-eligible result size (ADR-0012 §2:
   * `publiclyRenderable AND dynamicallyDiscoverable`) is asserted, so the
   * corpus cannot drift silently and a live `run` row can be checked against
   * a known number.
   */
  readonly pinnedIntersections: readonly BenchmarkPinnedIntersection[];
  /** Broad (wide subtree) and deep (thin chain) nodes to move, for the AC7 amplification measurement. */
  readonly hierarchyMoveTargets: {
    readonly broadKeywordId: string;
    readonly deepKeywordId: string;
    readonly newParentKeywordId: string;
  };
  /** Media pairs whose `capturedAt` differs only in sub-second precision (ADR-0012 §9 keyset risk). */
  readonly subSecondPrecisionMediaIds: readonly (readonly [string, string])[];
};

export type KeywordBenchmarkFixtures = {
  readonly keywords: readonly BenchmarkKeyword[];
  readonly media: readonly BenchmarkMedium[];
  readonly scenario: BenchmarkScenario;
};

export type BuildOptions = {
  readonly mediaCount?: number;
  readonly seed?: number;
  /**
   * Tag written to `benchmarkRun` on every document and echoed in the
   * scenario. Every benchmark query filters on it, so a stray document of
   * the same `_type` from an unrelated run cannot contaminate a count or a
   * page (Codex plan-review finding #2 — an `_id` prefix alone is not an
   * ownership predicate a `_type ==` filter respects).
   */
  readonly benchmarkRun?: string;
  /** Fraction of media flagged `dynamicallyDiscoverable: false` (ADR-0012 §2 AND). */
  readonly privateFraction?: number;
  /**
   * Fraction of media that also carry a *direct* tag on an internal
   * (non-leaf) node, not only leaves. AB#55 has not decided whether tagging
   * is leaf-only; the benchmark models both rather than assuming.
   */
  readonly internalTagFraction?: number;
};

const DEFAULT_SEED = 0x5f_3d_2c_1b;
const DEFAULT_BENCHMARK_RUN = "kwbench-fixture-v1";

/** mulberry32 — a tiny, well-known deterministic PRNG. No dependency. */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The complete synthetic label vocabulary: `Root`, or one of a fixed set of
 * facet prefixes followed by a short alphanumeric code.
 * `validateKeywordBenchmarkFixtures` checks every keyword label against this
 * pattern, so a real place or person name can never reach the corpus
 * unnoticed (AC8).
 */
const LABEL_PATTERN = /^(?:Root|(?:Rally|Marque|Team|Driver|Stage|Surface|Era|Class)-[A-Z0-9]{1,4})$/;

type MutableKeyword = {
  _id: string;
  _type: typeof BENCHMARK_KEYWORD_TYPE;
  benchmarkRun: string;
  keywordId: string;
  label: string;
  parentKeywordId: string | null;
  ancestorKeywordIds: string[];
  depth: number;
};

function keywordDocId(keywordId: string): string {
  return `${BENCHMARK_ID_PREFIX}kw--${keywordId}`;
}

function mediaDocId(mediaId: string): string {
  return `${BENCHMARK_ID_PREFIX}media--${mediaId}`;
}

/**
 * Builds the taxonomy: one root, a wide-shallow "broad" branch, a
 * thin-deep "narrow" branch, and a few medium branches so the five-wide
 * selection has pairwise-incomparable leaves to draw from.
 */
function buildTaxonomy(run: string): {
  keywords: MutableKeyword[];
  byId: Map<string, MutableKeyword>;
  broadRootId: string;
  broadLeafIds: string[];
  narrowLeafId: string;
  mediumLeafIds: string[];
  parentDescendantPair: { ancestorKeywordId: string; descendantKeywordId: string };
  internalNodeId: string;
  deepChainIds: string[];
  firstFacetRootId: string;
} {
  const keywords: MutableKeyword[] = [];
  const byId = new Map<string, MutableKeyword>();
  let sequence = 0;

  const add = (label: string, parentKeywordId: string | null): MutableKeyword => {
    sequence += 1;
    const keywordId = `kw-${pad(sequence, 4)}`;
    const parent = parentKeywordId === null ? null : byId.get(parentKeywordId) ?? null;
    const ancestorKeywordIds =
      parent === null ? [] : [...parent.ancestorKeywordIds, parent.keywordId];
    const keyword: MutableKeyword = {
      _id: keywordDocId(keywordId),
      _type: BENCHMARK_KEYWORD_TYPE,
      benchmarkRun: run,
      keywordId,
      label,
      parentKeywordId,
      ancestorKeywordIds,
      depth: ancestorKeywordIds.length,
    };
    keywords.push(keyword);
    byId.set(keywordId, keyword);
    return keyword;
  };

  const root = add("Root", null);

  // Broad branch: Rally-A -> 40 marques -> 4 models each (161 nodes, depth 3),
  // a wide fan-out whose root sits over a large slice of the corpus.
  const broadRoot = add("Rally-A", root.keywordId);
  const broadLeafIds: string[] = [];
  let descendantForPair: string | null = null;
  let internalNodeId: string | null = null;
  for (let marque = 0; marque < 40; marque += 1) {
    const marqueNode = add(`Marque-${pad(marque, 2)}`, broadRoot.keywordId);
    if (marque === 0) internalNodeId = marqueNode.keywordId;
    for (let model = 0; model < 4; model += 1) {
      const modelNode = add(`Class-${pad(marque, 2)}${model}`, marqueNode.keywordId);
      broadLeafIds.push(modelNode.keywordId);
      if (marque === 0 && model === 0) descendantForPair = modelNode.keywordId;
    }
  }

  // Narrow branch: a depth-5 chain, one child per level, tiny match set.
  let deepParent = root.keywordId;
  const deepChainIds: string[] = [];
  for (let level = 0; level < MAX_KEYWORD_DEPTH; level += 1) {
    const node = add(`Stage-${pad(level, 2)}`, deepParent);
    deepChainIds.push(node.keywordId);
    deepParent = node.keywordId;
  }
  const narrowLeafId = deepChainIds[deepChainIds.length - 1]!;

  // Medium branches: a few facet trees (Team, Surface, Era, Driver) so the
  // five-wide AND has genuinely unrelated leaves.
  const mediumLeafIds: string[] = [];
  let firstFacetRootId: string | null = null;
  for (const [facet, count] of [
    ["Team", 12],
    ["Surface", 6],
    ["Era", 6],
    ["Driver", 8],
  ] as const) {
    const facetRoot = add(`Rally-${facet.slice(0, 1)}${facet.length}`, root.keywordId);
    if (firstFacetRootId === null) firstFacetRootId = facetRoot.keywordId;
    for (let index = 0; index < count; index += 1) {
      const node = add(`${facet}-${pad(index, 2)}`, facetRoot.keywordId);
      mediumLeafIds.push(node.keywordId);
    }
  }

  return {
    keywords,
    byId,
    broadRootId: broadRoot.keywordId,
    broadLeafIds,
    narrowLeafId,
    mediumLeafIds,
    parentDescendantPair: {
      ancestorKeywordId: broadRoot.keywordId,
      descendantKeywordId: descendantForPair!,
    },
    internalNodeId: internalNodeId!,
    deepChainIds,
    firstFacetRootId: firstFacetRootId!,
  };
}

/** Union of `leafKeywordIds` and every ancestor of each — self-inclusive. */
export function computeExpandedKeywordIds(
  leafKeywordIds: readonly string[],
  byId: ReadonlyMap<string, { readonly ancestorKeywordIds: readonly string[] }>,
): string[] {
  const closure = new Set<string>();
  for (const leaf of leafKeywordIds) {
    closure.add(leaf);
    const node = byId.get(leaf);
    if (node) for (const ancestor of node.ancestorKeywordIds) closure.add(ancestor);
  }
  return [...closure].sort();
}

export function buildKeywordBenchmarkFixtures(options: BuildOptions = {}): KeywordBenchmarkFixtures {
  const mediaCount = options.mediaCount ?? DEFAULT_MEDIA_COUNT;
  const run = options.benchmarkRun ?? DEFAULT_BENCHMARK_RUN;
  const privateFraction = options.privateFraction ?? 0.1;
  const internalTagFraction = options.internalTagFraction ?? 0.15;
  const random = createPrng(options.seed ?? DEFAULT_SEED);

  if (!Number.isInteger(mediaCount) || mediaCount < 100) {
    throw new TypeError(`mediaCount must be an integer >= 100, received ${mediaCount}`);
  }

  const taxonomy = buildTaxonomy(run);
  const byId = taxonomy.byId;

  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const pickDistinct = <T,>(items: readonly T[], howMany: number): T[] => {
    const pool = [...items];
    const chosen: T[] = [];
    while (chosen.length < howMany && pool.length > 0) {
      chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
    }
    return chosen;
  };

  const media: BenchmarkMedium[] = [];
  const internalNodeIds = taxonomy.keywords
    .filter((keyword) => keyword.depth >= 1 && keyword.depth <= 2)
    .map((keyword) => keyword.keywordId);

  // The first NARROW_LEAF_MEDIA media carry ONLY the narrow-branch leaf and
  // nothing else, so that branch's match set is exactly this size and any
  // AND of the narrow leaf with a keyword outside {narrow leaf} is provably
  // empty — the zero-result path, robust to the random draw.
  const NARROW_LEAF_MEDIA = 7;

  // The maximum-width AND (five pairwise-incomparable facet leaves) is
  // planted on an exact band of media so its match set is non-empty and
  // deterministic — a few random facet draws alone would never cover all
  // five at once.
  const WIDE_BAND_START = 30;
  const WIDE_BAND_END = 50;
  const plantedWideSet = [0, 12, 18, 24, 1].map((offset) => taxonomy.mediumLeafIds[offset]!);

  // Sub-second-precision pairs live in their own disjoint index band so they
  // never overlap the narrow-leaf block or the duplicate-instant cluster.
  // The partner's crafted timestamp is applied when its index is reached.
  const subSecondPrecisionMediaIds: (readonly [string, string])[] = [];
  const craftedTimestamps = new Map<string, string>();
  for (const [pairIndex, baseSeconds] of [
    [20, "2023-03-03T03:03:03"],
    [22, "2023-07-07T07:07:07"],
    [24, "2023-11-11T11:11:11"],
  ] as const) {
    const firstId = `m-${pad(pairIndex + 1, 5)}`;
    const secondId = `m-${pad(pairIndex + 2, 5)}`;
    craftedTimestamps.set(firstId, `${baseSeconds}.000Z`);
    craftedTimestamps.set(secondId, `${baseSeconds}.500Z`);
    subSecondPrecisionMediaIds.push([firstId, secondId]);
  }

  for (let index = 0; index < mediaCount; index += 1) {
    const mediaId = `m-${pad(index + 1, 5)}`;
    const leafKeywordIds = new Set<string>();

    if (index < NARROW_LEAF_MEDIA) {
      leafKeywordIds.add(taxonomy.narrowLeafId);
    } else {
      // Every medium gets 1-3 broad-branch leaves (except an every-fifth
      // slice), so the broad root matches a large fraction of the corpus.
      if (index % 5 !== 0) {
        for (const leaf of pickDistinct(taxonomy.broadLeafIds, 1 + Math.floor(random() * 3))) {
          leafKeywordIds.add(leaf);
        }
      }
      // 0-3 medium-facet leaves.
      for (const leaf of pickDistinct(taxonomy.mediumLeafIds, Math.floor(random() * 4))) {
        leafKeywordIds.add(leaf);
      }
      // A fraction also carry a direct internal-node tag (AB#55 has not
      // decided leaf-only tagging; the corpus models both).
      if (random() < internalTagFraction) {
        leafKeywordIds.add(pick(internalNodeIds));
      }
      if (index >= WIDE_BAND_START && index < WIDE_BAND_END) {
        for (const leaf of plantedWideSet) leafKeywordIds.add(leaf);
      }
      if (leafKeywordIds.size === 0) {
        leafKeywordIds.add(pick(taxonomy.mediumLeafIds));
      }
    }

    let capturedAt: string | null;
    const crafted = craftedTimestamps.get(mediaId);
    if (crafted !== undefined) {
      capturedAt = crafted;
    } else if (index % 200 === 7) {
      capturedAt = null; // undated block — `coalesce(capturedAt, "")` fallback
    } else if (index % 4 === 0) {
      capturedAt = DUPLICATE_CAPTURED_AT; // ~25% share one exact instant
    } else {
      const dayOffset = Math.floor(random() * 900);
      const secondOffset = Math.floor(random() * 86_400);
      const instant = new Date(Date.UTC(2022, 0, 1) + dayOffset * 86_400_000 + secondOffset * 1000);
      capturedAt = `${instant.toISOString().slice(0, 19)}Z`;
    }

    const expandedKeywordIds = computeExpandedKeywordIds([...leafKeywordIds], byId);

    media.push({
      _id: mediaDocId(mediaId),
      _type: BENCHMARK_MEDIA_TYPE,
      benchmarkRun: run,
      mediaId,
      publiclyRenderable: true,
      dynamicallyDiscoverable: random() >= privateFraction,
      capturedAt,
      leafKeywordIds: [...leafKeywordIds].sort(),
      expandedKeywordIds,
    });
  }

  const keywords: BenchmarkKeyword[] = taxonomy.keywords.map((keyword) => ({
    _id: keyword._id,
    _type: keyword._type,
    benchmarkRun: keyword.benchmarkRun,
    keywordId: keyword.keywordId,
    label: keyword.label,
    parentKeywordId: keyword.parentKeywordId,
    ancestorKeywordIds: [...keyword.ancestorKeywordIds],
    depth: keyword.depth,
  }));

  const scenario = buildScenario(run, taxonomy, media, subSecondPrecisionMediaIds);

  return { keywords, media, scenario };
}

/**
 * The number of media a dynamic query for `selectionKeywordIds` returns —
 * over the **query-eligible** set (ADR-0012 §2: `publiclyRenderable AND
 * dynamicallyDiscoverable`), matching what the measurement specs actually
 * filter on. A raw keyword-match count would over-report and make the pinned
 * "sanity check" numbers look like drift against a live run.
 */
function countMatching(
  media: readonly BenchmarkMedium[],
  selectionKeywordIds: readonly string[],
): number {
  return media.filter(
    (medium) =>
      medium.publiclyRenderable === true &&
      medium.dynamicallyDiscoverable &&
      selectionKeywordIds.every((keywordId) => medium.expandedKeywordIds.includes(keywordId)),
  ).length;
}

function buildScenario(
  run: string,
  taxonomy: ReturnType<typeof buildTaxonomy>,
  media: readonly BenchmarkMedium[],
  subSecondPrecisionMediaIds: readonly (readonly [string, string])[],
): BenchmarkScenario {
  // One leaf from each of several facet trees, so the maximum-width AND is
  // genuinely across unrelated facets rather than five siblings.
  const facetLeafPicks = [0, 12, 18, 24, 1].map((offset) => taxonomy.mediumLeafIds[offset]!);
  const fiveWideKeywordIds = facetLeafPicks.slice(0, MAX_CANONICAL_KEYWORDS);

  // An empty intersection: the narrow leaf ANDed with a medium-facet leaf.
  // The narrow-leaf media carry only the narrow leaf; every other medium
  // lacks the narrow leaf — so the AND is provably zero by construction.
  const emptyIntersectionKeywordIds = [taxonomy.narrowLeafId, fiveWideKeywordIds[0]!];

  const pinnedIntersections: BenchmarkPinnedIntersection[] = [
    { label: "1-keyword / broad root", keywordIds: [taxonomy.broadRootId] },
    { label: "1-keyword / narrow leaf", keywordIds: [taxonomy.narrowLeafId] },
    {
      label: "2-keyword / parent+descendant (pre-collapse)",
      keywordIds: [
        taxonomy.parentDescendantPair.ancestorKeywordId,
        taxonomy.parentDescendantPair.descendantKeywordId,
      ],
    },
    { label: "3-keyword / medium facets", keywordIds: fiveWideKeywordIds.slice(0, 3) },
    { label: "4-keyword / medium facets", keywordIds: fiveWideKeywordIds.slice(0, 4) },
    { label: "5-keyword / maximum width", keywordIds: fiveWideKeywordIds },
    { label: "empty intersection", keywordIds: emptyIntersectionKeywordIds },
  ].map((entry) => ({
    ...entry,
    expectedCount: countMatching(media, entry.keywordIds),
  }));

  return {
    benchmarkRun: run,
    broadRootKeywordId: taxonomy.broadRootId,
    narrowLeafKeywordId: taxonomy.narrowLeafId,
    parentDescendantPair: taxonomy.parentDescendantPair,
    internalNodeKeywordId: taxonomy.internalNodeId,
    fiveWideKeywordIds,
    emptyIntersectionKeywordIds,
    pinnedIntersections,
    hierarchyMoveTargets: {
      broadKeywordId: taxonomy.broadRootId,
      deepKeywordId: taxonomy.deepChainIds[1]!,
      // A facet root outside both the broad branch and the deep chain, so
      // either move actually reparents the node rather than being a no-op.
      newParentKeywordId: taxonomy.firstFacetRootId,
    },
    subSecondPrecisionMediaIds,
  };
}

// ---------------------------------------------------------------------------
// Validation — every invariant an owner-run write could otherwise violate,
// re-derived here the way `validateSeedFixtures` does for the sample content.
// ---------------------------------------------------------------------------

export class KeywordBenchmarkFixtureError extends Error {
  constructor(message: string) {
    super(`[keyword-benchmark-fixtures] ${message}`);
    this.name = "KeywordBenchmarkFixtureError";
  }
}

export function validateKeywordBenchmarkFixtures(fixtures: KeywordBenchmarkFixtures): void {
  const { keywords, media, scenario } = fixtures;
  const fail = (message: string): never => {
    throw new KeywordBenchmarkFixtureError(message);
  };

  // --- keyword structure ---
  const keywordById = new Map<string, BenchmarkKeyword>();
  const seenDocIds = new Set<string>();
  for (const keyword of keywords) {
    if (!keyword._id.startsWith(BENCHMARK_ID_PREFIX)) fail(`keyword ${keyword._id} is outside the ${BENCHMARK_ID_PREFIX} namespace`);
    if (keyword._id.includes(".")) fail(`keyword ${keyword._id} contains a dot (hidden from tokenless reads)`);
    if (seenDocIds.has(keyword._id)) fail(`duplicate keyword _id ${keyword._id}`);
    seenDocIds.add(keyword._id);
    if (keywordById.has(keyword.keywordId)) fail(`duplicate keywordId ${keyword.keywordId}`);
    keywordById.set(keyword.keywordId, keyword);
    if (!LABEL_PATTERN.test(keyword.label)) {
      fail(`keyword ${keyword.keywordId} label "${keyword.label}" is not a synthetic benchmark label`);
    }
    if (keyword.benchmarkRun !== scenario.benchmarkRun) fail(`keyword ${keyword.keywordId} carries a mismatched benchmarkRun`);
  }

  for (const keyword of keywords) {
    // acyclic + ancestor closure correctness
    const path: string[] = [];
    let cursor: string | null = keyword.parentKeywordId;
    const guard = new Set<string>([keyword.keywordId]);
    while (cursor !== null) {
      if (guard.has(cursor)) fail(`cycle through keyword ${keyword.keywordId}`);
      guard.add(cursor);
      const parent = keywordById.get(cursor);
      if (!parent) fail(`keyword ${keyword.keywordId} parent ${cursor} does not resolve`);
      path.unshift(parent!.keywordId);
      cursor = parent!.parentKeywordId;
    }
    if (JSON.stringify(path) !== JSON.stringify(keyword.ancestorKeywordIds)) {
      fail(`keyword ${keyword.keywordId} ancestorKeywordIds ${JSON.stringify(keyword.ancestorKeywordIds)} != recomputed ${JSON.stringify(path)}`);
    }
    if (keyword.ancestorKeywordIds.includes(keyword.keywordId)) fail(`keyword ${keyword.keywordId} lists itself as an ancestor`);
    if (keyword.depth !== keyword.ancestorKeywordIds.length) fail(`keyword ${keyword.keywordId} depth != ancestor count`);
    if (keyword.depth > MAX_KEYWORD_DEPTH) fail(`keyword ${keyword.keywordId} depth ${keyword.depth} exceeds ${MAX_KEYWORD_DEPTH}`);
  }

  // --- media structure ---
  const mediaById = new Map<string, BenchmarkMedium>();
  let undatedCount = 0;
  let duplicateInstantCount = 0;
  for (const medium of media) {
    if (!medium._id.startsWith(BENCHMARK_ID_PREFIX)) fail(`media ${medium._id} is outside the ${BENCHMARK_ID_PREFIX} namespace`);
    if (medium._id.includes(".")) fail(`media ${medium._id} contains a dot`);
    if (seenDocIds.has(medium._id)) fail(`duplicate media _id ${medium._id}`);
    seenDocIds.add(medium._id);
    if (mediaById.has(medium.mediaId)) fail(`duplicate mediaId ${medium.mediaId}`);
    mediaById.set(medium.mediaId, medium);
    if (medium.benchmarkRun !== scenario.benchmarkRun) fail(`media ${medium.mediaId} carries a mismatched benchmarkRun`);
    if (medium.publiclyRenderable !== true) fail(`media ${medium.mediaId} is not publiclyRenderable`);
    if (medium.leafKeywordIds.length === 0) fail(`media ${medium.mediaId} has no leafKeywordIds`);

    for (const leaf of medium.leafKeywordIds) {
      if (!keywordById.has(leaf)) fail(`media ${medium.mediaId} leaf ${leaf} does not resolve`);
    }
    const recomputed = computeExpandedKeywordIds(medium.leafKeywordIds, keywordById);
    if (JSON.stringify(recomputed) !== JSON.stringify([...medium.expandedKeywordIds])) {
      fail(`media ${medium.mediaId} expandedKeywordIds drift`);
    }
    for (const leaf of medium.leafKeywordIds) {
      if (!medium.expandedKeywordIds.includes(leaf)) fail(`media ${medium.mediaId} closure is not self-inclusive for ${leaf}`);
    }

    if (medium.capturedAt === null) {
      undatedCount += 1;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(medium.capturedAt)) {
        fail(`media ${medium.mediaId} capturedAt "${medium.capturedAt}" is not a Z-normalized ISO-8601 instant`);
      }
      if (medium.capturedAt === DUPLICATE_CAPTURED_AT) duplicateInstantCount += 1;
    }
  }

  if (media.length < 100) fail(`only ${media.length} media`);
  if (undatedCount === 0) fail("no undated media — `coalesce` fallback ordering is not exercised");
  if (duplicateInstantCount < Math.floor(media.length * 0.15)) {
    fail(`only ${duplicateInstantCount} media at the duplicate instant — the sort-key cluster is too small`);
  }

  // --- scenario coverage ---
  if (!keywordById.has(scenario.broadRootKeywordId)) fail("scenario broadRootKeywordId does not resolve");
  if (!keywordById.has(scenario.narrowLeafKeywordId)) fail("scenario narrowLeafKeywordId does not resolve");
  const broadMatch = countMatching(media, [scenario.broadRootKeywordId]);
  if (broadMatch < media.length * 0.4) fail(`broad root only matches ${broadMatch}/${media.length} — not "broad"`);
  const narrowMatch = countMatching(media, [scenario.narrowLeafKeywordId]);
  if (narrowMatch === 0 || narrowMatch > 12) fail(`narrow leaf matches ${narrowMatch} — expected 1..12`);

  const ancestor = keywordById.get(scenario.parentDescendantPair.ancestorKeywordId)!;
  const descendant = keywordById.get(scenario.parentDescendantPair.descendantKeywordId)!;
  if (!descendant.ancestorKeywordIds.includes(ancestor.keywordId)) {
    fail("parentDescendantPair ancestor is not actually an ancestor of the descendant");
  }

  const internal = keywordById.get(scenario.internalNodeKeywordId);
  if (!internal) fail("scenario internalNodeKeywordId does not resolve");
  if (!keywords.some((keyword) => keyword.parentKeywordId === scenario.internalNodeKeywordId)) {
    fail("scenario internalNodeKeywordId has no children — it is not a genuine internal node");
  }
  if (!descendant.ancestorKeywordIds.includes(scenario.internalNodeKeywordId)) {
    fail("scenario internalNodeKeywordId is not on the parent+descendant root path");
  }

  if (scenario.fiveWideKeywordIds.length !== MAX_CANONICAL_KEYWORDS) fail("fiveWideKeywordIds is not length 5");
  for (let i = 0; i < scenario.fiveWideKeywordIds.length; i += 1) {
    for (let j = i + 1; j < scenario.fiveWideKeywordIds.length; j += 1) {
      const a = keywordById.get(scenario.fiveWideKeywordIds[i]!)!;
      const b = keywordById.get(scenario.fiveWideKeywordIds[j]!)!;
      if (a.ancestorKeywordIds.includes(b.keywordId) || b.ancestorKeywordIds.includes(a.keywordId)) {
        fail("fiveWideKeywordIds contains a comparable pair — not a maximum-width antichain");
      }
    }
  }

  if (countMatching(media, scenario.emptyIntersectionKeywordIds) !== 0) {
    fail("emptyIntersectionKeywordIds does not actually yield zero media");
  }

  for (const pinned of scenario.pinnedIntersections) {
    const actual = countMatching(media, pinned.keywordIds);
    if (actual !== pinned.expectedCount) {
      fail(`pinned intersection "${pinned.label}" expected ${pinned.expectedCount}, corpus has ${actual}`);
    }
  }

  for (const [firstId, secondId] of scenario.subSecondPrecisionMediaIds) {
    const first = mediaById.get(firstId);
    const second = mediaById.get(secondId);
    if (!first || !second) fail(`sub-second precision pair ${firstId}/${secondId} missing`);
    if (first!.capturedAt === null || second!.capturedAt === null) fail(`sub-second precision pair ${firstId}/${secondId} has a null timestamp`);
    if (first!.capturedAt === second!.capturedAt) fail(`sub-second precision pair ${firstId}/${secondId} timestamps are equal`);
    const secondsOnly = (value: string): string => value.slice(0, 19);
    if (secondsOnly(first!.capturedAt!) !== secondsOnly(second!.capturedAt!)) {
      fail(`sub-second precision pair ${firstId}/${secondId} differs above the sub-second field`);
    }
  }

  if (scenario.subSecondPrecisionMediaIds.length === 0) fail("no sub-second precision pairs");
}

/** Shapes the fixtures into the plain documents the mutate API receives. */
export function toBenchmarkDocuments(
  fixtures: KeywordBenchmarkFixtures,
): readonly (Readonly<Record<string, unknown>> & { readonly _id: string })[] {
  return [
    ...fixtures.keywords.map((keyword) => ({ ...keyword })),
    ...fixtures.media.map((medium) => ({ ...medium })),
  ];
}
