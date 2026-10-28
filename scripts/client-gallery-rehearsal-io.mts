/** Bounded, journal-before-write IO. No retries, aliases, ambient credentials or query writes. */
import { createClientGalleryCleanupTransport, type CleanupTransport } from "../src/lib/client-gallery-cleanup-transport.ts";
import { assetEvidence, assertMutations, manifestDigest, ownedIds, record, requireRehearsal, strictJson, type Case, type Manifest } from "./client-gallery-rehearsal-scope.mts";

export type RehearsalIO = ReturnType<typeof createRehearsalIO>;
export type Journal = (event: Record<string, unknown>) => Promise<void>;
export function createRehearsalIO(manifest: Manifest, token: string, journal: Journal, fetcher: typeof fetch = fetch) {
  requireRehearsal(typeof token === "string" && token.length <= 8192 && /^[A-Za-z0-9_-]+$/u.test(token), "invalid_credential");
  const origin = `https://${manifest.target.projectId}.api.sanity.io`, prefix = `/${manifest.target.apiVersion}`;
  const ids = new Set([...ownedIds(manifest), ...manifest.baseline.map(row => row.id)]);
  const started = performance.now(), uploaded = new Set<string>();
  let requests = 0, writes = 0, unsafe = false, stopped = false;
  const armed = new Map<string, { entry: Case; kind: "image" | "zip" }>();
  function params(url: URL, expected: Record<string, string>) {
    requireRehearsal([...url.searchParams].length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value), "request_refused");
  }
  const guarded: typeof fetch = async (input, init) => {
    requireRehearsal(typeof input === "string" && init && init.redirect === "error" && init.cache === "no-store", "request_refused");
    const url = new URL(input), method = init.method ?? "GET", headers = new Headers(init.headers);
    requireRehearsal(url.origin === origin && !url.username && !url.password && !url.hash &&
      headers.get("authorization") === `Bearer ${token}` && [...headers.keys()].every(key => ["authorization", "content-type"].includes(key)), "request_refused");
    requireRehearsal(++requests <= 500 && performance.now() - started < 600_000, "request_budget");
    const exportPath = `${prefix}/data/export/preview`, docPrefix = `${prefix}/data/doc/preview/`;
    let targets: unknown[] = [], bytes: Uint8Array | undefined;
    if (method === "GET") {
      requireRehearsal(init.body === undefined && !headers.has("content-type"), "request_refused");
      if (url.pathname === exportPath) params(url, {});
      else {
        requireRehearsal(url.pathname.startsWith(docPrefix), "request_refused");
        const selected = decodeURIComponent(url.pathname.slice(docPrefix.length)).split(",");
        requireRehearsal(selected.length > 0 && selected.length <= 40 && new Set(selected).size === selected.length && selected.every(id => ids.has(id)), "request_refused");
        params(url, url.searchParams.has("includeAllVersions") ? { includeAllVersions: "true" } : {});
      }
    } else {
      requireRehearsal(method === "POST" && !stopped && !unsafe && ++writes <= 150, "write_refused");
      if (url.pathname === `${prefix}/data/mutate/preview`) {
        params(url, { returnIds: "true", returnDocuments: "false", visibility: "sync" });
        requireRehearsal(typeof init.body === "string" && headers.get("content-type") === "application/json", "request_refused");
        bytes = Buffer.from(init.body);
        const body = strictJson(bytes);
        requireRehearsal(record(body) && Object.keys(body).length === 1 && Array.isArray(body.mutations), "request_refused");
        assertMutations(manifest, body.mutations);
        targets = body.mutations.map(value => {
          const mutation = value as Record<string, Record<string, unknown>>, kind = Object.keys(mutation)[0], payload = mutation[kind];
          return { kind, id: payload._id ?? payload.id, ...(payload.ifRevisionID ? { revision: payload.ifRevisionID } : {}) };
        });
      } else {
        const allowed = armed.get(input);
        requireRehearsal(allowed && init.body instanceof Uint8Array, "request_refused");
        const { entry, kind } = allowed, evidence = entry[kind], actual = assetEvidence(init.body, kind);
        params(url, { filename: kind === "zip" ? "delivery.zip" : `cleanup-rehearsal-${entry.name}.webp` });
        requireRehearsal(url.pathname === `${prefix}/assets/${kind === "image" ? "images" : "files"}/preview` &&
          headers.get("content-type") === (kind === "image" ? "image/webp" : "application/zip") &&
          JSON.stringify(actual) === JSON.stringify(evidence) && actual.bytes <= 1024 * 1024 && !uploaded.has(evidence.id), "upload_refused");
        uploaded.add(evidence.id); bytes = init.body;
        targets = [{ kind: "upload", id: evidence.id }];
      }
      // The supplied journal persists and fsyncs this intent before the wire write.
      try { await journal({ phase: "intent", sequence: writes, method, path: url.pathname, bodySha256: manifestDigest(bytes!), targets }); }
      catch { stopped = true; requireRehearsal(false, "journal_failed"); }
    }
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    try {
      const response = await new Promise<Response>((resolve, reject) => {
        let settled = false;
        const abort = () => { if (!settled) { settled = true; reject(new Error("deadline")); } };
        signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
        Promise.resolve().then(() => { if (signal.aborted) throw new Error("deadline"); return fetcher(input, { ...init, signal }); }).then(response => {
          signal.removeEventListener("abort", abort);
          if (settled) { void response.body?.cancel().catch(() => {}); return; }
          settled = true; resolve(response);
        }, error => { signal.removeEventListener("abort", abort); if (!settled) { settled = true; reject(error); } });
      });
      if (method === "POST" && response.status >= 500) unsafe = true;
      return response;
    } catch { if (method === "POST") unsafe = true; requireRehearsal(false, "provider_unavailable"); }
  };
  const actual = createClientGalleryCleanupTransport({ ...manifest.target, token }, { fetch: guarded,
    limits: { maxSnapshotBytes: 1024 * 1024, maxDocuments: 1000, maxReferences: 2000 } });
  const transport: CleanupTransport = { ...actual, async mutate(mutations, signal) {
    const result = await actual.mutate(mutations, signal);
    if (result.kind === "uncertain") unsafe = true;
    return result;
  } };
  return { transport, unsafe: () => unsafe || stopped, stats: () => ({ requests, writes }), stop: () => { stopped = true; },
    async upload(entry: Case, kind: "image" | "zip", bytes: Uint8Array): Promise<void> {
      requireRehearsal(manifest.cases.includes(entry), "upload_refused");
      const evidence = entry[kind], prior = await actual.read([evidence.id]);
      requireRehearsal(prior.omitted.has(evidence.id) && prior.documents.size === 0, "asset_already_exists");
      const url = new URL(`${origin}${prefix}/assets/${kind === "image" ? "images" : "files"}/preview`);
      url.searchParams.set("filename", kind === "zip" ? "delivery.zip" : `cleanup-rehearsal-${entry.name}.webp`);
      armed.set(url.toString(), { entry, kind });
      try {
        const response = await guarded(url.toString(), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": kind === "image" ? "image/webp" : "application/zip" }, body: bytes as BodyInit, redirect: "error", cache: "no-store" });
        void response.body?.cancel().catch(() => {});
        requireRehearsal(response.status === 200, "upload_unconfirmed");
        const result = await actual.read([evidence.id]), doc = result.documents.get(evidence.id);
        const metadata = doc?.metadata as { dimensions?: { width?: number; height?: number } } | undefined;
        requireRehearsal(doc?._type === (kind === "image" ? "sanity.imageAsset" : "sanity.fileAsset") && doc.sha1hash === evidence.sha1 && doc.size === evidence.bytes &&
          doc.extension === (kind === "image" ? "webp" : "zip") && doc.mimeType === (kind === "image" ? "image/webp" : "application/zip") &&
          (kind === "zip" || metadata?.dimensions?.width === 256 && metadata.dimensions.height === 192), "upload_unconfirmed");
      } catch { unsafe = true; requireRehearsal(false, "upload_unconfirmed"); }
      finally { armed.delete(url.toString()); }
    },
  };
}
