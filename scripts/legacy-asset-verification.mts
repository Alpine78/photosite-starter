/** AB#250: exact anonymous CDN bytes, never upload support or publication approval. */
import { createHash } from "node:crypto";
import { buildLegacyDocumentPlan } from "./legacy-delivery-document-plan.mts";

type Candidate = ReturnType<typeof buildLegacyDocumentPlan>;
type Asset = Candidate["candidateAssets"][number];
export type AssetVerification = Readonly<{
  status: "matched" | "absent" | "failed";
  code?: "http" | "headers" | "bytes" | "digest" | "request";
  httpStatus?: number;
}>;

function assetUrl(target: Candidate["target"], asset: Asset): string {
  // Callers use the compiler below, not arbitrary URLs or provider response URLs.
  const image = asset.assetId.startsWith("image-");
  const filename = image
    ? asset.assetId.slice(6).replace(/-(jpg|jpeg)$/u, ".$1")
    : `${asset.sha1}.zip`;
  return `https://cdn.sanity.io/${image ? "images" : "files"}/${target.projectId}/${target.dataset}/${filename}${image ? "" : "?dl=photographs.zip"}`;
}

function observeCleanup(cancel: () => Promise<unknown> | undefined): void {
  try { void cancel()?.catch(() => {}); } catch { /* Never replace bounded results. */ }
}

async function verifyAsset(target: Candidate["target"], asset: Asset, fetcher: typeof fetch, timeoutMs: number): Promise<AssetVerification> {
  const controller = new AbortController();
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false, timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("asset-deadline")); }, timeoutMs);
  });
  void deadline.catch(() => {});
  try {
    const pending = Promise.resolve().then(() => fetcher(assetUrl(target, asset), {
      method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal,
      headers: { "accept-encoding": "identity" },
    })).then((saved) => {
      if (finished) observeCleanup(() => saved.body?.cancel());
      return saved;
    });
    response = await Promise.race([pending, deadline]);
    if (response.status === 404) return { status: "absent", httpStatus: 404 };
    if (response.status !== 200) return { status: "failed", code: "http", httpStatus: response.status };
    const encoding = response.headers.get("content-encoding");
    const length = response.headers.get("content-length");
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const zip = asset.assetId.startsWith("file-");
    const mimeMatches = zip ? ["application/zip", "application/x-zip-compressed"].includes(mime ?? "") : mime === "image/jpeg";
    if (!mimeMatches || (encoding !== null && encoding !== "identity") ||
      (length !== null && (!/^[1-9]\d*$/u.test(length) || Number(length) !== asset.bytes)) ||
      (zip && !/^attachment(?:;|$)/iu.test(response.headers.get("content-disposition") ?? "")) || !response.body) {
      return { status: "failed", code: "headers" };
    }
    reader = response.body.getReader();
    const sha1 = createHash("sha1"), sha256 = createHash("sha256");
    let bytes = 0;
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > asset.bytes) return { status: "failed", code: "bytes" };
      sha1.update(chunk.value); sha256.update(chunk.value);
    }
    if (bytes !== asset.bytes) return { status: "failed", code: "bytes" };
    if (sha1.digest("hex") !== asset.sha1 || sha256.digest("hex") !== asset.sourceSha256) return { status: "failed", code: "digest" };
    return { status: "matched" };
  } catch {
    return { status: "failed", code: "request" };
  } finally {
    finished = true;
    clearTimeout(timer!); controller.abort();
    if (reader) {
      const saved = reader;
      observeCleanup(() => saved.cancel());
      try { saved.releaseLock(); } catch { /* In-flight read is already observed. */ }
    } else if (response) {
      const saved = response;
      observeCleanup(() => saved.body?.cancel());
    }
  }
}

/** Recompile every declaration before the first request; no input URL is trusted. */
export async function verifyLegacyAssetBytes(source: unknown, reviewDigest: unknown, bindings: unknown, now: number,
  options: { fetchImplementation?: typeof fetch; timeoutMs?: number } = {}) {
  const candidate = buildLegacyDocumentPlan(source, reviewDigest, bindings, now);
  const timeoutMs = options.timeoutMs ?? 330_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 330_000) throw new Error("ASSET_TIMEOUT_INVALID");
  const results: AssetVerification[] = [];
  // One pass per unique source asset, no retries and no GB-sized buffers.
  for (const asset of candidate.candidateAssets) {
    results.push(await verifyAsset(candidate.target, asset, options.fetchImplementation ?? fetch, timeoutMs));
    // A broken target must not trigger downloads of every remaining large archive.
    if (results.at(-1)!.status !== "matched") break;
  }
  return {
    version: 1, reviewDigest: candidate.reviewDigest, candidateDigest: candidate.candidateDigest,
    checkedAt: new Date(now).toISOString(), counts: candidate.counts,
    status: results.length === candidate.candidateAssets.length && results.every((r) => r.status === "matched") ? "matched" : "unverified",
    checkedAssets: results.length, results,
    limitations: ["cdn-byte-observation-only", "does-not-establish-supported-upload", "does-not-approve-import-or-publication",
      "does-not-establish-provider-metadata-or-gallery-runtime", "stops-at-first-unverified-asset"],
  } as const;
}
