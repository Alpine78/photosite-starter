/**
 * AB#65 spike — the measurement matrix (which queries, on which endpoints,
 * how many repetitions) and the Markdown renderer for its results.
 *
 * Pure and store-free: `buildMeasurementMatrix` turns a fixture
 * `BenchmarkScenario` into the full cross-product AC3/AC5 ask for —
 * `strategy × {broad, narrow, parent+descendant pre/post collapse, five-wide,
 * empty} × {direct API, CDN first-seen, CDN repeat}` for the intersection
 * queries, plus the keyset-vs-offset page walk and the three count
 * strategies. The orchestrator executes each cell; `formatResultsMarkdown`
 * turns the collected timings into the tables that paste into
 * `docs/keyword-query-benchmark.md`.
 *
 * "CDN first-seen" and "CDN repeat" are the same request to `apicdn`, issued
 * twice; only the response's own cache headers prove which was a miss and
 * which a hit, so the orchestrator records those rather than this module
 * asserting a temperature it cannot observe.
 */

import type { BenchmarkScenario } from "./keyword-benchmark-fixtures.mts";
import type { AncestorStrategy, MatchSpec } from "./keyword-benchmark-queries.mts";
import type { BenchmarkEndpoint, SampleSummary } from "./keyword-benchmark-http.mts";

export const DEFAULT_REPETITIONS = 8;
export const DEFAULT_PAGE_SIZE = 24; // matches the curated gallery's own page size band

export type IntersectionShape =
  | "broad-root"
  | "narrow-leaf"
  | "parent-descendant-pre-collapse"
  | "parent-descendant-collapsed"
  | "five-wide"
  | "empty";

export type StrategyVariant =
  | { readonly strategy: AncestorStrategy; readonly preResolveDescendants: boolean };

export const STRATEGY_VARIANTS: readonly StrategyVariant[] = [
  { strategy: "media-expansion", preResolveDescendants: false },
  { strategy: "materialized-ancestors", preResolveDescendants: false },
  { strategy: "materialized-ancestors", preResolveDescendants: true },
  { strategy: "query-time-traversal", preResolveDescendants: true },
];

/**
 * Two endpoint passes, no "cold/warm" split. The direct API is Sanity's
 * uncached surface, so `direct-api` is the honest uncached baseline. The
 * `cdn` pass issues the same request `--repetitions` times against the CDN;
 * the harness records every sample's own `age` / `x-cache` /
 * `cf-cache-status` headers, so the warm-up curve is read from the data
 * rather than asserted by a label (an identical GROQ URL is issued by more
 * than one strategy variant and by every re-run, so no single request can be
 * *claimed* cold).
 */
export const ENDPOINT_PASSES: readonly { readonly id: string; readonly endpoint: BenchmarkEndpoint }[] = [
  { id: "direct-api", endpoint: "api" },
  { id: "cdn", endpoint: "apicdn" },
];

export type IntersectionCell = {
  readonly id: string;
  readonly acRef: "AC2/AC3" | "AC4";
  readonly shape: IntersectionShape;
  readonly variant: StrategyVariant;
  readonly endpointPassId: string;
  readonly endpoint: BenchmarkEndpoint;
  readonly spec: MatchSpec;
  /** Keywords whose descendant closure the orchestrator must resolve first for the two-step / traversal variants. */
  readonly resolveDescendantsFor: readonly string[];
};

export type PaginationCell = {
  readonly id: string;
  readonly acRef: "AC5";
  readonly mode: "keyset" | "offset";
  readonly endpoint: BenchmarkEndpoint;
  readonly spec: MatchSpec;
  readonly pageSize: number;
  /** For a two-step / traversal strategy the walk must resolve these first, then keyset-page the match. */
  readonly resolveDescendantsFor: readonly string[];
};

export type CountCell = {
  readonly id: string;
  readonly acRef: "AC5";
  readonly mode: "count-function" | "id-projection-length" | "no-count";
  readonly endpoint: BenchmarkEndpoint;
  readonly spec: MatchSpec;
};

export type MeasurementMatrix = {
  readonly repetitions: number;
  readonly pageSize: number;
  readonly intersection: readonly IntersectionCell[];
  readonly pagination: readonly PaginationCell[];
  readonly count: readonly CountCell[];
};

function selectionFor(shape: IntersectionShape, scenario: BenchmarkScenario): readonly string[] {
  switch (shape) {
    case "broad-root":
      return [scenario.broadRootKeywordId];
    case "narrow-leaf":
      return [scenario.narrowLeafKeywordId];
    case "parent-descendant-pre-collapse":
      return [
        scenario.parentDescendantPair.ancestorKeywordId,
        scenario.parentDescendantPair.descendantKeywordId,
      ];
    case "parent-descendant-collapsed":
      return [scenario.parentDescendantPair.descendantKeywordId];
    case "five-wide":
      return scenario.fiveWideKeywordIds;
    case "empty":
      return scenario.emptyIntersectionKeywordIds;
  }
}

