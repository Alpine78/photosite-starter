/** Server-only request contract for one private gallery notification attempt. */
import "server-only";

import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import {
  CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS,
  CONTACT_FIELD_MAX_LENGTHS,
  EMAIL_SHAPE,
} from "@/lib/contact-message";

/** One outbox attempt key. A deliberate resend has a new key; retry keeps it. */
export type GalleryNotificationRequest = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly idempotencyKey: string;
};

export type GalleryNotificationTransport = {
  readonly name: string;
  deliver(request: GalleryNotificationRequest): Promise<ContactDeliveryOutcome>;
};

const SINGLE_LINE_CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;

export function isValidGalleryNotificationRecipient(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > CONTACT_FIELD_MAX_LENGTHS.email ||
    !EMAIL_SHAPE.test(value)
  ) return false;
  return (
    Buffer.byteLength(value.slice(0, value.indexOf("@")), "utf8") <=
    CONTACT_EMAIL_MAX_LOCAL_PART_OCTETS
  );
}

/** 200 plus the provider prefix is safely within Resend's 256-character limit. */
export function isValidGalleryNotificationIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

export type GalleryNotificationValidationReason =
  | "invalid-recipient"
  | "invalid-idempotency-key"
  | "invalid-content";

export class GalleryNotificationValidationError extends Error {
  readonly reason: GalleryNotificationValidationReason;

  constructor(reason: GalleryNotificationValidationReason) {
    super("[gallery-notification] " + reason);
    this.name = "GalleryNotificationValidationError";
    this.reason = reason;
  }
}

export function validateGalleryNotificationRequest(request: GalleryNotificationRequest): void {
  if (!isValidGalleryNotificationRecipient(request.to)) {
    throw new GalleryNotificationValidationError("invalid-recipient");
  }
  if (!isValidGalleryNotificationIdempotencyKey(request.idempotencyKey)) {
    throw new GalleryNotificationValidationError("invalid-idempotency-key");
  }
  if (
    typeof request.subject !== "string" ||
    request.subject.trim().length === 0 ||
    Buffer.byteLength(request.subject, "utf8") > 998 ||
    SINGLE_LINE_CONTROL.test(request.subject) ||
    typeof request.text !== "string" ||
    request.text.length === 0 ||
    Buffer.byteLength(request.text, "utf8") > 1_000_000
  ) {
    throw new GalleryNotificationValidationError("invalid-content");
  }
}
