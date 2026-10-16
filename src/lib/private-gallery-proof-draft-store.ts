/**
 * Administrator-owned, pre-publication proof setup (AB#130).
 * No draft has a capability, session, placement or customer-visible route.
 * A production adapter must persist these records with unique gallery IDs and
 * handles; this reference implementation is development-only and process-local.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { generateGalleryHandle } from "@/lib/private-gallery-capability";
import type { PrivateGallery, PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import {
  isPrivateGalleryProofBusinessReference,
  validatePrivateGalleryProofPricing,
  type PrivateGalleryProofPricing,
} from "@/lib/private-gallery-proof";
import {
  openPrivateGalleryUploadPreparation,
  isPrivateGalleryPreparationExpired,
  type PrivateGalleryManifestEntry,
  type PrivateGalleryUploadPlan,
} from "@/lib/private-gallery-upload";
import { buildVerifiedFirstProofPlacements } from "@/lib/private-gallery-proof-upload";
import { planPrivateGalleryFirstProofReady } from "@/lib/private-gallery-readiness";
import {
  verifyPrivateGalleryUpload,
  type PrivateGalleryObjectObservation,
  type PrivateGalleryUploadReceipt,
  type PrivateGalleryVerifiedObject,
  type PrivateGalleryVerificationFailure,
} from "@/lib/private-gallery-upload-completion";
import { snapshotPrivateGalleryUploadCompletionEvidence } from "@/lib/private-gallery-upload-evidence";

export const PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT = 100;
/** Per-store development memory guard; reset/restart releases these rows. */
export const PRIVATE_GALLERY_PROOF_DRAFT_CAPACITY = 1000;

/** Server-only records committed together on the first ready transition. */
export type PrivateGalleryProofDraftReadyData = {
  readonly pricingSnapshot: PrivateGalleryProofPricing;
  readonly placements: readonly PrivateGalleryProofPlacement[];
  readonly lastAssignedOrdinal: number;
  readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
};

