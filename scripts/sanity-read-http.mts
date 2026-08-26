/**
 * The read-only half of this project's hand-written Sanity HTTP transport:
 * connection validation and the `GET .../data/query/...` surface, with no
 * write capability at all. Split out of `sanity-seed-http.mts` (AB#138) so a
 * tool that must never mutate — the content audit tool
 * (`scripts/sanity-audit.mts`) — can prove that structurally, by only ever
 * importing a module that has no mutate/upload export to call, rather than by
 * a test asserting a mutation function was never named.
 *
 * Self-contained by the same convention every other `scripts/*.mts` file
 * follows — no import from `src/lib`, because `src/lib/sanity-client.ts`/
 * `sanity-config.ts` carry the `server-only` marker, which throws
 * unconditionally outside a bundler that maps its `react-server` export
 * condition (see `sanity-seed-http.mts`'s original module comment for the
 * verification detail this restates).
 *
 * Verified against Sanity's HTTP API reference (2026-08-10), the same source
 * `src/lib/sanity-client.ts` and the original `sanity-seed-http.mts` cite:
 * `GET https://<projectId>.api.sanity.io/<apiVersion>/data/query/<dataset>`.
 *
 * Every request:
 * - sends the token only as an `Authorization: Bearer …` header — never in a
 *   URL, request body, or log line;
 * - sets `redirect: "error"`, so a redirect response throws instead of being
 *   silently followed to a host that would then receive the header too;
 * - is bounded by `READ_REQUEST_TIMEOUT_MS` via `AbortSignal.timeout`;
 * - surfaces a non-2xx response as `SanityReadHttpError`, carrying the status
 *   and a short, token-redacted message — never Sanity's raw response body,
 *   which could itself echo a request value back.
 */

const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DATASET_PATTERN = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const API_VERSION_PATTERN = /^v(\d{4})-(\d{2})-(\d{2})$/;

export const READ_REQUEST_TIMEOUT_MS = 20_000;

export class SanityReadConfigurationError extends Error {
  constructor(message: string) {
    super(`[sanity-read-http] ${message}`);
    this.name = "SanityReadConfigurationError";
  }
}

export class SanityReadHttpError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(`[sanity-read-http] ${message}`);
    this.name = "SanityReadHttpError";
    this.status = status;
  }
}

export type ReadConnection = {
  readonly projectId: string;
  readonly dataset: string;
  readonly apiVersion: string;
  /**
   * Credential authorizing this connection's reads. The role required
   * depends on the caller: a write-scoped seed run reuses this same shape
   * with an Editor-role token, while a read-only audit needs only a
   * Viewer-role token (see `docs/sanity-seeding.md`'s "Content audit"
   * section) — this module has no opinion on which.
   */
  readonly token: string;
};

/**
 * Restates `sanity-config.ts`'s `parseApiVersion` in full, including the
 * future-date rejection — see `sanity-seed-http.mts`'s original comment on
 * why this is restated rather than imported, and on the drift risk of
 * restating only part of a validation rule.
 */
