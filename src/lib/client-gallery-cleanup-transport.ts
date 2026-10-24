/** Dedicated cleanup credential and fixed-origin, non-retrying Content Lake IO. */
import "server-only";
import { parseSanityJsonWithoutDuplicates } from "./sanity-json";
import {
  CleanupSnapshotBuilder, CleanupSnapshotError, cleanupDocumentId, cleanupRevision, cleanupDocumentType,
  type CleanupSnapshot, type CleanupSnapshotLimits,
} from "./client-gallery-cleanup-snapshot";

export type CleanupTransportErrorCode = "provider_unavailable" | "provider_refused" | "provider_invalid" | "deadline_exceeded" | "clock_untrusted" | "snapshot_invalid" | "snapshot_limit_exceeded";
export class CleanupTransportError extends Error {
  constructor(readonly code: CleanupTransportErrorCode) { super(code); this.name = "CleanupTransportError"; }
}
export type CleanupTransportLimits = CleanupSnapshotLimits & {
  readonly exportTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maxClockSkewMs: number;
};
export const DEFAULT_CLEANUP_TRANSPORT_LIMITS: CleanupTransportLimits = Object.freeze({
  maxSnapshotBytes: 64 * 1024 * 1024, maxLineBytes: 1024 * 1024,
  maxDocuments: 100_000, maxReferences: 500_000,
  exportTimeoutMs: 30_000, requestTimeoutMs: 10_000, maxClockSkewMs: 60_000,
});
export function cleanupTransportLimits(input: Partial<CleanupTransportLimits> = {}): CleanupTransportLimits {
  const limits = { ...DEFAULT_CLEANUP_TRANSPORT_LIMITS, ...input };
  const bounds: Record<keyof CleanupTransportLimits, readonly [number, number]> = {
    maxSnapshotBytes: [1024 * 1024, 256 * 1024 * 1024], maxLineBytes: [1024, 1024 * 1024],
    maxDocuments: [100, 200_000], maxReferences: [100, 1_000_000],
    exportTimeoutMs: [5_000, 60_000], requestTimeoutMs: [1_000, 30_000], maxClockSkewMs: [1_000, 60_000],
  };
  if (Object.keys(limits).some((key) => !Object.hasOwn(bounds, key))) throw new CleanupTransportError("provider_invalid");
  for (const key of Object.keys(bounds) as (keyof CleanupTransportLimits)[]) {
    const [min, max] = bounds[key];
    if (!Number.isSafeInteger(limits[key]) || limits[key] < min || limits[key] > max) throw new CleanupTransportError("provider_invalid");
  }
  return Object.freeze(limits);
}
export type CleanupReadResult = {
  readonly documents: ReadonlyMap<string, Record<string, unknown>>;
  readonly omitted: ReadonlySet<string>;
};
export type CleanupMutationResult = { readonly kind: "committed"; readonly transactionId: string } | { readonly kind: "conflict" | "refused" | "uncertain" };
export type CleanupTransport = {
  due(nowISO: string, signal?: AbortSignal): Promise<boolean>;
  snapshot(signal?: AbortSignal): Promise<CleanupSnapshot>;
  read(ids: readonly string[], options?: { readonly includeAllVersions?: boolean; readonly signal?: AbortSignal }): Promise<CleanupReadResult>;
  mutate(mutations: readonly unknown[], signal?: AbortSignal): Promise<CleanupMutationResult>;
};
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function fail(code: CleanupTransportErrorCode): never { throw new CleanupTransportError(code); }
function cancel(response: Response): void { try { void response.body?.cancel().catch(() => {}); } catch { /* best effort */ } }
function wait<T>(operation: Promise<T>, signal: AbortSignal, onLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; signal.removeEventListener("abort", abort); reject(new CleanupTransportError("deadline_exceeded")); } };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then((value) => {
      if (settled) { onLate?.(value); return; }
      settled = true; signal.removeEventListener("abort", abort); resolve(value);
    }, () => {
      if (!settled) { settled = true; signal.removeEventListener("abort", abort); reject(new CleanupTransportError("provider_unavailable")); }
    });
  });
}
async function chunks(response: Response, signal: AbortSignal, maxBytes: number, consume: (chunk: Uint8Array) => void, check: () => void): Promise<void> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) { cancel(response); fail("snapshot_limit_exceeded"); }
  if (!response.body) fail("provider_invalid");
  const reader = response.body.getReader();
  let complete = false;
  let bytes = 0;
  try {
    for (;;) {
      check();
      const part = await wait(reader.read(), signal);
      check();
      if (part.done) { complete = true; break; }
      if (!(part.value instanceof Uint8Array)) fail("provider_invalid");
      if (part.value.byteLength > maxBytes - bytes) fail("snapshot_limit_exceeded");
      bytes += part.value.byteLength;
      consume(part.value);
      check();
    }
    const encoding = response.headers.get("content-encoding");
    // Fetch exposes decoded bytes; a compressed wire Content-Length is not their length.
    if (contentLength !== null && (!encoding || encoding === "identity") && bytes !== Number(contentLength)) fail("provider_invalid");
  } finally {
    if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* never await a stuck cancellation */ } }
    try { reader.releaseLock(); } catch { /* ignored-abort reader can still have a pending read */ }
  }
}
async function json(response: Response, signal: AbortSignal, check: () => void): Promise<unknown> {
  const bytes = new Uint8Array(1024 * 1024);
  let size = 0;
  await chunks(response, signal, bytes.length, (chunk) => { bytes.set(chunk, size); size += chunk.length; }, check);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail("provider_invalid");
  try { return parseSanityJsonWithoutDuplicates(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))); }
  catch { return fail("provider_invalid"); }
}
function relatedVersion(id: string, base: string): boolean {
  return id === base || (!base.startsWith("drafts.") && !base.startsWith("versions.") &&
    (id === `drafts.${base}` || (id.startsWith("versions.") && id.slice(id.indexOf(".", 9) + 1) === base && id.indexOf(".", 9) > 9)));
}

