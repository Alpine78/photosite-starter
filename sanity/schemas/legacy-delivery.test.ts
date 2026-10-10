import { describe, expect, it } from "vitest";
import { legacyDeliveryGalleryType } from "./legacy-delivery-gallery";
import { legacyDeliveryImageType } from "./legacy-delivery-image";

describe("legacy continuity schema boundary", () => {
  it("separates byte-preserved images from ordinary public media", () => {
    expect(legacyDeliveryImageType.fields?.find((f) => f.name === "source")?.options).toEqual({ accept: "image/jpeg", hotspot: false, storeOriginalFilename: false });
    expect(legacyDeliveryImageType.fields?.find((f) => f.name === "gallery")?.to).toEqual([{ type: "legacyDeliveryGallery" }]);
    expect(legacyDeliveryGalleryType.fields?.find((f) => f.name === "deliveryZip")?.options).toEqual({ accept: "application/zip", storeOriginalFilename: false });
  });
  it("starts unavailable and keeps approved imported fields read-only", () => {
    expect(legacyDeliveryGalleryType.fields?.find((f) => f.name === "published")?.initialValue).toBe(false);
    for (const schema of [legacyDeliveryGalleryType, legacyDeliveryImageType]) {
      expect(schema.fields?.every((f) => f.readOnly)).toBe(true);
      expect(schema.fields?.map((f) => f.name)).not.toContain("archiveLocator");
      expect(schema.fields?.map((f) => f.name)).not.toContain("email");
    }
  });
});
