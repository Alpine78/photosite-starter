/**
 * Private-gallery readiness from verified object-store evidence (ADR-0014 §8c).
 *
 * A proof's first ready transition is a transaction plan. The future private
 * store must write its pricing snapshot, permanent references, high-water mark
 * and ready state atomically. The first-publication plan below checks the
 * persisted ready state and preparation deadline before customer access can be
 * granted. Neither plan writes objects or sends mail.
 */

import "server-only";

import type {
  PrivateGallery,
  PrivateGalleryProofPlacement,
  PrivateGalleryUploadPreparation,
} from "@/lib/private-gallery";
import { projectPrivateGalleryItem } from "@/lib/private-gallery-item";
import {
  assignInitialProofReferences,
  validatePrivateGalleryProofPricing,
  type PrivateGalleryProofPricing,
} from "@/lib/private-gallery-proof";
import type { PrivateGalleryVerifiedObject } from "@/lib/private-gallery-upload-completion";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";
import {
  computePrivateGalleryAccessExpiry,
  PRIVATE_GALLERY_MAX_PREPARATION_DAYS,
} from "@/lib/private-gallery-retention";

export type PrivateGalleryReadinessBlocker =
  | "no-derivatives"
  | "no-verified-zip"
  | "zip-pointer-unverified"
  | "wrong-state"
  | "proof-data-missing"
  | "proof-pricing-invalid"
  | "proof-placements-invalid"
  | "proof-objects-mismatch";

export type PrivateGalleryReadiness =
  | { readonly ready: true }
  | { readonly ready: false; readonly blockers: readonly PrivateGalleryReadinessBlocker[] };

export type PrivateGalleryProofReadinessData = {
  /** Persisted snapshot, or the candidate saved with the ready transition. */
  readonly pricingSnapshot: PrivateGalleryProofPricing;
  /** The complete, closed set of this gallery's initial proof placements. */
  readonly placements: readonly PrivateGalleryProofPlacement[];
};

function proofPlacementsValid(
  galleryId: string,
  placements: readonly PrivateGalleryProofPlacement[],
): boolean {
  if (
    !Array.isArray(placements) ||
    placements.length === 0 ||
    placements.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY
  ) return false;

  const placementIds = new Set<string>();
  const mediaIds = new Set<string>();
  const objectKeys = new Set<string>();
  const references = new Set<string>();

  for (const item of placements) {
    if (
      item.galleryId !== galleryId ||
      item.derivativeKind !== "watermarked-proof" ||
      typeof item.filename !== "string" ||
      item.filename.length === 0 ||
      typeof item.mediaId !== "string" ||
      item.mediaId.length === 0 ||
      typeof item.placementId !== "string" ||
      item.placementId.length === 0 ||
      typeof item.objectKey !== "string" ||
      item.objectKey.length === 0 ||
      typeof item.reference !== "string" ||
      !/^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/.test(item.reference) ||
      placementIds.has(item.placementId) ||
      mediaIds.has(item.mediaId) ||
      objectKeys.has(item.objectKey) ||
      references.has(item.reference)
    ) return false;

    try {
      // The browser projection checks true dimensions and web-derivative limits.
      projectPrivateGalleryItem(item);
    } catch {
      return false;
    }

    placementIds.add(item.placementId);
    mediaIds.add(item.mediaId);
    objectKeys.add(item.objectKey);
    references.add(item.reference);
  }

  // Reuse the one initial-reference algorithm, so a future comparator change
  // cannot make assignment and validation disagree.
  try {
    const expected = assignInitialProofReferences(
      placements.map((item) => ({ ...item, reference: undefined })),
    );
    return expected.every(
      (item, index) => item.reference === placements[index].reference,
    );
  } catch {
    return false;
  }
}

function proofObjectsMatch(
  placements: readonly PrivateGalleryProofPlacement[],
  verifiedObjects: readonly PrivateGalleryVerifiedObject[],
): boolean {
  if (placements.length !== verifiedObjects.length) return false;
  const byKey = new Map<string, PrivateGalleryVerifiedObject>();
  for (const object of verifiedObjects) {
    if (object.objectKind !== "proof" || byKey.has(object.objectKey)) return false;
    byKey.set(object.objectKey, object);
  }
  return placements.every((item) => {
    const object = byKey.get(item.objectKey);
    return (
      object !== undefined &&
      object.objectKind === "proof" &&
      object.sizeBytes === item.nominalBytes
    );
  });
}