export function createClientGalleryCleanupTransport(config: {
  readonly projectId: string; readonly dataset: string; readonly apiVersion: string; readonly token: string;
}, dependencies: { readonly fetch?: typeof fetch; readonly now?: () => number; readonly monotonicNow?: () => number; readonly limits?: Partial<CleanupTransportLimits> } = {}): CleanupTransport {
  const versionTime = Date.parse(config.apiVersion.slice(1));
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.exec(config.projectId)?.[0] !== config.projectId ||
    /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u.exec(config.dataset)?.[0] !== config.dataset ||
    /^v\d{4}-\d{2}-\d{2}$/u.exec(config.apiVersion)?.[0] !== config.apiVersion || !Number.isFinite(versionTime) || new Date(versionTime).toISOString().slice(0, 10) !== config.apiVersion.slice(1) || config.apiVersion < "v2025-02-19" ||
    !config.token || /\s/.test(config.token)) fail("provider_invalid");
  const limits = cleanupTransportLimits(dependencies.limits);
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const base = `https://${config.projectId}.api.sanity.io/${config.apiVersion}/data`;
  const clock = (response: Response): number => {
    const date = response.headers.get("date");
    const time = date === null ? NaN : Date.parse(date);
    const local = now();
    if (!Number.isFinite(time) || !Number.isFinite(local) || Math.abs(local - time) > limits.maxClockSkewMs) { cancel(response); fail("clock_untrusted"); }
    return time;
  };
  const run = async <T>(timeout: number, external: AbortSignal | undefined, perform: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const started = monotonicNow();
    const check = () => {
      const elapsed = monotonicNow() - started;
      if (controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= timeout) { controller.abort(); fail("deadline_exceeded"); }
    };
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) controller.abort();
    const timer = setTimeout(abort, timeout);
    try { check(); const result = await perform(controller.signal, check); check(); return result; }
    catch (error) {
      if (error instanceof CleanupTransportError) throw error;
      if (error instanceof CleanupSnapshotError) throw new CleanupTransportError(error.code);
      return fail("provider_unavailable");
    } finally { clearTimeout(timer); external?.removeEventListener("abort", abort); }
  };
  const request = async (url: string, signal: AbortSignal, check: () => void, body?: string): Promise<Response> => {
    check();
    const response = await wait(Promise.resolve().then(() => {
      check();
      return fetcher(url, {
      method: body === undefined ? "GET" : "POST", headers: {
        Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, ...(body === undefined ? {} : { body }), cache: "no-store", redirect: "error", signal,
      });
    }), signal, cancel);
    try { check(); } catch (error) { cancel(response); throw error; }
    return response;
  };
  const readable = (response: Response) => {
    if (!response.ok) { cancel(response); fail(response.status >= 400 && response.status < 500 ? "provider_refused" : "provider_unavailable"); }
    return clock(response);
  };
  return {
    due: (nowISO, signal) => run(limits.requestTimeoutMs, signal, async (active, check) => {
      if (!Number.isFinite(Date.parse(nowISO)) || new Date(nowISO).toISOString() !== nowISO) fail("provider_invalid");
      const url = new URL(`${base}/query/${config.dataset}`);
      url.searchParams.set("query", 'count(*[(_type == "clientGalleryCleanup" || string::startsWith(_id, "clientGalleryCleanup.")) && !(state in ["disabled", "complete"]) && (state != "enrolled" || !defined(dateTime(policy.expiryInstant)) || dateTime(policy.expiryInstant) <= dateTime($now))][0...1]) > 0');
      url.searchParams.set("$now", JSON.stringify(nowISO));
      url.searchParams.set("perspective", "raw");
      const response = await request(url.toString(), active, check); readable(response);
      const value = await json(response, active, check);
      if (!object(value) || typeof value.result !== "boolean") fail("provider_invalid");
      return value.result;
    }),
    snapshot: (signal) => run(limits.exportTimeoutMs, signal, async (active, check) => {
      const response = await request(`${base}/export/${config.dataset}`, active, check);
      const providerTime = readable(response);
      const builder = new CleanupSnapshotBuilder(limits);
      await chunks(response, active, limits.maxSnapshotBytes, (chunk) => builder.append(chunk), check);
      return builder.finish(providerTime);
    }),
    read: (ids, options = {}) => run(limits.requestTimeoutMs, options.signal, async (active, check) => {
      if (ids.length > 600 || ids.some((id) => !cleanupDocumentId(id)) || new Set(ids).size !== ids.length) fail("provider_invalid");
      const documents = new Map<string, Record<string, unknown>>();
      const omitted = new Set<string>();
      // A 40-ID chunk stays below 6 KiB even at Sanity's maximum ID length.
      for (let start = 0; start < ids.length; start += 40) {
        const selected = ids.slice(start, start + 40);
        const url = new URL(`${base}/doc/${config.dataset}/${selected.map(encodeURIComponent).join(",")}`);
        if (options.includeAllVersions) url.searchParams.set("includeAllVersions", "true");
        const response = await request(url.toString(), active, check); readable(response);
        const value = await json(response, active, check);
        if (!object(value) || !Array.isArray(value.documents) || value.omitted !== undefined && !Array.isArray(value.omitted)) fail("provider_invalid");
        const seen = new Set<string>();
        for (const document of value.documents) {
          if (!object(document) || !cleanupDocumentId(document._id) || !cleanupRevision(document._rev) || !cleanupDocumentType(document._type) ||
            !selected.some((id) => options.includeAllVersions ? relatedVersion(document._id as string, id) : document._id === id) || seen.has(document._id)) fail("provider_invalid");
          seen.add(document._id);
          const prior = documents.get(document._id);
          if (prior && JSON.stringify(prior) !== JSON.stringify(document)) fail("provider_invalid");
          documents.set(document._id, document);
        }
        for (const entry of (value.omitted ?? []) as unknown[]) {
          if (!object(entry) || !cleanupDocumentId(entry.id) || !selected.includes(entry.id) || seen.has(entry.id) || entry.reason !== "existence") fail("provider_invalid");
          seen.add(entry.id); omitted.add(entry.id);
        }
        if (selected.some((id) => !seen.has(id))) fail("provider_invalid");
      }
      return { documents, omitted };
    }),
    mutate: async (mutations, signal) => {
      let body: string;
      const targets = new Set<string>();
      const created = new Set<string>();
      const deleted = new Set<string>();
      try {
        if (!Array.isArray(mutations) || !mutations.length || mutations.length > 2048) return { kind: "refused" };
        for (const mutation of mutations) {
          if (!object(mutation) || Object.keys(mutation).length !== 1) return { kind: "refused" };
          const kind = Object.keys(mutation)[0];
          const payload = mutation[kind];
          if (!["create", "patch", "delete"].includes(kind) || !object(payload) || "query" in payload) return { kind: "refused" };
          const id = kind === "create" ? payload._id : payload.id;
          if (!cleanupDocumentId(id)) return { kind: "refused" };
          targets.add(id);
          if (kind === "create") created.add(id);
          if (kind === "delete") deleted.add(id);
        }
        body = JSON.stringify({ mutations });
        if (new TextEncoder().encode(body).length > 3_500_000) return { kind: "refused" };
      } catch { return { kind: "refused" }; }
      try {
        return await run(limits.requestTimeoutMs, signal, async (active, check): Promise<CleanupMutationResult> => {
          const response = await request(`${base}/mutate/${config.dataset}?returnIds=true&returnDocuments=false&visibility=sync`, active, check, body);
          if (response.status === 409) { cancel(response); return { kind: "conflict" }; }
          if (response.status >= 400 && response.status < 500) { cancel(response); return { kind: "refused" }; }
          if (!response.ok) { cancel(response); return { kind: "uncertain" }; }
          clock(response);
          const value = await json(response, active, check);
          if (!object(value) || !cleanupRevision(value.transactionId) || !Array.isArray(value.results) || !value.results.length ||
            // The raw HTTP result uses `id`; the JS SDK derives its top-level documentId from it.
            value.results.some((result) => !object(result) || typeof result.operation !== "string" || !["create", "update", "delete", "none"].includes(result.operation) || !cleanupDocumentId(result.id) || !targets.has(result.id))) return { kind: "uncertain" };
          const observed = new Set(value.results.map((result) => (result as Record<string, unknown>).id));
          // Providers may coalesce an absent-draft create+delete assertion out of the results.
          if ([...targets].some((id) => !observed.has(id) && !(created.has(id) && deleted.has(id)))) return { kind: "uncertain" };
          return { kind: "committed", transactionId: value.transactionId };
        });
      } catch { return { kind: "uncertain" }; }
    },
  };
}
