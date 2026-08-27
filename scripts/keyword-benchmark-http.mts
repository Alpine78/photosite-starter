/**
 * AB#65 spike — the measurement-capable, read-only Sanity transport.
 *
 * The shipped read transport (`scripts/sanity-read-http.mts`) cannot collect
 * what this benchmark needs (Codex plan-review finding #1): it hardcodes the
 * `api.sanity.io` host, discards Sanity's server-side `ms`, and returns only
 * the parsed `result`. This module adds exactly those three things and
 * nothing else — endpoint selection (direct API vs API CDN), the raw
 * (decompressed) JSON payload size, the server-reported `ms` alongside a
 * wall-clock measurement, and the response's cache-related headers so a
 * claimed cache hit can be shown rather than assumed.
 *
 * It stays strictly read-only: it imports only `parseReadConnection` for
 * validation and issues only `GET .../data/query/...`. There is no mutate or
 * upload path here at all — the orchestrator's seed/move/clean writes go
 * through `scripts/sanity-seed-http.mts`, a separate module.
 *
 * Every request keeps the shipped transport's safety posture: the token
 * travels only as an `Authorization: Bearer` header, a redirect throws
 * rather than being followed to another host, the request is time-bounded,
 * and a non-2xx response surfaces as a typed error carrying the status and a
 * short, token-free message — never Sanity's raw body.
 *
 * "Payload bytes" here means the decompressed JSON response body length, not
 * the compressed wire size; the findings doc states this so a reader knows
 * which number a row holds.
 */

import { parseReadConnection, type ReadConnection } from "./sanity-read-http.mts";

export { parseReadConnection };
export type { ReadConnection };

export type BenchmarkEndpoint = "api" | "apicdn";

export const BENCHMARK_REQUEST_TIMEOUT_MS = 30_000;
const MAX_QUERY_URL_BYTES = 11 * 1024; // restates sanity-client.ts's documented GET cap

export class BenchmarkHttpError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(`[keyword-benchmark-http] ${message}`);
    this.name = "BenchmarkHttpError";
    this.status = status;
  }
}

export type MeasuredQueryRequest = {
  readonly query: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly endpoint: BenchmarkEndpoint;
  /**
   * Defaults to `published`, matching the perspective a production public
   * query uses (`src/lib/sanity-client.ts`) — the benchmark's fixtures are
   * written with dot-free published ids, so a measurement must see exactly
   * what production would. `raw` is only for the dataset-emptiness preflight
   * and the cleanup scan, which must also see drafts and release versions.
   */
  readonly perspective?: "published" | "raw";
};

export type MeasuredQueryResult = {
  readonly endpoint: BenchmarkEndpoint;
  /** End-to-end: request start until the body has been fully read. */
  readonly wallMs: number;
  /** Sanity's own `ms` field, when present in the response body. */
  readonly serverMs: number | undefined;
  /** Decompressed JSON response body length in bytes. */
  readonly payloadBytes: number;
  /** `result.length` for an array result, `1` for a scalar (e.g. a `count()`), `0` for null. */
  readonly resultCount: number;
  readonly result: unknown;
  /** Cache-relevant response headers, lowercased — evidence for a hit/miss claim. */
  readonly cacheHeaders: Readonly<Record<string, string>>;
};

export type FetchImplementation = typeof fetch;

const CACHE_HEADER_NAMES = [
  "age",
  "cache-control",
  "x-sanity-shard",
  "x-cache",
  "cf-cache-status",
  "x-vercel-cache",
  "via",
  "etag",
] as const;

function hostFor(endpoint: BenchmarkEndpoint, projectId: string): string {
  return endpoint === "apicdn"
    ? `https://${projectId}.apicdn.sanity.io`
    : `https://${projectId}.api.sanity.io`;
}

function buildUrl(connection: ReadConnection, request: MeasuredQueryRequest): string {
  const entries: (readonly [string, string])[] = [
    ["query", request.query],
    ["perspective", request.perspective ?? "published"],
    ["returnQuery", "false"],
  ];
  for (const [name, value] of Object.entries(request.params ?? {})) {
    entries.push([`$${name}`, JSON.stringify(value)]);
  }
  const search = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const url = `${hostFor(request.endpoint, connection.projectId)}/${connection.apiVersion}/data/query/${connection.dataset}?${search}`;
  const size = new TextEncoder().encode(url).length;
  if (size > MAX_QUERY_URL_BYTES) {
    throw new BenchmarkHttpError(
      `Query URL is ${size} bytes, past the ${MAX_QUERY_URL_BYTES}-byte GET limit — narrow the query, or move a large id list into fewer params`,
    );
  }
  return url;
}

