/** Anonymous, canonical Sanity asset reads shared by approved legacy and whole-ZIP checks. */
import { createHash } from "node:crypto";

export type SanityByteTarget = Readonly<{ projectId: string; dataset: string }>;
export type SanityByteAsset = Readonly<{
  assetId: string; sha1: string; sourceSha256: string; bytes: number; mimeType: string; kind?: "file";
}>;
export const SANITY_ASSET_ORIGIN = "https://cdn.sanity.io";
export const SANITY_ASSET_TIMEOUT_MS = 330_000;

export function isSanityByteTarget(target: SanityByteTarget): boolean {
  return typeof target.projectId === "string" && target.projectId.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(target.projectId) &&
    typeof target.dataset === "string" && target.dataset.length <= 64 &&
    /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u.test(target.dataset);
}
function validDeclaration(target: SanityByteTarget, asset: SanityByteAsset, timeoutMs: number, maximumBytes: number) {
  if (!isSanityByteTarget(target) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SANITY_ASSET_TIMEOUT_MS ||
    !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > maximumBytes ||
    typeof asset.sha1 !== "string" || !/^[a-f0-9]{40}$/u.test(asset.sha1) ||
    typeof asset.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sourceSha256) ||
    typeof asset.assetId !== "string" || asset.assetId.length > 128) return false;
  if (asset.mimeType === "image/jpeg") {
    if (asset.kind === "file") return asset.assetId === `file-${asset.sha1}-jpg`;
    const parts = /^image-([a-f0-9]{40})-[1-9]\d{0,4}x[1-9]\d{0,4}-(?:jpg|jpeg)$/u.exec(asset.assetId);
    return parts !== null && parts[1] === asset.sha1 && asset.kind === undefined;
  }
  return ["application/zip", "application/x-zip-compressed"].includes(asset.mimeType) &&
    asset.assetId === `file-${asset.sha1}-zip` && asset.kind === undefined;
}

export type AssetVerification = Readonly<{
  status: "matched" | "absent" | "failed";
  code?: "http" | "headers" | "bytes" | "digest" | "request";
  httpStatus?: number;
}>;

function assetUrl(target: SanityByteTarget, asset: SanityByteAsset): string {
  // Both callers compile closed identities; never use a provider response URL.
  const image = asset.assetId.startsWith("image-");
  const filename = image
    ? asset.assetId.slice(6).replace(/-(jpg|jpeg)$/u, ".$1")
    : `${asset.sha1}.${asset.kind === "file" ? "jpg" : "zip"}`;
  return `${SANITY_ASSET_ORIGIN}/${image ? "images" : "files"}/${target.projectId}/${target.dataset}/${filename}${asset.mimeType === "image/jpeg" ? "" : "?dl=photographs.zip"}`;
}

function observeCleanup(cancel: () => Promise<unknown> | undefined): void {
  try { void cancel()?.catch(() => {}); } catch { /* Never replace bounded results. */ }
}

/** Internal transport: both callers first compile their own closed declarations. No URL input. */
export async function verifySanityAssetBytes(target: SanityByteTarget, asset: SanityByteAsset,
  fetcher: typeof fetch, timeoutMs: number, maximumBytes: number): Promise<AssetVerification> {
  try {
    if (!validDeclaration(target, asset, timeoutMs, maximumBytes)) return { status: "failed", code: "request" };
  } catch { return { status: "failed", code: "request" }; }
  const expiresAt = performance.now() + timeoutMs;
  const controller = new AbortController();
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  const timer = setTimeout(() => { finished = true; controller.abort(); }, timeoutMs);
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) throw new Error("asset-deadline");
    let onAbort!: () => void;
    // Each operation owns its cancellation promise. Reusing one pending promise in
    // every race would retain completed chunk buffers until the whole download ends.
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("asset-deadline"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(operation), interrupted]); }
    finally { controller.signal.removeEventListener("abort", onAbort); }
  }
  try {
    const pending = Promise.resolve().then(() => fetcher(assetUrl(target, asset), {
      method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal,
      headers: { "accept-encoding": "identity" },
    })).then((saved) => {
      if (finished) observeCleanup(() => saved.body?.cancel());
      return saved;
    });
    response = await bounded(() => pending);
    if (performance.now() >= expiresAt) throw new Error("asset-deadline");
    if (response.status === 404) return { status: "absent", httpStatus: 404 };
    if (response.status !== 200) return { status: "failed", code: "http", httpStatus: response.status };
    const encoding = response.headers.get("content-encoding");
    const length = response.headers.get("content-length");
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const zip = asset.mimeType !== "image/jpeg";
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
      // Immediate chunks must not starve timer-based enforcement of the total deadline.
      if (performance.now() >= expiresAt) throw new Error("asset-deadline");
      const savedReader = reader;
      const chunk = await bounded(() => savedReader.read());
      if (performance.now() >= expiresAt) throw new Error("asset-deadline");
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
    clearTimeout(timer); controller.abort();
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

