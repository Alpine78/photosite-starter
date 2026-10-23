import { describe, expect, it } from "vitest";
import { isProofCustomerEmail, parseProofPrice, parseProofTerms } from "./proof-terms";

const terms = { includedCount: 20, extraUnitPriceMinor: 1500, currency: "EUR", jobReference: "2026-17", reminder: { delayDays: 7, customerEmail: "asiakas@example.fi" } };

describe("proof terms (ADR-0038 decisions 3 and 9)", () => {
  it("parses prices as text in the currency's minor units", () => {
    expect(parseProofPrice("12,50", "EUR")).toBe(1250);
    expect(parseProofPrice("12.5", "EUR")).toBe(1250);
    expect(parseProofPrice(" 12 ", "EUR")).toBe(1200);
    expect(parseProofPrice("0", "EUR")).toBe(0);
    expect(parseProofPrice("1500", "JPY")).toBe(1500);
    for (const [text, currency] of [["12,505", "EUR"], ["12,5", "JPY"], ["-1", "EUR"], ["1e3", "EUR"], ["", "EUR"], ["12", "XXX"], ["1 000", "EUR"], ["1000001", "EUR"]]) {
      expect(parseProofPrice(text, currency)).toBeUndefined();
    }
  });
  it("accepts exactly the closed terms object", () => {
    expect(parseProofTerms(terms)).toEqual(terms);
    expect(parseProofTerms({ ...terms, reminder: null })).toEqual({ ...terms, reminder: null });
    for (const bad of [
      { ...terms, currency: "eur" }, { ...terms, currency: "XAU" }, { ...terms, includedCount: -1 }, { ...terms, includedCount: 1.5 },
      { ...terms, extraUnitPriceMinor: 100_000_001 }, { ...terms, jobReference: "" }, { ...terms, jobReference: " padded" },
      { ...terms, jobReference: "x".repeat(101) }, { ...terms, reminder: { delayDays: 0, customerEmail: "a@example.fi" } },
      { ...terms, reminder: { delayDays: 7 } }, { ...terms, reminder: { delayDays: 7, customerEmail: "not-an-address" } },
      { ...terms, extra: 1 }, { includedCount: 1 }, null, [],
    ]) expect(parseProofTerms(bad)).toBeUndefined();
  });
  it("checks customer addresses conservatively", () => {
    for (const ok of ["a@example.fi", "first.last+tag@sub.example.com", "x@xn--bcher-kva.example"]) expect(isProofCustomerEmail(ok)).toBe(true);
    for (const bad of ["", "a@b", "@example.fi", "a@@example.fi", "a b@example.fi", "a@example..fi", ".a@example.fi", "a.@example.fi", "a@-example.fi", "<a@example.fi>", "a@example.f", `${"a".repeat(65)}@example.fi`]) {
      expect(isProofCustomerEmail(bad)).toBe(false);
    }
  });
});
