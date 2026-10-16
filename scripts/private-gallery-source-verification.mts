/** Validate a saved offline plan before reading any declared source file. */
import { isDeepStrictEqual } from "node:util";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY as MAX_FILES } from "../src/lib/private-gallery-limits.ts";
import { buildPrivateGallerySourcePlan, validatePrivateSourceInput, refuse, PrivateSourcePlanError,
  type LocalAsset } from "./private-gallery-source-plan.mts";

export const PRIVATE_SOURCE_MAX_PLAN_BYTES = 4 * 1024 * 1024;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).sort().join(",") === [...names].sort().join(",");
}
export function validateSavedPrivateSourcePlan(value: unknown, expectedDigest: string) {
  if (typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedDigest)) refuse("INVALID_ARGUMENTS");
  try {
    if (!keys(value, ["version", "mode", "manifest", "localAssets", "totalBytes", "checks", "digest"]) ||
        value.version !== 1 || (value.mode !== "proof" && value.mode !== "delivery") ||
        !Array.isArray(value.manifest) || !Array.isArray(value.localAssets) ||
        value.manifest.length < 1 || value.manifest.length > MAX_FILES || value.manifest.length !== value.localAssets.length ||
        typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) refuse("INVALID_PLAN");
    const assets: LocalAsset[] = [];
    const images: { relativePath: string; mediaId?: string }[] = [];
    let zipPath: string | undefined;
    for (let index = 0; index < value.manifest.length; index++) {
      const entry: unknown = value.manifest[index], local: unknown = value.localAssets[index];
      if (!record(entry)) refuse("INVALID_PLAN");
      const zip = entry.kind === "zip";
      const proof = value.mode === "proof";
      if (!keys(entry, zip ? ["kind", "nominalBytes"] : proof
        ? ["kind", "derivativeKind", "nominalBytes", "width", "height", "filename", "mediaId"]
        : ["kind", "derivativeKind", "nominalBytes", "width", "height"]) ||
          !keys(local, zip ? ["relativePath", "bytes", "sha256"] : ["relativePath", "bytes", "sha256", "hasExif", "hasIcc"]) ||
          typeof local.relativePath !== "string" || typeof local.bytes !== "number" || typeof local.sha256 !== "string" ||
          (!zip && (typeof local.hasExif !== "boolean" || typeof local.hasIcc !== "boolean"))) refuse("INVALID_PLAN");
      if (zip) {
        if (proof || index !== value.manifest.length - 1 || zipPath !== undefined) refuse("INVALID_PLAN");
        zipPath = local.relativePath;
      } else {
        if (entry.kind !== "derivative" || typeof entry.width !== "number" || typeof entry.height !== "number" ||
            (proof && typeof entry.mediaId !== "string")) refuse("INVALID_PLAN");
        images.push({ relativePath: local.relativePath, ...(proof ? { mediaId: entry.mediaId as string } : {}) });
      }
      assets.push({ relativePath: local.relativePath, bytes: local.bytes, sha256: local.sha256,
        // Inode identity is deliberately read-local, never a persisted freshness pin.
        identity: `0:${index}`,
        ...(!zip ? { format: "jpeg", width: entry.width as number, height: entry.height as number,
          hasExif: local.hasExif as boolean, hasIcc: local.hasIcc as boolean } : {}),
      });
    }
    const input = validatePrivateSourceInput({ mode: value.mode, images,
      ...(value.mode === "proof" ? { externallyWatermarked: true } : { zipPath }) });
    const plan = buildPrivateGallerySourcePlan(input, assets);
    // Fixed-shape reconstruction validates totals, per-kind fields, integrity claims
    // and the original digest without recursively normalizing unknown input.
    if (!isDeepStrictEqual(value, plan)) refuse("INVALID_PLAN");
    if (plan.digest !== expectedDigest) refuse("PLAN_DIGEST_MISMATCH");
    return { plan, input };
  } catch (error) {
    if (error instanceof PrivateSourcePlanError && error.code === "PLAN_DIGEST_MISMATCH") throw error;
    refuse("INVALID_PLAN");
  }
}
