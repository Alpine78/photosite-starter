import { describe, expect, it } from "vitest";
import { previewImageId } from "./preview-image";

describe("full-frame preview source", () => {
  it("discards authored crop and hotspot while keeping the original asset", () => {
    expect(previewImageId({
      asset: { _ref: "image-abc123-200x1600-jpg" },
      crop: { top: 0.5, bottom: 0.4 },
      hotspot: { x: 0, y: 0, width: 0.1, height: 0.1 },
    })).toBe("image-abc123-200x1600-jpg");
  });

  it("accepts asset documents and references without interpreting media documents as images", () => {
    expect(previewImageId({ _id: "image-abc123-1600x200-webp" })).toBe("image-abc123-1600x200-webp");
    expect(previewImageId({ _ref: "image-abc123-200x300-png" })).toBe("image-abc123-200x300-png");
    expect(previewImageId({ _ref: "shared-media" })).toBeUndefined();
  });

  it.each([undefined, null, "arbitrary-url", {}, { asset: {} }, { _ref: "image-x-0x1-jpg" }])(
    "does not construct an image request for malformed/non-image values: %j", (value) => {
      expect(previewImageId(value)).toBeUndefined();
    },
  );
});
