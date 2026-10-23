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

/** A new proof gallery: generated handle, paused, indefinite (owner answer 4), nothing numbered yet. */
export function initialProofGallery(random?: (bytes: Uint8Array<ArrayBuffer>) => void) {
  return { ...initialClientGallery(random), availabilityMode: "indefinite", referenceHighWater: 0 };
}

export function withClientGalleryDefaults(schema: SchemaTypeDefinition) {
  if (schema.name === "clientDeliveryGallery") return { ...schema, initialValue: () => initialClientGallery() };
  if (schema.name === "clientProofGallery") return { ...schema, initialValue: () => initialProofGallery() };
  return schema;
}
