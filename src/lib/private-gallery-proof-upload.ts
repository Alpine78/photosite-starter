/**
 * The first proof upload's verified objects become unnumbered placements here.
 *
 * The upload plan is committed before bytes are written; completion verifies
 * those exact keys. This join carries the complete filename and stable media
 * identity from the plan into the placement rows. The first-ready planner then
 * assigns permanent gallery-local references. No placement or reference is
 * persisted by this pure helper.
 */

import "server-only";

import type { PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import type { PrivateGalleryCompletionOutcome } from "@/lib/private-gallery-upload-completion";
import type { PrivateGalleryUploadPlan } from "@/lib/private-gallery-upload";

export type PrivateGalleryProofUploadErrorReason =
  | "wrong-gallery-kind"
  | "unverified-upload"
  | "plan-mismatch"
  | "objects-mismatch";

export class PrivateGalleryProofUploadError extends Error {
  readonly reason: PrivateGalleryProofUploadErrorReason;

  constructor(reason: PrivateGalleryProofUploadErrorReason) {
    // No filenames, identities, keys, or customer data in an error.
    super("[private-gallery-proof-upload] " + reason);
    this.name = "PrivateGalleryProofUploadError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryProofUploadErrorReason): never {
  throw new PrivateGalleryProofUploadError(reason);
}

/**
 * Only the complete, verified first proof preparation may produce placements.
 * Its stored plan and verification result must describe the same closed set.
 * Display order initially follows the declared manifest; permanent references
 * follow the independent natural-filename rule in the first-ready planner.
 */
export function buildVerifiedFirstProofPlacements(
  plan: PrivateGalleryUploadPlan,
  completion: PrivateGalleryCompletionOutcome,
): readonly PrivateGalleryProofPlacement[] {
  if (plan.galleryKind !== "proof") fail("wrong-gallery-kind");
  if (!completion.verified) fail("unverified-upload");

  const plannedKeys = new Set(plan.objects.map((object) => object.objectKey));
  if (
    plan.objects.length === 0 ||
    plannedKeys.size !== plan.objects.length ||
    plannedKeys.size !== plan.preparation.objectKeys.length ||
    !plan.preparation.objectKeys.every((key) => plannedKeys.has(key)) ||
    plan.objects.some((object) => object.objectKind !== "proof")
  ) fail("plan-mismatch");

  const verifiedByKey = new Map(
    completion.objects.map((object) => [object.objectKey, object]),
  );
  if (
    verifiedByKey.size !== completion.objects.length ||
    verifiedByKey.size !== plannedKeys.size
  ) fail("objects-mismatch");

  return plan.objects.map((object, index) => {
    if (object.objectKind !== "proof") fail("plan-mismatch");
    const verified = verifiedByKey.get(object.objectKey);
    if (
      verified?.objectKind !== "proof" ||
      verified.sizeBytes !== object.nominalBytes
    ) fail("objects-mismatch");

    return {
      galleryId: plan.preparation.galleryId,
      placementId: object.placementId,
      objectKey: object.objectKey,
      order: index + 1,
      derivativeKind: "watermarked-proof",
      nominalBytes: verified.sizeBytes,
      width: object.width,
      height: object.height,
      filename: object.filename,
      mediaId: object.mediaId,
    };
  });
}
