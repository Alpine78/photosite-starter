#!/usr/bin/env node
/**
 * AB#65 spike — the owner-run orchestrator for the Sanity keyword-hierarchy
 * query benchmark. Thin IO and dispatch only; every decision worth testing
 * lives in the pure modules beside it (`keyword-benchmark-fixtures.mts`,
 * `-model.mts`, `-queries.mts`, `-plan.mts`) and in the measurement
 * transport (`keyword-benchmark-http.mts`). See
 * `docs/keyword-query-benchmark.md` for the full runbook.
 *
 *   npm run benchmark:keywords -- <plan|seed|run|move|clean> \
 *     --project <id> --dataset <name> --api-version vYYYY-MM-DD [--yes]
 *
 * - `plan`  (default) builds and validates the fixture corpus and prints the
 *           document manifest and the measurement matrix. No network.
 * - `seed`  writes the corpus. Requires `--yes` and `SANITY_BENCHMARK_TOKEN`
 *           (a temporary, write-scoped credential — never the app's read
 *           token). Refuses to run unless the target dataset is empty, so no
 *           pre-existing document can contaminate a measurement.
 * - `run`   executes the matrix against the seeded dataset and writes a
 *           results JSON plus a Markdown table for the findings doc. Needs
 *           only a read-capable `SANITY_BENCHMARK_TOKEN`.
 * - `move`  performs and reverts one real hierarchy move, timing the write
 *           amplification and the query-visibility lag (AC7). Requires
 *           `--scenario broad|deep`, `--strategy a|b`, and `--yes`.
 * - `clean` deletes every `kwbench--` document. Requires `--yes`.
 *
 * The token is read from the environment only, never a flag: a process's
 * argument list is visible to every other process on the machine.
 */

import { writeFileSync } from "node:fs";

import {
  buildKeywordBenchmarkFixtures,
  computeExpandedKeywordIds,
  toBenchmarkDocuments,
  validateKeywordBenchmarkFixtures,
  type KeywordBenchmarkFixtures,
  BENCHMARK_ID_PREFIX,
  MAX_KEYWORD_DEPTH,
} from "./keyword-benchmark-fixtures.mts";
import {
  computePostMoveAncestorIndex,
  hierarchyMoveAmplification,
  antichainSelectionCardinality,
  naiveSelectionCardinality,
  describeInvalidationEvents,
} from "./keyword-benchmark-model.mts";
import {
  type AncestorStrategy,
  buildCountQuery,
  buildDescendantResolutionQuery,
  buildIdProjectionQuery,
  buildKeysetPageQuery,
  buildLevelExpansionQuery,
  buildMatchQuery,
  buildOffsetPageQuery,
  evaluateMatch,
  type MatchSpec,
} from "./keyword-benchmark-queries.mts";
import {
  buildMeasurementMatrix,
  formatResultsMarkdown,
  type CellResult,
  type IntersectionCell,
  type MatrixResults,
  type PaginationCell,
} from "./keyword-benchmark-plan.mts";
import {
  type BenchmarkEndpoint,
  countAllDocuments,
  type MeasuredQueryResult,
  runMeasuredQuery,
  runRepeatedQuery,
  summarizeSamples,
  type ReadConnection,
} from "./keyword-benchmark-http.mts";
import { parseReadConnection, SanityReadConfigurationError } from "./sanity-read-http.mts";
import {
  runSeedMutationBatches,
  type SeedMutation,
  MUTATION_BATCH_SIZE,
} from "./sanity-seed-http.mts";

const SUBCOMMANDS = new Set(["plan", "seed", "run", "move", "clean"]);
const ALLOWED_FLAGS = new Set([
  "project",
  "dataset",
  "api-version",
  "yes",
  "media-count",
  "repetitions",
  "out",
  "scenario",
  "strategy",
  "allow-nonempty",
]);
/** Sanity Free/Growth plans cap a dataset near this many documents; the seed refuses to approach it. */
const DATASET_DOCUMENT_SOFT_LIMIT = 9_500;

function fail(message: string): never {
  console.error(`keyword-benchmark failed: ${message}`);
  process.exit(1);
}

function readFlag(name: string): string | undefined {
  const indices: number[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}`) indices.push(index);
  });
  if (indices.length > 1) fail(`--${name} was passed more than once`);
  if (indices.length === 0) return undefined;
  const value = process.argv[indices[0]! + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} requires a value`);
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function assertNoUnknownFlags(): void {
  for (const arg of process.argv.slice(3)) {
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (!ALLOWED_FLAGS.has(name)) fail(`unknown flag --${name}`);
  }
}

function connectionFromFlags({ tokenRequired }: { tokenRequired: boolean }): ReadConnection {
  const projectId = readFlag("project") ?? process.env.SANITY_PROJECT_ID;
  const dataset = readFlag("dataset") ?? process.env.SANITY_DATASET;
  const apiVersion = readFlag("api-version") ?? process.env.SANITY_API_VERSION;
  if (!projectId || !dataset || !apiVersion) {
    fail("project, dataset, and api-version are required (flag or SANITY_PROJECT_ID/SANITY_DATASET/SANITY_API_VERSION)");
  }
  // A dry run (seed/move/clean without --yes) prints its plan and issues no
  // request, so it needs no token.
  const token = process.env.SANITY_BENCHMARK_TOKEN?.trim() ?? (tokenRequired ? undefined : "dry-run-no-token");
  if (!token) {
    fail("missing SANITY_BENCHMARK_TOKEN (temporary, write-scoped for seed/move/clean; a read-capable token is enough for run)");
  }
  try {
    return parseReadConnection({ projectId, dataset, apiVersion, token });
  } catch (cause) {
    if (cause instanceof SanityReadConfigurationError) fail(cause.message);
    throw cause;
  }
}

