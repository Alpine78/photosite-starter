import { describe, expect, it } from "vitest";
import { validateLocalizationReview } from "./localization-review";

 describe("localization review publication guard", () => {
  it("blocks copied fields while leaving ordinary documents and completed reviews valid", () => {
    expect(validateLocalizationReview({ localizationReview: { pendingFields: ["title", "body[0].text"] } })).toMatch(/Review the copied/);
    expect(validateLocalizationReview({ localizationReview: { pendingFields: [] } })).toBe(true);
    expect(validateLocalizationReview({ title: "Existing page" })).toBe(true);
    expect(validateLocalizationReview({ localizedFrom: "fi" })).toMatch(/need a review list/);
  });
});
