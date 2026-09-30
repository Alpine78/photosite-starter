/** One bounded proof-notification attempt against a claimed private outbox row. */
import "server-only";

import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import type { GalleryNotificationTransport } from "@/lib/gallery-notification";
import type {
  PrivateGalleryProofOutboxRecord,
  PrivateGalleryProofStore,
} from "@/lib/private-gallery-proof-store";

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
