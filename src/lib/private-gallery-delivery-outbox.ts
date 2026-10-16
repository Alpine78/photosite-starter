/** Bounded provider-free orchestration; applications do not register this worker yet. */
import "server-only";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import type { GalleryNotificationRequest, GalleryNotificationTransport } from "@/lib/gallery-notification";
import { buildPrivateGalleryDeliveryNotification } from "@/lib/private-gallery-delivery-notification";
import { privateGalleryDeliveryNotificationStatus } from "@/lib/private-gallery-delivery-notification-status";
import type { PrivateGalleryDeliveryPublicationSnapshot } from "@/lib/private-gallery-delivery-publication-store";
import { DELIVERY_OUTBOX_MAX_BATCH, deliveryOutboxTime, redactedDeliveryOutcome, snapshotDeliveryNotificationCandidate, snapshotDeliveryOutboxToken,
  type DeliveryNotificationIdentity, type DeliveryNotificationOutcome, type DeliveryNotificationToken, type PrivateGalleryDeliveryOutboxStore } from "@/lib/private-gallery-delivery-outbox-state";

export const DELIVERY_OUTBOX_SEND_TIMEOUT_MS = 10_000;
type Progress = { listed: number; completed: number; sent: number; failed: number; notClaimable: number; timedOut: number };
type Reason = "invalid-input" | "invalid-clock" | "store-failed" | "invalid-store-result";
export class PrivateGalleryDeliveryWorkerError extends Error {
  readonly progress: Readonly<Progress>;
  constructor(readonly reason: Reason, progress: Progress = { listed: 0, completed: 0, sent: 0, failed: 0, notClaimable: 0, timedOut: 0 }) {
    super(`[private-gallery-delivery-worker] ${reason}`);
    this.name = "PrivateGalleryDeliveryWorkerError";
    this.progress = { ...progress };
  }
}
function clockReader(clock: () => Date): () => Date {
  let previous = -Infinity;
  return () => {
    let value: unknown;
    try { value = clock(); } catch { throw new PrivateGalleryDeliveryWorkerError("invalid-clock"); }
    const time = deliveryOutboxTime(value);
    if (time === undefined || time < previous) throw new PrivateGalleryDeliveryWorkerError("invalid-clock");
    previous = time;
    return new Date(time);
  };
}
function sameBinding(a: PrivateGalleryDeliveryPublicationSnapshot, b: PrivateGalleryDeliveryPublicationSnapshot, token: DeliveryNotificationToken, now: Date): boolean {
  return privateGalleryDeliveryNotificationStatus(a, now).dispatchable && privateGalleryDeliveryNotificationStatus(b, now).dispatchable &&
    a.outbox.state === "pending" && b.outbox.state === "pending" &&
    b.dispatch?.claim?.claimId === token.claimId && b.dispatch.claim.generation === token.generation &&
    deliveryOutboxTime(b.dispatch.claim.createdAt) !== undefined && deliveryOutboxTime(b.dispatch.claim.expiresAt) !== undefined &&
    now >= b.dispatch.claim.createdAt && now < b.dispatch.claim.expiresAt &&
    a.gallery.galleryHandle === token.handle && b.gallery.galleryHandle === token.handle && a.gallery.galleryId === b.gallery.galleryId &&
    a.gallery.capabilityGeneration === token.generation && b.gallery.capabilityGeneration === token.generation &&
    a.outbox.outboxId === token.outboxId && b.outbox.outboxId === token.outboxId && a.outbox.generation === token.generation && b.outbox.generation === token.generation &&
    a.outbox.idempotencyKey === b.outbox.idempotencyKey && a.gallery.accessExpiresAt?.getTime() === b.gallery.accessExpiresAt?.getTime() &&
    a.notification.recipient === b.notification.recipient && a.notification.locale === b.notification.locale &&
    a.notification.canonicalOrigin === b.notification.canonicalOrigin && a.notification.routePrefix === b.notification.routePrefix;
}
async function sendBounded(deliver: (request: GalleryNotificationRequest) => Promise<unknown>, request: GalleryNotificationRequest): Promise<{ outcome: DeliveryNotificationOutcome; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ outcome: DeliveryNotificationOutcome; timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, outcome: { status: "failed", errorClass: "timeout", retryable: true } }), DELIVERY_OUTBOX_SEND_TIMEOUT_MS);
  });
  try {
    let pending: Promise<unknown>;
    try { pending = Promise.resolve(deliver(request)); }
    catch { pending = Promise.resolve({ status: "failed", errorClass: "provider-unavailable", retryable: true }); }
    const settled = pending.then((value) => ({ outcome: redactedDeliveryOutcome(value), timedOut: false }),
      () => ({ outcome: redactedDeliveryOutcome(undefined), timedOut: false }));
    // The race consumes late settlements too; a timeout cannot abort an arbitrary
    // custom transport. Its batch stops rather than admitting more hidden sends.
    return await Promise.race([settled, timeout]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
type Result = { readonly kind: "not-claimable"; readonly timedOut: boolean } |
  { readonly kind: "completed"; readonly state: "sent" | "failed"; readonly timedOut: boolean };
export async function dispatchPrivateGalleryDeliveryNotification(input: {
  readonly store: PrivateGalleryDeliveryOutboxStore; readonly transport: GalleryNotificationTransport;
  readonly keyring: PrivateGalleryCapabilityKeyring; readonly identity: DeliveryNotificationIdentity; readonly clock: () => Date;
}): Promise<Result> {
  const clock = clockReader(input.clock);
  let identity: DeliveryNotificationIdentity, deliver: (request: GalleryNotificationRequest) => Promise<unknown>;
  try { identity = snapshotDeliveryNotificationCandidate(input.identity); deliver = input.transport.deliver.bind(input.transport); }
  catch { throw new PrivateGalleryDeliveryWorkerError("invalid-input"); }
  let claim;
  try { claim = await input.store.claimDeliveryNotification({ ...identity, now: clock() }); }
  catch (error) { if (error instanceof PrivateGalleryDeliveryWorkerError) throw error; throw new PrivateGalleryDeliveryWorkerError("store-failed"); }
  if (!claim) return { kind: "not-claimable", timedOut: false };
  let token: DeliveryNotificationToken;
  try {
    const copied = snapshotDeliveryOutboxToken({ ...claim.token, now: clock() });
    token = copied;
    // Strip the copied clock before reusing the closed token input shape.
    token = { handle: token.handle, outboxId: token.outboxId, claimId: token.claimId, generation: token.generation };
    if (token.handle !== identity.handle || token.outboxId !== identity.outboxId || !sameBinding(claim.publication, claim.publication, token, copied.now)) throw new Error();
  } catch { throw new PrivateGalleryDeliveryWorkerError("invalid-store-result"); }
  const complete = async (outcome: DeliveryNotificationOutcome, timedOut = false): Promise<Result> => {
    let state;
    try { state = await input.store.completeDeliveryNotification({ ...token, outcome, now: clock() }); }
    catch (error) { if (error instanceof PrivateGalleryDeliveryWorkerError) throw error; throw new PrivateGalleryDeliveryWorkerError("store-failed"); }
    if (state === undefined) return { kind: "not-claimable", timedOut };
    if (state !== "sent" && state !== "failed") throw new PrivateGalleryDeliveryWorkerError("invalid-store-result");
    return { kind: "completed", state, timedOut };
  };
  let request: GalleryNotificationRequest;
  try { request = buildPrivateGalleryDeliveryNotification({ ...claim.publication.notification, gallery: claim.publication.gallery,
    capability: claim.publication.capability, keyring: input.keyring, outboxIdempotencyKey: claim.publication.outbox.idempotencyKey, now: clock() }); }
  catch { return complete({ status: "failed", errorClass: "configuration", retryable: false }); }
  let fresh, checkedAt: Date;
  try { checkedAt = clock(); fresh = await input.store.readClaimedDeliveryNotification({ ...token, now: checkedAt }); }
  catch (error) {
    if (error instanceof PrivateGalleryDeliveryWorkerError) throw error;
    return complete({ status: "failed", errorClass: "worker-unavailable", retryable: true });
  }
  try {
    if (!fresh || !sameBinding(claim.publication, fresh, token, checkedAt)) return complete({ status: "failed", errorClass: "configuration", retryable: false });
  } catch { return complete({ status: "failed", errorClass: "configuration", retryable: false }); }
  // No await, keyring or clock callback between this fresh check and invocation.
  // A subsequent revoke is an in-flight-send race; completion still must CAS.
  const sent = await sendBounded(deliver, request);
  return complete(sent.outcome, sent.timedOut);
}

export async function runPrivateGalleryDeliveryOutboxBatch(input: {
  readonly store: PrivateGalleryDeliveryOutboxStore; readonly transport: GalleryNotificationTransport;
  readonly keyring: PrivateGalleryCapabilityKeyring; readonly clock: () => Date; readonly limit: number;
}): Promise<Readonly<Progress>> {
  const progress: Progress = { listed: 0, completed: 0, sent: 0, failed: 0, notClaimable: 0, timedOut: 0 };
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > DELIVERY_OUTBOX_MAX_BATCH) throw new PrivateGalleryDeliveryWorkerError("invalid-input", progress);
  const clock = clockReader(input.clock);
  let identities: readonly DeliveryNotificationIdentity[];
  try {
    const found = await input.store.listDueDeliveryNotifications({ limit: input.limit, now: clock() });
    if (!Array.isArray(found) || found.length > input.limit) throw new Error();
    identities = found.map(snapshotDeliveryNotificationCandidate);
    if (new Set(identities.map((value) => `${value.handle}:${value.outboxId}`)).size !== identities.length) throw new Error();
  } catch { throw new PrivateGalleryDeliveryWorkerError("store-failed", progress); }
  progress.listed = identities.length;
  for (const identity of identities) {
    let result: Result;
    try { result = await dispatchPrivateGalleryDeliveryNotification({ ...input, identity, clock }); }
    catch { throw new PrivateGalleryDeliveryWorkerError("store-failed", progress); }
    if (result.kind === "not-claimable") progress.notClaimable++;
    else { progress.completed++; if (result.state === "sent") progress.sent++; else progress.failed++; }
    if (result.timedOut) { progress.timedOut++; break; }
  }
  return progress;
}
