/** AB#250: exact anonymous CDN bytes, never upload support or publication approval. */
import { buildLegacyDocumentPlan } from "./legacy-delivery-document-plan.mts";
import { MAX_ZIP_BYTES } from "./legacy-delivery-import-plan.mts";
import { verifySanityAssetBytes, type AssetVerification } from "./sanity-asset-byte-verification.mts";
export type { AssetVerification } from "./sanity-asset-byte-verification.mts";

/** Recompile every declaration before the first request; no input URL is trusted. */
export async function verifyLegacyAssetBytes(source: unknown, reviewDigest: unknown, bindings: unknown, now: number,
  options: { fetchImplementation?: typeof fetch; timeoutMs?: number } = {}) {
  const candidate = buildLegacyDocumentPlan(source, reviewDigest, bindings, now);
  const timeoutMs = options.timeoutMs ?? 330_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 330_000) throw new Error("ASSET_TIMEOUT_INVALID");
  const results: AssetVerification[] = [];
  // One pass per unique source asset, no retries and no GB-sized buffers.
  for (const asset of candidate.candidateAssets) {
    results.push(await verifySanityAssetBytes(candidate.target, asset, options.fetchImplementation ?? fetch, timeoutMs, MAX_ZIP_BYTES));
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
