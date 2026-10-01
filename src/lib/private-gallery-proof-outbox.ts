/** One bounded proof-notification attempt against a claimed private outbox row. */
import "server-only";

import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import type { GalleryNotificationTransport } from "@/lib/gallery-notification";
import type {
  PrivateGalleryProofOutboxRecord,
  PrivateGalleryProofStore,
  PrivateGalleryProofDueAttempt,
} from "@/lib/private-gallery-proof-store";
import { PRIVATE_GALLERY_PROOF_OUTBOX_MAX_BATCH_SIZE } from "@/lib/private-gallery-proof-store";

export type PrivateGalleryProofDispatchResult =
  | { readonly kind: "not-claimable" }
  | { readonly kind: "completed"; readonly outbox: PrivateGalleryProofOutboxRecord };

/**
 * The transport gets the frozen request and its original idempotency key on
 * every automatic retry. It may accept an email before its response is lost;
 * the provider's finite idempotency window cannot make that race impossible.
 * No caller should log the request or an arbitrary transport exception.
 */
export async function dispatchPrivateGalleryProofOutboxAttempt(params: {
  readonly store: PrivateGalleryProofStore;
  readonly transport: GalleryNotificationTransport;
  readonly galleryId: string;
  readonly idempotencyKey: string;
  readonly clock: () => Date;
}): Promise<PrivateGalleryProofDispatchResult> {
  const { store, transport, galleryId, idempotencyKey, clock } = params;
  const claim = await store.claimDelivery({ galleryId, idempotencyKey, now: clock() });
  if (claim === undefined) return { kind: "not-claimable" };

  let outcome: ContactDeliveryOutcome;
  try {
    outcome = await transport.deliver(claim.request);
  } catch {
    // Transport exceptions may contain provider bodies, recipients or message
    // fragments. The store records only this closed, redacted class.
    outcome = {
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    };
  }
  const outbox = await store.completeDelivery({
    galleryId,
    idempotencyKey,
    claimId: claim.claimId,
    outcome,
    now: clock(),
  });
  return { kind: "completed", outbox };
}

/** Safe operational counts; no gallery, attempt, recipient or message text. */
export type PrivateGalleryProofBatchProgress = {
  readonly listed: number;
  readonly completed: number;
  readonly sent: number;
  readonly failed: number;
  readonly notClaimable: number;
};

export type PrivateGalleryProofBatchErrorReason =
  | "invalid-limit"
  | "discovery-failed"
  | "invalid-store-result"
  | "dispatch-failed";

/** Redacts arbitrary store/transport exceptions but preserves partial progress. */
export class PrivateGalleryProofBatchError extends Error {
  readonly reason: PrivateGalleryProofBatchErrorReason;
  readonly progress: PrivateGalleryProofBatchProgress;

  constructor(reason: PrivateGalleryProofBatchErrorReason, progress: PrivateGalleryProofBatchProgress) {
    super(`[private-gallery-proof-batch] ${reason}`);
    this.name = "PrivateGalleryProofBatchError";
    this.reason = reason;
    this.progress = { ...progress };
  }
}

function validCandidates(
  value: readonly PrivateGalleryProofDueAttempt[],
  limit: number,
): boolean {
  if (!Array.isArray(value) || value.length > limit) return false;
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate?.galleryId !== "string" || candidate.galleryId.length === 0 ||
      typeof candidate.idempotencyKey !== "string" || candidate.idempotencyKey.length === 0
    ) return false;
    const identity = JSON.stringify([candidate.galleryId, candidate.idempotencyKey]);
    if (seen.has(identity)) return false;
    seen.add(identity);
  }
  return true;
}

/**
 * One bounded, sequential worker pass. A PostgreSQL adapter discovers due
 * rows in a bounded query; the existing per-row claim remains the CAS gate.
 * Another worker winning after discovery is a normal not-claimable result.
 *
 * This is orchestration, not a scheduler. A future runtime worker supplies a
 * durable store and transport; customer confirmation never invokes it.
 */
export async function runPrivateGalleryProofOutboxBatch(params: {
  readonly store: PrivateGalleryProofStore;
  readonly transport: GalleryNotificationTransport;
  readonly clock: () => Date;
  readonly limit: number;
}): Promise<PrivateGalleryProofBatchProgress> {
  const { store, transport, clock, limit } = params;
  const progress = { listed: 0, completed: 0, sent: 0, failed: 0, notClaimable: 0 };
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      limit > PRIVATE_GALLERY_PROOF_OUTBOX_MAX_BATCH_SIZE) {
    throw new PrivateGalleryProofBatchError("invalid-limit", progress);
  }

  let due: readonly PrivateGalleryProofDueAttempt[];
  try {
    due = await store.listDueOutboxAttempts({ now: clock(), limit });
  } catch {
    throw new PrivateGalleryProofBatchError("discovery-failed", progress);
  }
  if (!validCandidates(due, limit)) {
    throw new PrivateGalleryProofBatchError("invalid-store-result", progress);
  }
  progress.listed = due.length;

  for (const candidate of due) {
    let result: PrivateGalleryProofDispatchResult;
    try {
      result = await dispatchPrivateGalleryProofOutboxAttempt({
        store, transport, galleryId: candidate.galleryId,
        idempotencyKey: candidate.idempotencyKey, clock,
      });
    } catch {
      throw new PrivateGalleryProofBatchError("dispatch-failed", progress);
    }
    if (result.kind === "not-claimable") {
      progress.notClaimable += 1;
      continue;
    }
    if (result.outbox.state !== "sent" && result.outbox.state !== "failed") {
      throw new PrivateGalleryProofBatchError("invalid-store-result", progress);
    }
    progress.completed += 1;
    if (result.outbox.state === "sent") progress.sent += 1;
    else progress.failed += 1;
  }
  return progress;
}
