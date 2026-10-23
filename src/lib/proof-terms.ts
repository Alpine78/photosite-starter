/**
 * Proof selection terms for the publication route (ADR-0038 decisions 3 and 9,
 * AB#130). Restated from `sanity/schemas/proof-terms.ts`, which the Studio
 * dialog uses: application code never imports the schema package.
 * `sanity/schemas/proof-terms.parity.test.ts` keeps both in step.
 */

/** Supported currencies and their minor-unit digits; a closed list, not a syntax check. */
export const PROOF_CURRENCIES: Readonly<Record<string, number>> = {
  EUR: 2, USD: 2, GBP: 2, SEK: 2, NOK: 2, DKK: 2, CHF: 2, JPY: 0,
};
export const PROOF_MAX_INCLUDED = 256;
export const PROOF_MAX_PRICE_MINOR = 100_000_000;
export const PROOF_MAX_REMINDER_DAYS = 365;
export const PROOF_JOB_REFERENCE_MAX = 100;

export type ProofReminderTerms = Readonly<{ delayDays: number; customerEmail: string }>;
export type ProofTerms = Readonly<{
  includedCount: number;
  extraUnitPriceMinor: number;
  currency: string;
  jobReference: string;
  /** `null`: no reminder, and no customer address is stored. */
  reminder: ProofReminderTerms | null;
}>;

function plainText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length >= 1 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

/** A bounded, ordinary mailbox address; not a full RFC 5322 parser. */
export function isProofCustomerEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254 || /[\s\u0000-\u001f\u007f<>()[\]\\,;:"]/u.test(value)) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at), domain = value.slice(at + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(label)) &&
    /^[A-Za-z]{2,63}$|^xn--[A-Za-z0-9-]{1,59}$/u.test(labels[labels.length - 1]);
}

/** The closed terms object, or `undefined`. */
export function parseProofTerms(value: unknown): ProofTerms | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const fields = ["includedCount", "extraUnitPriceMinor", "currency", "jobReference", "reminder"];
  if (Object.keys(row).length !== fields.length || !fields.every((name) => Object.hasOwn(row, name))) return undefined;
  const { includedCount, extraUnitPriceMinor, currency, jobReference, reminder } = row;
  if (!Number.isSafeInteger(includedCount) || (includedCount as number) < 0 || (includedCount as number) > PROOF_MAX_INCLUDED) return undefined;
  if (!Number.isSafeInteger(extraUnitPriceMinor) || (extraUnitPriceMinor as number) < 0 || (extraUnitPriceMinor as number) > PROOF_MAX_PRICE_MINOR) return undefined;
  if (typeof currency !== "string" || !Object.hasOwn(PROOF_CURRENCIES, currency)) return undefined;
  if (!plainText(jobReference, PROOF_JOB_REFERENCE_MAX)) return undefined;
  let parsedReminder: ProofReminderTerms | null = null;
  if (reminder !== null) {
    if (typeof reminder !== "object" || Array.isArray(reminder) || reminder === undefined) return undefined;
    const r = reminder as Record<string, unknown>;
    if (Object.keys(r).length !== 2 || !Number.isSafeInteger(r.delayDays) || (r.delayDays as number) < 1 ||
      (r.delayDays as number) > PROOF_MAX_REMINDER_DAYS || !isProofCustomerEmail(r.customerEmail)) return undefined;
    parsedReminder = { delayDays: r.delayDays as number, customerEmail: r.customerEmail };
  }
  return { includedCount: includedCount as number, extraUnitPriceMinor: extraUnitPriceMinor as number,
    currency, jobReference: jobReference as string, reminder: parsedReminder };
}

/**
 * A price typed by the editor ("12,50", "12.50", "12") in minor units, or
 * `undefined`. Parsed as text: no floating point, and no more fraction digits
 * than the currency has.
 */
export function parseProofPrice(text: string, currency: string): number | undefined {
  if (!Object.hasOwn(PROOF_CURRENCIES, currency)) return undefined;
  const digits = PROOF_CURRENCIES[currency];
  const trimmed = text.trim();
  const match = digits === 0 ? /^(\d{1,9})$/u.exec(trimmed) : new RegExp(`^(\\d{1,9})(?:[.,](\\d{1,${digits}}))?$`, "u").exec(trimmed);
  if (!match) return undefined;
  const minor = Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) && minor <= PROOF_MAX_PRICE_MINOR ? minor : undefined;
}
