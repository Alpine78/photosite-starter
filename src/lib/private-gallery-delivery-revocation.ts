/** Privileged development-memory revoke transition; no authentication or transport IO. */
import "server-only";
import { types } from "node:util";
import { canTransitionPrivateGalleryState } from "@/lib/private-gallery-state";
import type { PrivateGalleryDeliveryDraft } from "@/lib/private-gallery-delivery-draft-store";
import { validPublicationHandle } from "@/lib/private-gallery-delivery-publication-store";

export type PrivateGalleryDeliveryRevokeInput = {
  readonly handle: string;
  readonly expectedRevision: number;
  readonly expectedGeneration: number;
  readonly now: Date;
};
type Reason = "invalid-input" | "not-found" | "conflict" | "unavailable";
const LIFECYCLE_ERROR = Symbol.for("photosite-starter.private-gallery.delivery-lifecycle-error");
export class PrivateGalleryDeliveryLifecycleError extends Error {
  constructor(readonly reason: Reason) {
    super(`[private-gallery-delivery-lifecycle] ${reason}`);
    this.name = "PrivateGalleryDeliveryLifecycleError";
    Object.defineProperty(this, LIFECYCLE_ERROR, { value: true });
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Error && value.name === "PrivateGalleryDeliveryLifecycleError" &&
      Object.hasOwn(value, LIFECYCLE_ERROR) && (value as unknown as Record<symbol, unknown>)[LIFECYCLE_ERROR] === true;
  }
}
export function lifecycleFailure(reason: Reason): never { throw new PrivateGalleryDeliveryLifecycleError(reason); }
export function readDeliveryRevokeData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return undefined;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") || Object.values(fields).some((field) => !("value" in field))) return undefined;
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}
export function snapshotDeliveryRevokeInput(value: unknown): PrivateGalleryDeliveryRevokeInput {
  try {
    const fields = readDeliveryRevokeData(value);
    if (!fields || Object.keys(fields).sort().join(",") !== "expectedGeneration,expectedRevision,handle,now" ||
        !validPublicationHandle(fields.handle) || !Number.isSafeInteger(fields.expectedRevision) || (fields.expectedRevision as number) < 0 ||
        !Number.isSafeInteger(fields.expectedGeneration) || (fields.expectedGeneration as number) < 0 || !types.isDate(fields.now)) lifecycleFailure("invalid-input");
    const time = Date.prototype.getTime.call(fields.now);
    if (!Number.isFinite(time)) lifecycleFailure("invalid-input");
    return { handle: fields.handle, expectedRevision: fields.expectedRevision as number, expectedGeneration: fields.expectedGeneration as number, now: new Date(time) };
  } catch { lifecycleFailure("invalid-input"); }
}
export function buildRevokedDeliveryCandidate(current: PrivateGalleryDeliveryDraft, input: PrivateGalleryDeliveryRevokeInput): PrivateGalleryDeliveryDraft {
  const { gallery, publication } = current;
  if (!gallery || gallery.kind !== "delivery" || gallery.state !== "published" || !canTransitionPrivateGalleryState(gallery.state, "access-suspended") ||
      !publication || input.handle !== gallery.galleryHandle || current.revision !== input.expectedRevision || gallery.capabilityGeneration !== input.expectedGeneration ||
      !Number.isSafeInteger(current.revision) || current.revision < 0 || current.revision >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(gallery.capabilityGeneration) || gallery.capabilityGeneration < 0 || gallery.capabilityGeneration >= Number.MAX_SAFE_INTEGER) lifecycleFailure("conflict");
  if (!(gallery.publishedAt instanceof Date) || !Number.isFinite(gallery.publishedAt.getTime()) ||
      !(gallery.accessExpiresAt instanceof Date) || !Number.isFinite(gallery.accessExpiresAt.getTime()) || gallery.accessExpiresAt <= gallery.publishedAt ||
      !(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) || input.now < gallery.publishedAt || input.now >= gallery.accessExpiresAt ||
      !publication.capability || !publication.outbox || publication.outbox.galleryId !== gallery.galleryId ||
      publication.outbox.kind !== "delivery-notification" || !["pending", "failed", "sent"].includes(publication.outbox.state) ||
      publication.capability.galleryId !== gallery.galleryId || publication.capability.capabilityGeneration !== gallery.capabilityGeneration) lifecycleFailure("unavailable");
  return { ...current, revision: current.revision + 1,
    gallery: { ...gallery, state: "access-suspended", capabilityGeneration: gallery.capabilityGeneration + 1 },
    publication: Object.freeze({ ...publication, ...(publication.dispatch ? { dispatch: { ...publication.dispatch, claim: undefined, retryable: false, nextAttemptAt: undefined } } : {}), outbox: publication.outbox.state === "sent" ? publication.outbox :
      Object.freeze({ ...publication.outbox, state: "failed", lastError: "access-revoked" }) }) };
}

