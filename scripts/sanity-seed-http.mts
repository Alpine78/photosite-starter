/**
 * The IO half of AB#84's seed script: everything that actually talks to
 * Sanity's HTTP surface. Self-contained by the same convention every other
 * `scripts/*.mts` file follows — no import from `src/lib`, because
 * `src/lib/sanity-client.ts`/`sanity-config.ts` carry the `server-only`
 * marker, which throws unconditionally outside a bundler that maps its
 * `react-server` export condition (verified against `node_modules/server-only`
 * directly: its default export is an unconditional throw; only Vitest's own
 * config aliases it to a stub, which is why `src/lib`'s own tests can import
 * those modules and a plain `node` invocation of this script could not).
 *
 * Three surfaces, verified against Sanity's HTTP API reference (2026-08-10),
 * the same source `src/lib/sanity-client.ts` cites:
 * - `GET  https://<projectId>.api.sanity.io/<apiVersion>/data/query/<dataset>`
 * - `POST https://<projectId>.api.sanity.io/<apiVersion>/data/mutate/<dataset>`
 * - `POST https://<projectId>.api.sanity.io/<apiVersion>/assets/images/<dataset>`
 *
 * Every request:
 * - sends the token only as an `Authorization: Bearer …` header — never in a
 *   URL, request body, or log line;
 * - sets `redirect: "error"`, so a redirect response throws instead of being
 *   silently followed to a host that would then receive the header too;
 * - is bounded by `SEED_REQUEST_TIMEOUT_MS` via `AbortSignal.timeout`;
 * - surfaces a non-2xx response as `SanitySeedHttpError`, carrying the status
 *   and a short, token-redacted message — never Sanity's raw response body,
 *   which could itself echo a request value back.
 */

const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DATASET_PATTERN = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const API_VERSION_PATTERN = /^v(\d{4})-(\d{2})-(\d{2})$/;

export const SEED_REQUEST_TIMEOUT_MS = 20_000;

/** A self-chosen, conservative batch size — not a scraped Sanity limit — so one request/response stays small and one failure is cheap to diagnose. */
export const MUTATION_BATCH_SIZE = 100;

export class SanitySeedConfigurationError extends Error {
  constructor(message: string) {
    super(`[sanity-seed-http] ${message}`);
    this.name = "SanitySeedConfigurationError";
  }
}

export class SanitySeedHttpError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(`[sanity-seed-http] ${message}`);
    this.name = "SanitySeedHttpError";
    this.status = status;
  }
}

export type SeedConnection = {
  readonly projectId: string;
  readonly dataset: string;
  readonly apiVersion: string;
  /** Write-scoped credential. Never the runtime app's `SANITY_READ_TOKEN`. */
  readonly token: string;
};

/**
 * Restates `sanity-config.ts`'s `parseApiVersion` in full, including the
 * future-date rejection — a first draft of this function checked only the
 * calendar-date half and was caught missing that rule by this story's own
 * review, which is exactly the silent-drift risk duplicating validation
 * logic (rather than importing it — see this file's module comment) invites.
 * A version dated after `now` pins no behavior this write could have been
 * tested against, so it is refused here exactly as it would be by the
 * running application's own config loader.
 */
