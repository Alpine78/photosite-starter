/** Join a complete, verified first delivery upload into private placement rows. */
import "server-only";
import { createHash } from "node:crypto";
import type { PrivateGalleryPlacement } from "@/lib/private-gallery";
import { projectPrivateGalleryItem } from "@/lib/private-gallery-item";
import type { PrivateGalleryUploadPlan } from "@/lib/private-gallery-upload";
import type { PrivateGalleryCompletionOutcome } from "@/lib/private-gallery-upload-completion";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY,
  PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES,
  PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES,
} from "@/lib/private-gallery-limits";

export class PrivateGalleryDeliveryUploadError extends Error {
  constructor(readonly reason: "invalid-plan" | "unverified-upload" | "objects-mismatch") {
    super(`[private-gallery-delivery-upload] ${reason}`);
    this.name = "PrivateGalleryDeliveryUploadError";
  }
}
function fail(reason: PrivateGalleryDeliveryUploadError["reason"]): never {
  throw new PrivateGalleryDeliveryUploadError(reason);
}

/**
 * Plan order determines display order; provider observation order is irrelevant.
 * Placement identity is deterministic and domain-separated from the opaque key.
 * Neither keys nor verified provider metadata are browser projections.
 * This verifies metadata agreement, not ZIP contents or decoded image pixels.
 */
export function buildVerifiedFirstDeliveryData(
  plan: PrivateGalleryUploadPlan,
  completion: PrivateGalleryCompletionOutcome,
): { readonly placements: readonly PrivateGalleryPlacement[]; readonly activeZipObjectKey: string } {
  if (!completion.verified) fail("unverified-upload");
  if (!plan || plan.galleryKind !== "delivery" || !Array.isArray(plan.objects) || plan.objects.length < 2 ||
      plan.objects.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
      typeof plan.preparation?.galleryId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(plan.preparation.galleryId) ||
      !Array.isArray(plan.preparation.objectKeys)) fail("invalid-plan");
  for (const object of plan.objects) {
    if (!object || typeof object.objectKey !== "string" || !["preview", "zip"].includes(object.objectKind) ||
        !new RegExp(`/g/${plan.preparation.galleryId}/${object.objectKind}/[A-Za-z0-9_-]{22}$`).test(object.objectKey)) fail("invalid-plan");
  }
  const keys = new Set(plan.objects.map((object) => object?.objectKey));
  if (keys.size !== plan.objects.length || keys.size !== plan.preparation.objectKeys.length ||
      !plan.preparation.objectKeys.every((key) => keys.has(key)) ||
      plan.objects.filter((object) => object?.objectKind === "zip").length !== 1 ||
      plan.objects.some((object) => !object || !["preview", "zip"].includes(object.objectKind))) fail("invalid-plan");
  if (!Array.isArray(completion.objects) || completion.objects.length !== keys.size) fail("objects-mismatch");
  for (const object of completion.objects) if (!object || typeof object.objectKey !== "string") fail("objects-mismatch");
  const verified = new Map(completion.objects.map((object) => [object?.objectKey, object]));
  if (verified.size !== keys.size) fail("objects-mismatch");
  const placements: PrivateGalleryPlacement[] = [];
  let zipKey: string | undefined;
  let totalBytes = 0;
  for (const object of plan.objects) {
    const actual = verified.get(object.objectKey);
    if (!actual || actual.objectKind !== object.objectKind || actual.sizeBytes !== object.nominalBytes ||
        !Number.isSafeInteger(actual.sizeBytes) || actual.sizeBytes <= 0 ||
        typeof object.objectKey !== "string" || object.objectKey.length > 512) fail("objects-mismatch");
    totalBytes += actual.sizeBytes;
    if (object.objectKind === "zip") {
      if (actual.sizeBytes > PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES) fail("objects-mismatch");
      zipKey = object.objectKey;
    } else if (object.objectKind === "preview") {
      const row: PrivateGalleryPlacement = {
        galleryId: plan.preparation.galleryId,
        placementId: createHash("sha256").update(JSON.stringify([
          "private-gallery-delivery-placement-v1", plan.preparation.galleryId, object.objectKey,
        ])).digest("base64url"),
        objectKey: object.objectKey,
        order: placements.length + 1,
        derivativeKind: "delivery-preview",
        nominalBytes: actual.sizeBytes,
        width: object.width,
        height: object.height,
      };
      try { projectPrivateGalleryItem(row); } catch { fail("objects-mismatch"); }
      placements.push(row);
    } else fail("invalid-plan");
  }
  if (!zipKey || placements.length === 0 || totalBytes !== plan.totalBytes ||
      totalBytes > PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES) fail("objects-mismatch");
  if (completion.zipSwap?.objectKey !== zipKey || completion.zipSwap.predecessorObjectKey !== undefined ||
      completion.zipSwap.retainPredecessorUntil !== undefined) fail("objects-mismatch");
  return { placements, activeZipObjectKey: zipKey };
}
