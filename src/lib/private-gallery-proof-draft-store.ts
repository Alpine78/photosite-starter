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
import {
  openPrivateGalleryUploadPreparation,
  type PrivateGalleryManifestEntry,
  type PrivateGalleryUploadPlan,
} from "@/lib/private-gallery-upload";

export const PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT = 100;

export type PrivateGalleryProofDraftSetup = {
  readonly gallery: PrivateGallery;
  /** Editable candidate; only the later ready transaction freezes it. */
  readonly pricing: PrivateGalleryProofPricing;
  /** Optimistic version for prepublication administrator edits. */
  readonly revision: number;
  /** Complete first upload plan, committed with draft -> preparing. Server-only. */
  readonly preparation?: PrivateGalleryUploadPlan;
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
  updatePricing(input: {
    readonly handle: string;
    readonly expectedRevision: number;
    readonly pricing: PrivateGalleryProofPricing;
  }): Promise<PrivateGalleryProofDraftSetup>;
  openFirstPreparation(input: {
    readonly handle: string;
    readonly expectedRevision: number;
    readonly keyPrefix: string;
    readonly manifest: readonly PrivateGalleryManifestEntry[];
    readonly now: Date;
  }): Promise<PrivateGalleryUploadPlan>;
};

export type PrivateGalleryProofDraftStoreErrorReason =
  | "invalid-input"
  | "invalid-time"
  | "invalid-limit"
  | "identity-collision"
  | "not-found"
  | "conflict";

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
  const byHandle = new Map<string, string>();

  return {
    async create(input, now) {
      // Validate before generating an identity or changing state.
      const validated = validatedInput(input);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("invalid-time");
      const galleryId = randomUUID();
      const galleryHandle = generateGalleryHandle();
      if (byId.has(galleryId) || byHandle.has(galleryHandle)) fail("identity-collision");
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
        revision: 0,
      };
      byId.set(galleryId, row);
      byHandle.set(galleryHandle, galleryId);
      return structuredClone(row);
    },
    async updatePricing(input) {
      if (typeof input !== "object" || input === null ||
          typeof input.handle !== "string" || input.handle.length === 0 ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        fail("invalid-input");
      }
      let pricing: PrivateGalleryProofPricing;
      try {
        pricing = validatePrivateGalleryProofPricing(input.pricing);
      } catch {
        fail("invalid-input");
      }
      // No await between lookup, revision check and replacement: one process
      // cannot interleave two updates inside this critical section.
      const galleryId = byHandle.get(input.handle);
      if (galleryId === undefined) fail("not-found");
      const current = byId.get(galleryId);
      if (current === undefined) fail("not-found");
      // Pricing stays a candidate until ready freezes the current row value.
      // The upload plan contains no pricing.
      if ((current.gallery.state !== "draft" && current.gallery.state !== "preparing") ||
          current.revision !== input.expectedRevision ||
          current.revision === Number.MAX_SAFE_INTEGER) fail("conflict");
      const updated = { ...current, pricing, revision: current.revision + 1 };
      byId.set(galleryId, updated);
      return structuredClone(updated);
    },
    async openFirstPreparation(input) {
      if (typeof input !== "object" || input === null ||
          typeof input.handle !== "string" || input.handle.length === 0 ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        fail("invalid-input");
      }
      const galleryId = byHandle.get(input.handle);
      if (galleryId === undefined) fail("not-found");
      const current = byId.get(galleryId);
      if (current === undefined) fail("not-found");
      if (current.gallery.state !== "draft" || current.preparation !== undefined ||
          current.revision !== input.expectedRevision ||
          current.revision === Number.MAX_SAFE_INTEGER) fail("conflict");

      // Validate the whole manifest before mutation. No await may occur between
      // lookup, plan creation and replacement in this one-process store.
      // The production adapter needs a transaction and compare-and-swap.
      let plan: PrivateGalleryUploadPlan;
      try {
        plan = openPrivateGalleryUploadPreparation({
          galleryId,
          galleryKind: "proof",
          state: current.gallery.state,
          keyPrefix: input.keyPrefix,
          preparationId: randomUUID(),
          manifest: input.manifest,
          now: input.now,
        });
      } catch {
        fail("invalid-input");
      }
      byId.set(galleryId, {
        ...current,
        gallery: { ...current.gallery, state: "preparing" },
        preparation: plan,
        revision: current.revision + 1,
      });
      return structuredClone(plan);
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