function buildFixtures(): KeywordBenchmarkFixtures {
  const mediaCountFlag = readFlag("media-count");
  const mediaCount = mediaCountFlag === undefined ? undefined : Number(mediaCountFlag);
  if (mediaCount !== undefined && (!Number.isInteger(mediaCount) || mediaCount < 100)) {
    fail(`--media-count must be an integer >= 100, received ${mediaCountFlag}`);
  }
  const fixtures = buildKeywordBenchmarkFixtures(mediaCount === undefined ? {} : { mediaCount });
  validateKeywordBenchmarkFixtures(fixtures);
  return fixtures;
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

function runPlan(): void {
  const fixtures = buildFixtures();
  const { keywords, media, scenario } = fixtures;
  const repetitions = Number(readFlag("repetitions") ?? "8");
  const matrix = buildMeasurementMatrix(scenario, { repetitions });

  console.log("Keyword-hierarchy query benchmark — plan\n");
  console.log(`benchmarkRun          ${scenario.benchmarkRun}`);
  console.log(`keyword documents     ${keywords.length}`);
  console.log(`media documents       ${media.length}`);
  console.log(`total documents       ${keywords.length + media.length}`);
  console.log("");
  console.log(`broad root            ${scenario.broadRootKeywordId}`);
  console.log(`narrow leaf           ${scenario.narrowLeafKeywordId}`);
  console.log(
    `parent+descendant     ${scenario.parentDescendantPair.ancestorKeywordId} -> ${scenario.parentDescendantPair.descendantKeywordId}`,
  );
  console.log(`five-wide             ${scenario.fiveWideKeywordIds.join(", ")}`);
  console.log(`empty intersection    ${scenario.emptyIntersectionKeywordIds.join(", ")}`);
  console.log("");
  console.log("Pinned intersection sizes:");
  for (const pinned of scenario.pinnedIntersections) {
    console.log(`  ${pinned.label.padEnd(46)} ${pinned.expectedCount}`);
  }
  console.log("");
  console.log(
    `Matrix: ${matrix.intersection.length} intersection cells + ${matrix.pagination.length} pagination + ${matrix.count.length} count, ${matrix.repetitions} repetitions each.`,
  );
  console.log("");

  console.log("Analytical model (AC6 cardinality, no queries):");
  const antichain = antichainSelectionCardinality(keywords);
  const naive = naiveSelectionCardinality(keywords.length);
  console.log(`  vocabulary size (V)                       ${keywords.length}`);
  console.log(`  naive Σ C(V,k), k=1..5 (upper bound)      ${naive.toString()}`);
  console.log(`  collapse-aware antichain selections       ${antichain.total.toString()}`);
  console.log(`  by size                                   [${antichain.bySize.slice(1).map(String).join(", ")}]`);

  const events = describeInvalidationEvents(keywords, {
    root: scenario.broadRootKeywordId,
    internal: scenario.internalNodeKeywordId,
    leaf: scenario.narrowLeafKeywordId,
  });
  console.log("");
  console.log("Invalidation fan-out (AC6, single-medium membership change):");
  for (const [name, value] of Object.entries(events.singleMediumMembershipChange)) {
    console.log(
      `  ${name.padEnd(10)} ${value.affectedSelections.toString()} / ${value.totalSelections.toString()} selections (${(value.fraction * 100).toFixed(1)}%)`,
    );
  }

  console.log("");
  console.log("Hierarchy-move amplification (AC7, modelled):");
  for (const label of ["broadKeywordId", "deepKeywordId"] as const) {
    const move = hierarchyMoveAmplification(
      keywords,
      media,
      scenario.hierarchyMoveTargets[label],
      scenario.hierarchyMoveTargets.newParentKeywordId,
    );
    console.log(`  move ${scenario.hierarchyMoveTargets[label]} (${label}) under ${scenario.hierarchyMoveTargets.newParentKeywordId}:`);
    console.log(
      `    strategy A  ${move.strategyA.keywordDocsRewritten} keyword docs, ${move.strategyA.mutationBatches} batches`,
    );
    console.log(
      `    strategy B  ${move.strategyB.mediaDocsRewritten} media docs (of ${move.strategyB.mediaTaggedInSubtree} tagged; ${move.strategyB.mediaDocsUnchanged} already carry the new ancestor), ${move.strategyB.mutationBatches} batches`,
    );
    const ratio =
      move.strategyA.keywordDocsRewritten > 0
        ? (move.strategyB.mediaDocsRewritten / move.strategyA.keywordDocsRewritten).toFixed(1)
        : "n/a";
    console.log(`    strategy B / strategy A write ratio  ~${ratio}x`);
  }
  console.log("");
  console.log("No network request was made. Run `seed` (with --yes) then `run` to measure.");
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

async function runSeed(): Promise<void> {
  const connection = connectionFromFlags({ tokenRequired: hasFlag("yes") });
  const fixtures = buildFixtures();
  const docs = toBenchmarkDocuments(fixtures);

  if (!hasFlag("yes")) {
    console.log(`Dry run: would write ${docs.length} documents to ${connection.dataset}. Re-run with --yes.`);
    return;
  }

  const existing = await countAllDocuments(connection);
  if (existing > 0 && !hasFlag("allow-nonempty")) {
    fail(
      `dataset "${connection.dataset}" already holds ${existing} document(s). The benchmark needs a dedicated, empty dataset so nothing contaminates a measurement — create one (\`sanity dataset create <name>\`) or pass --allow-nonempty if you accept the bias.`,
    );
  }
  if (existing + docs.length > DATASET_DOCUMENT_SOFT_LIMIT) {
    fail(`writing ${docs.length} documents would bring the dataset to ${existing + docs.length}, past the ${DATASET_DOCUMENT_SOFT_LIMIT} soft limit`);
  }

  const mutations: SeedMutation[] = docs.map((doc) => ({ createOrReplace: doc }));
  console.log(`Writing ${mutations.length} documents in batches of ${MUTATION_BATCH_SIZE}...`);
  const { batchesRun } = await runSeedMutationBatches(connection, mutations);
  console.log(`Wrote ${mutations.length} documents in ${batchesRun} batches.`);

  const keywordCount = await scalarCount(connection, `count(*[_type == "benchmarkKeyword" && benchmarkRun == $run])`, {
    run: fixtures.scenario.benchmarkRun,
  });
  const mediaCount = await scalarCount(connection, `count(*[_type == "benchmarkMedia" && benchmarkRun == $run])`, {
    run: fixtures.scenario.benchmarkRun,
  });
  if (keywordCount !== fixtures.keywords.length || mediaCount !== fixtures.media.length) {
    fail(`post-write verification mismatch: keywords ${keywordCount}/${fixtures.keywords.length}, media ${mediaCount}/${fixtures.media.length}`);
  }
  console.log(`Verified: ${keywordCount} keyword + ${mediaCount} media documents present.`);
}

async function scalarCount(
  connection: ReadConnection,
  query: string,
  params: Record<string, unknown>,
): Promise<number> {
  const measured = await runMeasuredQuery(connection, { query, params, endpoint: "api" });
  if (typeof measured.result !== "number") fail(`count query "${query}" did not return a number`);
  return measured.result as number;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

type DescendantResolution = {
  map: Map<string, readonly string[]>;
  roundTrips: number;
  /** Summed across every resolution request, so a caller can fold it into an end-to-end sample. */
  wallMs: number;
  serverMs: number;
  payloadBytes: number;
  /** Cache-relevant headers from each resolution request, so a caller can show the resolve legs' hit/miss too. */
  cacheHeadersPerRequest: readonly Readonly<Record<string, string>>[];
};

/**
 * Resolves each selected keyword's descendant-id closure, the way its
 * strategy is defined to, and returns the *summed* cost of doing so:
 *
 * - `materialized-ancestors` — one query per keyword against the
 *   materialized `ancestorKeywordIds` field (1 round trip each).
 * - `query-time-traversal` — no materialized field: a breadth-first walk of
 *   the authored `parentKeywordId` edge, one level per round trip, bounded
 *   by `MAX_KEYWORD_DEPTH`. This is the round-trip cost AC2 asks whether is
 *   "viable".
 *
 * The wall/server/byte totals let `runMatrix` charge every repetition the
 * *end-to-end* two-step / traversal cost, not just the final match request
 * (Codex review #1).
 */
async function resolveDescendants(
  connection: ReadConnection,
  keywordIds: readonly string[],
  benchmarkRun: string,
  strategy: Extract<AncestorStrategy, "materialized-ancestors" | "query-time-traversal">,
  endpoint: BenchmarkEndpoint,
): Promise<DescendantResolution> {
  const map = new Map<string, readonly string[]>();
  let roundTrips = 0;
  let wallMs = 0;
  let serverMs = 0;
  let payloadBytes = 0;
  const cacheHeadersPerRequest: Readonly<Record<string, string>>[] = [];
  const account = (measured: Awaited<ReturnType<typeof runMeasuredQuery>>): void => {
    roundTrips += 1;
    wallMs += measured.wallMs;
    serverMs += measured.serverMs ?? 0;
    payloadBytes += measured.payloadBytes;
    cacheHeadersPerRequest.push(measured.cacheHeaders);
  };

  for (const keywordId of keywordIds) {
    if (strategy === "materialized-ancestors") {
      const query = buildDescendantResolutionQuery(keywordId, benchmarkRun);
      const measured = await runMeasuredQuery(connection, { ...query, endpoint });
      account(measured);
      map.set(keywordId, Array.isArray(measured.result) ? (measured.result as string[]) : []);
      continue;
    }

    // query-time-traversal: BFS over parentKeywordId.
    const closure = new Set<string>([keywordId]);
    let frontier: string[] = [keywordId];
    for (let depth = 0; depth < MAX_KEYWORD_DEPTH && frontier.length > 0; depth += 1) {
      const query = buildLevelExpansionQuery(frontier, benchmarkRun);
      const measured = await runMeasuredQuery(connection, { ...query, endpoint });
      account(measured);
      const children = Array.isArray(measured.result) ? (measured.result as string[]) : [];
      const fresh = children.filter((id) => !closure.has(id));
      for (const id of fresh) closure.add(id);
      frontier = fresh;
    }
    map.set(keywordId, [...closure]);
  }

  return { map, roundTrips, wallMs, serverMs, payloadBytes, cacheHeadersPerRequest };
}

async function runMatrix(): Promise<void> {
  const connection = connectionFromFlags({ tokenRequired: true });
  const fixtures = buildFixtures();
  const { scenario } = fixtures;
  const repetitions = Number(readFlag("repetitions") ?? "8");
  const outPath = readFlag("out") ?? `keyword-benchmark-results-${scenario.benchmarkRun}.json`;
  const matrix = buildMeasurementMatrix(scenario, { repetitions });

  // --- correctness / compile phase ---
  // Every strategy must return one ordered id list matching the JS oracle,
  // for *every measured selection shape* — not only the ancestor+descendant
  // one, whose ancestor predicate is redundant by construction and so would
  // not catch a dropped or mis-scoped multi-keyword AND (Codex review #5).
  console.log("Correctness phase: every strategy × every measured shape must match the JS reference.\n");
  const gateShapes: readonly (readonly [string, readonly string[]])[] = [
    ["broad-root", [scenario.broadRootKeywordId]],
    ["narrow-leaf", [scenario.narrowLeafKeywordId]],
    [
      "parent+descendant",
      [scenario.parentDescendantPair.ancestorKeywordId, scenario.parentDescendantPair.descendantKeywordId],
    ],
    ["five-wide", scenario.fiveWideKeywordIds],
    ["empty", scenario.emptyIntersectionKeywordIds],
  ];
  for (const [shapeName, selectionKeywordIds] of gateShapes) {
    const expected = evaluateMatch(
      fixtures,
      { benchmarkRun: scenario.benchmarkRun, selectionKeywordIds, strategy: "media-expansion", requireDynamicallyDiscoverable: true },
    ).map((m) => m.mediaId);
    for (const strategy of ["media-expansion", "materialized-ancestors", "query-time-traversal"] as const) {
      const spec: MatchSpec = {
        benchmarkRun: scenario.benchmarkRun,
        selectionKeywordIds,
        strategy,
        requireDynamicallyDiscoverable: true,
      };
      const resolution =
        strategy === "media-expansion"
          ? undefined
          : await resolveDescendants(connection, selectionKeywordIds, scenario.benchmarkRun, strategy, "api");
      const measured = await runMeasuredQuery(connection, {
        ...buildIdProjectionQuery(spec, resolution?.map),
        endpoint: "api",
      });
      const got = (measured.result as { mediaId: string }[]).map((row) => row.mediaId);
      const agrees = got.length === expected.length && got.every((id, index) => id === expected[index]);
      const trips = resolution ? ` (+${resolution.roundTrips} resolve)` : "";
      console.log(`  ${shapeName.padEnd(18)} ${strategy.padEnd(22)} ${agrees ? "OK" : "MISMATCH"} (${got.length} rows)${trips}`);
      if (!agrees) {
        fail(
          `strategy "${strategy}" on shape "${shapeName}" disagrees with the JS reference on membership or order — a GROQ scoping/index/ordering problem (incl. ADR-0012 §9's sub-second-precision keyset risk). No results written.`,
        );
      }
    }
  }
  console.log("");

  const cells: CellResult[] = [];

  for (const cell of matrix.intersection) {
    cells.push(await measureIntersectionCell(connection, cell, repetitions));
    process.stdout.write(".");
  }
  console.log("");

  for (const cell of matrix.pagination) {
    cells.push(await walkPages(connection, cell, fixtures));
    process.stdout.write(".");
  }

  for (const cell of matrix.count) {
    cells.push(await measureCount(connection, cell.spec, cell.mode, repetitions));
    process.stdout.write(".");
  }
  console.log("");

  const results: MatrixResults = {
    benchmarkRun: scenario.benchmarkRun,
    capturedAt: new Date().toISOString(),
    projectId: connection.projectId,
    dataset: connection.dataset,
    apiVersion: connection.apiVersion,
    cells,
  };
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults JSON: ${outPath}\n`);
  console.log(formatResultsMarkdown(results));
}

const CACHE_STATUS_HEADER_KEYS = ["age", "x-cache", "cf-cache-status", "x-vercel-cache"] as const;

function cacheStatusOf(headers: Readonly<Record<string, string>>): string {
  const parts = CACHE_STATUS_HEADER_KEYS.flatMap((key) =>
    headers[key] === undefined ? [] : [`${key}=${headers[key]}`],
  );
  return parts.length > 0 ? parts.join(" ") : "no cache-status headers";
}

/**
 * Measures one intersection cell over `--repetitions` samples. For
 * `media-expansion` a sample is one match request; for
 * `materialized-ancestors` (two-step) and `query-time-traversal` a sample is
 * the **end-to-end** cost — descendant resolution *plus* the match, re-run
 * every repetition — so the median/p95/bytes answer "what does this strategy
 * cost per query" rather than only the final request. For the `cdn` pass the
 * per-sample cache-status headers (resolve legs *and* match) are recorded in
 * the note, so hit/miss is read from the response, never asserted by a label.
 */
async function measureIntersectionCell(
  connection: ReadConnection,
  cell: IntersectionCell,
  repetitions: number,
): Promise<CellResult> {
  const needsResolve =
    cell.resolveDescendantsFor.length > 0 && cell.variant.strategy !== "media-expansion";

  const samples: MeasuredQueryResult[] = [];
  const cacheEvidencePerSample: string[] = [];
  let roundTripsPerSample = 1;
  for (let i = 0; i < repetitions; i += 1) {
    let resolution: DescendantResolution | undefined;
    if (needsResolve) {
      resolution = await resolveDescendants(
        connection,
        cell.resolveDescendantsFor,
        cell.spec.benchmarkRun,
        cell.variant.strategy as "materialized-ancestors" | "query-time-traversal",
        cell.endpoint,
      );
      roundTripsPerSample = resolution.roundTrips + 1;
    }
    const match = await runMeasuredQuery(connection, {
      ...buildMatchQuery(cell.spec, resolution?.map),
      endpoint: cell.endpoint,
    });
    samples.push({
      endpoint: match.endpoint,
      wallMs: (resolution?.wallMs ?? 0) + match.wallMs,
      serverMs:
        resolution === undefined ? match.serverMs : resolution.serverMs + (match.serverMs ?? 0),
      payloadBytes: (resolution?.payloadBytes ?? 0) + match.payloadBytes,
      resultCount: match.resultCount,
      result: match.result,
      cacheHeaders: match.cacheHeaders,
    });
    if (cell.endpoint === "apicdn") {
      const legs = [
        ...(resolution?.cacheHeadersPerRequest ?? []).map(
          (headers, index) => `resolve${index + 1}[${cacheStatusOf(headers)}]`,
        ),
        `match[${cacheStatusOf(match.cacheHeaders)}]`,
      ];
      cacheEvidencePerSample.push(`s${i + 1}: ${legs.join(" ")}`);
    }
  }

  const passLabel =
    cell.endpoint === "apicdn" ? "CDN (read hit/miss from headers)" : "direct API (uncached baseline)";
  const note = [
    passLabel,
    cacheEvidencePerSample.length > 0 ? cacheEvidencePerSample.join("; ") : undefined,
    needsResolve ? `end-to-end incl. ${roundTripsPerSample - 1} resolve round trip(s)` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
  return {
    cellId: cell.id,
    requestCount: repetitions * roundTripsPerSample,
    summary: summarizeSamples(samples),
    cacheHeaderSample: samples[0]!.cacheHeaders,
    note,
  };
}

async function walkPages(
  connection: ReadConnection,
  cell: PaginationCell,
  fixtures: KeywordBenchmarkFixtures,
): Promise<CellResult> {
  const { spec, mode, pageSize } = cell;
  const expected = evaluateMatch(fixtures, spec).map((m) => m.mediaId);
  const needsResolve = cell.resolveDescendantsFor.length > 0 && spec.strategy !== "media-expansion";

  const walked: string[] = [];
  // Per-page samples, each folding in that page's own descendant-resolution
  // cost: a real continuation request is independent and must re-resolve (or
  // hit a cache production is not yet designed to provide — ADR-0012 leaves
  // it open), so resolving once up front would understate the walk, most of
  // all for query-time traversal (Codex review #5).
  const samples: { wallMs: number; serverMs: number | undefined; payloadBytes: number }[] = [];
  let requestCount = 0;
  let lastCacheHeaders: Readonly<Record<string, string>> = {};
  let cursor: { afterKey: string; afterId: string } | undefined;
  let start = 0;
  const maxPages = Math.ceil(expected.length / pageSize) + 3;

  for (let page = 0; page < maxPages; page += 1) {
    let resolution: DescendantResolution | undefined;
    if (needsResolve) {
      resolution = await resolveDescendants(
        connection,
        cell.resolveDescendantsFor,
        spec.benchmarkRun,
        spec.strategy as "materialized-ancestors" | "query-time-traversal",
        "api",
      );
      requestCount += resolution.roundTrips;
    }
    const query =
      mode === "keyset"
        ? buildKeysetPageQuery(spec, pageSize, cursor, resolution?.map)
        : buildOffsetPageQuery(spec, start, start + pageSize, resolution?.map);
    const measured = await runMeasuredQuery(connection, { ...query, endpoint: "api" });
    requestCount += 1;
    lastCacheHeaders = measured.cacheHeaders;
    samples.push({
      wallMs: (resolution?.wallMs ?? 0) + measured.wallMs,
      serverMs:
        resolution === undefined ? measured.serverMs : resolution.serverMs + (measured.serverMs ?? 0),
      payloadBytes: (resolution?.payloadBytes ?? 0) + measured.payloadBytes,
    });
    const rows = measured.result as { mediaId: string; capturedAt: string | null }[];
    if (rows.length === 0) break;
    walked.push(...rows.map((row) => row.mediaId));
    const last = rows[rows.length - 1]!;
    cursor = { afterKey: last.capturedAt ?? "", afterId: last.mediaId };
    start += pageSize;
    if (rows.length < pageSize) break;
  }

  const agrees = walked.length === expected.length && walked.every((id, index) => id === expected[index]);
  if (!agrees) {
    // The documented correctness gate: a page walk that does not reproduce
    // the reference order (a keyset boundary bug, or GROQ's ORDER BY
    // disagreeing with the adapter on sub-second `capturedAt` — ADR-0012 §9)
    // invalidates every timing that would follow it.
    fail(
      `pagination cell "${cell.id}" walk did not match the reference order: ${walked.length} walked vs ${expected.length} expected. No results written.`,
    );
  }
  return {
    cellId: cell.id,
    requestCount,
    // Not `summarizeSamples` — that guards against samples disagreeing on
    // row count, which is exactly what a page walk does (24, 24, …, N).
    summary: summarizePageWalk(samples, walked.length),
    cacheHeaderSample: lastCacheHeaders,
    note: `full walk in ${samples.length} pages, ${walked.length} rows${
      needsResolve ? "; each page re-resolves the descendant closure" : ""
    }`,
  };
}

/** Per-page wall/byte distribution for a pagination walk, where each page legitimately returns a different row count. */
function summarizePageWalk(
  samples: readonly { wallMs: number; serverMs: number | undefined; payloadBytes: number }[],
  totalRows: number,
): CellResult["summary"] {
  const q = (values: readonly number[], quantile: number): number => {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * quantile;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo]! : sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
  };
  const wall = samples.map((s) => s.wallMs);
  const bytes = samples.map((s) => s.payloadBytes);
  const serverMs = samples.map((s) => s.serverMs).filter((v): v is number => v !== undefined);
  return {
    samples: samples.length,
    medianWallMs: q(wall, 0.5),
    p95WallMs: q(wall, 0.95),
    minWallMs: wall.length > 0 ? Math.min(...wall) : Number.NaN,
    maxWallMs: wall.length > 0 ? Math.max(...wall) : Number.NaN,
    medianServerMs: serverMs.length > 0 ? q(serverMs, 0.5) : undefined,
    medianPayloadBytes: q(bytes, 0.5),
    resultCount: totalRows,
  };
}

async function measureCount(
  connection: ReadConnection,
  spec: MatchSpec,
  mode: "count-function" | "id-projection-length" | "no-count",
  repetitions: number,
): Promise<CellResult> {
  const query =
    mode === "count-function"
      ? buildCountQuery(spec)
      : mode === "id-projection-length"
        ? buildIdProjectionQuery(spec)
        : buildKeysetPageQuery(spec, 24, undefined);
  const samples = await runRepeatedQuery(connection, { ...query, endpoint: "api" }, repetitions);
  return {
    cellId: `count/${mode}/direct-api`,
    requestCount: samples.length,
    summary: summarizeSamples(samples),
    cacheHeaderSample: samples[samples.length - 1]!.cacheHeaders,
    note: mode === "no-count" ? "cost of the first page only; no separate count request" : mode,
  };
}

// ---------------------------------------------------------------------------
// move (AC7 — real measured write amplification + visibility lag)
// ---------------------------------------------------------------------------

async function runMove(): Promise<void> {
  const connection = connectionFromFlags({ tokenRequired: hasFlag("yes") });
  const fixtures = buildFixtures();
  const { keywords, media, scenario } = fixtures;
  const which = readFlag("scenario");
  const strategy = readFlag("strategy");
  if (which !== "broad" && which !== "deep") fail("--scenario must be broad or deep");
  if (strategy !== "a" && strategy !== "b") fail("--strategy must be a or b");
  if (!hasFlag("yes")) {
    console.log("Dry run: would perform and immediately revert one hierarchy move. Re-run with --yes.");
    return;
  }

  const movedId = which === "broad" ? scenario.hierarchyMoveTargets.broadKeywordId : scenario.hierarchyMoveTargets.deepKeywordId;
  const newParentId = scenario.hierarchyMoveTargets.newParentKeywordId;
  const model = hierarchyMoveAmplification(keywords, media, movedId, newParentId);
  const moved = keywords.find((k) => k.keywordId === movedId)!;
  const { index: postMoveIndex, subtreeKeywordIds, postMoveAncestorsOf } = computePostMoveAncestorIndex(
    keywords,
    movedId,
    newParentId,
  );
  const subtree = new Set(subtreeKeywordIds);

  console.log(`Moving ${movedId} under ${newParentId} (strategy ${strategy.toUpperCase()}).`);
  console.log(
    `Modelled amplification: strategy A ${model.strategyA.keywordDocsRewritten} keyword docs; ` +
      `strategy B ${model.strategyB.mediaDocsRewritten} media docs ` +
      `(of ${model.strategyB.mediaTaggedInSubtree} tagged in the subtree; ${model.strategyB.mediaDocsUnchanged} unchanged).`,
  );

  // Preflight: the revert relies on `createOrReplace` restoring the exact
  // fixture. If the dataset does not already hold this fixture unchanged,
  // that guarantee is void — the move would create documents and leave a
  // hybrid behind while reporting "baseline restored". Verify before the
  // first mutation.
  const runParam = { run: scenario.benchmarkRun };
  const liveKeywords = await scalarCount(
    connection,
    `count(*[_type == "benchmarkKeyword" && benchmarkRun == $run])`,
    runParam,
  );
  const liveMedia = await scalarCount(
    connection,
    `count(*[_type == "benchmarkMedia" && benchmarkRun == $run])`,
    runParam,
  );
  if (liveKeywords !== keywords.length || liveMedia !== media.length) {
    fail(
      `dataset baseline mismatch: found ${liveKeywords}/${keywords.length} keyword and ${liveMedia}/${media.length} media documents for run "${scenario.benchmarkRun}". Reseed with \`benchmark:keywords -- seed --yes\` before running a move.`,
    );
  }
  const liveMovedParent = (
    await runMeasuredQuery(connection, {
      query: `*[_type == "benchmarkKeyword" && benchmarkRun == $run && keywordId == $k][0].parentKeywordId`,
      params: { run: scenario.benchmarkRun, k: movedId },
      endpoint: "api",
    })
  ).result;
  if (liveMovedParent !== moved.parentKeywordId) {
    fail(
      `keyword ${movedId} already has parent "${String(liveMovedParent)}" (fixture expects "${moved.parentKeywordId}") — the tree is not at its seeded baseline.`,
    );
  }

  const forward: SeedMutation[] = [];
  const revert: SeedMutation[] = [];
  const writtenMediaIds: string[] = [];

  if (strategy === "a") {
    // Rewrite `ancestorKeywordIds` (and `depth`) on the moved node and every
    // descendant; media are untouched.
    for (const keyword of keywords) {
      if (keyword.keywordId !== movedId && !subtree.has(keyword.keywordId)) continue;
      const rebuilt = [...postMoveAncestorsOf(keyword.keywordId)];
      forward.push({
        createOrReplace: {
          ...keyword,
          ancestorKeywordIds: rebuilt,
          depth: rebuilt.length,
          parentKeywordId: keyword.keywordId === movedId ? newParentId : keyword.parentKeywordId,
        },
      });
      revert.push({ createOrReplace: { ...keyword } });
    }
  } else {
    // Strategy B: the one authored edit is the moved keyword's parent edge;
    // the cost is recomputing every *actually-affected* medium's ancestor
    // closure. A medium tagged in the subtree whose closure does not change
    // — because it already carries the new ancestor via another tag — is not
    // written. The descendant keyword docs' own `ancestorKeywordIds` are a
    // strategy-A artefact a pure strategy-B store would not carry, so they
    // are left as-is (and restored by the revert regardless).
    const rebuiltMoved = [...postMoveAncestorsOf(movedId)];
    forward.push({
      createOrReplace: {
        ...moved,
        parentKeywordId: newParentId,
        ancestorKeywordIds: rebuiltMoved,
        depth: rebuiltMoved.length,
      },
    });
    revert.push({ createOrReplace: { ...moved } });

    let gainsNewParent = 0;
    for (const medium of media) {
      if (!medium.leafKeywordIds.some((leaf) => subtree.has(leaf))) continue;
      const newClosure = computeExpandedKeywordIds(medium.leafKeywordIds, postMoveIndex);
      if (JSON.stringify(newClosure) === JSON.stringify([...medium.expandedKeywordIds])) continue;
      forward.push({ createOrReplace: { ...medium, expandedKeywordIds: newClosure } });
      revert.push({ createOrReplace: { ...medium } });
      writtenMediaIds.push(medium.mediaId);
      if (!medium.expandedKeywordIds.includes(newParentId) && newClosure.includes(newParentId)) {
        gainsNewParent += 1;
      }
    }

    // The re-sync completeness proof (below) is an aggregate
    // `count(newParentId in expandedKeywordIds)`. That only proves *every*
    // written doc is visible if every written doc newly gains `newParentId`
    // — true for the shipped broad/deep scenarios, asserted here so a future
    // scenario cannot silently break the proof.
    if (gainsNewParent !== writtenMediaIds.length) {
      fail(
        `strategy-B move for scenario "${which}" writes ${writtenMediaIds.length} media but only ${gainsNewParent} newly gain "${newParentId}" — the aggregate re-sync probe cannot prove all writes are visible for this scenario. Add a scenario-specific probe before running it.`,
      );
    }
  }

  console.log(`Forward mutation: ${forward.length} documents, ${Math.ceil(forward.length / MUTATION_BATCH_SIZE)} batches.`);
  console.log(
    strategy === "a"
      ? `  keyword docs rewritten: ${forward.length}, media docs: 0`
      : `  keyword docs rewritten: 1, media docs actually rewritten: ${writtenMediaIds.length} (${model.strategyB.mediaDocsUnchanged} tagged-but-unchanged skipped)`,
  );
  const serializedBytes = Buffer.byteLength(JSON.stringify(forward));
  console.log(`Serialized forward payload: ${serializedBytes} bytes.`);

  // The re-sync figure only means something if the write does not block
  // until it is queryable. `runSeedMutationBatches` defaults to Sanity's
  // `visibility=sync` (the request returns only once the change is visible),
  // which would make any poll after it measure ~0. The forward write is
  // therefore issued `visibility=async`: the request returns on acceptance,
  // and the poll below times the real indexing lag. The revert stays `sync`,
  // so the baseline is guaranteed restored before the command exits.
  const expectedVisibleCount =
    strategy === "a"
      ? keywords.filter((keyword) => postMoveAncestorsOf(keyword.keywordId).includes(newParentId)).length
      : media.filter((medium) =>
          computeExpandedKeywordIds(medium.leafKeywordIds, postMoveIndex).includes(newParentId),
        ).length;
  const probeQuery =
    strategy === "a"
      ? {
          query: `count(*[_type == "benchmarkKeyword" && benchmarkRun == $run && $newParent in ancestorKeywordIds])`,
          params: { run: scenario.benchmarkRun, newParent: newParentId },
        }
      : {
          query: `count(*[_type == "benchmarkMedia" && benchmarkRun == $run && $newParent in expandedKeywordIds])`,
          params: { run: scenario.benchmarkRun, newParent: newParentId },
        };

  try {
    // t0 — before the first batch — through to "every rewritten doc visible"
    // is the end-to-end write + re-sync time AC7 asks for.
    const t0 = performance.now();
    await runSeedMutationBatches(connection, forward, { visibility: "async" });
    const acceptedMs = performance.now() - t0;
    console.log(`Forward mutation accepted (async) after ${acceptedMs.toFixed(0)} ms.`);

    // Poll an *aggregate* count until it reflects *every* rewritten document,
    // not just one from an early batch. Every mutation only adds
    // `newParentId` to a closure — never removes it — so the matching count
    // rises monotonically from its pre-move value to a known post-move
    // value; re-sync is complete only when the count reaches that value.
    let syncedMs: number | undefined;
    let lastSeen = -1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const measured = await runMeasuredQuery(connection, {
        ...probeQuery,
        endpoint: "api",
        perspective: "published",
      });
      lastSeen = typeof measured.result === "number" ? measured.result : lastSeen;
      if (lastSeen >= expectedVisibleCount) {
        syncedMs = performance.now() - t0;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log(
      syncedMs === undefined
        ? `Re-sync: only ${lastSeen}/${expectedVisibleCount} rewritten docs query-visible within 30s — record this.`
        : `End-to-end write + re-sync until all ${expectedVisibleCount} rewritten docs are query-visible: ${syncedMs.toFixed(0)} ms (acceptance ${acceptedMs.toFixed(0)} ms).`,
    );
  } finally {
    console.log(`Reverting ${revert.length} documents...`);
    try {
      const startRevert = performance.now();
      await runSeedMutationBatches(connection, revert);
      console.log(`Revert wall time: ${(performance.now() - startRevert).toFixed(0)} ms. Baseline restored.`);
    } catch (cause) {
      console.error(
        `REVERT FAILED (${cause instanceof Error ? cause.message : String(cause)}). Restore the baseline with:\n` +
          `  npm run benchmark:keywords -- clean --project ${connection.projectId} --dataset ${connection.dataset} --api-version ${connection.apiVersion} --yes\n` +
          `  npm run benchmark:keywords -- seed  --project ${connection.projectId} --dataset ${connection.dataset} --api-version ${connection.apiVersion} --yes`,
      );
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------

async function runClean(): Promise<void> {
  const connection = connectionFromFlags({ tokenRequired: hasFlag("yes") });
  if (!hasFlag("yes")) {
    console.log("Dry run: would delete every kwbench-- document. Re-run with --yes.");
    return;
  }
  // Keyset scan over every id in the reserved namespace. `string::startsWith`
  // matches the dot-free `kwbench--…` ids directly (`path()` globs on
  // dot-separated segments, which these deliberately have none of); the raw
  // perspective also surfaces any `drafts.kwbench--…` a stray Studio edit
  // left behind, since `_id > $after` orders those too.
  const ids: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 1000; page += 1) {
    const filter = `string::startsWith(_id, $prefix) || string::startsWith(_id, $draftPrefix)`;
    const query =
      after === undefined
        ? `*[${filter}] | order(_id) [0...200]._id`
        : `*[(${filter}) && _id > $after] | order(_id) [0...200]._id`;
    const params: Record<string, unknown> = {
      prefix: BENCHMARK_ID_PREFIX,
      draftPrefix: `drafts.${BENCHMARK_ID_PREFIX}`,
    };
    if (after !== undefined) params.after = after;
    const measured = await runMeasuredQuery(connection, { query, params, endpoint: "api", perspective: "raw" });
    const rows = Array.isArray(measured.result) ? (measured.result as string[]) : [];
    if (rows.length === 0) break;
    ids.push(...rows);
    after = rows[rows.length - 1];
    if (rows.length < 200) break;
  }
  if (ids.length === 0) {
    console.log("Nothing to delete.");
    return;
  }
  const mutations: SeedMutation[] = ids.map((id) => ({ delete: { id } }));
  const { batchesRun } = await runSeedMutationBatches(connection, mutations);
  console.log(`Deleted ${ids.length} documents in ${batchesRun} batches.`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const subcommand = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "plan";
  if (!SUBCOMMANDS.has(subcommand)) fail(`unknown subcommand "${subcommand}" (expected: ${[...SUBCOMMANDS].join(", ")})`);
  assertNoUnknownFlags();

  switch (subcommand) {
    case "plan":
      runPlan();
      return;
    case "seed":
      await runSeed();
      return;
    case "run":
      await runMatrix();
      return;
    case "move":
      await runMove();
      return;
    case "clean":
      await runClean();
      return;
  }
}

main().catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)));
