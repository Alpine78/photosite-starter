import { describe, expect, it } from "vitest";

import {
  CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS,
  CONTACT_FIELD_MAX_LENGTHS,
  parseContactMessage,
  type ContactFieldName,
} from "@/lib/contact-message";

const valid = {
  name: "Jane Example",
  email: "jane@example.com",
  message: "Are you available in June?",
};

/** Zero-width space, byte-order mark, and a bidi isolate. */
const INVISIBLE = "\u200B\uFEFF\u2066";

function issueCodes(input: Partial<Record<ContactFieldName, string>>) {
  const result = parseContactMessage(input);
  return result.ok
    ? []
    : result.issues.map(({ field, code }) => `${field}:${code}`);
}

function parsed(input: Partial<Record<ContactFieldName, string>>) {
  const result = parseContactMessage(input);
  if (!result.ok) {
    throw new Error(`expected a valid message: ${issueCodes(input)}`);
  }
  return result.message;
}

describe("parseContactMessage", () => {
  it("accepts an ordinary enquiry unchanged", () => {
    expect(parsed(valid)).toEqual(valid);
  });

  it("reports every empty field at once rather than one per submission", () => {
    expect(issueCodes({})).toEqual([
      "name:required",
      "email:required",
      "message:required",
    ]);
  });

  it("treats a field of only whitespace as one that was never filled in", () => {
    expect(issueCodes({ ...valid, name: "   \t  " })).toEqual(["name:required"]);
  });

  it("removes invisible characters instead of counting them as content", () => {
    expect(issueCodes({ ...valid, name: INVISIBLE })).toEqual(["name:required"]);
  });

  it("collapses a name that only invisible characters made look different", () => {
    expect(parsed({ ...valid, name: "Ja\u200Bne" }).name).toBe("Jane");
  });

  it("composes decomposed characters so a limit measures what was typed", () => {
    // Base letters plus combining diaereses, which NFC composes to two chars.
    expect(parsed({ ...valid, name: "A\u0308a\u0308" }).name).toBe("Ää");
  });

  it("folds line breaks and control characters out of single-line fields", () => {
    expect(
      parsed({ ...valid, name: "Jane\r\nBcc: someone@example.com" }).name,
    ).toBe("Jane Bcc: someone@example.com");
    expect(parsed({ ...valid, email: "jane@example.com " }).email).toBe(
      "jane@example.com",
    );
  });

  it("keeps paragraphs in the message and bounds runs of blank lines", () => {
    expect(
      parsed({ ...valid, message: "First\r\n\r\n\r\n\r\nSecond" }).message,
    ).toBe("First\n\nSecond");
  });

  it("counts a length limit in code points, not UTF-16 units", () => {
    // Each of these is one code point and two UTF-16 units.
    const astral = "\u{1F600}".repeat(CONTACT_FIELD_MAX_LENGTHS.name);
    expect(issueCodes({ ...valid, name: astral })).toEqual([]);
    expect(issueCodes({ ...valid, name: `${astral}\u{1F600}` })).toEqual([
      "name:too-long",
    ]);
  });

  it("applies each field's own limit", () => {
    expect(
      issueCodes({
        ...valid,
        message: "x".repeat(CONTACT_FIELD_MAX_LENGTHS.message + 1),
      }),
    ).toEqual(["message:too-long"]);
  });

  it("reports one issue per field, so a too-long address is not also invalid", () => {
    const overlong = `${"a".repeat(CONTACT_FIELD_MAX_LENGTHS.email)}@example.com`;
    expect(issueCodes({ ...valid, email: overlong })).toEqual(["email:too-long"]);
  });

  it.each([
    "jane@example.com",
    "jane.doe+enquiry@sub.example.co.uk",
    "jane_doe@example-studio.fi",
  ])("accepts the address %s", (email) => {
    expect(issueCodes({ ...valid, email })).toEqual([]);
  });

  it("measures the address in UTF-8 octets, which is what SMTP limits", () => {
    // Each "ä" is one code point and two octets, so an address a code-point
    // count would accept is over the limit a delivery provider applies.
    const domain = "@example.com";
    const localPart = "ä".repeat(
      (CONTACT_FIELD_MAX_LENGTHS.email - domain.length) / 2 + 1,
    );

    expect([...`${localPart}${domain}`].length).toBeLessThan(
      CONTACT_FIELD_MAX_LENGTHS.email,
    );
    expect(issueCodes({ ...valid, email: `${localPart}${domain}` })).toEqual([
      "email:too-long",
    ]);
  });

  it("refuses a local part longer than a mailbox may have", () => {
    const localPart = "a".repeat(CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS + 1);

    // Reported as an address we cannot reply to, not as a length to trim: the
    // total is well inside its own limit, so naming that limit would point at
    // the wrong part of the value.
    expect(issueCodes({ ...valid, email: `${localPart}@example.com` })).toEqual([
      "email:invalid-email",
    ]);
  });

  it("accepts a local part exactly at the limit", () => {
    const localPart = "a".repeat(CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS);

    expect(issueCodes({ ...valid, email: `${localPart}@example.com` })).toEqual(
      [],
    );
  });

  it.each([
    "jane",
    "jane@",
    "@example.com",
    "jane@localhost",
    "jane@example .com",
    "jane<script>@example.com",
    "jane@example.com, other@example.com",
    "Jane <jane@example.com>",
  ])("rejects the address %s", (email) => {
    expect(issueCodes({ ...valid, email })).toEqual(["email:invalid-email"]);
  });
});
