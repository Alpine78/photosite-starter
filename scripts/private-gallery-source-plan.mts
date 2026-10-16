/** Offline local preparation only; no key assignment, storage writes or publication. */
import { createHash } from "node:crypto";
import type { PrivateGalleryManifestEntry } from "../src/lib/private-gallery-upload.ts";
import { isPrivateGalleryProofFilename, isPrivateGalleryProofMediaId } from "../src/lib/private-gallery-proof-identifiers.ts";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY as MAX_FILES,
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES as MAX_IMAGE_BYTES,
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX as MAX_EDGE,
  PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES as MAX_TOTAL,
  PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES as MAX_ZIP,
} from "../src/lib/private-gallery-limits.ts";
export { MAX_IMAGE_BYTES, MAX_ZIP, MAX_EDGE };
export const PRIVATE_SOURCE_MAX_INPUT_BYTES = 1024 * 1024;
export type PrivateSourceErrorCode = "INVALID_ARGUMENTS" | "INVALID_INPUT" | "INVALID_PATH" | "DUPLICATE_SOURCE" |
  "INVALID_MEDIA" | "INVALID_PROOF" | "INVALID_SIZE" | "PRIVATE_PERMISSIONS" | "PRIVATE_PERMISSIONS_UNSUPPORTED" |
  "PATH_SYMLINK" | "SOURCE_ROOT_ESCAPE" | "SOURCE_CHANGED" | "GIT_GUARD_FAILED" | "ARTIFACT_NOT_IGNORED" |
  "ARTIFACT_TRACKED" | "OUTPUT_EXISTS" | "LOCAL_IO_FAILED" | "INVALID_PLAN" | "PLAN_DIGEST_MISMATCH";
export class PrivateSourcePlanError extends Error {
  readonly code: PrivateSourceErrorCode;
  readonly ordinal?: number;
  constructor(code: PrivateSourceErrorCode, ordinal?: number) {
    super(`[private-upload-source] ${code}${ordinal === undefined ? "" : ` item=${ordinal}`}`);
    this.name = "PrivateSourcePlanError";
    this.code = code;
    this.ordinal = ordinal;
  }
}
export function refuse(code: PrivateSourceErrorCode, ordinal?: number): never { throw new PrivateSourcePlanError(code, ordinal); }
type ImageInput = { readonly relativePath: string; readonly mediaId?: string };
export type PrivateSourceInput = { readonly mode: "proof" | "delivery"; readonly images: readonly ImageInput[];
  readonly zipPath?: string; readonly externallyWatermarked?: true };
export type LocalAsset = {
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Read-time file identity only; never included in the saved digest/report. */
  readonly identity: string;
  readonly format?: string; readonly width?: number; readonly height?: number;
  readonly orientation?: number; readonly pages?: number;
  readonly hasExif?: boolean; readonly hasIcc?: boolean;
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positive(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}
export function validatePrivateSourcePath(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 1024 ||
      /[\\:\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) ||
      value.split("/").some((part) => part.length === 0 || part === "." || part === "..")) refuse("INVALID_PATH");
  return value;
}
const pathIdentity = (value: string) => value.normalize("NFC").toLowerCase();

