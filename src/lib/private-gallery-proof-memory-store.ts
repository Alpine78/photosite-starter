/** Development-only, single-process reference implementation of the AB#130 store seam. */
import "server-only";

import { randomUUID } from "node:crypto";

import type { PrivateGallery, PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import {
  confirmPrivateGalleryProofSelection,
  editPrivateGalleryProofDraft,
  planPrivateGalleryProofResend,
  PrivateGalleryProofError,
  reopenPrivateGalleryProofSelection,
  validatePrivateGalleryProofPricing,
  type PrivateGalleryProofConfirmation,
  type PrivateGalleryProofDraft,
  type PrivateGalleryProofPricing,
} from "@/lib/private-gallery-proof";
import {
  isValidGalleryNotificationIdempotencyKey,
  validateGalleryNotificationRequest,
} from "@/lib/gallery-notification";
import { buildPrivateGalleryProofNotification } from "@/lib/private-gallery-proof-notification";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";
import type {
  PrivateGalleryProofOutboxDelivery,
  PrivateGalleryProofOutboxRecord,
  PrivateGalleryProofStore,
} from "@/lib/private-gallery-proof-store";

export type PrivateGalleryProofStoreErrorReason =
  | "invalid-seed"
  | "gallery-unavailable"
  | "access-expired"
  | "invalid-time"
  | "invalid-attempt-key"
  | "duplicate-attempt"
  | "unknown-confirmation"
  | "draft-open"
  | "missing-notification";

export class PrivateGalleryProofStoreError extends Error {
  readonly reason: PrivateGalleryProofStoreErrorReason;

  constructor(reason: PrivateGalleryProofStoreErrorReason) {
    // Neither a reference nor a filename/customer/selection may enter errors.
    super("[private-gallery-proof-store] " + reason);
    this.name = "PrivateGalleryProofStoreError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryProofStoreErrorReason): never {
  throw new PrivateGalleryProofStoreError(reason);
}

function validTime(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * One gallery's development state. All planning and writes in each async method
 * run without an await, so two requests in this process cannot interleave them.
 * This gives tests CAS behavior, not cross-process durability or SQL uniqueness.
 * Production must use the ADR-0014 PostgreSQL transaction/constraint boundary.
 */
export function createPrivateGalleryProofMemoryStore(seed: {
  readonly gallery: PrivateGallery;
  readonly pricingSnapshot: PrivateGalleryProofPricing;
  readonly placements: readonly PrivateGalleryProofPlacement[];
}): PrivateGalleryProofStore {
  if (
    seed.gallery.kind !== "proof" ||
    seed.gallery.state !== "published" ||
    !validTime(seed.gallery.accessExpiresAt) ||
    !Array.isArray(seed.placements) ||
    seed.placements.length === 0 ||
    seed.placements.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY
  ) fail("invalid-seed");

  let pricingSnapshot: PrivateGalleryProofPricing;
  try {
    pricingSnapshot = validatePrivateGalleryProofPricing(seed.pricingSnapshot);
    // The planner checks placement identity, scope and duplicate references.
    // Published references must also use the canonical wire form.
    if (seed.placements.some((item) =>
      typeof item.reference !== "string" ||
      !/^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/.test(item.reference)
    )) fail("invalid-seed");
    editPrivateGalleryProofDraft({
      galleryId: seed.gallery.galleryId,
      draft: {
        galleryId: seed.gallery.galleryId,
        revision: 0,
        selectedReferences: [],
        confirmed: false,
      },
      expectedRevision: 0,
      selectedReferences: [],
      placements: seed.placements,
    });
  } catch {
    fail("invalid-seed");
  }

  const gallery = clone(seed.gallery);
  const placements = clone(seed.placements);
  pricingSnapshot = clone(pricingSnapshot);
  let draft: PrivateGalleryProofDraft = {
    galleryId: gallery.galleryId,
    revision: 0,
    selectedReferences: [],
    confirmed: false,
  };
  const confirmations = new Map<number, PrivateGalleryProofConfirmation>();
  const outbox = new Map<string, PrivateGalleryProofOutboxDelivery>();

  function requireGallery(galleryId: string): void {
    if (galleryId !== gallery.galleryId || gallery.state !== "published") {
      fail("gallery-unavailable");
    }
  }

  function requireAccess(galleryId: string, now: Date): void {
    requireGallery(galleryId);
    if (!validTime(now)) fail("invalid-time");
    if (now.getTime() >= gallery.accessExpiresAt!.getTime()) fail("access-expired");
  }

  function pending(
    idempotencyKey: string,
    confirmationVersion: number,
    now: Date,
  ): PrivateGalleryProofOutboxRecord {
    if (!isValidGalleryNotificationIdempotencyKey(idempotencyKey)) {
      fail("invalid-attempt-key");
    }
    if (outbox.has(idempotencyKey)) fail("duplicate-attempt");
    return {
      galleryId: gallery.galleryId,
      outboxId: randomUUID(),
      kind: "proof-confirmation",
      confirmationVersion,
      idempotencyKey,
      state: "pending",
      attempts: 0,
      createdAt: new Date(now),
    };
  }

  return {
    async read(galleryId) {
      if (galleryId !== gallery.galleryId) return undefined;
      return clone({
        gallery,
        pricingSnapshot,
        placements,
        draft,
        latestConfirmationVersion: confirmations.size,
      });
    },
    async readConfirmation(galleryId, version) {
      if (galleryId !== gallery.galleryId) return undefined;
      const confirmation = confirmations.get(version);
      return confirmation === undefined ? undefined : clone(confirmation);
    },
    async readOutbox(galleryId, idempotencyKey) {
      if (galleryId !== gallery.galleryId) return undefined;
      const delivery = outbox.get(idempotencyKey);
      return delivery === undefined ? undefined : clone(delivery.outbox);
    },
    async readDelivery(galleryId, idempotencyKey) {
      if (galleryId !== gallery.galleryId) return undefined;
      const delivery = outbox.get(idempotencyKey);
      return delivery === undefined ? undefined : clone(delivery);
    },
    async editDraft({ galleryId, expectedRevision, selectedReferences, now }) {
      requireAccess(galleryId, now);
      const next = editPrivateGalleryProofDraft({
        galleryId,
        draft,
        expectedRevision,
        selectedReferences,
        placements,
      });
      draft = clone(next);
      return clone(draft);
    },
    async confirm({ galleryId, expectedRevision, now, notification }) {
      requireAccess(galleryId, now);
      const next = confirmPrivateGalleryProofSelection({
        galleryId,
        draft,
        expectedRevision,
        previousVersion: confirmations.size,
        pricing: pricingSnapshot,
        placements,
        now,
      });
      const row = pending(next.outboxIdempotencyKey, next.confirmation.version, now);
      if (confirmations.has(next.confirmation.version)) fail("duplicate-attempt");
      const request = buildPrivateGalleryProofNotification({
        ...notification,
        confirmation: next.confirmation,
        outboxIdempotencyKey: row.idempotencyKey,
      });
      validateGalleryNotificationRequest(request);
      const storedDraft = clone(next.draft);
      const storedConfirmation = clone(next.confirmation);
      const delivery = clone({ outbox: row, request });
      // Commit point: all validation and copies completed before the first write.
      // The outbox row and its exact message live in one map entry.
      draft = storedDraft;
      confirmations.set(next.confirmation.version, storedConfirmation);
      outbox.set(row.idempotencyKey, delivery);
      return clone({ draft, confirmation: next.confirmation, outbox: row });
    },
    async reopen({ galleryId, expectedRevision, now }) {
      requireAccess(galleryId, now);
      if (expectedRevision !== draft.revision) {
        throw new PrivateGalleryProofError("stale-revision");
      }
      const next = reopenPrivateGalleryProofSelection({
        draft,
        accessExpiresAt: gallery.accessExpiresAt!,
      });
      // Reopening changes only the draft. The publication expiry and all prior
      // confirmation/outbox rows are immutable.
      draft = clone(next.draft);
      return clone(draft);
    },
    async queueResend({ galleryId, confirmationVersion, attemptId, now }) {
      requireGallery(galleryId);
      if (!validTime(now)) fail("invalid-time");
      if (!draft.confirmed) fail("draft-open");
      if (confirmationVersion !== confirmations.size) fail("unknown-confirmation");
      const confirmation = confirmations.get(confirmationVersion);
      if (confirmation === undefined) fail("unknown-confirmation");
      const plan = planPrivateGalleryProofResend({ confirmation, attemptId });
      const initial = outbox.get(
        "proof-confirmation:" + galleryId + ":" + confirmationVersion,
      );
      if (initial === undefined) fail("missing-notification");
      const row = pending(plan.outboxIdempotencyKey, confirmationVersion, now);
      const request = { ...initial.request, idempotencyKey: row.idempotencyKey };
      const delivery = clone({ outbox: row, request });
      outbox.set(row.idempotencyKey, delivery);
      return clone(row);
    },
  };
}