/**
 * Evaluate persisted-shaped state. Blockers contain no object key, filename,
 * count, customer identity or price and are intended for the administrator.
 * Customer authorization still depends solely on the published state.
 */
export function evaluatePrivateGalleryReadiness(params: {
  readonly gallery: PrivateGallery;
  readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
  readonly proof?: PrivateGalleryProofReadinessData;
}): PrivateGalleryReadiness {
  const { gallery, verifiedObjects, proof } = params;
  const blockers: PrivateGalleryReadinessBlocker[] = [];

  if (gallery.state !== "preparing" && gallery.state !== "ready") {
    blockers.push("wrong-state");
  }

  const derivativeKind = gallery.kind === "proof" ? "proof" : "preview";
  const hasDerivative = verifiedObjects.some(
    (object) => object.objectKind === derivativeKind,
  );
  if (!hasDerivative) blockers.push("no-derivatives");

  if (gallery.kind === "proof") {
    if (proof === undefined) {
      blockers.push("proof-data-missing");
    } else {
      try {
        validatePrivateGalleryProofPricing(proof.pricingSnapshot);
      } catch {
        blockers.push("proof-pricing-invalid");
      }
      if (!proofPlacementsValid(gallery.galleryId, proof.placements)) {
        blockers.push("proof-placements-invalid");
      }
      if (!proofObjectsMatch(proof.placements, verifiedObjects)) {
        blockers.push("proof-objects-mismatch");
      }
    }
    return blockers.length === 0
      ? { ready: true }
      : { ready: false, blockers };
  }

  const verifiedZip = verifiedObjects.find(
    (object) => object.objectKind === "zip",
  );
  if (verifiedZip === undefined) {
    blockers.push("no-verified-zip");
  } else if (gallery.activeZipObjectKey !== verifiedZip.objectKey) {
    blockers.push("zip-pointer-unverified");
  }

  return blockers.length === 0
    ? { ready: true }
    : { ready: false, blockers };
}

export type PrivateGalleryFirstProofReadyPlan =
  | {
      readonly ready: true;
      readonly galleryId: string;
      readonly nextState: "ready";
      readonly pricingSnapshot: PrivateGalleryProofPricing;
      readonly placements: readonly PrivateGalleryProofPlacement[];
      /** Must be persisted even if a later proof is removed. */
      readonly lastAssignedOrdinal: number;
    }
  | { readonly ready: false; readonly blockers: readonly PrivateGalleryReadinessBlocker[] };

/**
 * Plan the first ready transition from the complete proof set. A second call
 * after that transition refuses instead of recomputing permanent references.
 * One failing or missing object prevents every assignment from being persisted.
 */
export function planPrivateGalleryFirstProofReady(params: {
  readonly gallery: PrivateGallery;
  readonly placements: readonly PrivateGalleryProofPlacement[];
  readonly pricing: PrivateGalleryProofPricing;
  readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
}): PrivateGalleryFirstProofReadyPlan {
  const { gallery, placements, pricing, verifiedObjects } = params;
  if (
    gallery.kind !== "proof" ||
    gallery.state !== "preparing" ||
    gallery.publishedAt !== undefined
  ) return { ready: false, blockers: ["wrong-state"] };

  let assigned: readonly PrivateGalleryProofPlacement[];
  try {
    assigned = assignInitialProofReferences(placements);
  } catch {
    return { ready: false, blockers: ["proof-placements-invalid"] };
  }

  let pricingSnapshot: PrivateGalleryProofPricing;
  try {
    pricingSnapshot = validatePrivateGalleryProofPricing(pricing);
  } catch {
    return { ready: false, blockers: ["proof-pricing-invalid"] };
  }

  const readiness = evaluatePrivateGalleryReadiness({
    gallery,
    verifiedObjects,
    proof: { pricingSnapshot, placements: assigned },
  });
  if (!readiness.ready) return readiness;
  return {
    ready: true,
    galleryId: gallery.galleryId,
    nextState: "ready",
    pricingSnapshot,
    placements: assigned,
    lastAssignedOrdinal: assigned.length,
  };
}