export function buildMeasurementMatrix(
  scenario: BenchmarkScenario,
  options: { readonly repetitions?: number; readonly pageSize?: number } = {},
): MeasurementMatrix {
  const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const run = scenario.benchmarkRun;

  const shapes: readonly IntersectionShape[] = [
    "broad-root",
    "narrow-leaf",
    "parent-descendant-pre-collapse",
    "parent-descendant-collapsed",
    "five-wide",
    "empty",
  ];

  const intersection: IntersectionCell[] = [];
  for (const shape of shapes) {
    const selectionKeywordIds = selectionFor(shape, scenario);
    for (const variant of STRATEGY_VARIANTS) {
      for (const pass of ENDPOINT_PASSES) {
        intersection.push({
          id: `intersection/${shape}/${variant.strategy}${variant.preResolveDescendants ? "+preresolve" : ""}/${pass.id}`,
          acRef: shape.startsWith("parent-descendant") ? "AC4" : "AC2/AC3",
          shape,
          variant,
          endpointPassId: pass.id,
          endpoint: pass.endpoint,
          spec: {
            benchmarkRun: run,
            selectionKeywordIds,
            strategy: variant.strategy,
            requireDynamicallyDiscoverable: true,
          },
          resolveDescendantsFor:
            variant.strategy === "media-expansion" || !variant.preResolveDescendants
              ? []
              : selectionKeywordIds,
        });
      }
    }
  }

  // Pagination + count walk the broad result (the largest working set).
  const broadSelection = [scenario.broadRootKeywordId];
  const specFor = (strategy: AncestorStrategy): MatchSpec => ({
    benchmarkRun: run,
    selectionKeywordIds: broadSelection,
    strategy,
    requireDynamicallyDiscoverable: true,
  });

  // Keyset per strategy — this is ADR-0012's own decision trigger: does the
  // strategy's bounded page walk stay bounded at archive scale? Offset is a
  // single baseline on the simplest strategy.
  const pagination: PaginationCell[] = [
    ...(["media-expansion", "materialized-ancestors", "query-time-traversal"] as const).map(
      (strategy): PaginationCell => ({
        id: `pagination/keyset/${strategy}/direct-api`,
        acRef: "AC5",
        mode: "keyset",
        endpoint: "api",
        spec: specFor(strategy),
        pageSize,
        resolveDescendantsFor: strategy === "media-expansion" ? [] : broadSelection,
      }),
    ),
    {
      id: "pagination/offset/media-expansion/direct-api",
      acRef: "AC5",
      mode: "offset",
      endpoint: "api",
      spec: specFor("media-expansion"),
      pageSize,
      resolveDescendantsFor: [],
    },
  ];

  // Count strategy (count() vs id-projection length vs none) is orthogonal to
  // the ancestor strategy, so it is measured once, on the simplest match.
  const count: CountCell[] = (["count-function", "id-projection-length", "no-count"] as const).map((mode) => ({
    id: `count/${mode}/direct-api`,
    acRef: "AC5",
    mode,
    endpoint: "api",
    spec: specFor("media-expansion"),
  }));

  return { repetitions, pageSize, intersection, pagination, count };
}

// ---------------------------------------------------------------------------
// Results rendering
// ---------------------------------------------------------------------------

export type CellResult = {
  readonly cellId: string;
  readonly requestCount: number;
  readonly summary: SampleSummary;
  readonly cacheHeaderSample: Readonly<Record<string, string>>;
  readonly note?: string;
};

export type MatrixResults = {
  readonly benchmarkRun: string;
  readonly capturedAt: string;
  readonly projectId: string;
  readonly dataset: string;
  readonly apiVersion: string;
  readonly cells: readonly CellResult[];
};

function ms(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(1);
}

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}

export function formatResultsMarkdown(results: MatrixResults): string {
  const lines: string[] = [];
  lines.push(`<!-- generated by \`npm run benchmark:keywords -- run\` on ${results.capturedAt} -->`);
  lines.push(
    `Run \`${results.benchmarkRun}\` against project \`${results.projectId}\`, dataset \`${results.dataset}\` (API ${results.apiVersion}).`,
  );
  lines.push("");
  lines.push(
    row([
      "Cell",
      "Requests",
      "Result rows",
      "Median wall ms",
      "p95 wall ms",
      "Median server ms",
      "Median bytes",
      "Cache headers",
      "Note",
    ]),
  );
  lines.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---", "---"]));
  for (const cell of results.cells) {
    lines.push(
      row([
        cell.cellId,
        cell.requestCount,
        cell.summary.resultCount,
        ms(cell.summary.medianWallMs),
        ms(cell.summary.p95WallMs),
        ms(cell.summary.medianServerMs),
        Math.round(cell.summary.medianPayloadBytes),
        Object.entries(cell.cacheHeaderSample)
          .map(([key, value]) => `${key}=${value}`)
          .join("; ") || "—",
        cell.note ?? "",
      ]),
    );
  }
  return lines.join("\n");
}
