import type { SchemaTypeDefinition } from "./schema-types";

/** Owner-imported ADR-0028 legacy continuity, separate from public media. */
export const legacyDeliveryGalleryType: SchemaTypeDefinition = {
  name: "legacyDeliveryGallery", title: "Legacy delivery gallery", type: "document",
  description: "Unlisted public legacy delivery. Direct assets are public; this is not authenticated private storage. Imported fields are read-only.",
  fields: [
    { name: "handle", title: "Opaque handle", type: "string", readOnly: true },
    { name: "migrationBatch", title: "Approved batch digest", type: "string", readOnly: true },
    { name: "published", title: "Available", type: "boolean", initialValue: false, readOnly: true },
    { name: "displayTitle", title: "Display title", type: "string", readOnly: true },
    { name: "availabilityMode", title: "Availability", type: "string", readOnly: true,
      options: { list: [{ title: "Until a deadline", value: "until" }, { title: "Explicitly indefinite", value: "indefinite" }] } },
    { name: "expiryInstant", title: "Exclusive UTC deadline", type: "datetime", readOnly: true },
    { name: "imageCount", title: "Expected images (1–256)", type: "number", readOnly: true },
    { name: "manifestDigest", title: "Ordered delivery manifest SHA-256", type: "string", readOnly: true },
    { name: "deliveryZip", title: "One original whole-gallery ZIP", type: "file", readOnly: true,
      options: { accept: "application/zip", storeOriginalFilename: false } },
  ],
};
