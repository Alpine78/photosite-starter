import { describe, expect, it } from "vitest";
import * as schema from "./proof-terms";
import * as server from "../../src/lib/proof-terms";

describe("proof terms parity between the Studio dialog and the publication route", () => {
  it("agrees on currencies, prices, addresses and terms", () => {
    expect(server.PROOF_CURRENCIES).toEqual(schema.PROOF_CURRENCIES);
    for (const [text, currency] of [["12,50", "EUR"], ["12,505", "EUR"], ["1500", "JPY"], ["1,5", "JPY"], ["x", "EUR"]]) {
      expect(server.parseProofPrice(text, currency)).toBe(schema.parseProofPrice(text, currency));
    }
    for (const address of ["a@example.fi", "a@b", "a..b@example.fi", "x@xn--bcher-kva.example"]) {
      expect(server.isProofCustomerEmail(address)).toBe(schema.isProofCustomerEmail(address));
    }
    const terms = { includedCount: 5, extraUnitPriceMinor: 900, currency: "SEK", jobReference: "job", reminder: null };
    for (const value of [terms, { ...terms, currency: "XXX" }, { ...terms, reminder: { delayDays: 30, customerEmail: "a@example.fi" } }]) {
      expect(server.parseProofTerms(value)).toEqual(schema.parseProofTerms(value));
    }
  });
});