function assertRealCalendarDate(value: string, now: Date): void {
  const match = API_VERSION_PATTERN.exec(value);
  if (match === null) {
    throw new SanityReadConfigurationError(
      `Invalid API version: expected vYYYY-MM-DD, received "${value}"`,
    );
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isReal =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  if (!isReal) {
    throw new SanityReadConfigurationError(`"${value}" is not a date on the calendar`);
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > today) {
    throw new SanityReadConfigurationError(
      `"${value}" is in the future, so it pins no API behavior a read against it could have been verified against. Use today's UTC date or an earlier one.`,
    );
  }
}

/**
 * Validates connection settings against the exact same rules
 * `src/lib/sanity-config.ts` uses — duplicated, not imported, for the reason
 * in this file's module comment. Called before any URL is ever built from
 * these values, so a malformed project id or dataset name fails loudly here
 * rather than silently sending a token to the wrong host.
 */
export function parseReadConnection(
  input: {
    readonly projectId: string;
    readonly dataset: string;
    readonly apiVersion: string;
    readonly token: string;
  },
  { now = new Date() }: { readonly now?: Date } = {},
): ReadConnection {
  if (!PROJECT_ID_PATTERN.test(input.projectId)) {
    throw new SanityReadConfigurationError(
      `Invalid project id: expected 1-63 lowercase letters, digits, or inner hyphens, received "${input.projectId}"`,
    );
  }
  if (!DATASET_PATTERN.test(input.dataset)) {
    throw new SanityReadConfigurationError(
      `Invalid dataset: expected 1-64 characters of lowercase letters, digits, hyphens, or underscores, beginning and ending with a lowercase letter or digit, received "${input.dataset}"`,
    );
  }
  assertRealCalendarDate(input.apiVersion, now);
  if (input.token.trim().length === 0 || /\s/.test(input.token)) {
    throw new SanityReadConfigurationError(
      "Invalid token: must be non-empty and contain no whitespace",
    );
  }

  return {
    projectId: input.projectId,
    dataset: input.dataset,
    apiVersion: input.apiVersion,
    token: input.token,
  };
}

export type FetchImplementation = typeof fetch;

export type RequestOptions = {
  readonly fetchImplementation?: FetchImplementation;
};

/**
 * Sends one request. Exported so `sanity-seed-http.mts`'s mutate and upload
 * requests — which are POSTs to a different path, not a read — share the
 * same timeout, redirect, and failure-wrapping behavior instead of a second,
 * independently drifting copy.
 */
export async function sendSanityHttpRequest(
  url: string,
  init: RequestInit,
  options: RequestOptions | undefined,
): Promise<Response> {
  const send = options?.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await send(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(READ_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new SanityReadHttpError(
      timedOut ? "Request timed out" : "Request failed before receiving a response",
    );
  }
  return response;
}

/** Exported for the same reason as `sendSanityHttpRequest`: shared by the mutate/upload paths in `sanity-seed-http.mts`. */
export async function readSanityJsonResponse(response: Response, context: string): Promise<unknown> {
  if (!response.ok) {
    throw new SanityReadHttpError(
      `${context} failed with HTTP ${response.status}`,
      response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new SanityReadHttpError(`${context} returned a non-JSON response`);
  }
}

export type ReadQueryRequest = {
  readonly query: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /**
   * Defaults to `"published"`, matching `src/lib/sanity-client.ts`'s own
   * fixed perspective. `"raw"` is required whenever a caller needs to see a
   * draft, a release version, or a `system.release` record alongside
   * published documents — the seed script's identity-collision preflight and
   * the content audit tool (AB#138) both ask for it explicitly.
   */
  readonly perspective?: "published" | "raw";
};

/** Restates `sanity-client.ts`'s documented 11 KB GET cap. */
const MAX_READ_QUERY_URL_BYTES = 11 * 1024;

function buildQueryUrl(connection: ReadConnection, request: ReadQueryRequest): string {
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
  const url = `https://${connection.projectId}.api.sanity.io/${connection.apiVersion}/data/query/${connection.dataset}?${search}`;

  const size = new TextEncoder().encode(url).length;
  if (size > MAX_READ_QUERY_URL_BYTES) {
    throw new SanityReadHttpError(
      `Query too large: the request URL is ${size} bytes, past the ${MAX_READ_QUERY_URL_BYTES}-byte GET limit. Narrow the query or its parameters.`,
    );
  }
  return url;
}

export async function runReadQuery(
  connection: ReadConnection,
  request: ReadQueryRequest,
  options?: RequestOptions,
): Promise<unknown> {
  const response = await sendSanityHttpRequest(
    buildQueryUrl(connection, request),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${connection.token}`,
      },
    },
    options,
  );
  const body = await readSanityJsonResponse(response, "Query");
  if (typeof body !== "object" || body === null || !("result" in body)) {
    throw new SanityReadHttpError("Query returned an unexpected response shape");
  }
  return (body as { readonly result: unknown }).result;
}
