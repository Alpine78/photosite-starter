/** First delivery publication preconditions; this module writes nothing. */
import "server-only";
import type { PrivateGallery, PrivateGalleryPlacement, PrivateGalleryUploadPreparation } from "@/lib/private-gallery";
import type { PrivateGalleryVerifiedObject } from "@/lib/private-gallery-upload-completion";
import { projectPrivateGalleryItem } from "@/lib/private-gallery-item";
import { assertPrivateGalleryHandleShape } from "@/lib/private-gallery-exchange";
import { computePrivateGalleryAccessExpiry, PRIVATE_GALLERY_MAX_PREPARATION_DAYS } from "@/lib/private-gallery-retention";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY, PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES,
  PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES } from "@/lib/private-gallery-limits";

export type PrivateGalleryFirstDeliveryPublicationBlocker = "wrong-state" | "publication-metadata-present" |
  "invalid-identity" | "invalid-generation" | "invalid-time" | "preparation-unavailable" |
  "preparation-expired" | "delivery-data-invalid" | "delivery-objects-mismatch";
export type PrivateGalleryFirstDeliveryPublicationPlan =
  | { readonly publishable: false; readonly blockers: readonly PrivateGalleryFirstDeliveryPublicationBlocker[] }
  | { readonly publishable: true; readonly galleryId: string; readonly expectedState: "ready";
      readonly expectedCapabilityGeneration: number; readonly nextState: "published";
      readonly publishedAt: Date; readonly accessExpiresAt: Date };
function refused(reason: PrivateGalleryFirstDeliveryPublicationBlocker): PrivateGalleryFirstDeliveryPublicationPlan {
  return { publishable: false, blockers: [reason] };
}
function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Returns the first blocker in a fixed validation order, with no private values.
 *
 * A future adapter must lock/re-read the gallery AND this entire preparation,
 * placement and verified-object set in the same transaction as the state change,
 * sealed capability and unique initial outbox insert. State/generation alone
 * cannot guard concurrent child-record edits. A repeat publish returns the
 * existing publication rather than using this first-publication plan again.
 *
 * Object evidence has no verifiedAt: it describes the immutable object keys
 * checked at completion. Live adapters must prove immutable-write/version and
 * checksum semantics; this pure plan cannot establish their freshness or bytes.
 */
export function planPrivateGalleryFirstDeliveryPublication(input: {
  readonly gallery: PrivateGallery;
  readonly placements: readonly PrivateGalleryPlacement[];
  readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
  readonly preparation?: PrivateGalleryUploadPreparation;
  readonly now: Date;
}): PrivateGalleryFirstDeliveryPublicationPlan {
  if (!input || !input.gallery || input.gallery.kind !== "delivery" || input.gallery.state !== "ready") return refused("wrong-state");
  const { gallery, placements, verifiedObjects, preparation, now } = input;
  if (gallery.publishedAt !== undefined || gallery.accessExpiresAt !== undefined) return refused("publication-metadata-present");
  if (typeof gallery.galleryId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(gallery.galleryId)) return refused("invalid-identity");
  try { assertPrivateGalleryHandleShape(gallery.galleryHandle); } catch { return refused("invalid-identity"); }
  if (!Number.isSafeInteger(gallery.capabilityGeneration) || gallery.capabilityGeneration < 0) return refused("invalid-generation");
  if (!validDate(gallery.createdAt) || !validDate(now) || now < gallery.createdAt) return refused("invalid-time");
  if (!preparation || preparation.galleryId !== gallery.galleryId || !validDate(preparation.openedAt) || !validDate(preparation.deadline) ||
      preparation.openedAt < gallery.createdAt || preparation.deadline <= preparation.openedAt ||
      preparation.deadline.getTime() - preparation.openedAt.getTime() > PRIVATE_GALLERY_MAX_PREPARATION_DAYS * 86400000) return refused("preparation-unavailable");
  if (now < preparation.openedAt || now >= preparation.deadline) return refused("preparation-expired");
  // Check all cardinalities before building maps or walking untrusted rows.
  if (!Array.isArray(placements) || placements.length < 1 || placements.length >= PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
      !Array.isArray(verifiedObjects) || verifiedObjects.length !== placements.length + 1 ||
      !Array.isArray(preparation.objectKeys) || preparation.objectKeys.length !== verifiedObjects.length) return refused("delivery-data-invalid");
  const byKey = new Map<string, PrivateGalleryVerifiedObject>();
  let zip: PrivateGalleryVerifiedObject | undefined;
  let totalBytes = 0;
  for (const object of verifiedObjects) {
    if (!object || typeof object.objectKey !== "string" || object.objectKey.length > 512 ||
        (object.objectKind !== "preview" && object.objectKind !== "zip") ||
        !new RegExp(`^[a-z0-9][a-z0-9_-]*(?:/[a-z0-9][a-z0-9_-]*)*/g/${gallery.galleryId}/${object.objectKind}/[A-Za-z0-9_-]{22}$`).test(object.objectKey) ||
        byKey.has(object.objectKey) || !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes <= 0) return refused("delivery-objects-mismatch");
    byKey.set(object.objectKey, object);
    if (object.objectKind === "zip") {
      if (zip || object.sizeBytes > PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES) return refused("delivery-objects-mismatch");
      zip = object;
    }
    totalBytes += object.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES) return refused("delivery-objects-mismatch");
  }
  if (!zip || gallery.activeZipObjectKey !== zip.objectKey) return refused("delivery-objects-mismatch");
  const preparedKeys = new Set(preparation.objectKeys);
  if (preparedKeys.size !== byKey.size || [...byKey.keys()].some((key) => !preparedKeys.has(key))) return refused("delivery-objects-mismatch");
  const placementIds = new Set<string>();
  const placedKeys = new Set<string>();
  const orders = new Set<number>();
  for (const item of placements) {
    if (!item || item.galleryId !== gallery.galleryId || item.derivativeKind !== "delivery-preview" ||
        typeof item.placementId !== "string" || item.placementId.length > 128 ||
        placementIds.has(item.placementId) || placedKeys.has(item.objectKey) ||
        !Number.isSafeInteger(item.order) || item.order < 1 || orders.has(item.order)) return refused("delivery-data-invalid");
    // Positive unique order values may contain gaps; all objects still join.
    try { projectPrivateGalleryItem(item); } catch { return refused("delivery-data-invalid"); }
    const object = byKey.get(item.objectKey);
    if (!object || object.objectKind !== "preview" || object.sizeBytes !== item.nominalBytes) return refused("delivery-objects-mismatch");
    placementIds.add(item.placementId); placedKeys.add(item.objectKey); orders.add(item.order);
  }
  let expiresAt: Date;
  try { expiresAt = computePrivateGalleryAccessExpiry(now); } catch { return refused("invalid-time"); }
  if (!validDate(expiresAt) || expiresAt <= now) return refused("invalid-time");
  return { publishable: true, galleryId: gallery.galleryId, expectedState: "ready",
    expectedCapabilityGeneration: gallery.capabilityGeneration, nextState: "published",
    publishedAt: new Date(now), accessExpiresAt: expiresAt };
}
