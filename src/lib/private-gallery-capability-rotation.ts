/** Single-row, development-memory capability envelope rotation; never a key-retirement job. */
import "server-only";
import { types } from "node:util";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import type { PrivateGalleryDeliveryDraft } from "@/lib/private-gallery-delivery-draft-store";
import { capabilityEnvelopeKeyId, openCapability, resealCapability } from "@/lib/private-gallery-capability";
import { validPublicationHandle } from "@/lib/private-gallery-delivery-publication-store";

export type PrivateGalleryCapabilityRotationInput = {
  readonly handle: string;
  readonly keyring: PrivateGalleryCapabilityKeyring;
  readonly now: Date;
};
type Reason = "invalid-input" | "not-found" | "unavailable" | "conflict" | "capability-unavailable";
export class PrivateGalleryCapabilityRotationError extends Error {
  constructor(readonly reason: Reason) {
    super(`[private-gallery-capability-rotation] ${reason}`);
    this.name = "PrivateGalleryCapabilityRotationError";
  }
}
export function rotationFailure(reason: Reason): never { throw new PrivateGalleryCapabilityRotationError(reason); }
export function snapshotCapabilityRotationInput(value: PrivateGalleryCapabilityRotationInput): PrivateGalleryCapabilityRotationInput {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) rotationFailure("invalid-input");
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== 3 || Object.keys(fields).sort().join(",") !== "handle,keyring,now" ||
        Object.values(fields).some((field) => !("value" in field)) ||
        !validPublicationHandle(fields.handle.value) || !types.isDate(fields.now.value)) rotationFailure("invalid-input");
    const time = Date.prototype.getTime.call(fields.now.value);
    const keyring = fields.keyring.value;
    if (!Number.isFinite(time) || !keyring || typeof keyring !== "object") rotationFailure("invalid-input");
    return { handle: fields.handle.value, keyring, now: new Date(time) };
  } catch { rotationFailure("invalid-input"); }
}
function date(value: unknown): value is Date { return types.isDate(value) && Number.isFinite(Date.prototype.getTime.call(value)); }

/** Return the original row for an authenticated no-op, otherwise a detached candidate. */
export function buildRotatedCapabilityCandidate(current: PrivateGalleryDeliveryDraft, input: PrivateGalleryCapabilityRotationInput): PrivateGalleryDeliveryDraft {
  const { gallery, publication } = current;
  if (!gallery || gallery.kind !== "delivery" || gallery.state !== "published" || !publication || gallery.galleryHandle !== input.handle ||
      !Number.isSafeInteger(current.revision) || current.revision < 0 ||
      !Number.isSafeInteger(gallery.capabilityGeneration) || gallery.capabilityGeneration < 0 ||
      !date(gallery.createdAt) || !date(gallery.publishedAt) || !date(gallery.accessExpiresAt) || !date(input.now) ||
      gallery.publishedAt < gallery.createdAt || gallery.accessExpiresAt <= gallery.publishedAt || input.now < gallery.publishedAt || input.now >= gallery.accessExpiresAt) rotationFailure("unavailable");
  const capability = publication.capability;
  if (!capability || capability.galleryId !== gallery.galleryId || capability.capabilityGeneration !== gallery.capabilityGeneration ||
      !date(capability.createdAt) || capability.createdAt < gallery.publishedAt || capability.createdAt > input.now) rotationFailure("unavailable");
  const context = { galleryId: gallery.galleryId, handle: gallery.galleryHandle, generation: gallery.capabilityGeneration };
  try {
    if (capability.keyId !== capabilityEnvelopeKeyId(capability.envelope)) rotationFailure("capability-unavailable");
    if (capability.keyId === input.keyring.activeKeyId) {
      // An active key id alone does not prove a valid authenticated envelope.
      openCapability(input.keyring, context, capability.envelope);
      return current;
    }
    if (current.revision >= Number.MAX_SAFE_INTEGER) rotationFailure("conflict");
    const material = resealCapability(input.keyring, context, capability.envelope);
    return { ...current, revision: current.revision + 1, publication: Object.freeze({ ...publication,
      capability: Object.freeze({ ...capability, ...material }) }) };
  } catch (error) {
    if (error instanceof PrivateGalleryCapabilityRotationError) throw error;
    rotationFailure("capability-unavailable");
  }
}
