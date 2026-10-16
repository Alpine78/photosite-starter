/** Allowlisted administrator status; storage identities and media stay private. */
import "server-only";
import type { PrivateGalleryProofDraftSetup } from "@/lib/private-gallery-proof-draft-store";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";
import { PRIVATE_GALLERY_MAX_PREPARATION_DAYS } from "@/lib/private-gallery-retention";

export type PrivateGalleryProofDraftStatus = {
  readonly state: "draft" | "preparing" | "ready";
  readonly upload?: {
    readonly objectCount: number;
    readonly openedAt: string;
    readonly deadline: string;
    /** Snapshot at this administrator response; the store always rechecks time. */
    readonly expired: boolean;
  };
};
function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function invalid(): never { throw new Error("[private-gallery-proof-draft-status] invalid-record"); }

/** Malformed privileged store data refuses the whole request, never a partial list. */
export function projectPrivateGalleryProofDraftStatus(row: PrivateGalleryProofDraftSetup, now: Date): PrivateGalleryProofDraftStatus {
  const { gallery, preparation } = row;
  if (!gallery || gallery.kind !== "proof" || !validDate(gallery.createdAt) || !validDate(now) ||
      !["draft", "preparing", "ready"].includes(gallery.state)) invalid();
  if (gallery.state === "draft") {
    if (preparation !== undefined || row.readyProof !== undefined) invalid();
    return { state: "draft" };
  }
  if (!preparation || !preparation.preparation || preparation.galleryKind !== "proof" ||
      preparation.preparation.galleryId !== gallery.galleryId ||
      !validDate(preparation.preparation.openedAt) || !validDate(preparation.preparation.deadline) ||
      preparation.preparation.openedAt < gallery.createdAt ||
      preparation.preparation.deadline <= preparation.preparation.openedAt ||
      preparation.preparation.deadline.getTime() - preparation.preparation.openedAt.getTime() > PRIVATE_GALLERY_MAX_PREPARATION_DAYS * 86400000 ||
      !Array.isArray(preparation.objects) || preparation.objects.length < 1 ||
      preparation.objects.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
      !Array.isArray(preparation.preparation.objectKeys) || preparation.preparation.objectKeys.length !== preparation.objects.length ||
      (gallery.state === "ready") !== (row.readyProof !== undefined)) invalid();
  return { state: gallery.state as "preparing" | "ready", upload: {
    objectCount: preparation.objects.length,
    openedAt: preparation.preparation.openedAt.toISOString(),
    deadline: preparation.preparation.deadline.toISOString(),
    expired: now.getTime() >= preparation.preparation.deadline.getTime(),
  } };
}
