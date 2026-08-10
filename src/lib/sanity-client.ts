/**
 * The one place in the project that knows Sanity's HTTP surface.
 *
 * Everything Sanity-specific stops here: the hostname, the API version path
 * segment, the perspective, the parameter encoding, and the shape of a
 * response. Adapters in `src/lib` compose GROQ and project the result into the
 * project's own types; routes and components read those adapters and never this
 * module. ESLint enforces that direction, so the boundary is a rule rather than
 * a convention — and replacing Sanity later means writing another file like
 * this one instead of auditing every route.
 *
 * No SDK. The Content Lake query API is one authenticated GET, and the project
 * already reaches its email provider the same way (`contact-delivery-resend.ts`).
 * A client library would add a dependency tree, a listener transport, and
 * retry and caching behavior this project has not decided on yet — AB#83 owns
 * caching and revalidation, and it should decide that on purpose. ADR-0006
 * records the trade-off.
 *
 * Verified against Sanity's HTTP API reference (2026-08-10):
 * `GET https://<projectId>.api.sanity.io/<apiVersion>/data/query/<dataset>`
 * with the GROQ query in `query`, GROQ parameters as `$`-prefixed URL
 * parameters whose values are JSON literals, an optional `perspective`
 * (`published`, `drafts`, `raw`), an optional `tag` for log aggregation, and
 * `returnQuery=false` to suppress the echoed query. A success answers
 * `{ ms, query, result, syncTags }`; a rejected query answers
 * `{ error: { description, type, … } }`. GET is capped at 11 KB, and because
 * GROQ always evaluates to a value, a missing document is `null` or `[]` rather
 * than a 404.
 *
 * ## Drafts
 *
 * Every request states `perspective=published`, and nothing configurable can
 * change it. Draft access is therefore not a setting somebody could flip, or a
 * default that could shift under a version bump: it is absent. A draft-preview
 * surface is a separate, authenticated, `no-store` feature (ADR-0004 §3), and
 * building it means deliberately editing this file — which is the point.
 *
 * The `server-only` marker makes a Client Component that reaches this module —
 * directly, or through an adapter several hops away that ESLint cannot see —
 * a build error rather than a runtime one.
 */

import "server-only";

import { ContentSourceConfigurationError } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  getSanityConfig,
  SanityConfigurationError,
  type SanityConfig,
} from "@/lib/sanity-config";

/**
 * The only perspective this project asks for. A constant rather than a
 * parameter: see the module note above.
 */
const PUBLISHED_PERSPECTIVE = "published";

/**
 * Bound on one content fetch. A slow Content Lake becomes a fast, classified
 * failure the page can react to, rather than a request that hangs until the
 * platform kills the function and the visitor sees nothing.
 */
export const SANITY_QUERY_TIMEOUT_MS = 10_000;

/**
 * Sanity caps a GET query at 11 KB. Measured over the whole assembled URL —
 * origin, API version, dataset path, and query string alike — because that is
 * what the cap is stated against, and because measuring only the query string
 * would accept a URL the service then rejects. A query that outgrows this is a
 * design problem in the adapter that wrote it, so it fails loudly here instead
 * of becoming an opaque rejection at request time.
 */
export const MAX_SANITY_GET_URL_BYTES = 11 * 1024;

/**
 * Why a content fetch did not succeed, at the granularity an operational log
 * may record. Each value is a class of failure, never Sanity's own message:
 * a rejection echoes the query it describes, and a query can carry parameters
 * derived from a visitor's URL, so provider prose never reaches a log
 * (ADR-0004 §5).
 */
export type SanityErrorClass =
  /** Settings are missing, unusable, or name a project this token cannot read. */
  | "configuration"
  /** The credential was refused: absent, wrong, revoked, or out of scope. */
  | "unauthorized"
  /** The project, dataset, or API version does not exist. Not a missing document. */
  | "not-found"
  /** The query itself was refused — a parse error, or an unsupported feature. */
  | "query-rejected"
  | "rate-limited"
  | "unavailable"
  | "timeout"
  /** A 200 whose body was not the documented `{ result }` envelope. */
  | "malformed-response";

/**
 * Raised by every failing read. It carries a class, a retry decision, and the
 * correlation identifier that was logged, so a caller can surface a reference a
 * person can quote without the caller learning anything about the query.
 */
export class SanityQueryError extends Error {
  readonly errorClass: SanityErrorClass;
  readonly retryable: boolean;
  readonly correlationId: string;

