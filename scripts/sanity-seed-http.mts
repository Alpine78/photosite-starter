/**
 * The write half of AB#84's seed script: everything that mutates Sanity's
 * HTTP surface (batched document writes and image asset uploads). The
 * read-only connection validation and `GET .../data/query/...` transport
 * this file used to also own moved to `scripts/sanity-read-http.mts` in
 * AB#138, so that a tool that must never mutate — the content audit tool —
 * can import a module with no mutate/upload export to call at all, rather
 * than relying on a test to notice one was added here by mistake. This file
 * re-exports the read primitives under their original names so every
 * existing caller (`seed-sanity-content.mts`, this file's own tests) needs
 * no change.
 *
 * Self-contained by the same convention every other `scripts/*.mts` file
 * follows — no import from `src/lib`, because `src/lib/sanity-client.ts`/
 * `sanity-config.ts` carry the `server-only` marker, which throws
 * unconditionally outside a bundler that maps its `react-server` export
 * condition (verified against `node_modules/server-only` directly: its
 * default export is an unconditional throw; only Vitest's own config
 * aliases it to a stub, which is why `src/lib`'s own tests can import those
 * modules and a plain `node` invocation of this script could not).
 *
 * Two write surfaces, verified against Sanity's HTTP API reference
 * (2026-08-10), the same source `src/lib/sanity-client.ts` cites:
 * - `POST https://<projectId>.api.sanity.io/<apiVersion>/data/mutate/<dataset>`
 * - `POST https://<projectId>.api.sanity.io/<apiVersion>/assets/images/<dataset>`
 *
 * Every request:
 * - sends the token only as an `Authorization: Bearer …` header — never in a
 *   URL, request body, or log line;
 * - sets `redirect: "error"`, so a redirect response throws instead of being
 *   silently followed to a host that would then receive the header too;
 * - is bounded by `READ_REQUEST_TIMEOUT_MS` via `AbortSignal.timeout`
 *   (shared with the read transport — see `sendSanityHttpRequest`);
 * - surfaces a non-2xx response as `SanitySeedHttpError`, carrying the status
 *   and a short, token-redacted message — never Sanity's raw response body,
 *   which could itself echo a request value back.
 */

import {
  parseReadConnection,
  type ReadConnection,
  readSanityJsonResponse,
  runReadQuery,
  SanityReadConfigurationError,
  SanityReadHttpError,
  sendSanityHttpRequest,
  type ReadQueryRequest,
  type RequestOptions,
} from "./sanity-read-http.mts";

export {
  parseReadConnection as parseSeedConnection,
  runReadQuery as runSeedQuery,
  SanityReadConfigurationError as SanitySeedConfigurationError,
  SanityReadHttpError as SanitySeedHttpError,
};
export type { ReadConnection as SeedConnection, ReadQueryRequest as SeedQueryRequest };

/** Local alias so the write functions below read the same as before the AB#138 split. */
type SeedConnection = ReadConnection;

/** A self-chosen, conservative batch size — not a scraped Sanity limit — so one request/response stays small and one failure is cheap to diagnose. */
export const MUTATION_BATCH_SIZE = 100;

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
    const response = await sendSanityHttpRequest(
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
      throw new SanityReadHttpError(
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
  const response = await sendSanityHttpRequest(
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
  const body = (await readSanityJsonResponse(response, "Asset upload")) as RawUploadResponse;

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
    throw new SanityReadHttpError("Asset upload response was missing expected fields");
  }

  if (policy.formatsByExtension[extension] !== mimeType) {
    throw new SanityReadHttpError(
      `Uploaded asset was accepted as an unexpected format ("${extension}"/"${mimeType}") — refusing to trust it against this project's public-delivery policy`,
    );
  }
  if (Math.max(width, height) > policy.maxDimension) {
    throw new SanityReadHttpError(
      `Uploaded asset is ${width}x${height}, past the ${policy.maxDimension}px public-delivery limit`,
    );
  }

  return { assetId: id, width, height, extension, mimeType };
}
