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
 * Explicit maximum lengths of the normalized value.
 *
 * The units differ by field, deliberately. `name` and `message` are product
 * choices — generous enough for a real enquiry, small enough to keep a request
 * body bounded — and are counted in **code points**, so a limit measures what a
 * person sees they typed.
 *
 * `email` is not a product choice: it is the 254-**octet** ceiling a mailbox
 * path may occupy in an SMTP transaction, and it is measured in UTF-8 octets
 * for that reason. Counting an internationalized address in code points would
 * accept one the delivery provider then refuses, which is a failure the visitor
 * cannot act on because the form told them the address was fine.
 */
export const CONTACT_FIELD_MAX_LENGTHS = {
  name: 100,
  email: 254,
  message: 4000,
} as const satisfies Record<ContactFieldName, number>;

/**
 * Maximum local part of an address, in UTF-8 octets (RFC 5321 §4.5.3.1.1). An
 * address over it is not deliverable, so it is reported as an address we cannot
 * reply to rather than as a length to trim: "shorten this to 254" would name
 * the wrong limit and the wrong part of the value.
 */
export const CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS = 64;

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

const utf8 = new TextEncoder();

/** Length in UTF-8 octets: what an address limit is actually expressed in. */
function lengthInOctets(value: string): number {
  return utf8.encode(value).length;
}

/**
 * Validates one already-normalized value, returning the first thing wrong with
 * it or `undefined`.
 *
 * The address is checked in three steps and in this order: its total size,
 * then its shape, then its local part — the last needs the shape to hold,
 * because only then is there exactly one `@` to split on.
 */
function validateField(
  field: ContactFieldName,
  value: string,
): ContactIssueCode | undefined {
  if (value.length === 0) return "required";

  const measured =
    field === "email" ? lengthInOctets(value) : lengthInCodePoints(value);
  if (measured > CONTACT_FIELD_MAX_LENGTHS[field]) return "too-long";

  if (field !== "email") return undefined;
  if (!EMAIL_SHAPE.test(value)) return "invalid-email";

  const localPart = value.slice(0, value.indexOf("@"));
  return lengthInOctets(localPart) > CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS
    ? "invalid-email"
    : undefined;
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

    const code = validateField(field, value);
    if (code !== undefined) issues.push({ field, code });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, message: normalized };
}