  constructor(options: {
    errorClass: SanityErrorClass;
    retryable: boolean;
    correlationId: string;
  }) {
    super(
      `[sanity-client] Content fetch failed: ${options.errorClass} (reference ${options.correlationId})`,
    );
    this.name = "SanityQueryError";
    this.errorClass = options.errorClass;
    this.retryable = options.retryable;
    this.correlationId = options.correlationId;
  }
}

/**
 * One read.
 *
 * `tag` is a project-owned constant naming the read — never visitor input. It
 * is sent to Sanity for log aggregation and is the only thing about a query
 * that reaches this project's own operational events, which is why its
 * character set is narrow.
 */
export type SanityQueryRequest = {
  readonly query: string;
  /** GROQ parameters by bare name, without the `$` prefix. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly tag: string;
};

export type SanityClient = {
  /**
   * Runs one published read and returns the raw `result`.
   *
   * Deliberately `unknown`. This module knows the transport and nothing about
   * content, so a generic type parameter here would be a cast dressed up as a
   * guarantee. The adapter that wrote the query owns validating and projecting
   * what came back.
   */
  query(request: SanityQueryRequest): Promise<unknown>;
};

export type SanityClientSettings = {
  readonly config: SanityConfig;
  /** Injected in tests; production uses the global `fetch`. */
  readonly fetchImplementation?: typeof fetch;
};

const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function encodeQueryString(entries: readonly (readonly [string, string])[]) {
  // Built by hand rather than with URLSearchParams, which encodes a space as
  // `+`. Sanity's own documentation warns about encoding a query and its
  // parameters together for exactly this class of reason, and `%20` is
  // unambiguous wherever `+` is a guess about how the far end decodes.
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/**
 * Composes the request URL for one published read.
 *
 * Exported so a test can assert the exact URL a deployment would call without
 * making the call — the host, the pinned API version, the dataset, the
 * perspective, and the parameter encoding are the contract, and a silent change
 * to any of them is a silent change to which content the site serves.
 */
export function buildSanityQueryUrl(
  config: SanityConfig,
  request: SanityQueryRequest,
): string {
  if (!TAG_PATTERN.test(request.tag)) {
    throw new TypeError(
      `[sanity-client] Invalid query tag "${request.tag}": expected lowercase letters, digits, dots, underscores, or hyphens`,
    );
  }

  const entries: (readonly [string, string])[] = [
    ["query", request.query],
    ["perspective", PUBLISHED_PERSPECTIVE],
    // Nothing needs the query echoed back, and not receiving it is one less
    // place it could be logged by something downstream.
    ["returnQuery", "false"],
    ["tag", request.tag],
  ];

  for (const [name, value] of Object.entries(request.params ?? {})) {
    // GROQ parameter values are JSON literals: `$id="myId"`, not `$id=myId`.
    entries.push([`$${name}`, JSON.stringify(value)]);
  }

  const url = `https://${config.projectId}.api.sanity.io/${config.apiVersion}/data/query/${config.dataset}?${encodeQueryString(entries)}`;
  const size = new TextEncoder().encode(url).length;

  if (size > MAX_SANITY_GET_URL_BYTES) {
    throw new TypeError(
      `[sanity-client] Query too large: the request URL is ${size} bytes, past the ${MAX_SANITY_GET_URL_BYTES}-byte GET limit. Narrow the query or its parameters; the API's POST form is not implemented.`,
    );
  }

  return url;
}

function classifyStatus(status: number): {
  errorClass: SanityErrorClass;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { errorClass: "unauthorized", retryable: false };
  }

  // GROQ evaluates to a value, so a missing document is `null` rather than a
  // 404. A 404 here means the address itself is wrong: an unknown project,
  // dataset, or API version.
  if (status === 404) return { errorClass: "not-found", retryable: false };

  if (status === 429) return { errorClass: "rate-limited", retryable: true };
  if (status >= 500) return { errorClass: "unavailable", retryable: true };

  // A 400 and every other 4xx: the query was refused. Sending it again produces
  // the same answer, so this is a defect in the adapter, not a transient state.
  return { errorClass: "query-rejected", retryable: false };
}

/**
 * One operational event per failed read.
 *
 * The same closed schema the contact endpoint writes (ADR-0004 §5): a random
 * correlation identifier, a state, and a redacted error class — plus the
 * project-owned tag naming which read it was, which is a constant in this
 * repository and can restate nothing about a visitor. The query, its
 * parameters, the response body, and the token are never written.
 */
