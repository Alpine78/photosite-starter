/**
 * The contact submission the application accepts, as a validated value.
 *
 * Everything a visitor types crosses this module before it reaches delivery,
 * and nothing else in the contact path is allowed to invent a field. Three
 * rules follow from that:
 *
 * - **The field set is closed.** `CONTACT_FIELD_NAMES` is the whitelist the
 *   request boundary enforces, so a submission carrying anything else is
 *   rejected rather than partially accepted.
 * - **Every value is normalized before it is measured.** A limit applied to raw
 *   input measures whitespace and invisible characters instead of content, so
 *   normalization runs first and the limit applies to what a person actually
 *   wrote.
 * - **Issues are codes, not sentences.** The server never returns UI copy: the
 *   route space that rendered the form owns the wording in its own locale, and
 *   a localized string crossing the wire would have to be built somewhere that
 *   does not know the visitor's language.
 *
 * The module is deliberately free of HTTP, delivery, and configuration
 * concerns, which keeps it directly testable and keeps the rules in one place
 * whether a submission arrives from the contact page or, later, from the
 * gallery enquiry flow (AB#60).
 */

/**
 * The fields a contact submission may carry. Attachments and submitted HTML
 * are outside the MVP, so there is no field for either and nothing downstream
 * has to strip one.
 */
export const CONTACT_FIELD_NAMES = ["name", "email", "message"] as const;

export type ContactFieldName = (typeof CONTACT_FIELD_NAMES)[number];

/**
 * Explicit maximum lengths, counted in code points of the normalized value.
 *
 * The address limit is the 254-octet ceiling a mailbox path may occupy in an
 * SMTP transaction; the other two are product choices generous enough for a
 * real enquiry and small enough to keep a request body bounded.
 */
export const CONTACT_FIELD_MAX_LENGTHS = {
  name: 100,
  email: 254,
  message: 4000,
} as const satisfies Record<ContactFieldName, number>;

export type ContactMessage = {
  readonly [Field in ContactFieldName]: string;
};

/**
 * Why one field was not accepted. The set is closed so the form can map every
 * code to copy in its own locale and fail loudly when a new code appears.
 */
export type ContactIssueCode = "required" | "too-long" | "invalid-email";

export type ContactFieldIssue = {
  readonly field: ContactFieldName;
  readonly code: ContactIssueCode;
};

export type ContactMessageResult =
  | { readonly ok: true; readonly message: ContactMessage }
  | { readonly ok: false; readonly issues: readonly ContactFieldIssue[] };

/**
 * Characters that occupy no visual space: zero-width joiners and spaces, bidi
 * overrides and isolates, and the byte-order mark. They survive a trim, count
 * against a length limit, and can make two different strings render
 * identically — a name that reads as one person's while being another's. None
 * of them carries meaning in a name, an address, or an enquiry, so they are
 * removed rather than escaped.
 */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;

/**
 * C0 and C1 control characters, excluding the line feed that survives
 * `normalizeLineBreaks` in a multi-line field. A carriage return never reaches
 * this point as a line break, so anything matched here is a stray control code.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/gu;

/** Horizontal whitespace runs, collapsed to one space in single-line fields. */
const HORIZONTAL_WHITESPACE_RUN = /[^\S\n]+/gu;

/** Three or more consecutive line breaks, collapsed to a blank line. */
const EXCESSIVE_LINE_BREAKS = /\n{3,}/gu;

/**
 * A pragmatic address shape: a local part with no whitespace or the delimiters
 * that separate addresses in a header, and a dotted domain of alphanumeric
 * labels.
 *
 * It rejects some addresses RFC 5322 permits — quoted local parts, address
 * literals, and single-label domains. That is the intended trade: those forms
 * do not appear in a public contact form, and the value here is a reply-to
 * address, so accepting a shape the delivery provider will reject anyway helps
 * nobody. Deliverability is never claimed, only plausibility.
 */
const EMAIL_SHAPE =
  /^[^\s@,;:<>"'\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu;

/** Normalizes the several ways a browser or platform can encode a line break. */
function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?|\u2028|\u2029/gu, "\n");
}

/**
 * Normalizes a value the visitor typed.
 *
 * Composition is normalized to NFC first, so `ä` typed as one code point and
 * `ä` typed as two are the same value and are measured as the same length.
 * Line breaks are then either removed (single-line fields, where a break is
 * either an accident or an injection attempt) or preserved and bounded
 * (the message, where paragraphs are the point).
 */
function normalizeField(value: string, multiline: boolean): string {
  const composed = normalizeLineBreaks(value.normalize("NFC"))
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(CONTROL_CHARACTERS, "");

  const withoutStructuralNoise = multiline
    ? composed
        .split("\n")
        .map((line) => line.replace(HORIZONTAL_WHITESPACE_RUN, " ").trim())
        .join("\n")
        .replace(EXCESSIVE_LINE_BREAKS, "\n\n")
    : composed.replace(/\n/gu, " ").replace(HORIZONTAL_WHITESPACE_RUN, " ");

  return withoutStructuralNoise.trim();
}

/**
 * Length in code points rather than UTF-16 units, so an emoji or an
 * astral-plane character costs what it looks like it costs instead of two.
 */
function lengthInCodePoints(value: string): number {
  return [...value].length;
}

/**
 * Normalizes and validates one raw submission.
 *
 * A missing field and an empty one are the same state: the form marks a field
 * required, and a value that normalizes to nothing was never filled in. All
 * issues are collected rather than reported one at a time, because an
 * accessible error summary lists every problem at once and a visitor should
 * not have to submit three times to find three mistakes.
 */
export function parseContactMessage(
  input: Partial<Record<ContactFieldName, string>>,
): ContactMessageResult {
  const issues: ContactFieldIssue[] = [];
  const normalized = {} as Record<ContactFieldName, string>;

  for (const field of CONTACT_FIELD_NAMES) {
    const value = normalizeField(input[field] ?? "", field === "message");
    normalized[field] = value;

    if (value.length === 0) {
      issues.push({ field, code: "required" });
      continue;
    }
    if (lengthInCodePoints(value) > CONTACT_FIELD_MAX_LENGTHS[field]) {
      issues.push({ field, code: "too-long" });
      continue;
    }
    if (field === "email" && !EMAIL_SHAPE.test(value)) {
      issues.push({ field, code: "invalid-email" });
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, message: normalized };
}
