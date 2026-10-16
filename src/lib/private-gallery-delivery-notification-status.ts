/** Access eligibility only; a dispatcher must also enforce due time and claim ownership. */
import "server-only";
import type { PrivateGalleryDeliveryPublicationSnapshot } from "@/lib/private-gallery-delivery-publication-store";

export function privateGalleryDeliveryNotificationStatus(row: PrivateGalleryDeliveryPublicationSnapshot, now: Date): {
  readonly state: "pending" | "failed" | "sent" | "stopped" | "expired" | "unavailable";
  readonly dispatchable: boolean;
} {
  if (!row?.gallery || !row.outbox || !row.capability || row.gallery.kind !== "delivery" ||
      row.outbox.kind !== "delivery-notification" || row.outbox.galleryId !== row.gallery.galleryId ||
      row.capability.galleryId !== row.gallery.galleryId || !["pending", "failed", "sent"].includes(row.outbox.state) ||
      !Number.isSafeInteger(row.gallery.capabilityGeneration) || row.gallery.capabilityGeneration < 0 ||
      !Number.isSafeInteger(row.capability.capabilityGeneration) || row.capability.capabilityGeneration < 0) return { state: "unavailable", dispatchable: false };
  if (row.outbox.state === "sent") return { state: "sent", dispatchable: false };
  if (row.gallery.state === "access-suspended" || row.capability.capabilityGeneration !== row.gallery.capabilityGeneration ||
      row.outbox.lastError === "access-revoked") return { state: "stopped", dispatchable: false };
  if (row.gallery.state !== "published" || !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      !(row.gallery.publishedAt instanceof Date) || !(row.gallery.accessExpiresAt instanceof Date) ||
      !Number.isFinite(row.gallery.publishedAt.getTime()) || !Number.isFinite(row.gallery.accessExpiresAt.getTime()) ||
      row.gallery.accessExpiresAt <= row.gallery.publishedAt || now < row.gallery.publishedAt) return { state: "unavailable", dispatchable: false };
  if (now >= row.gallery.accessExpiresAt) return { state: "expired", dispatchable: false };
  return { state: row.outbox.state, dispatchable: true };
}