function logSanityFailure(event: {
  correlationId: string;
  tag: string;
  errorClass: SanityErrorClass;
}): void {
  console.error(
    JSON.stringify({
      event: "sanity.query",
      correlationId: event.correlationId,
      state: "failed",
      tag: event.tag,
      errorClass: event.errorClass,
    }),
  );
}

function fail(
  tag: string,
  errorClass: SanityErrorClass,
  retryable: boolean,
): never {
  const correlationId = crypto.randomUUID();
  logSanityFailure({ correlationId, tag, errorClass });
  throw new SanityQueryError({ errorClass, retryable, correlationId });
}

export function createSanityClient(
  settings: SanityClientSettings,
): SanityClient {
  const { config } = settings;
  const send = settings.fetchImplementation ?? fetch;

  return {
    async query(request: SanityQueryRequest): Promise<unknown> {
      const url = buildSanityQueryUrl(config, request);
      let response: Response;

      try {
        response = await send(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            // Absent for a public dataset. The token authorizes the read; it
            // never appears in the URL, where it would reach access logs and
            // referrers.
            ...(config.readToken === undefined
              ? {}
              : { Authorization: `Bearer ${config.readToken}` }),
          },
          signal: AbortSignal.timeout(SANITY_QUERY_TIMEOUT_MS),
          // The Content Lake is not a browsing context. Caching and
          // revalidation are AB#83's decision, made deliberately rather than
          // inherited from a default here.
          cache: "no-store",
        });
      } catch (cause) {
        const timedOut =
          cause instanceof DOMException &&
          (cause.name === "TimeoutError" || cause.name === "AbortError");
        return fail(
          request.tag,
          timedOut ? "timeout" : "unavailable",
          true,
        );
      }

      if (!response.ok) {
        const { errorClass, retryable } = classifyStatus(response.status);
        return fail(request.tag, errorClass, retryable);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return fail(request.tag, "malformed-response", false);
      }

      // A 200 that is not the documented envelope is not a result worth
      // guessing at. Note that `result` may legitimately be `null` — a GROQ
      // query for a document that does not exist — so the property must be
      // present rather than merely truthy.
      if (
        typeof body !== "object" ||
        body === null ||
        !("result" in body)
      ) {
        return fail(request.tag, "malformed-response", false);
      }

      return (body as { result: unknown }).result;
    },
  };
}

/**
 * Proves the deployment can reach its own Content Lake.
 *
 * The query reads no document: `*[false]` is a filter that matches nothing, so
 * a success carries an empty array and no content of any kind. What it does
 * establish is the whole address and the credential — project, dataset, API
 * version, token, and the published perspective — which is the part a clone
 * gets wrong. It says nothing about whether any content has been authored yet;
 * that is a schema story's question, not this one's.
 */
export async function probeSanityConnectivity(
  client: SanityClient,
): Promise<
  | { readonly status: "reachable" }
  | { readonly status: "unreachable"; readonly errorClass: SanityErrorClass }
> {
  try {
    await client.query({ query: "*[false]", tag: "connectivity.probe" });
    return { status: "reachable" };
  } catch (cause) {
    if (cause instanceof SanityQueryError) {
      return { status: "unreachable", errorClass: cause.errorClass };
    }
    throw cause;
  }
}

let cachedClient: SanityClient | undefined;

/**
 * The deployment's client, built once per runtime instance.
 *
 * It refuses to exist unless the deployment declared Sanity as its content
 * source. A deployment reading mock fixtures that also holds a Sanity client is
 * one accidental import away from serving half of each, and which half would
 * depend on load order.
 *
 * Caching the client caches no request state, so it holds nothing an instance
 * would have to share with another one (ADR-0004 §2).
 */
export function getSanityClient(): SanityClient {
  // Checked before the deployment config, so a client component that reached
  // this module is told what it actually did wrong. Not a `SanityQueryError`: no
  // read was attempted and nothing was logged, so there is no correlation
  // identifier to quote and inventing one would make the log a fiction.
  if (typeof window !== "undefined") {
    throw new SanityConfigurationError(
      "A Sanity client was created in a browser. It carries a server-only credential and must be reached from a Server Component, Route Handler, or another server module.",
    );
  }

  const { contentSource } = getDeploymentConfig();
  if (contentSource !== "sanity") {
    throw new ContentSourceConfigurationError(
      `This deployment declared SITE_CONTENT_SOURCE="${contentSource}", so no Sanity client exists. Read the project's fixture layer instead, or declare "sanity".`,
    );
  }

  cachedClient ??= createSanityClient({ config: getSanityConfig() });
  return cachedClient;
}
