import type { SchemaTypeDefinition } from "./schema-types";

export const legacyDeliveryImageType: SchemaTypeDefinition = {
  name: "legacyDeliveryImage", title: "Legacy delivery image", type: "document",
  description: "One unchanged legacy JPEG. No crop, optimizer, archive path or customer contact fields.",
  fields: [
    { name: "imageId", title: "Opaque image identity", type: "string", readOnly: true },
    { name: "migrationBatch", title: "Approved batch digest", type: "string", readOnly: true },
    { name: "gallery", title: "Legacy gallery", type: "reference", to: [{ type: "legacyDeliveryGallery" }], readOnly: true },
    { name: "position", title: "Zero-based source order", type: "number", readOnly: true },
    { name: "source", title: "Unchanged JPEG", type: "image", readOnly: true,
      options: { accept: "image/jpeg", hotspot: false, storeOriginalFilename: false } },
    { name: "displayWidth", title: "Intrinsic width", type: "number", readOnly: true },
    { name: "displayHeight", title: "Intrinsic height", type: "number", readOnly: true },
    { name: "sourceOrientation", title: "Verified EXIF orientation (1)", type: "number", readOnly: true },
    { name: "alt", title: "Reviewed alt text", type: "string", readOnly: true },
  ],
};
