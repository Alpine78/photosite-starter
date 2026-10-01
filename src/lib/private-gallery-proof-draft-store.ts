/**
 * Administrator-owned, pre-publication proof setup (AB#130).
 * No draft has a capability, session, placement or customer-visible route.
 * A production adapter must persist these records with unique gallery IDs and
 * handles; this reference implementation is development-only and process-local.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { generateGalleryHandle } from "@/lib/private-gallery-capability";
import type { PrivateGallery } from "@/lib/private-gallery";
import {
  isPrivateGalleryProofBusinessReference,
  validatePrivateGalleryProofPricing,
  type PrivateGalleryProofPricing,
} from "@/lib/private-gallery-proof";

export const PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT = 100;

export type PrivateGalleryProofDraftSetup = {
  readonly gallery: PrivateGallery;
  /** Editable candidate; only the later ready transaction freezes it. */
  readonly pricing: PrivateGalleryProofPricing;
  /** Optional external identifiers until AB#28 supplies customer/job records. */
  readonly customerReference?: string;
  readonly jobReference?: string;
};

export type PrivateGalleryProofDraftSetupInput = {
  readonly pricing: PrivateGalleryProofPricing;
  readonly customerReference?: string;
  readonly jobReference?: string;
};

export type PrivateGalleryProofDraftList = {
  readonly items: readonly PrivateGalleryProofDraftSetup[];
  readonly hasMore: boolean;
};

export type PrivateGalleryProofDraftStore = {
  create(
    input: PrivateGalleryProofDraftSetupInput,
    now: Date,
  ): Promise<PrivateGalleryProofDraftSetup>;
  list(limit: number): Promise<PrivateGalleryProofDraftList>;
};

export type PrivateGalleryProofDraftStoreErrorReason =
  | "invalid-input"
  | "invalid-time"
  | "invalid-limit"
  | "identity-collision";

export class PrivateGalleryProofDraftStoreError extends Error {
  constructor(readonly reason: PrivateGalleryProofDraftStoreErrorReason) {
    // The input, its external references and the generated handle stay out of errors.
    super("[private-gallery-proof-draft-store] " + reason);
    this.name = "PrivateGalleryProofDraftStoreError";
  }
}

function fail(reason: PrivateGalleryProofDraftStoreErrorReason): never {
  throw new PrivateGalleryProofDraftStoreError(reason);
}

function validatedInput(input: PrivateGalleryProofDraftSetupInput): PrivateGalleryProofDraftSetupInput {
  if (typeof input !== "object" || input === null) fail("invalid-input");
  let pricing: PrivateGalleryProofPricing;
  try {
    pricing = validatePrivateGalleryProofPricing(input.pricing);
  } catch {
    fail("invalid-input");
  }
  if (
    (input.customerReference !== undefined &&
      !isPrivateGalleryProofBusinessReference(input.customerReference)) ||
    (input.jobReference !== undefined &&
      !isPrivateGalleryProofBusinessReference(input.jobReference))
  ) fail("invalid-input");
  return {
    pricing,
    ...(input.customerReference === undefined
      ? {} : { customerReference: input.customerReference }),
    ...(input.jobReference === undefined
      ? {} : { jobReference: input.jobReference }),
  };
}

/** One-process reference with atomic synchronous mutations inside async methods. */
export function createPrivateGalleryProofDraftMemoryStore(): PrivateGalleryProofDraftStore {
  const byId = new Map<string, PrivateGalleryProofDraftSetup>();
  const handles = new Set<string>();

  return {
    async create(input, now) {
      // Validate before generating an identity or changing state.
      const validated = validatedInput(input);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("invalid-time");
      const galleryId = randomUUID();
      const galleryHandle = generateGalleryHandle();
      if (byId.has(galleryId) || handles.has(galleryHandle)) fail("identity-collision");
      const row: PrivateGalleryProofDraftSetup = {
        gallery: {
          galleryId,
          galleryHandle,
          kind: "proof",
          state: "draft",
          capabilityGeneration: 0,
          createdAt: new Date(now),
        },
        ...validated,
      };
      byId.set(galleryId, row);
      handles.add(galleryHandle);
      return structuredClone(row);
    },
    async list(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 ||
          limit > PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT) fail("invalid-limit");
      const rows = [...byId.values()].sort((left, right) =>
        right.gallery.createdAt.getTime() - left.gallery.createdAt.getTime() ||
        (left.gallery.galleryId < right.gallery.galleryId ? -1 : left.gallery.galleryId > right.gallery.galleryId ? 1 : 0));
      return {
        items: structuredClone(rows.slice(0, limit)),
        hasMore: rows.length > limit,
      };
    },
  };
}
