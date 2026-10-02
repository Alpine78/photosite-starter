import { describe, expect, it } from "vitest";

import {
  formatPrivateGalleryProofMoney,
  PrivateGalleryProofMoneyError,
} from "@/lib/private-gallery-proof-money";

describe("formatPrivateGalleryProofMoney", () => {
  it("uses each currency's digits and the locale's layout", () => {
    expect(formatPrivateGalleryProofMoney(1250, "EUR", "fi-FI")).toContain("12,50");
    expect(formatPrivateGalleryProofMoney(1250, "JPY", "en-GB")).toContain("1,250");
    expect(formatPrivateGalleryProofMoney(1250, "KWD", "en-GB")).toContain("1.250");
  });

  it("preserves the exact minor-unit remainder near the safe integer limit", () => {
    expect(formatPrivateGalleryProofMoney(
      Number.MAX_SAFE_INTEGER, "EUR", "en-GB",
    )).toBe("€90,071,992,547,409.91");
    expect(formatPrivateGalleryProofMoney(0, "EUR", "en-GB")).toBe("€0.00");
  });

  it.each([
    [-1, "EUR", "fi-FI", "invalid-amount"],
    [1.5, "EUR", "fi-FI", "invalid-amount"],
    [Number.MAX_SAFE_INTEGER + 1, "EUR", "fi-FI", "invalid-amount"],
    [1, "eur", "fi-FI", "invalid-currency"],
    [1, "EUR", "", "invalid-locale"],
  ])("refuses an unusable amount, currency or locale", (amount, currency, locale, reason) => {
    try {
      formatPrivateGalleryProofMoney(amount, currency, locale);
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateGalleryProofMoneyError);
      expect((error as PrivateGalleryProofMoneyError).reason).toBe(reason);
    }
  });
});
