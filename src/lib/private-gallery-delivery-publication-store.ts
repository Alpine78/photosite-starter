/** Privileged process-memory first-publication contracts; no route or transport. */
import "server-only";
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { PrivateGallery, PrivateGalleryCapability } from "@/lib/private-gallery";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import type { PrivateGalleryDeliveryDraft } from "@/lib/private-gallery-delivery-draft-store";
import { generateCapabilitySecret, sealCapability } from "@/lib/private-gallery-capability";
import { planPrivateGalleryFirstDeliveryPublication } from "@/lib/private-gallery-delivery-readiness";
import { snapshotPrivateGalleryDeliveryNotificationContext, type PrivateGalleryDeliveryNotificationContext } from "@/lib/private-gallery-delivery-notification";
import { isValidGalleryNotificationIdempotencyKey } from "@/lib/gallery-notification";
import type { PrivateGalleryDeliveryRevokeInput } from "@/lib/private-gallery-delivery-revocation";
import type { PrivateGalleryDeliveryOutboxRecord, DeliveryNotificationDispatch, PrivateGalleryDeliveryOutboxStore } from "@/lib/private-gallery-delivery-outbox-state";
import type { PrivateGalleryCapabilityRotationInput } from "@/lib/private-gallery-capability-rotation";

export type PrivateGalleryDeliveryPublicationInput = PrivateGalleryDeliveryNotificationContext & {
  readonly handle: string;
  readonly expectedRevision: number;
  readonly now: Date;
  readonly keyring: PrivateGalleryCapabilityKeyring;
};
export type PrivateGalleryDeliveryPublication = {
  readonly sourceRevision: number;
  readonly capability: PrivateGalleryCapability;
  readonly notification: PrivateGalleryDeliveryNotificationContext;
  readonly outbox: PrivateGalleryDeliveryOutboxRecord;
  readonly dispatch?: DeliveryNotificationDispatch;
};
/** Server-only snapshot: never pass this encrypted capability or recipient to a browser. */
export type PrivateGalleryDeliveryPublicationSnapshot = PrivateGalleryDeliveryPublication & {
  readonly gallery: PrivateGallery;
  readonly revision: number;
};
export type PrivateGalleryDeliveryPublicationStore = PrivateGalleryDeliveryOutboxStore & {
  publishFirstDelivery(input: PrivateGalleryDeliveryPublicationInput): Promise<PrivateGalleryDeliveryPublicationSnapshot>;
  readPublication(handle: string): Promise<PrivateGalleryDeliveryPublicationSnapshot | undefined>;
  revokeDeliveryAccess(input: PrivateGalleryDeliveryRevokeInput): Promise<PrivateGalleryDeliveryPublicationSnapshot>;
  rotateCapabilityEnvelope(input: PrivateGalleryCapabilityRotationInput): Promise<{
    readonly rotated: boolean; readonly publication: PrivateGalleryDeliveryPublicationSnapshot;
  }>;
};
type Reason = "invalid-input" | "not-found" | "conflict" | "readiness-failed" | "capability-unavailable" | "outbox-unavailable" | "snapshot-unavailable";
export class PrivateGalleryDeliveryPublicationError extends Error {
  constructor(readonly reason: Reason) {
    super(`[private-gallery-delivery-publication] ${reason}`);
    this.name = "PrivateGalleryDeliveryPublicationError";
  }
}
export function publicationFailure(reason: Reason): never { throw new PrivateGalleryDeliveryPublicationError(reason); }
export function validPublicationHandle(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value); }

