import type { SchemaTypeDefinition } from "../sanity/schemas/schema-types";

/** A public, non-customer-derived handle. Possession is not authentication. */
export function initialClientGallery(
  random: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => { globalThis.crypto.getRandomValues(bytes); },
) {
  const bytes = new Uint8Array(16);
  // Use the supplied buffer, as Web Crypto does; no fallback to weaker entropy.
  random(bytes);
  return { handle: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""), available: false };
}

/** Six calendar months in UTC; clamp the day instead of overflowing into March. */
export function deliveryExpiryFromCreation(createdAt: number): string {
  const deadline = new Date(createdAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(deadline.getTime()) || !/^\d{4}-/u.test(deadline.toISOString())) throw new Error("invalid-gallery-clock");
  const day = deadline.getUTCDate();
  deadline.setUTCDate(1);
  deadline.setUTCMonth(deadline.getUTCMonth() + 6);
  const lastDay = new Date(deadline.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  deadline.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  const result = deadline.toISOString();
  if (!/^\d{4}-/u.test(result)) throw new Error("invalid-gallery-clock");
  return result;
}

/** Creation-time suggestion only: editors can change it, and publication never resets it. */
export function initialDeliveryGallery(
  random?: (bytes: Uint8Array<ArrayBuffer>) => void,
  now: () => number = Date.now,
) {
  const expiryInstant = deliveryExpiryFromCreation(now());
  return { ...initialClientGallery(random), availabilityMode: "until", expiryInstant };
}

/** A new proof gallery: generated handle, paused, indefinite (owner answer 4), nothing numbered yet. */
export function initialProofGallery(random?: (bytes: Uint8Array<ArrayBuffer>) => void) {
  return { ...initialClientGallery(random), availabilityMode: "indefinite", referenceHighWater: 0 };
}

export function withClientGalleryDefaults(schema: SchemaTypeDefinition) {
  if (schema.name === "clientDeliveryGallery") return { ...schema, initialValue: () => initialDeliveryGallery() };
  if (schema.name === "clientProofGallery") return { ...schema, initialValue: () => initialProofGallery() };
  return schema;
}
