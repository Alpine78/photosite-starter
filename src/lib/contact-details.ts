/** Contact-only fields. Gallery enquiries keep their existing three-field contract. */

import { normalizeContactField } from "@/lib/contact-message";

export const CONTACT_DETAIL_FIELD_NAMES = ["phone", "preferredDate", "subject"] as const;
export type ContactDetailFieldName = (typeof CONTACT_DETAIL_FIELD_NAMES)[number];

/** Outside the allowed service-id alphabet, so it cannot collide with one. */
export const OTHER_CONTACT_SUBJECT = "__other__";

export const CONTACT_DETAIL_MAX_LENGTHS = {
  phone: 40,
  preferredDate: 10,
  subject: 128,
} as const satisfies Record<ContactDetailFieldName, number>;

export type ContactSubjectOption = {
  readonly serviceId: string;
  readonly name: string;
};

export type ContactDetails = {
  readonly phone?: string;
  readonly preferredDate?: string;
  readonly subject: string;
};

export type ContactDetailIssue = {
  readonly field: ContactDetailFieldName;
  readonly code: "too-long" | "invalid-phone" | "invalid-date" | "invalid-subject";
};

export type ContactDetailsResult =
  | { readonly ok: true; readonly details: ContactDetails }
  | { readonly ok: false; readonly issues: readonly ContactDetailIssue[] };

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/**
 * Validate after the common contact envelope has imposed its byte and key
 * limits. This never accepts an arbitrary service name as a submitted subject:
 * only a current published service identity or the reserved Other value.
 */
export function parseContactDetails(
  input: Partial<Record<ContactDetailFieldName, string>>,
  services: readonly ContactSubjectOption[],
): ContactDetailsResult {
  const phone = normalizeContactField(input.phone ?? "", false);
  const preferredDate = normalizeContactField(input.preferredDate ?? "", false);
  const subject = normalizeContactField(input.subject ?? OTHER_CONTACT_SUBJECT, false);
  const issues: ContactDetailIssue[] = [];

  if ([...phone].length > CONTACT_DETAIL_MAX_LENGTHS.phone) {
    issues.push({ field: "phone", code: "too-long" });
  } else if (phone && (!/^[+0-9() .\-/]+$/u.test(phone) || (phone.match(/\d/gu) ?? []).length < 3)) {
    issues.push({ field: "phone", code: "invalid-phone" });
  }

  if (preferredDate.length > CONTACT_DETAIL_MAX_LENGTHS.preferredDate) {
    issues.push({ field: "preferredDate", code: "too-long" });
  } else if (preferredDate && !validCalendarDate(preferredDate)) {
    issues.push({ field: "preferredDate", code: "invalid-date" });
  }

  if (
    [...subject].length > CONTACT_DETAIL_MAX_LENGTHS.subject ||
    (subject !== OTHER_CONTACT_SUBJECT && !services.some((service) => service.serviceId === subject))
  ) {
    issues.push({ field: "subject", code: "invalid-subject" });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        details: {
          ...(phone ? { phone } : {}),
          ...(preferredDate ? { preferredDate } : {}),
          subject,
        },
      };
}

/** Query values are hints only. Reject arrays and overlong values without echoing them. */
export function resolveContactSubjectPrefill(
  raw: string | readonly string[] | undefined,
  services: readonly ContactSubjectOption[],
): string {
  if (typeof raw !== "string" || raw.length > CONTACT_DETAIL_MAX_LENGTHS.subject) {
    return OTHER_CONTACT_SUBJECT;
  }
  const byId = services.find((service) => service.serviceId === raw);
  if (byId !== undefined) return byId.serviceId;
  // Existing service links used the display name. Preserve only an unambiguous
  // exact match; never reflect unknown query text into the form or email.
  const byName = services.filter((service) => service.name === raw);
  return byName.length === 1 ? byName[0].serviceId : OTHER_CONTACT_SUBJECT;
}
