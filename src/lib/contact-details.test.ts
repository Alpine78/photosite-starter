import { describe, expect, it } from "vitest";
import {
  OTHER_CONTACT_SUBJECT,
  parseContactDetails,
  resolveContactSubjectPrefill,
} from "@/lib/contact-details";

const services = [
  { serviceId: "portraits", name: "Portraits" },
  { serviceId: "events", name: "Events" },
];

describe("contact-only details", () => {
  it("keeps optional fields absent and defaults older submissions to Other", () => {
    expect(parseContactDetails({}, services)).toEqual({
      ok: true,
      details: { subject: OTHER_CONTACT_SUBJECT },
    });
  });

  it("normalizes bounded phone/date values and accepts a published service identity", () => {
    expect(parseContactDetails({
      phone: "  +358  40  123-4567  ",
      preferredDate: "2028-02-29",
      subject: "portraits",
    }, services)).toEqual({
      ok: true,
      details: {
        phone: "+358 40 123-4567",
        preferredDate: "2028-02-29",
        subject: "portraits",
      },
    });
  });

  it("rejects invalid, oversized or injected optional fields", () => {
    const result = parseContactDetails({
      phone: "1\nX-Injected: yes",
      preferredDate: "2027-02-29",
      subject: "unknown-service",
    }, services);
    expect(result).toEqual({
      ok: false,
      issues: [
        { field: "phone", code: "invalid-phone" },
        { field: "preferredDate", code: "invalid-date" },
        { field: "subject", code: "invalid-subject" },
      ],
    });
    expect(parseContactDetails({ phone: "1".repeat(41) }, services)).toMatchObject({
      ok: false,
      issues: [{ field: "phone", code: "too-long" }],
    });
    expect(parseContactDetails({ preferredDate: "2028-01-010" }, services)).toMatchObject({
      ok: false,
      issues: [{ field: "preferredDate", code: "too-long" }],
    });
  });

  it("never trusts a query value as a label or subject", () => {
    expect(resolveContactSubjectPrefill("portraits", services)).toBe("portraits");
    expect(resolveContactSubjectPrefill("Portraits", services)).toBe("portraits");
    expect(resolveContactSubjectPrefill("<script>", services)).toBe(OTHER_CONTACT_SUBJECT);
    expect(resolveContactSubjectPrefill(["portraits", "events"], services)).toBe(OTHER_CONTACT_SUBJECT);
    expect(resolveContactSubjectPrefill("x".repeat(129), services)).toBe(OTHER_CONTACT_SUBJECT);
    expect(resolveContactSubjectPrefill("Portraits", [
      ...services,
      { serviceId: "second-portrait", name: "Portraits" },
    ])).toBe(OTHER_CONTACT_SUBJECT);
  });
});