/** Validate the whole declaration before any image/ZIP IO. */
export function validatePrivateSourceInput(value: unknown): PrivateSourceInput {
  if (!record(value) || (value.mode !== "proof" && value.mode !== "delivery") ||
      !Array.isArray(value.images) || value.images.length < 1 || value.images.length > MAX_FILES ||
      Object.keys(value).some((key) => !["mode", "images", "zipPath", "externallyWatermarked"].includes(key))) refuse("INVALID_INPUT");
  if (value.mode === "proof" ? (value.externallyWatermarked !== true || Object.hasOwn(value, "zipPath")) :
    (Object.hasOwn(value, "externallyWatermarked") || typeof value.zipPath !== "string" || value.images.length >= MAX_FILES)) refuse("INVALID_INPUT");
  const seenPaths = new Set<string>();
  const seenMedia = new Set<string>();
  const images: ImageInput[] = [];
  for (let index = 0; index < value.images.length; index++) {
    const item: unknown = value.images[index];
    if (!record(item) || Object.keys(item).some((key) => !["relativePath", "mediaId"].includes(key))) refuse("INVALID_INPUT", index + 1);
    const relativePath = validatePrivateSourcePath(item.relativePath);
    const identity = pathIdentity(relativePath);
    if (seenPaths.has(identity)) refuse("DUPLICATE_SOURCE", index + 1);
    seenPaths.add(identity);
    if (value.mode === "proof") {
      const filename = relativePath.split("/").at(-1)!;
      if (!isPrivateGalleryProofFilename(filename) || !isPrivateGalleryProofMediaId(item.mediaId) || seenMedia.has(item.mediaId)) refuse("INVALID_PROOF", index + 1);
      seenMedia.add(item.mediaId);
      images.push({ relativePath, mediaId: item.mediaId });
    } else {
      if (Object.hasOwn(item, "mediaId")) refuse("INVALID_INPUT", index + 1);
      images.push({ relativePath });
    }
  }
  if (value.mode === "proof") return { mode: "proof", images, externallyWatermarked: true };
  const zipPath = validatePrivateSourcePath(value.zipPath);
  if (seenPaths.has(pathIdentity(zipPath))) refuse("DUPLICATE_SOURCE");
  return { mode: "delivery", images, zipPath };
}

/** Metadata and hashes must describe bytes just read by the IO adapter. */
export function buildPrivateGallerySourcePlan(value: unknown, assets: readonly LocalAsset[]) {
  const input = validatePrivateSourceInput(value);
  const paths = [...input.images.map((item) => item.relativePath), ...(input.zipPath ? [input.zipPath] : [])];
  if (!Array.isArray(assets) || assets.length !== paths.length) refuse("INVALID_INPUT");
  const identities = new Set<string>();
  const manifest: PrivateGalleryManifestEntry[] = [];
  const localAssets: { relativePath: string; bytes: number; sha256: string; hasExif?: boolean; hasIcc?: boolean }[] = [];
  let totalBytes = 0;
  for (let index = 0; index < paths.length; index++) {
    const asset = assets[index];
    const isZip = index === input.images.length;
    if (!asset || asset.relativePath !== paths[index] || !positive(asset.bytes, isZip ? MAX_ZIP : MAX_IMAGE_BYTES) ||
        typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256) ||
        typeof asset.identity !== "string" || !/^[0-9]+:[0-9]+$/.test(asset.identity)) refuse("INVALID_SIZE", index + 1);
    if (identities.has(asset.identity)) refuse("DUPLICATE_SOURCE", index + 1);
    identities.add(asset.identity);
    totalBytes += asset.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL) refuse("INVALID_SIZE", index + 1);
    if (isZip) manifest.push({ kind: "zip", nominalBytes: asset.bytes });
    else {
      if (asset.format !== "jpeg" || !positive(asset.width, MAX_EDGE) || !positive(asset.height, MAX_EDGE) ||
          (asset.orientation !== undefined && asset.orientation !== 1) ||
          (asset.pages !== undefined && asset.pages !== 1)) refuse("INVALID_MEDIA", index + 1);
      if (input.mode === "proof") manifest.push({ kind: "derivative", derivativeKind: "watermarked-proof", nominalBytes: asset.bytes,
        width: asset.width, height: asset.height, filename: paths[index].split("/").at(-1)!, mediaId: input.images[index].mediaId! });
      else manifest.push({ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: asset.bytes, width: asset.width, height: asset.height });
    }
    localAssets.push({ relativePath: asset.relativePath, bytes: asset.bytes, sha256: asset.sha256,
      ...(!isZip ? { hasExif: asset.hasExif === true, hasIcc: asset.hasIcc === true } : {}) });
  }
  const content = { version: 1, mode: input.mode, manifest, localAssets, totalBytes,
    checks: { watermarks: input.mode === "proof" ? "owner-attested-not-detected" : "not-applicable",
      zip: input.mode === "delivery" ? "signature-only-no-entry-or-crc-verification" : "not-applicable",
      freshness: "planning-time-only-rehash-before-upload", remote: "not-contacted" } };
  // Change detection, not authentication. Exactly this JSON, excluding digest.
  return { ...content, digest: createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex") };
}
