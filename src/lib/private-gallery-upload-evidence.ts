/** Bounded, detached upload receipt/provider metadata snapshots for private stores. */
import "server-only";
import type { PrivateGalleryUploadReceipt, PrivateGalleryObjectObservation } from "@/lib/private-gallery-upload-completion";
import { PRIVATE_GALLERY_MAX_OBJECT_KEY_LENGTH } from "@/lib/private-gallery-object-key";

export type PrivateGalleryUploadCompletionEvidence = {
  readonly receipts: readonly PrivateGalleryUploadReceipt[];
  readonly observations: readonly PrivateGalleryObjectObservation[];
};
function invalid(): never { throw new Error("[private-gallery-upload-evidence] invalid-input"); }

function boundedMetadataString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && /^[\x20-\x7e]+$/.test(value);
}

/** Copy only bounded provider metadata; helpers must not retain caller objects. */
export function snapshotPrivateGalleryUploadCompletionEvidence(
  input: PrivateGalleryUploadCompletionEvidence,
  plan: { readonly objects: readonly unknown[]; readonly preparation: { readonly objectKeys: readonly string[] } },
): Pick<PrivateGalleryUploadCompletionEvidence, "receipts" | "observations"> {
  const { receipts, observations } = input;
  if (!Array.isArray(receipts) || receipts.length > plan.objects.length ||
      !Array.isArray(observations) || observations.length > plan.objects.length + 1) {
    invalid();
  }
  const checksum = (value: PrivateGalleryObjectObservation["checksum"]) => {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null) invalid();
    const { algorithm, value: digest } = value;
    if ((algorithm !== "sha256" && algorithm !== "crc32c") ||
        !boundedMetadataString(digest, 256)) invalid();
    // Encoding is provider-owned. Never treat an ETag as a content digest.
    return { algorithm, value: digest };
  };
  const receiptKeys = new Set<string>();
  const plannedKeys = new Set(plan.preparation.objectKeys);
  return {
    receipts: receipts.map((item: PrivateGalleryUploadReceipt) => {
      if (typeof item !== "object" || item === null) invalid();
      const { objectKey, checksum: digest } = item;
      if (!plannedKeys.has(objectKey) || receiptKeys.has(objectKey)) invalid();
      receiptKeys.add(objectKey);
      const copied = checksum(digest);
      return { objectKey, ...(copied === undefined ? {} : { checksum: copied }) };
    }),
    observations: observations.map((item: PrivateGalleryObjectObservation) => {
      if (typeof item !== "object" || item === null) invalid();
      const { objectKey, sizeBytes, etag, checksum: digest } = item;
      if (!boundedMetadataString(objectKey, PRIVATE_GALLERY_MAX_OBJECT_KEY_LENGTH) ||
          !Number.isSafeInteger(sizeBytes) ||
          (etag !== undefined && !boundedMetadataString(etag, 512))) invalid();
      const copied = checksum(digest);
      return { objectKey, sizeBytes,
        ...(etag === undefined ? {} : { etag }),
        ...(copied === undefined ? {} : { checksum: copied }) };
    }),
  };
}