function assertRealCalendarDate(value: string, now: Date): void {
  const match = API_VERSION_PATTERN.exec(value);
  if (match === null) {
    throw new SanitySeedConfigurationError(
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
    throw new SanitySeedConfigurationError(`"${value}" is not a date on the calendar`);
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > today) {
    throw new SanitySeedConfigurationError(
      `"${value}" is in the future, so it pins no API behavior this write could have been made against. Use today's UTC date or an earlier one.`,
    );
  }
}

/**
 * Validates connection settings against the exact same rules
 * `src/lib/sanity-config.ts` uses — duplicated, not imported, for the reason
 * in this file's module comment. Called before any URL is ever built from
 * these values, so a malformed project id or dataset name fails loudly here
 * rather than silently redirecting a write (and its token) to the wrong host.
 * `now` is injectable for the same reason it is in `sanity-config.ts`: so the
 * future-date check can be asserted against a fixed clock in tests.
 */
export function parseSeedConnection(
  input: {
    readonly projectId: string;
    readonly dataset: string;
    readonly apiVersion: string;
    readonly token: string;
  },
  { now = new Date() }: { readonly now?: Date } = {},
): SeedConnection {
  if (!PROJECT_ID_PATTERN.test(input.projectId)) {
    throw new SanitySeedConfigurationError(
      `Invalid project id: expected 1-63 lowercase letters, digits, or inner hyphens, received "${input.projectId}"`,
    );
  }
  if (!DATASET_PATTERN.test(input.dataset)) {
    throw new SanitySeedConfigurationError(
      `Invalid dataset: expected 1-64 characters of lowercase letters, digits, hyphens, or underscores, beginning and ending with a lowercase letter or digit, received "${input.dataset}"`,
    );
  }
  assertRealCalendarDate(input.apiVersion, now);
  if (input.token.trim().length === 0 || /\s/.test(input.token)) {
    throw new SanitySeedConfigurationError(
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

type RequestOptions = {
  readonly fetchImplementation?: FetchImplementation;
};

async function send(
  url: string,
  init: RequestInit,
  options: RequestOptions | undefined,
): Promise<Response> {
  const send_ = options?.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await send_(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(SEED_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new SanitySeedHttpError(
      timedOut ? "Request timed out" : "Request failed before receiving a response",
    );
  }
  return response;
}

async function readOkJson(response: Response, context: string): Promise<unknown> {
  if (!response.ok) {
    throw new SanitySeedHttpError(
      `${context} failed with HTTP ${response.status}`,
      response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new SanitySeedHttpError(`${context} returned a non-JSON response`);
  }
}

// ---------------------------------------------------------------------------
// Query (read) — used by the preflight and the post-write live verification
// ---------------------------------------------------------------------------

export type SeedQueryRequest = {
  readonly query: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /**
   * Defaults to `"published"`, matching `src/lib/sanity-client.ts`'s own
   * fixed perspective — every read this script does to prove a live write
   * or find a stale document only ever cares about what is actually public.
   * The one exception is the identity-collision preflight, which explicitly
   * asks for `"raw"`: an unpublished draft can claim the same `mediaId`/
   * `categoryId`/etc. this fixture is about to publish, and a published-only
   * check would miss it — the collision only becomes visible once someone
   * later publishes that draft, by which point this script has already run.
   */
  readonly perspective?: "published" | "raw";
};

/** Restates `sanity-client.ts`'s documented 11 KB GET cap. */
const MAX_SEED_QUERY_URL_BYTES = 11 * 1024;

function buildQueryUrl(connection: SeedConnection, request: SeedQueryRequest): string {
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
  if (size > MAX_SEED_QUERY_URL_BYTES) {
    throw new SanitySeedHttpError(
      `Query too large: the request URL is ${size} bytes, past the ${MAX_SEED_QUERY_URL_BYTES}-byte GET limit. Narrow the query or delete some documents first.`,
    );
  }
  return url;
}

export async function runSeedQuery(
  connection: SeedConnection,
  request: SeedQueryRequest,
  options?: RequestOptions,
): Promise<unknown> {
  const response = await send(
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
  const body = await readOkJson(response, "Query");
  if (typeof body !== "object" || body === null || !("result" in body)) {
    throw new SanitySeedHttpError("Query returned an unexpected response shape");
  }
  return (body as { readonly result: unknown }).result;
}

// ---------------------------------------------------------------------------
// Mutate (write)
// ---------------------------------------------------------------------------

export type SeedMutation =
  | { readonly createOrReplace: Readonly<Record<string, unknown>> & { readonly _id: string } }
  | { readonly delete: { readonly id: string } };

/**
 * Exported so a caller with its own array-of-ids too large for one GET
 * request (`seed-sanity-content.mts`'s archive-placement verification is
 * the first) can chunk it the same way mutation batching already does,
 * rather than a second, independently-drifting implementation.
 */
export function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError(`[sanity-seed-http] batchSize must be a positive integer, received ${size}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Runs every mutation in dependency order, batched. Each batch is its own
 * Sanity transaction; because every write is `createOrReplace` against a
 * fixed `_id`, a run that fails partway through is safe to simply re-run in
 * full afterward — every earlier batch's writes are idempotent no-ops the
 * second time.
 */
export async function runSeedMutationBatches(
  connection: SeedConnection,
  mutations: readonly SeedMutation[],
  options?: RequestOptions & { readonly batchSize?: number },
): Promise<{ readonly batchesRun: number; readonly mutationCount: number }> {
  const batches = chunk(mutations, options?.batchSize ?? MUTATION_BATCH_SIZE);
  const url = `https://${connection.projectId}.api.sanity.io/${connection.apiVersion}/data/mutate/${connection.dataset}`;

  for (const [index, batch] of batches.entries()) {
    const response = await send(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${connection.token}`,
        },
        body: JSON.stringify({ mutations: batch }),
      },
      options,
    );
    if (!response.ok) {
      throw new SanitySeedHttpError(
        `Mutation batch ${index + 1}/${batches.length} failed with HTTP ${response.status}. Every earlier batch already succeeded and is safe to leave as-is — fix the cause and re-run the whole command.`,
        response.status,
      );
    }
    // Body is intentionally not read: a successful mutate response can echo
    // document content back, which this module never logs or retains.
  }

  return { batchesRun: batches.length, mutationCount: mutations.length };
}

// ---------------------------------------------------------------------------
// Asset upload
// ---------------------------------------------------------------------------

export type UploadedAsset = {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly extension: string;
  readonly mimeType: string;
};

type RawUploadResponse = {
  readonly document?: {
    readonly _id?: unknown;
    readonly extension?: unknown;
    readonly mimeType?: unknown;
    readonly metadata?: { readonly dimensions?: { readonly width?: unknown; readonly height?: unknown } };
  };
};

/**
 * Uploads one image asset and validates the response against the exact same
 * public-delivery policy `sanity/schemas/media.ts`'s own Studio validation
 * enforces (longest edge, format/mime-type agreement) — defense in depth,
 * even though the six source files are already known-good, and the only
 * check available for an upload made through this API rather than a Studio.
 */
export async function uploadSeedImageAsset(
  connection: SeedConnection,
  asset: { readonly bytes: Uint8Array; readonly contentType: string },
  policy: {
    readonly maxDimension: number;
    readonly formatsByExtension: Readonly<Record<string, string>>;
  },
  options?: RequestOptions,
): Promise<UploadedAsset> {
  const url = `https://${connection.projectId}.api.sanity.io/${connection.apiVersion}/assets/images/${connection.dataset}`;
  const response = await send(
    url,
    {
      method: "POST",
      headers: {
        "content-type": asset.contentType,
        Authorization: `Bearer ${connection.token}`,
      },
      body: asset.bytes as unknown as BodyInit,
    },
    options,
  );
  const body = (await readOkJson(response, "Asset upload")) as RawUploadResponse;

  const id = body.document?._id;
  const extension = body.document?.extension;
  const mimeType = body.document?.mimeType;
  const width = body.document?.metadata?.dimensions?.width;
  const height = body.document?.metadata?.dimensions?.height;

  if (
    typeof id !== "string" ||
    typeof extension !== "string" ||
    typeof mimeType !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    throw new SanitySeedHttpError("Asset upload response was missing expected fields");
  }

  if (policy.formatsByExtension[extension] !== mimeType) {
    throw new SanitySeedHttpError(
      `Uploaded asset was accepted as an unexpected format ("${extension}"/"${mimeType}") — refusing to trust it against this project's public-delivery policy`,
    );
  }
  if (Math.max(width, height) > policy.maxDimension) {
    throw new SanitySeedHttpError(
      `Uploaded asset is ${width}x${height}, past the ${policy.maxDimension}px public-delivery limit`,
    );
  }

  return { assetId: id, width, height, extension, mimeType };
}
