/** Browser-safe proof selection read model for an already-authorized gallery. */
import "server-only";

import {
  isPrivateGalleryProofFilename,
  isPrivateGalleryProofMediaId,
  summarizePrivateGalleryProofSelection,
  validatePrivateGalleryProofPricing,
  type PrivateGalleryProofSelectedImage,
  type PrivateGalleryProofSummary,
} from "@/lib/private-gallery-proof";
import type { PrivateGalleryProofStoredState } from "@/lib/private-gallery-proof-store";
import { projectPrivateGalleryItem, type PrivateGalleryItem } from "@/lib/private-gallery-item";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY,
  PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE,
} from "@/lib/private-gallery-limits";

const REFERENCE = /^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/;

export type PrivateGalleryProofViewItem = Omit<PrivateGalleryItem, "derivativeKind"> & {
  readonly derivativeKind: "watermarked-proof";
  readonly reference: string;
  readonly filename: string;
  readonly selected: boolean;
};

export type PrivateGalleryProofView = {
  readonly revision: number;
  readonly confirmed: boolean;
  readonly confirmationVersion?: number;
  readonly confirmedAt?: string;
  readonly items: readonly PrivateGalleryProofViewItem[];
  readonly selectedImages: readonly Pick<PrivateGalleryProofSelectedImage, "reference" | "filename">[];
  readonly summary: PrivateGalleryProofSummary;
  readonly pageIndex: number;
  readonly totalCount: number;
  readonly hasNextPage: boolean;
};

export type PrivateGalleryProofViewErrorReason =
  | "invalid-page"
  | "malformed-record";

export class PrivateGalleryProofViewError extends Error {
  readonly reason: PrivateGalleryProofViewErrorReason;

  constructor(reason: PrivateGalleryProofViewErrorReason) {
    // No gallery id, filename, reference or selected content in an error.
    super("[private-gallery-proof-view] " + reason);
    this.name = "PrivateGalleryProofViewError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryProofViewErrorReason): never {
  throw new PrivateGalleryProofViewError(reason);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}

/**
 * A confirmed review uses the immutable snapshot even if a selected placement
 * was later removed. Current proof cards are live and may change after
 * confirmation; no card can unlock the confirmed draft.
 *
 * The development store supplies up to 1,000 placement rows in one read.
 * A PostgreSQL adapter must provide a bounded page and selected-row query
 * instead of fetching the whole gallery for every page request.
 */
export function projectPrivateGalleryProofView(
  state: PrivateGalleryProofStoredState,
  pageIndex: number,
): PrivateGalleryProofView {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) fail("invalid-page");

