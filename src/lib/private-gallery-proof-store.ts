/**
 * Atomic private-store seam for AB#130 selection writes (ADR-0014 §8b, §8d).
 *
 * Callers authorize the customer session or administrator before using it. A
 * PostgreSQL adapter must commit each mutation and its uniqueness checks in a
 * real transaction; the development memory implementation is process-local.
 * Nothing from this contract is a browser response without a separate projection.
 */
import "server-only";

import type { BuiltInLabels } from "@/lib/deployment-config";
import type { GalleryNotificationRequest } from "@/lib/gallery-notification";
import type {
  PrivateGallery,
  PrivateGalleryOutboxRecord,
  PrivateGalleryProofPlacement,
} from "@/lib/private-gallery";
import type {
  PrivateGalleryProofConfirmation,
  PrivateGalleryProofDraft,
  PrivateGalleryProofPricing,
} from "@/lib/private-gallery-proof";

export type PrivateGalleryProofOutboxRecord = Omit<PrivateGalleryOutboxRecord, "kind"> & {
  readonly kind: "proof-confirmation";
  /** The immutable snapshot used to render this attempt's email. */
  readonly confirmationVersion: number;
};

/** Frozen when a confirmation is created, before its outbox entry is committed. */
export type PrivateGalleryProofNotificationContext = {
  readonly recipient: string;
  readonly galleryReference: string;
  readonly customerReference: string;
  readonly locale: string;
  readonly labels: BuiltInLabels["proofConfirmationEmail"];
};

/** Raw worker material; never project this into an administrator status response. */
export type PrivateGalleryProofOutboxDelivery = {
  readonly outbox: PrivateGalleryProofOutboxRecord;
  readonly request: GalleryNotificationRequest;
};

export type PrivateGalleryProofStoredState = {
  readonly gallery: PrivateGallery;
  readonly pricingSnapshot: PrivateGalleryProofPricing;
  readonly placements: readonly PrivateGalleryProofPlacement[];
  readonly draft: PrivateGalleryProofDraft;
  readonly latestConfirmationVersion: number;
};

export type PrivateGalleryProofStore = {
  /** Raw server-only data; read only after a fresh authorization check. */
  read(galleryId: string): Promise<PrivateGalleryProofStoredState | undefined>;
  readConfirmation(
    galleryId: string,
    version: number,
  ): Promise<PrivateGalleryProofConfirmation | undefined>;
  readOutbox(
    galleryId: string,
    idempotencyKey: string,
  ): Promise<PrivateGalleryProofOutboxRecord | undefined>;
  /** Worker-only raw message; no route or authorization is wired to this seam yet. */
  readDelivery(
    galleryId: string,
    idempotencyKey: string,
  ): Promise<PrivateGalleryProofOutboxDelivery | undefined>;
  editDraft(params: {
    readonly galleryId: string;
    readonly expectedRevision: number;
    readonly selectedReferences: readonly string[];
    readonly now: Date;
  }): Promise<PrivateGalleryProofDraft>;
  /** Conditional draft lock + snapshot + unique initial outbox insert. */
  confirm(params: {
    readonly galleryId: string;
    readonly expectedRevision: number;
    readonly now: Date;
    readonly notification: PrivateGalleryProofNotificationContext;
  }): Promise<{
    readonly draft: PrivateGalleryProofDraft;
    readonly confirmation: PrivateGalleryProofConfirmation;
    readonly outbox: PrivateGalleryProofOutboxRecord;
  }>;
  /** Administrator-only at the facade; never extends access expiry. */
  reopen(params: {
    readonly galleryId: string;
    readonly expectedRevision: number;
    readonly now: Date;
  }): Promise<PrivateGalleryProofDraft>;
  /** Administrator-only at the facade; targets the current locked version. */
  queueResend(params: {
    readonly galleryId: string;
    readonly confirmationVersion: number;
    readonly attemptId: string;
    readonly now: Date;
  }): Promise<PrivateGalleryProofOutboxRecord>;
};