export type PrivateGalleryFirstProofPublicationBlocker =
  | PrivateGalleryReadinessBlocker
  | "publication-metadata-present"
  | "invalid-time"
  | "preparation-unavailable"
  | "preparation-expired"
  | "invalid-generation"
  | "zip-pointer-present";

export type PrivateGalleryFirstProofPublicationPlan =
  | {
      readonly publishable: true;
      readonly galleryId: string;
      /** Both expected values belong in the future store's atomic CAS. */
      readonly expectedState: "ready";
      readonly expectedCapabilityGeneration: number;
      readonly nextState: "published";
      readonly publishedAt: Date;
      readonly accessExpiresAt: Date;
    }
  | {
      readonly publishable: false;
      readonly blockers: readonly PrivateGalleryFirstProofPublicationBlocker[];
    };

/**
 * First publication of an already-ready proof gallery (ADR-0014 §5, §7).
 * This only plans the metadata transition. A future PostgreSQL transaction
 * must recheck the expected state/generation, persist these dates once, and
 * persist a sealed capability and its publication notification atomically.
 * Reopening a confirmed selection never changes the gallery's published state.
 * Blockers contain no private row values, filenames or object keys.
 */
export function planPrivateGalleryFirstProofPublication(params: {
  readonly gallery: PrivateGallery;
  readonly proof?: PrivateGalleryProofReadinessData;
  readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
  readonly preparation?: Pick<
    PrivateGalleryUploadPreparation,
    "galleryId" | "openedAt" | "deadline"
  >;
  readonly now: Date;
}): PrivateGalleryFirstProofPublicationPlan {
  const { gallery, proof, verifiedObjects, preparation, now } = params;
  const blockers: PrivateGalleryFirstProofPublicationBlocker[] = [];
  if (gallery.kind !== "proof" || gallery.state !== "ready") {
    blockers.push("wrong-state");
  }
  if (gallery.publishedAt !== undefined || gallery.accessExpiresAt !== undefined) {
    blockers.push("publication-metadata-present");
  }
  if (gallery.activeZipObjectKey !== undefined) blockers.push("zip-pointer-present");
  if (!Number.isSafeInteger(gallery.capabilityGeneration) ||
      gallery.capabilityGeneration < 0) blockers.push("invalid-generation");

  const validDate = (value: unknown): value is Date =>
    value instanceof Date && Number.isFinite(value.getTime());
  if (!validDate(gallery.createdAt) || !validDate(now) ||
      now.getTime() < gallery.createdAt.getTime()) blockers.push("invalid-time");

  if (
    preparation === undefined ||
    preparation.galleryId !== gallery.galleryId ||
    !validDate(preparation.openedAt) ||
    !validDate(preparation.deadline) ||
    !validDate(gallery.createdAt) ||
    preparation.openedAt.getTime() < gallery.createdAt.getTime() ||
    preparation.deadline.getTime() <= preparation.openedAt.getTime() ||
    preparation.deadline.getTime() - preparation.openedAt.getTime() >
      PRIVATE_GALLERY_MAX_PREPARATION_DAYS * 24 * 60 * 60 * 1000
  ) {
    blockers.push("preparation-unavailable");
  } else if (validDate(now) && (
    now.getTime() < preparation.openedAt.getTime() ||
    now.getTime() >= preparation.deadline.getTime()
  )) {
    blockers.push("preparation-expired");
  }

  if (gallery.kind === "proof" && gallery.state === "ready") {
    const readiness = evaluatePrivateGalleryReadiness({ gallery, verifiedObjects, proof });
    if (!readiness.ready) blockers.push(...readiness.blockers);
  }
  if (blockers.length > 0) return { publishable: false, blockers };

  return {
    publishable: true,
    galleryId: gallery.galleryId,
    expectedState: "ready",
    expectedCapabilityGeneration: gallery.capabilityGeneration,
    nextState: "published",
    publishedAt: new Date(now),
    accessExpiresAt: computePrivateGalleryAccessExpiry(now),
  };
}