  try {
    const { gallery, draft, placements, currentConfirmation } = state;
    if (
      gallery.kind !== "proof" || gallery.state !== "published" ||
      !validDate(gallery.accessExpiresAt) ||
      draft.galleryId !== gallery.galleryId ||
      !Number.isSafeInteger(draft.revision) || draft.revision < 0 ||
      !Number.isSafeInteger(state.latestConfirmationVersion) ||
      state.latestConfirmationVersion < 0 ||
      !Array.isArray(placements) ||
      placements.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
      !Array.isArray(draft.selectedReferences) ||
      draft.selectedReferences.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
      typeof draft.confirmed !== "boolean"
    ) fail("malformed-record");

    const pricing = validatePrivateGalleryProofPricing(state.pricingSnapshot);
    const byReference = new Map<string, { filename: string }>();
    const mediaIds = new Set<string>();
    const itemIds = new Set<string>();
    const safeItems = placements.map((placement) => {
      if (
        placement.galleryId !== gallery.galleryId ||
        placement.derivativeKind !== "watermarked-proof" ||
        !validReference(placement.reference) ||
        !isPrivateGalleryProofFilename(placement.filename) ||
        !isPrivateGalleryProofMediaId(placement.mediaId) ||
        byReference.has(placement.reference) ||
        mediaIds.has(placement.mediaId) ||
        itemIds.has(placement.placementId)
      ) fail("malformed-record");
      const item = projectPrivateGalleryItem(placement);
      byReference.set(placement.reference, { filename: placement.filename });
      mediaIds.add(placement.mediaId);
      itemIds.add(placement.placementId);
      return {
        ...item,
        derivativeKind: "watermarked-proof" as const,
        reference: placement.reference,
        filename: placement.filename,
      };
    });

    const references = draft.selectedReferences;
    const selectedSet = new Set<string>();
    for (const reference of references) {
      if (!validReference(reference) || selectedSet.has(reference)) {
        fail("malformed-record");
      }
      selectedSet.add(reference);
      if (!draft.confirmed && !byReference.has(reference)) fail("malformed-record");
    }

    let selectedImages: readonly Pick<PrivateGalleryProofSelectedImage, "reference" | "filename">[];
    let summary: PrivateGalleryProofSummary;
    let confirmationVersion: number | undefined;
    let confirmedAt: string | undefined;
    if (draft.confirmed) {
      const confirmation = currentConfirmation;
      if (
        confirmation === undefined ||
        confirmation.galleryId !== gallery.galleryId ||
        !Number.isSafeInteger(confirmation.version) || confirmation.version < 1 ||
        confirmation.version !== state.latestConfirmationVersion ||
        !validDate(confirmation.confirmedAt) ||
        !Array.isArray(confirmation.selectedImages) ||
        confirmation.selectedImages.length !== references.length ||
        confirmation.selectedImages.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY
      ) fail("malformed-record");
      const snapshotMediaIds = new Set<string>();
      selectedImages = confirmation.selectedImages.map((image, index) => {
        if (
          !validReference(image.reference) ||
          image.reference !== references[index] ||
          !isPrivateGalleryProofFilename(image.filename) ||
          !isPrivateGalleryProofMediaId(image.mediaId) ||
          snapshotMediaIds.has(image.mediaId)
        ) fail("malformed-record");
        snapshotMediaIds.add(image.mediaId);
        return { reference: image.reference, filename: image.filename };
      });
      const expected = summarizePrivateGalleryProofSelection(pricing, selectedImages.length);
      if (
        confirmation.summary.includedCount !== expected.includedCount ||
        confirmation.summary.extraUnitPriceMinor !== expected.extraUnitPriceMinor ||
        confirmation.summary.currency !== expected.currency ||
        confirmation.summary.selectedCount !== expected.selectedCount ||
        confirmation.summary.extraCount !== expected.extraCount ||
        confirmation.summary.extraTotalMinor !== expected.extraTotalMinor
      ) fail("malformed-record");
      summary = expected;
      confirmationVersion = confirmation.version;
      confirmedAt = confirmation.confirmedAt.toISOString();
    } else {
      if (currentConfirmation !== undefined) fail("malformed-record");
      selectedImages = references.map((reference) => ({
        reference,
        filename: byReference.get(reference)!.filename,
      }));
      summary = summarizePrivateGalleryProofSelection(pricing, selectedImages.length);
    }

    const totalCount = safeItems.length;
    const pageCount = Math.max(1, Math.ceil(totalCount / PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE));
    if (pageIndex >= pageCount) fail("invalid-page");
    const start = pageIndex * PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE;
    const items = safeItems
      .slice(start, start + PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE)
      .map((item) => ({ ...item, selected: selectedSet.has(item.reference) }));
    return {
      revision: draft.revision,
      confirmed: draft.confirmed,
      ...(confirmationVersion === undefined ? {} : { confirmationVersion, confirmedAt }),
      items,
      selectedImages,
      summary,
      pageIndex,
      totalCount,
      hasNextPage: start + items.length < totalCount,
    };
  } catch (error) {
    if (error instanceof PrivateGalleryProofViewError) throw error;
    fail("malformed-record");
  }
}
