import { describe, expect, it } from "vitest";
import { canOverlayComparison, MAX_COMPARISON_LABEL_LENGTH, MAX_COMPARISON_TITLE_LENGTH } from "./content-image-comparison";
import { projectPublicImageMedia } from "./media";
import { mockImages } from "./mock-media";
import { indexContentBodyImages } from "./content-body-media";
import { MAX_COMPARISON_LABEL_LENGTH as SCHEMA_LABEL, MAX_COMPARISON_TITLE_LENGTH as SCHEMA_TITLE } from "../../sanity/schemas/content-block";

describe("image comparison alignment", () => {
  const block = { type: "image-comparison" as const, first: mockImages.lakesideReeds, second: mockImages.lichenStones, firstLabel: "A", secondLabel: "B" };
  it("accepts native ratios even at different derivative resolutions", () => {
    expect(canOverlayComparison(block)).toBe(true);
    const smaller = projectPublicImageMedia({
      mediaId: "smaller",
      publiclyRenderable: true,
      rendition: {
        ...block.second.rendition,
        sourceKind: "public-web-derivative",
        width: 627,
        height: 627,
      },
      alt: "Smaller test derivative",
    });
    expect(canOverlayComparison({ ...block, second: smaller })).toBe(true);
  });
  it("refuses to overlay incompatible native ratios", () => {
    expect(canOverlayComparison({ ...block, second: mockImages.forestStream })).toBe(false);
  });
  it("never adds comparison placements to the body's loose-image sequence", () => {
    expect(indexContentBodyImages([block, { type: "media", media: mockImages.mistyBirch }]).size).toBe(1);
  });
  it("pins the Studio text bounds", () => {
    expect(MAX_COMPARISON_LABEL_LENGTH).toBe(SCHEMA_LABEL);
    expect(MAX_COMPARISON_TITLE_LENGTH).toBe(SCHEMA_TITLE);
  });
});