/** Snapshot data fields without executing accessors or accepting a proxy. */
export function snapshotDeliveryPublicationInput(value: PrivateGalleryDeliveryPublicationInput): PrivateGalleryDeliveryPublicationInput {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) publicationFailure("invalid-input");
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
        Object.keys(fields).sort().join(",") !== "canonicalOrigin,expectedRevision,handle,keyring,locale,now,recipient,routePrefix" ||
        Object.values(fields).some((field) => !("value" in field))) publicationFailure("invalid-input");
    const data = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
    if (!validPublicationHandle(data.handle) || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0 ||
        !types.isDate(data.now)) publicationFailure("invalid-input");
    const time = Date.prototype.getTime.call(data.now);
    if (!Number.isFinite(time)) publicationFailure("invalid-input");
    const notification = snapshotPrivateGalleryDeliveryNotificationContext({ recipient: data.recipient,
      canonicalOrigin: data.canonicalOrigin, routePrefix: data.routePrefix, locale: data.locale });
    return { ...notification, handle: data.handle, expectedRevision: data.expectedRevision, now: new Date(time), keyring: data.keyring };
  } catch { publicationFailure("invalid-input"); }
}
export function sameDeliveryPublicationIntent(publication: PrivateGalleryDeliveryPublication, input: PrivateGalleryDeliveryPublicationInput): boolean {
  return publication.sourceRevision === input.expectedRevision &&
    publication.notification.recipient === input.recipient && publication.notification.locale === input.locale &&
    publication.notification.canonicalOrigin === input.canonicalOrigin && publication.notification.routePrefix === input.routePrefix;
}
export function deliveryPublicationSnapshot(row: PrivateGalleryDeliveryDraft): PrivateGalleryDeliveryPublicationSnapshot {
  if (!row.publication) publicationFailure("not-found");
  try { return structuredClone({ gallery: row.gallery, revision: row.revision, ...row.publication }); }
  catch { publicationFailure("snapshot-unavailable"); }
}

/** Build everything before the caller's single canonical-row CAS/commit. */
export function buildFirstDeliveryPublicationCandidate(
  current: PrivateGalleryDeliveryDraft,
  input: PrivateGalleryDeliveryPublicationInput,
): PrivateGalleryDeliveryDraft {
  if (current.gallery.state !== "ready" || current.revision !== input.expectedRevision || current.revision >= Number.MAX_SAFE_INTEGER) publicationFailure("conflict");
  const plan = planPrivateGalleryFirstDeliveryPublication({ gallery: current.gallery, placements: current.readyDelivery?.placements ?? [],
    verifiedObjects: current.readyDelivery?.verifiedObjects ?? [], preparation: current.preparation?.preparation, now: input.now });
  if (!plan.publishable) publicationFailure("readiness-failed");
  let capability: PrivateGalleryCapability;
  try {
    const material = sealCapability(input.keyring, { galleryId: current.gallery.galleryId,
      handle: current.gallery.galleryHandle, generation: current.gallery.capabilityGeneration }, generateCapabilitySecret());
    capability = Object.freeze({ ...material, galleryId: current.gallery.galleryId,
      capabilityGeneration: current.gallery.capabilityGeneration, createdAt: new Date(input.now) });
  } catch { publicationFailure("capability-unavailable"); }
  let outbox: PrivateGalleryDeliveryOutboxRecord;
  try {
    const outboxId = randomUUID();
    const idempotencyKey = `delivery-initial:${current.gallery.galleryId}:${current.gallery.capabilityGeneration}`;
    if (!/^[a-f0-9-]{36}$/.test(outboxId) || !isValidGalleryNotificationIdempotencyKey(idempotencyKey)) publicationFailure("outbox-unavailable");
    outbox = Object.freeze({ galleryId: current.gallery.galleryId, outboxId, kind: "delivery-notification" as const,
      idempotencyKey, generation: current.gallery.capabilityGeneration, state: "pending" as const, attempts: 0, createdAt: new Date(input.now) });
  } catch { publicationFailure("outbox-unavailable"); }
  return { ...current, revision: current.revision + 1,
    gallery: { ...current.gallery, state: "published", publishedAt: plan.publishedAt, accessExpiresAt: plan.accessExpiresAt },
    publication: Object.freeze({ sourceRevision: current.revision, capability, outbox,
      notification: Object.freeze({ recipient: input.recipient, locale: input.locale, canonicalOrigin: input.canonicalOrigin, routePrefix: input.routePrefix }) }) };
}
