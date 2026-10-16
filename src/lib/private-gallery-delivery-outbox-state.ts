/** Pure delivery claim transitions for the privileged process-memory store. */
import "server-only";
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import type { PrivateGalleryOutboxRecord } from "@/lib/private-gallery";
import type { PrivateGalleryDeliveryDraft } from "@/lib/private-gallery-delivery-draft-store";
import { validPublicationHandle, type PrivateGalleryDeliveryPublicationSnapshot } from "@/lib/private-gallery-delivery-publication-store";
import { privateGalleryDeliveryNotificationStatus } from "@/lib/private-gallery-delivery-notification-status";

export const DELIVERY_OUTBOX_MAX_BATCH = 100;
export const DELIVERY_OUTBOX_MAX_CLAIMS = 3;
export const DELIVERY_OUTBOX_LEASE_MS = 30_000;
export const DELIVERY_OUTBOX_RETRY_MS = 60_000;
export const DELIVERY_OUTBOX_RETRY_AGE_MS = 10 * 60_000;
export type PrivateGalleryDeliveryOutboxRecord = Omit<PrivateGalleryOutboxRecord, "kind"> & {
  readonly kind: "delivery-notification";
  readonly generation: number;
};
export type DeliveryNotificationDispatch = {
  readonly firstClaimAt: Date;
  readonly claim?: { readonly claimId: string; readonly generation: number; readonly createdAt: Date; readonly expiresAt: Date };
  readonly retryable?: boolean;
  readonly nextAttemptAt?: Date;
  readonly sentAt?: Date;
};
export type DeliveryNotificationIdentity = { readonly handle: string; readonly outboxId: string };
export type DeliveryNotificationToken = DeliveryNotificationIdentity & { readonly claimId: string; readonly generation: number };
export type DeliveryNotificationClaim = { readonly token: DeliveryNotificationToken; readonly publication: PrivateGalleryDeliveryPublicationSnapshot };
export type DeliveryNotificationOutcome = ContactDeliveryOutcome | { readonly status: "failed"; readonly errorClass: "worker-unavailable"; readonly retryable: boolean };
export type PrivateGalleryDeliveryOutboxStore = {
  listDueDeliveryNotifications(input: { readonly now: Date; readonly limit: number }): Promise<readonly DeliveryNotificationIdentity[]>;
  claimDeliveryNotification(input: DeliveryNotificationIdentity & { readonly now: Date }): Promise<DeliveryNotificationClaim | undefined>;
  readClaimedDeliveryNotification(input: DeliveryNotificationToken & { readonly now: Date }): Promise<PrivateGalleryDeliveryPublicationSnapshot | undefined>;
  /** Atomic claim/generation/lease CAS; stale or revoked results are discarded. */
  completeDeliveryNotification(input: DeliveryNotificationToken & { readonly now: Date; readonly outcome: DeliveryNotificationOutcome }): Promise<"sent" | "failed" | undefined>;
};
export class PrivateGalleryDeliveryOutboxError extends Error {
  constructor(readonly reason: "invalid-input" | "invalid-record" | "conflict") {
    super(`[private-gallery-delivery-outbox] ${reason}`);
    this.name = "PrivateGalleryDeliveryOutboxError";
  }
}
export function outboxFailure(reason: "invalid-input" | "invalid-record" | "conflict"): never { throw new PrivateGalleryDeliveryOutboxError(reason); }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
export function deliveryOutboxTime(value: unknown): number | undefined {
  if (!types.isDate(value)) return undefined;
  const result = Date.prototype.getTime.call(value);
  return Number.isFinite(result) ? result : undefined;
}
function data(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) outboxFailure("invalid-input");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") || Object.keys(fields).sort().join(",") !== keys ||
      Object.values(fields).some((field) => !("value" in field))) outboxFailure("invalid-input");
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}
function identity(fields: Record<string, unknown>): DeliveryNotificationIdentity & { readonly now: Date } {
  const now = deliveryOutboxTime(fields.now);
  if (!validPublicationHandle(fields.handle) || !uuid(fields.outboxId) || now === undefined) outboxFailure("invalid-input");
  return { handle: fields.handle, outboxId: fields.outboxId, now: new Date(now) };
}
export function snapshotDeliveryOutboxIdentity(value: unknown): DeliveryNotificationIdentity & { readonly now: Date } {
  return identity(data(value, "handle,now,outboxId"));
}
export function snapshotDeliveryOutboxToken(value: unknown, completion = false): DeliveryNotificationToken & { readonly now: Date; readonly outcome?: DeliveryNotificationOutcome } {
  const fields = data(value, completion ? "claimId,generation,handle,now,outboxId,outcome" : "claimId,generation,handle,now,outboxId");
  if (!uuid(fields.claimId) || !Number.isSafeInteger(fields.generation) || (fields.generation as number) < 0) outboxFailure("invalid-input");
  return { ...identity(fields), claimId: fields.claimId, generation: fields.generation as number,
    ...(completion ? { outcome: redactedDeliveryOutcome(fields.outcome) } : {}) };
}
export function snapshotDeliveryOutboxDiscovery(value: unknown): { readonly now: Date; readonly limit: number } {
  const fields = data(value, "limit,now");
  const now = deliveryOutboxTime(fields.now);
  if (now === undefined || !Number.isSafeInteger(fields.limit) || (fields.limit as number) < 1 || (fields.limit as number) > DELIVERY_OUTBOX_MAX_BATCH) outboxFailure("invalid-input");
  return { now: new Date(now), limit: fields.limit as number };
}
export function snapshotDeliveryNotificationCandidate(value: unknown): DeliveryNotificationIdentity {
  const fields = data(value, "handle,outboxId");
  if (!validPublicationHandle(fields.handle) || !uuid(fields.outboxId)) outboxFailure("invalid-input");
  return { handle: fields.handle, outboxId: fields.outboxId };
}
export function redactedDeliveryOutcome(value: unknown): DeliveryNotificationOutcome {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value)) throw new Error();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.values(fields).some((field) => !("value" in field))) throw new Error();
    const keys = Reflect.ownKeys(value).sort().join(",");
    if (keys === "status" && fields.status.value === "delivered") return { status: "delivered" };
    const classes = ["configuration", "provider-rejected", "provider-quota-exceeded", "provider-unavailable", "timeout", "worker-unavailable"];
    if (keys !== "errorClass,retryable,status" || fields.status.value !== "failed" ||
        !classes.includes(fields.errorClass.value) || typeof fields.retryable.value !== "boolean") throw new Error();
    const errorClass = fields.errorClass.value as "configuration" | "provider-rejected" | "provider-quota-exceeded" | "provider-unavailable" | "timeout" | "worker-unavailable";
    return { status: "failed", errorClass, retryable: fields.retryable.value && ["provider-unavailable", "timeout", "worker-unavailable"].includes(errorClass) };
  } catch { return { status: "failed", errorClass: "provider-unavailable", retryable: true }; }
}
function publication(row: PrivateGalleryDeliveryDraft) {
  if (!row.publication?.outbox || !Number.isSafeInteger(row.publication.outbox.attempts) || row.publication.outbox.attempts < 0 ||
      row.publication.outbox.attempts > DELIVERY_OUTBOX_MAX_CLAIMS || !uuid(row.publication.outbox.outboxId) ||
      deliveryOutboxTime(row.publication.outbox.createdAt) === undefined) outboxFailure("invalid-record");
  const dispatch = row.publication.dispatch;
  if (row.publication.outbox.attempts > 0 && (!dispatch || deliveryOutboxTime(dispatch.firstClaimAt) === undefined)) outboxFailure("invalid-record");
  if (dispatch && (deliveryOutboxTime(dispatch.firstClaimAt) === undefined || dispatch.firstClaimAt < row.publication.outbox.createdAt ||
      (dispatch.nextAttemptAt !== undefined && deliveryOutboxTime(dispatch.nextAttemptAt) === undefined) ||
      (dispatch.claim && (!uuid(dispatch.claim.claimId) || !Number.isSafeInteger(dispatch.claim.generation) || dispatch.claim.generation !== row.publication.outbox.generation ||
        deliveryOutboxTime(dispatch.claim.createdAt) === undefined || deliveryOutboxTime(dispatch.claim.expiresAt) === undefined ||
        dispatch.claim.createdAt < dispatch.firstClaimAt || dispatch.claim.expiresAt <= dispatch.claim.createdAt)))) outboxFailure("invalid-record");
  return row.publication;
}
function accessible(row: PrivateGalleryDeliveryDraft, now: Date): boolean {
  return row.publication !== undefined && privateGalleryDeliveryNotificationStatus({ gallery: row.gallery, revision: row.revision, ...row.publication }, now).dispatchable;
}
export function deliveryNotificationDue(row: PrivateGalleryDeliveryDraft, now: Date): boolean {
  if (!accessible(row, now)) return false;
  const saved = publication(row), currentTime = now.getTime();
  if (currentTime < saved.outbox.createdAt.getTime()) return false;
  if (saved.dispatch?.claim && currentTime < saved.dispatch.claim.expiresAt.getTime()) return false;
  if (saved.dispatch && currentTime < saved.dispatch.firstClaimAt.getTime()) return false;
  return saved.outbox.state === "pending" || (saved.outbox.state === "failed" && saved.dispatch?.retryable === true &&
    deliveryOutboxTime(saved.dispatch.nextAttemptAt) !== undefined && currentTime >= saved.dispatch.nextAttemptAt!.getTime());
}
function updated(row: PrivateGalleryDeliveryDraft, next: NonNullable<PrivateGalleryDeliveryDraft["publication"]>): PrivateGalleryDeliveryDraft {
  if (!Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) outboxFailure("conflict");
  return { ...row, revision: row.revision + 1, publication: Object.freeze(next) };
}
export function claimDeliveryNotificationCandidate(row: PrivateGalleryDeliveryDraft, now: Date): {
  readonly row: PrivateGalleryDeliveryDraft; readonly token?: DeliveryNotificationToken;
} | undefined {
  if (!deliveryNotificationDue(row, now)) return undefined;
  const saved = publication(row);
  const firstClaimAt = saved.dispatch?.firstClaimAt ?? new Date(now);
  if (saved.outbox.attempts >= DELIVERY_OUTBOX_MAX_CLAIMS || now.getTime() - firstClaimAt.getTime() >= DELIVERY_OUTBOX_RETRY_AGE_MS) {
    const lastError = saved.outbox.attempts >= DELIVERY_OUTBOX_MAX_CLAIMS ? "worker-interrupted" : "retry-window-expired";
    return { row: updated(row, { ...saved, outbox: { ...saved.outbox, state: "failed", lastError },
      dispatch: { ...saved.dispatch, firstClaimAt, claim: undefined, retryable: false, nextAttemptAt: undefined } }) };
  }
  const claimId = randomUUID();
  const expiresAt = new Date(Math.min(now.getTime() + DELIVERY_OUTBOX_LEASE_MS, row.gallery.accessExpiresAt!.getTime(), firstClaimAt.getTime() + DELIVERY_OUTBOX_RETRY_AGE_MS));
  if (!uuid(claimId) || deliveryOutboxTime(expiresAt) === undefined || expiresAt <= now) outboxFailure("invalid-record");
  const token = { handle: row.gallery.galleryHandle, outboxId: saved.outbox.outboxId, claimId, generation: saved.outbox.generation };
  return { token, row: updated(row, { ...saved, outbox: { ...saved.outbox, state: "pending", attempts: saved.outbox.attempts + 1, lastError: undefined },
    dispatch: { firstClaimAt, claim: { claimId, generation: token.generation, createdAt: new Date(now), expiresAt } } }) };
}
export function deliveryNotificationClaimCurrent(row: PrivateGalleryDeliveryDraft, token: DeliveryNotificationToken, now: Date): boolean {
  if (!accessible(row, now)) return false;
  const saved = publication(row), claim = saved.dispatch?.claim;
  return row.gallery.galleryHandle === token.handle && saved.outbox.state === "pending" && saved.outbox.outboxId === token.outboxId && saved.outbox.generation === token.generation &&
    claim?.claimId === token.claimId && claim.generation === token.generation &&
    deliveryOutboxTime(claim.createdAt) !== undefined && deliveryOutboxTime(claim.expiresAt) !== undefined &&
    now >= claim.createdAt && now < claim.expiresAt;
}
export function completeDeliveryNotificationCandidate(row: PrivateGalleryDeliveryDraft, token: DeliveryNotificationToken, now: Date,
  outcome: DeliveryNotificationOutcome): PrivateGalleryDeliveryDraft | undefined {
  if (!deliveryNotificationClaimCurrent(row, token, now)) return undefined;
  const saved = publication(row), result = redactedDeliveryOutcome(outcome), firstClaimAt = saved.dispatch!.firstClaimAt;
  const next = new Date(now.getTime() + DELIVERY_OUTBOX_RETRY_MS);
  const retryable = result.status === "failed" && result.retryable && saved.outbox.attempts < DELIVERY_OUTBOX_MAX_CLAIMS &&
    deliveryOutboxTime(next) !== undefined && next < row.gallery.accessExpiresAt! && next.getTime() - firstClaimAt.getTime() < DELIVERY_OUTBOX_RETRY_AGE_MS;
  return updated(row, { ...saved, outbox: { ...saved.outbox, state: result.status === "delivered" ? "sent" : "failed",
    lastError: result.status === "failed" ? result.errorClass : undefined }, dispatch: { firstClaimAt, claim: undefined,
      ...(result.status === "delivered" ? { sentAt: new Date(now) } : { retryable, ...(retryable ? { nextAttemptAt: next } : {}) }) } });
}
