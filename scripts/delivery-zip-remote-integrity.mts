/** AB#316: complete anonymous ZIP byte agreement, never upload or publication approval. */
import { createHash } from "node:crypto";
import {
  isSanityByteTarget, SANITY_ASSET_TIMEOUT_MS, verifySanityAssetBytes,
} from "./sanity-asset-byte-verification.mts";

export const REMOTE_ZIP_MAX_BYTES = 1_000_000_000;
export class RemoteZipInputError extends Error {
  constructor() { super("[remote-zip] INVALID_INPUT"); }
}
export type RemoteZipDeclaration = Readonly<{
  projectId: string; dataset: string; assetId: string; bytes: number; sha256: string;
}>;
const fields = ["projectId", "dataset", "assetId", "bytes", "sha256"] as const;

/** Copy only closed own data fields; no URL, environment or application configuration. */
export function parseRemoteZipDeclaration(value: unknown): RemoteZipDeclaration {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new RemoteZipInputError();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key as typeof fields[number]))) {
      throw new RemoteZipInputError();
    }
    const row: Record<string, unknown> = {};
    for (const key of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new RemoteZipInputError();
      row[key] = descriptor.value;
    }
    if (typeof row.projectId !== "string" || typeof row.dataset !== "string" ||
      !isSanityByteTarget({ projectId: row.projectId, dataset: row.dataset }) ||
      typeof row.assetId !== "string" || row.assetId.length !== 49 || !/^file-[a-f0-9]{40}-zip$/u.test(row.assetId) ||
      typeof row.bytes !== "number" || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > REMOTE_ZIP_MAX_BYTES ||
      typeof row.sha256 !== "string" || row.sha256.length !== 64 || !/^[a-fA-F0-9]{64}$/u.test(row.sha256)) throw new RemoteZipInputError();
    return Object.freeze({ projectId: row.projectId, dataset: row.dataset, assetId: row.assetId, bytes: row.bytes, sha256: row.sha256.toLowerCase() });
  } catch { throw new RemoteZipInputError(); }
}

export async function verifyRemoteDeliveryZip(input: unknown,
  options: { fetchImplementation?: typeof fetch; timeoutMs?: number } = {}) {
  const declaration = parseRemoteZipDeclaration(input);
  const timeoutMs = options.timeoutMs ?? SANITY_ASSET_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SANITY_ASSET_TIMEOUT_MS) throw new RemoteZipInputError();
  const result = await verifySanityAssetBytes(declaration, {
    assetId: declaration.assetId, sha1: declaration.assetId.slice(5, 45),
    sourceSha256: declaration.sha256, bytes: declaration.bytes, mimeType: "application/zip",
  }, options.fetchImplementation ?? fetch, timeoutMs, REMOTE_ZIP_MAX_BYTES);
  return {
    version: 1, status: result.status === "matched" ? "matched" : "unverified", result,
    declarationDigest: createHash("sha256").update(JSON.stringify(["remote-zip-v1", declaration.projectId,
      declaration.dataset, declaration.assetId, declaration.bytes, declaration.sha256])).digest("hex"),
    readyToPublish: false,
    limitations: ["remote-byte-agreement-only", "does-not-establish-supported-upload", "does-not-approve-import-or-publication",
      "zip-format-unproven", "source-eligibility-unproven", "jpeg-and-metadata-suitability-unproven", "local-manifest-authority-unproven"],
  } as const;
}
