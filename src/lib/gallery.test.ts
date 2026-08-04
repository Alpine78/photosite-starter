import { describe, expect, it } from "vitest";
import { getPortfolioGallery } from "@/lib/gallery";

describe("portfolio gallery media identity", () => {
  it("uses a unique placement identity for every current item", async () => {
    const gallery = await getPortfolioGallery();
    const placementIds = gallery.items.map((item) => item.placementId);

    expect(new Set(placementIds).size).toBe(placementIds.length);
  });
});
