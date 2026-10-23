/**
 * Sanity calls of the proof selection route (ADR-0038 decision 5, AB#130), all
 * with the server-only `SANITY_PROOF_SELECTION_TOKEN`. Discovery by handle is a
 * published-perspective query; every document the decision depends on — the
 * gallery, its private terms, the working selection and a confirmed version —
 * is then read fresh by ID through the Doc API, which bypasses the eventually
 * consistent query index (https://www.sanity.io/docs/http-reference/doc).
 *
 * Every URL is fixed to this deployment's project host; the token is sent only
 * there and never logged or put in an error message.
 */
import "server-only";
import type { SanityConfig } from "@/lib/sanity-config";

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;

export type ProofSelectionStoreOptions = Readonly<{ config: SanityConfig; token: string; fetchImplementation?: typeof fetch }>;

/**
 * `unavailable`: nothing was written. `conflict`: Sanity refused the whole
 * transaction (a guard or an existing `create` target). `unknown`: a
 * transaction was sent and its outcome is not known.
 */
export class ProofSelectionStoreError extends Error {
  constructor(readonly kind: "unavailable" | "conflict" | "unknown") {
    super(`[proof-selection-sanity] ${kind}`);
    this.name = "ProofSelectionStoreError";
  }
}

export function readProofSelectionToken(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  if (environment.NEXT_PUBLIC_SANITY_PROOF_SELECTION_TOKEN?.trim()) return undefined;
  const token = environment.SANITY_PROOF_SELECTION_TOKEN?.trim();
  return token && /^[A-Za-z0-9._~+/=-]{20,4096}$/u.test(token) ? token : undefined;
}

async function call(options: ProofSelectionStoreOptions, path: string, init: { method: "GET" | "POST"; body?: unknown }, failure: "unavailable" | "unknown"): Promise<unknown> {
  const send = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await send(`https://${options.config.projectId}.api.sanity.io/${options.config.apiVersion}${path}`, {
      method: init.method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${options.token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new ProofSelectionStoreError(failure);
  }
  if (response.status === 409) throw new ProofSelectionStoreError("conflict");
  // A 4xx means Sanity refused the request; a 5xx after a transaction leaves its outcome unknown.
  if (!response.ok) throw new ProofSelectionStoreError(response.status >= 500 ? failure : "unavailable");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new ProofSelectionStoreError(failure);
  let text: string;
  // A connection lost while the body streams leaves a sent transaction's outcome unknown too.
  try { text = await response.text(); } catch { throw new ProofSelectionStoreError(failure); }
  if (text.length > MAX_RESPONSE_BYTES) throw new ProofSelectionStoreError(failure);
  try { return JSON.parse(text); } catch { throw new ProofSelectionStoreError(failure); }
}

/** Exported for the groq-js contract test. Published perspective: never a draft. */
export const PROOF_SELECTION_DISCOVERY_QUERY = `*[_type == "clientProofGallery" && handle == $handle][0...2]{_id}`;

export async function discoverProofGallery(handle: string, options: ProofSelectionStoreOptions): Promise<unknown> {
  const result = await call(options, `/data/query/${options.config.dataset}?perspective=published`, {
    method: "POST", body: { query: PROOF_SELECTION_DISCOVERY_QUERY, params: { handle } },
  }, "unavailable");
  if (typeof result !== "object" || result === null || !("result" in result)) throw new ProofSelectionStoreError("unavailable");
  return (result as { result: unknown }).result;
}

/** A published-perspective query with the selection credential (the reminder run's discovery). */
export async function queryProofRecords(groq: string, params: Record<string, unknown>, options: ProofSelectionStoreOptions): Promise<unknown> {
  const result = await call(options, `/data/query/${options.config.dataset}?perspective=published`, { method: "POST", body: { query: groq, params } }, "unavailable");
  if (typeof result !== "object" || result === null || !("result" in result)) throw new ProofSelectionStoreError("unavailable");
  return (result as { result: unknown }).result;
}

/** One document by ID, fresh; `null` when it does not exist. */
export async function readProofSelectionDocument(id: string, options: ProofSelectionStoreOptions): Promise<unknown> {
  if (!DOCUMENT_ID.test(id) || id.includes("..")) throw new TypeError("Invalid document ID");
  const result = await call(options, `/data/doc/${options.config.dataset}/${id}`, { method: "GET" }, "unavailable");
  const documents = typeof result === "object" && result !== null ? (result as { documents?: unknown }).documents : undefined;
  if (!Array.isArray(documents) || documents.length > 1) throw new ProofSelectionStoreError("unavailable");
  if (documents.length === 0) return null;
  const document = documents[0];
  if (typeof document !== "object" || document === null || (document as { _id?: unknown })._id !== id) throw new ProofSelectionStoreError("unavailable");
  return document;
}

/** One atomic transaction. */
export async function commitProofSelection(mutations: readonly Record<string, unknown>[], options: ProofSelectionStoreOptions): Promise<void> {
  await call(options, `/data/mutate/${options.config.dataset}`, { method: "POST", body: { mutations } }, "unknown");
}
