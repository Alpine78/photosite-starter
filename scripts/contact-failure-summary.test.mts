import { describe, expect, it } from "vitest";
import { FAILURE_INPUT_LIMITS, summarizeContactFailures } from "./contact-failure-summary.mts";
const event = (state: string, errorClass?: string, correlationId = "synthetic-id", family = "contact.submission") => ({ event: family, correlationId, state, ...(errorClass ? { errorClass } : {}) });
const lines = (...values: unknown[]) => values.map((value) => JSON.stringify(value)).join("\n") + "\n";
describe("closed redacted submission summary", () => {
  it("deduplicates accepted/terminal lines by family and correlation", () => {
    const result = summarizeContactFailures(lines(event("accepted"), event("accepted"), event("delivered"), event("delivered"), event("delivery-failed", "timeout", "synthetic-id", "enquiry.submission")));
    expect(result).toMatchObject({ status: "failures", duplicateEvents: 2, correlations: 2, counts: { contact: { states: { accepted: 1, delivered: 1 }, failures: 0 }, enquiry: { failures: 1 } } });
  });
  it("separates expected refusal from rejected defects and all delivery failures", () => {
    for (const error of ["source-unavailable", "source-error", "malformed-source", "internal"]) expect(summarizeContactFailures(lines(event("rejected", error, "id", "enquiry.submission"))).counts.enquiry.failures).toBe(1);
    expect(summarizeContactFailures(lines(event("rejected", "honeypot"))).counts.contact.expectedRefusals).toBe(1);
    expect(summarizeContactFailures(lines(event("delivery-failed", "honeypot"))).counts.contact.failures).toBe(1);
  });
  it("accepted alone, empty and unterminated input are never complete", () => {
    expect(summarizeContactFailures(lines(event("accepted"))).status).toBe("incomplete");
    expect(summarizeContactFailures("").status).toBe("invalid");
    expect(summarizeContactFailures(JSON.stringify(event("delivered"))).status).toBe("invalid");
  });
  it("rejects unknown classes, extra sensitive fields, missing IDs and conflicting terminals", () => {
    for (const value of [event("rejected", "TOKEN_SECRET"), { ...event("delivered"), message: "EMAIL_SECRET" }, { event: "contact.submission", state: "delivered" }, event("failed"), { ...event("accepted"), errorClass: null }]) {
      const output = JSON.stringify(summarizeContactFailures(lines(value)));
      expect(JSON.parse(output).status).toBe("invalid"); expect(output).not.toMatch(/TOKEN_SECRET|EMAIL_SECRET|synthetic-id/);
    }
    expect(summarizeContactFailures(lines(event("delivered"), event("delivery-failed", "timeout"))).invalidRecords).toBe(1);
  });
  it("ignores no malformed lines and handles prototype-like correlations safely", () => {
    expect(summarizeContactFailures('{"secret":"VALUE"\n').invalidRecords).toBe(1);
    expect(summarizeContactFailures(lines(event("delivered", undefined, "__proto__"))).status).toBe("complete");
    expect(summarizeContactFailures(lines(event("rejected", "__proto__"))).status).toBe("invalid");
  });
  it("bounds record bytes, total bytes and distinct correlations", () => {
    expect(summarizeContactFailures("X".repeat(FAILURE_INPUT_LIMITS.recordBytes + 1) + "\n").status).toBe("invalid");
    expect(summarizeContactFailures("X".repeat(FAILURE_INPUT_LIMITS.bytes + 1)).status).toBe("invalid");
    const rows = Array.from({ length: FAILURE_INPUT_LIMITS.correlations + 1 }, (_, index) => event("delivered", undefined, `id-${index}`));
    expect(summarizeContactFailures(lines(...rows))).toMatchObject({ status: "invalid", correlations: FAILURE_INPUT_LIMITS.correlations, invalidRecords: 1 });
  });
});
