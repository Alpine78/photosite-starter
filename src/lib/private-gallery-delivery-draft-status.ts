/** Closed administrator summary of stored plans, never evidence of uploaded bytes. */
import "server-only";
import type { PrivateGalleryDeliveryDraft } from "@/lib/private-gallery-delivery-draft-store";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";
import { PRIVATE_GALLERY_MAX_PREPARATION_DAYS } from "@/lib/private-gallery-retention";
import { isPrivateGalleryPreparationExpired } from "@/lib/private-gallery-upload";
import { isPrivateGalleryObjectKeyInPrefix, privateGalleryObjectKeyPrefix } from "@/lib/private-gallery-object-key";
import { isPrivateGalleryProofBusinessReference } from "@/lib/private-gallery-proof-identifiers";

export type PrivateGalleryDeliveryDraftStatus =
  | { readonly state: "draft" }
  | { readonly state: "preparing" | "ready"; readonly upload: {
      readonly plannedPreviewCount: number; readonly plannedZipCount: 1;
      readonly openedAt: string; readonly deadline: string; readonly expired: boolean;
    } };
function invalid(): never { throw new Error("[private-gallery-delivery-draft-status] invalid-record"); }
function date(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }

/** Shape/identity checks protect this summary; completion/publication still validate the media. */
export function projectPrivateGalleryDeliveryDraftStatus(row: PrivateGalleryDeliveryDraft, now: Date): PrivateGalleryDeliveryDraftStatus {
  try {
    const { gallery, preparation: plan, readyDelivery: ready } = row;
    if (!gallery || gallery.kind !== "delivery" || !date(gallery.createdAt) || !date(now) ||
        typeof gallery.galleryHandle !== "string" || gallery.galleryHandle.length !== 22 ||
        !/^[A-Za-z0-9_-]{22}$/.test(gallery.galleryHandle) || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
        (row.customerReference !== undefined && !isPrivateGalleryProofBusinessReference(row.customerReference)) ||
        (row.jobReference !== undefined && !isPrivateGalleryProofBusinessReference(row.jobReference)) ||
        gallery.publishedAt !== undefined || gallery.accessExpiresAt !== undefined || row.publication !== undefined) invalid();
    if (gallery.state === "draft") {
      if (plan !== undefined || ready !== undefined || gallery.activeZipObjectKey !== undefined) invalid();
      return { state: "draft" };
    }
    if (gallery.state !== "preparing" && gallery.state !== "ready") invalid();
    if (!plan || plan.galleryKind !== "delivery" || !plan.preparation || plan.preparation.galleryId !== gallery.galleryId ||
        !date(plan.preparation.openedAt) || !date(plan.preparation.deadline) || plan.preparation.openedAt < gallery.createdAt ||
        plan.preparation.deadline <= plan.preparation.openedAt ||
        plan.preparation.deadline.getTime() - plan.preparation.openedAt.getTime() > PRIVATE_GALLERY_MAX_PREPARATION_DAYS * 86400000 ||
        !Array.isArray(plan.objects) || plan.objects.length < 2 || plan.objects.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
        !Array.isArray(plan.preparation.objectKeys) || plan.preparation.objectKeys.length !== plan.objects.length ||
        typeof row.preparationKeyPrefix !== "string") invalid();
    const prefix = privateGalleryObjectKeyPrefix({ keyPrefix: row.preparationKeyPrefix, galleryId: gallery.galleryId });
    const byKey = new Map<string, "preview" | "zip">();
    const previews = new Set<string>();
    let zip: string | undefined;
    for (const object of plan.objects) {
      if (!object || (object.objectKind !== "preview" && object.objectKind !== "zip") ||
          !isPrivateGalleryObjectKeyInPrefix(object.objectKey, row.preparationKeyPrefix) ||
          !object.objectKey.startsWith(`${prefix}${object.objectKind}/`) || byKey.has(object.objectKey)) invalid();
      byKey.set(object.objectKey, object.objectKind);
      if (object.objectKind === "zip") { if (zip !== undefined) invalid(); zip = object.objectKey; }
      else previews.add(object.objectKey);
    }
    const preparedKeys = new Set(plan.preparation.objectKeys);
    if (!zip || previews.size < 1 || preparedKeys.size !== byKey.size ||
        [...preparedKeys].some((key) => !byKey.has(key))) invalid();
    if (gallery.state === "preparing") {
      if (ready !== undefined || gallery.activeZipObjectKey !== undefined) invalid();
    } else {
      if (!ready || gallery.activeZipObjectKey !== zip || !Array.isArray(ready.placements) || ready.placements.length !== previews.size ||
          !Array.isArray(ready.verifiedObjects) || ready.verifiedObjects.length !== byKey.size) invalid();
      const placed = new Set<string>(), verified = new Set<string>();
      for (const item of ready.placements) {
        if (!item || item.galleryId !== gallery.galleryId || item.derivativeKind !== "delivery-preview" ||
            !previews.has(item.objectKey) || placed.has(item.objectKey)) invalid();
        placed.add(item.objectKey);
      }
      for (const item of ready.verifiedObjects) {
        if (!item || !byKey.has(item.objectKey) || byKey.get(item.objectKey) !== item.objectKind || verified.has(item.objectKey)) invalid();
        verified.add(item.objectKey);
      }
    }
    return { state: gallery.state, upload: { plannedPreviewCount: previews.size, plannedZipCount: 1,
      openedAt: plan.preparation.openedAt.toISOString(), deadline: plan.preparation.deadline.toISOString(),
      expired: isPrivateGalleryPreparationExpired(plan.preparation, now) } };
  } catch { return invalid(); }
}