export async function runMeasuredQuery(
  connection: ReadConnection,
  request: MeasuredQueryRequest,
  options?: { readonly fetchImplementation?: FetchImplementation },
): Promise<MeasuredQueryResult> {
  const send = options?.fetchImplementation ?? fetch;
  const url = buildUrl(connection, request);

  const startedAt = performance.now();
  let response: Response;
  try {
    response = await send(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${connection.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(BENCHMARK_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new BenchmarkHttpError(timedOut ? "Request timed out" : "Request failed before a response");
  }

  const text = await response.text();
  const wallMs = performance.now() - startedAt;

  if (!response.ok) {
    throw new BenchmarkHttpError(`Query failed with HTTP ${response.status}`, response.status);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BenchmarkHttpError("Query returned a non-JSON response");
  }
  if (typeof body !== "object" || body === null || !("result" in body)) {
    throw new BenchmarkHttpError("Query returned an unexpected response shape");
  }

  const result = (body as { readonly result: unknown }).result;
  const serverMsRaw = (body as { readonly ms?: unknown }).ms;

  const cacheHeaders: Record<string, string> = {};
  for (const name of CACHE_HEADER_NAMES) {
    const value = response.headers.get(name);
    if (value !== null) cacheHeaders[name] = value;
  }

  return {
    endpoint: request.endpoint,
    wallMs,
    serverMs: typeof serverMsRaw === "number" ? serverMsRaw : undefined,
    payloadBytes: new TextEncoder().encode(text).length,
    resultCount: Array.isArray(result) ? result.length : result === null ? 0 : 1,
    result,
    cacheHeaders,
  };
}

// ---------------------------------------------------------------------------
// Repetition + summary
// ---------------------------------------------------------------------------

export type SampleSummary = {
  readonly samples: number;
  readonly medianWallMs: number;
  readonly p95WallMs: number;
  readonly minWallMs: number;
  readonly maxWallMs: number;
  readonly medianServerMs: number | undefined;
  readonly medianPayloadBytes: number;
  readonly resultCount: number;
};

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (position - lower) * (sorted[upper]! - sorted[lower]!);
}

export function summarizeSamples(results: readonly MeasuredQueryResult[]): SampleSummary {
  if (results.length === 0) throw new BenchmarkHttpError("cannot summarize zero samples");
  const wall = results.map((r) => r.wallMs).sort((a, b) => a - b);
  const bytes = results.map((r) => r.payloadBytes).sort((a, b) => a - b);
  const serverMsValues = results
    .map((r) => r.serverMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const counts = new Set(results.map((r) => r.resultCount));
  if (counts.size > 1) {
    throw new BenchmarkHttpError(
      `samples disagree on result count (${[...counts].join(", ")}) — the dataset changed mid-measurement`,
    );
  }
  return {
    samples: results.length,
    medianWallMs: quantile(wall, 0.5),
    p95WallMs: quantile(wall, 0.95),
    minWallMs: wall[0]!,
    maxWallMs: wall[wall.length - 1]!,
    medianServerMs: serverMsValues.length > 0 ? quantile(serverMsValues, 0.5) : undefined,
    medianPayloadBytes: quantile(bytes, 0.5),
    resultCount: results[0]!.resultCount,
  };
}

/**
 * Issues the same request `repetitions` times against one endpoint and
 * returns every sample. Cold vs warm is the *caller's* concern — it chooses
 * the endpoint (the direct API is uncached; the CDN caches per token) and
 * whether to interleave or space the calls. This function only measures each
 * one and hands back the cache headers that show which it got.
 */
export async function runRepeatedQuery(
  connection: ReadConnection,
  request: MeasuredQueryRequest,
  repetitions: number,
  options?: { readonly fetchImplementation?: FetchImplementation },
): Promise<MeasuredQueryResult[]> {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new BenchmarkHttpError(`repetitions must be a positive integer, received ${repetitions}`);
  }
  const results: MeasuredQueryResult[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    results.push(await runMeasuredQuery(connection, request, options));
  }
  return results;
}

/**
 * A raw-perspective count of *content* documents (excluding Sanity's own
 * `system.*` records and release `versions.*` rows), for the seed
 * preflight: the benchmark requires an empty, dedicated disposable dataset
 * so no pre-existing document — published or draft — contaminates a count,
 * a page, or a latency figure (Codex plan-review finding #2). A freshly
 * created dataset holds only `system.*` rows, which this deliberately does
 * not count.
 */
export async function countAllDocuments(
  connection: ReadConnection,
  options?: { readonly fetchImplementation?: FetchImplementation },
): Promise<number> {
  const measured = await runMeasuredQuery(
    connection,
    {
      query: `count(*[!(_id in path("system.**")) && !(_id in path("versions.**"))])`,
      endpoint: "api",
      perspective: "raw",
    },
    options,
  );
  if (typeof measured.result !== "number") {
    throw new BenchmarkHttpError("document count query did not return a number");
  }
  return measured.result;
}
