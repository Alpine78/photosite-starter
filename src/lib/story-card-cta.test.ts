import { describe, expect, it } from "vitest";

import { getBuiltInLabels } from "@/lib/deployment-config";
import { getMockGalleryImageCount } from "@/lib/mock-gallery";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import { storyCardCallToAction } from "@/lib/story-card-cta";

describe("storyCardCallToAction (AB#298)", () => {
  const fi = getBuiltInLabels("fi");
  const en = getBuiltInLabels("en");

  it("names the photograph count of a counted gallery in each language", () => {
    expect(storyCardCallToAction({ variant: "gallery", imageCount: 86 }, fi)).toBe("Katso 86 kuvaa");
    expect(storyCardCallToAction({ variant: "gallery", imageCount: 86 }, en)).toBe("View 86 photos");
  });

  it("uses the singular for one photograph", () => {
    expect(storyCardCallToAction({ variant: "gallery", imageCount: 1 }, fi)).toBe("Katso 1 kuva");
    expect(storyCardCallToAction({ variant: "gallery", imageCount: 1 }, en)).toBe("View 1 photo");
  });

  it("falls back to count-free wording when a gallery has no count", () => {
    expect(storyCardCallToAction({ variant: "gallery" }, fi)).toBe("Katso kuvat");
    expect(storyCardCallToAction({ variant: "gallery", imageCount: 0 }, en)).toBe("View photos");
  });

  it("invites reading an article and ignores any count", () => {
    expect(storyCardCallToAction({ variant: "article" }, fi)).toBe("Lue tarina");
    expect(storyCardCallToAction({ variant: "article", imageCount: 9 }, en)).toBe("Read the story");
  });
});

describe("mock gallery image counts (AB#298)", () => {
  it("counts only visible, non-private placements and nothing for an article", () => {
    expect(getMockGalleryImageCount("en", "content-coastal-mornings")).toBeGreaterThan(0);
    expect(getMockGalleryImageCount("en", "content-awaiting-selection")).toBe(0);
    expect(getMockGalleryImageCount("en", "no-such-page")).toBeUndefined();
  });

  it("puts the count on a gallery's listing record and omits it when empty", () => {
    const records = mockContentListingRecords["en"]!;
    expect(records.get("content-coastal-mornings")?.imageCount).toBe(
      getMockGalleryImageCount("en", "content-coastal-mornings"),
    );
    expect(records.get("content-awaiting-selection")).not.toHaveProperty("imageCount");
  });
});
