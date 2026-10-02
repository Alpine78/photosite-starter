/**
 * Exact presentation of a proof-selection amount stored in integer minor units.
 *
 * The confirmation snapshot stores only integers. Both its customer review and
 * the photographer notification can use this formatter, so they cannot choose
 * different decimal scales. BigInt keeps the fractional digits exact even at
 * Number.MAX_SAFE_INTEGER; converting the divided amount to Number would lose
 * cents near that bound.
 *
 * This module carries no private record or credential and may be used by a
 * client component. A currency label is presentation, never a charge.
 */

export type PrivateGalleryProofMoneyErrorReason =
  | "invalid-amount"
  | "invalid-currency"
  | "invalid-locale"
  | "unsupported-format";

export class PrivateGalleryProofMoneyError extends Error {
  readonly reason: PrivateGalleryProofMoneyErrorReason;

  constructor(reason: PrivateGalleryProofMoneyErrorReason) {
    super("[private-gallery-proof-money] " + reason);
    this.name = "PrivateGalleryProofMoneyError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryProofMoneyErrorReason): never {
  throw new PrivateGalleryProofMoneyError(reason);
}

/**
 * The locale's currency layout comes from Intl; the decimal digits come from
 * the exact minor-unit remainder. The stored integer remains authoritative.
 */
export function formatPrivateGalleryProofMoney(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    fail("invalid-amount");
  }
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    fail("invalid-currency");
  }
  if (typeof locale !== "string" || locale.length === 0) {
    fail("invalid-locale");
  }

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  } catch {
    fail("unsupported-format");
  }

  const options = formatter.resolvedOptions();
  const digits = options.maximumFractionDigits;
  if (
    typeof digits !== "number" ||
    !Number.isSafeInteger(digits) ||
    digits < 0 ||
    digits > 6 ||
    options.minimumFractionDigits !== digits
  ) fail("unsupported-format");

  const scale = BigInt(10) ** BigInt(digits);
  const whole = BigInt(amountMinor) / scale;
  const fraction = (BigInt(amountMinor) % scale)
    .toString()
    .padStart(digits, "0");
  const parts = formatter.formatToParts(whole);
  if (digits > 0 && parts.filter((part) => part.type === "fraction").length !== 1) {
    fail("unsupported-format");
  }

  return parts
    .map((part) => part.type === "fraction" ? fraction : part.value)
    .join("");
}