export type PrivateGalleryProofDraftSetup = {
  readonly gallery: PrivateGallery;
  /** Editable candidate; only the later ready transaction freezes it. */
  readonly pricing: PrivateGalleryProofPricing;
  /** Optimistic version for prepublication administrator edits. */
  readonly revision: number;
  /** Complete first upload plan, committed with draft -> preparing. Server-only. */
  readonly preparation?: PrivateGalleryUploadPlan;
  /** Exact deployment prefix used when the stored preparation was opened. */
  readonly preparationKeyPrefix?: string;
  readonly readyProof?: PrivateGalleryProofDraftReadyData;
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

export type PrivateGalleryProofDraftCompletionInput = {
  readonly handle: string;
  readonly expectedRevision: number;
  readonly preparationId: string;
  readonly receipts: readonly PrivateGalleryUploadReceipt[];
  /** Server-side metadata reads, never browser assertions or upload receipts. */
  readonly observations: readonly PrivateGalleryObjectObservation[];
  readonly now: Date;
};

export type PrivateGalleryProofDraftCompletion =
  | { readonly ready: true; readonly setup: PrivateGalleryProofDraftSetup }
  | {
      readonly ready: false;
      /** Internal status only; object keys must not enter an HTTP response. */
      readonly failures: readonly PrivateGalleryVerificationFailure[];
      readonly truncated: boolean;
    };

export type PrivateGalleryProofDraftStore = {
  create(
    input: PrivateGalleryProofDraftSetupInput,
    now: Date,
  ): Promise<PrivateGalleryProofDraftSetup>;
  list(limit: number): Promise<PrivateGalleryProofDraftList>;
  /** Atomic revision CAS; replace both references. Ready data is frozen. */
  updateReferences(input: {
    readonly handle: string; readonly expectedRevision: number;
    readonly references: { readonly customerReference?: string; readonly jobReference?: string };
  }): Promise<PrivateGalleryProofDraftSetup>;
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
  /**
   * Verify the stored first plan and atomically freeze pricing/references with
   * preparing -> ready. Replays conflict; they never renumber or refreeze.
   * A production adapter must obtain observations from its object adapter,
   * then compare-and-swap the expected revision in its database transaction.
   */
  completeFirstPreparation(
    input: PrivateGalleryProofDraftCompletionInput,
  ): Promise<PrivateGalleryProofDraftCompletion>;
};

export type PrivateGalleryProofDraftStoreErrorReason =
  | "invalid-input"
  | "invalid-time"
  | "invalid-limit"
  | "identity-collision"
  | "capacity"
  | "preparation-expired"
  | "readiness-failed"
  | "not-found"
  | "conflict";

// The memory store survives across independently loaded Next.js route bundles.
// Its method closures can throw another bundle's copy of this error class.
const PROOF_DRAFT_ERROR = Symbol.for("photosite-starter.private-gallery.proof-draft-error.v1");

export class PrivateGalleryProofDraftStoreError extends Error {
  constructor(readonly reason: PrivateGalleryProofDraftStoreErrorReason) {
    // The input, its external references and the generated handle stay out of errors.
    super("[private-gallery-proof-draft-store] " + reason);
    this.name = "PrivateGalleryProofDraftStoreError";
    Object.defineProperty(this, PROOF_DRAFT_ERROR, { value: true });
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Error && value.name === "PrivateGalleryProofDraftStoreError" &&
      Object.getOwnPropertyDescriptor(value, PROOF_DRAFT_ERROR)?.value === true;
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
      // The bound and insertion share this synchronous critical section.
      if (byId.size >= PRIVATE_GALLERY_PROOF_DRAFT_CAPACITY) fail("capacity");
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
    async updateReferences(input) {
      if (!input || typeof input !== "object" || Array.isArray(input) ||
          Object.keys(input).sort().join(",") !== "expectedRevision,handle,references" ||
          typeof input.handle !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(input.handle) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail("invalid-input");
      const refs = input.references;
      if (!refs || typeof refs !== "object" || Array.isArray(refs) ||
          Object.keys(refs).some((key) => !["customerReference", "jobReference"].includes(key)) ||
          (refs.customerReference !== undefined && !isPrivateGalleryProofBusinessReference(refs.customerReference)) ||
          (refs.jobReference !== undefined && !isPrivateGalleryProofBusinessReference(refs.jobReference))) fail("invalid-input");
      // Snapshot validated scalars before the synchronous conditional mutation.
      const references = {
        ...(refs.customerReference === undefined ? {} : { customerReference: refs.customerReference }),
        ...(refs.jobReference === undefined ? {} : { jobReference: refs.jobReference }),
      };
      const id = byHandle.get(input.handle);
      const current = id === undefined ? undefined : byId.get(id);
      if (!current) fail("not-found");
      if ((current.gallery.state !== "draft" && current.gallery.state !== "preparing") ||
          current.revision !== input.expectedRevision || current.revision === Number.MAX_SAFE_INTEGER) fail("conflict");
      const updated = { ...current, customerReference: undefined, jobReference: undefined,
        ...references, revision: current.revision + 1 };
      // Omission clears stored fields, not only the HTTP projection.
      if (updated.customerReference === undefined) delete updated.customerReference;
      if (updated.jobReference === undefined) delete updated.jobReference;
      byId.set(current.gallery.galleryId, updated);
      return structuredClone(updated);
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
      const keyPrefix = input.keyPrefix;
      try {
        plan = openPrivateGalleryUploadPreparation({
          galleryId,
          galleryKind: "proof",
          state: current.gallery.state,
          keyPrefix,
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
        preparationKeyPrefix: keyPrefix,
        revision: current.revision + 1,
      });
      return structuredClone(plan);
    },
    async completeFirstPreparation(input) {
      if (typeof input !== "object" || input === null) fail("invalid-input");
      const { handle, expectedRevision, preparationId, now } = input;
      if (typeof handle !== "string" || handle.length === 0 ||
          !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
          typeof preparationId !== "string" || preparationId.length === 0) fail("invalid-input");
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("invalid-time");
      const completionTime = new Date(now);
      const galleryId = byHandle.get(handle);
      if (galleryId === undefined) fail("not-found");
      const current = byId.get(galleryId);
      if (current === undefined) fail("not-found");
      const plan = current.preparation;
      if (current.gallery.kind !== "proof" || current.gallery.state !== "preparing" ||
          current.readyProof !== undefined || current.revision !== expectedRevision ||
          current.revision === Number.MAX_SAFE_INTEGER || plan === undefined ||
          plan.preparation.preparationId !== preparationId) fail("conflict");
      if (plan.galleryKind !== "proof" || plan.preparation.galleryId !== galleryId ||
          current.preparationKeyPrefix === undefined) fail("readiness-failed");
      if (completionTime.getTime() < plan.preparation.openedAt.getTime()) fail("invalid-time");
      if (isPrivateGalleryPreparationExpired(plan.preparation, completionTime)) {
        fail("preparation-expired");
      }

      // No await from lookup through replacement: pricing and preparation cannot
      // change between verification and their single revision-guarded commit.
      let evidence;
      try { evidence = snapshotPrivateGalleryUploadCompletionEvidence(input, plan); }
      catch { fail("invalid-input"); }
      let completion;
      try {
        completion = verifyPrivateGalleryUpload({
          preparation: plan.preparation,
          expected: plan.objects,
          ...evidence,
          keyPrefix: current.preparationKeyPrefix,
          now: completionTime,
        });
      } catch {
        fail("invalid-input");
      }
      if (!completion.verified) {
        return { ready: false, failures: completion.failures, truncated: completion.truncated };
      }
      let placements: readonly PrivateGalleryProofPlacement[];
      try {
        placements = buildVerifiedFirstProofPlacements(plan, completion);
      } catch {
        fail("readiness-failed");
      }
      const ready = planPrivateGalleryFirstProofReady({
        gallery: current.gallery, placements, pricing: current.pricing,
        verifiedObjects: completion.objects,
      });
      if (!ready.ready) fail("readiness-failed");
      const updated: PrivateGalleryProofDraftSetup = {
        ...current,
        gallery: { ...current.gallery, state: "ready" },
        revision: current.revision + 1,
        readyProof: {
          pricingSnapshot: ready.pricingSnapshot,
          placements: ready.placements,
          lastAssignedOrdinal: ready.lastAssignedOrdinal,
          verifiedObjects: completion.objects,
        },
      };
      // Retain CAS even if an in-process adapter supplied a reentrant getter
      // while its metadata was copied. No intervening revision may be lost.
      if (byId.get(galleryId) !== current) fail("conflict");
      byId.set(galleryId, updated);
      return { ready: true, setup: structuredClone(updated) };
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
