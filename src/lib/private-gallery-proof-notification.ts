/**
 * Photographer notification for one immutable AB#130 confirmation version.
 *
 * This is a provider-independent plain-text projection. The private outbox
 * owns persistence, one initial send per version, resend attempts, delivery
 * status and deduplication; this function enforces none of those guarantees.
 * A resend passes the same confirmation and a new outbox attempt key. No draft or current default price is read here.
 */

import "server-only";

import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  isValidGalleryNotificationIdempotencyKey,
  isValidGalleryNotificationRecipient,
} from "@/lib/gallery-notification";
import {
  isPrivateGalleryProofBusinessReference,
  isPrivateGalleryProofFilename,
  isPrivateGalleryProofMediaId,
  summarizePrivateGalleryProofSelection,
  type PrivateGalleryProofConfirmation,
} from "@/lib/private-gallery-proof";
import { formatPrivateGalleryProofMoney } from "@/lib/private-gallery-proof-money";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";

export type PrivateGalleryProofNotification = {
  /** Validated per message; the transport must use this recipient. */
  readonly to: string;
  /** Application-owned wording only, with no customer or filename data. */
  readonly subject: string;
  readonly text: string;
  /** Passed through; the future outbox, not this builder, deduplicates it. */
  readonly idempotencyKey: string;
};

export type PrivateGalleryProofNotificationErrorReason =
  | "invalid-recipient"
  | "invalid-reference"
  | "invalid-confirmation"
  | "invalid-idempotency-key"
  | "format-unavailable";

export class PrivateGalleryProofNotificationError extends Error {
  readonly reason: PrivateGalleryProofNotificationErrorReason;

  constructor(reason: PrivateGalleryProofNotificationErrorReason) {
    // Never put a recipient, filename, reference, selection or message in an error.
    super("[private-gallery-proof-notification] " + reason);
    this.name = "PrivateGalleryProofNotificationError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryProofNotificationErrorReason): never {
  throw new PrivateGalleryProofNotificationError(reason);
}

const SINGLE_LINE_CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;
const PROOF_REFERENCE = /^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/;

function validSnapshot(value: unknown): value is PrivateGalleryProofConfirmation {
  if (typeof value !== "object" || value === null) return false;
  const confirmation = value as PrivateGalleryProofConfirmation;
  if (
    typeof confirmation.galleryId !== "string" ||
    confirmation.galleryId.length === 0 ||
    !Number.isSafeInteger(confirmation.version) ||
    confirmation.version < 1 ||
    !(confirmation.confirmedAt instanceof Date) ||
    !Number.isFinite(confirmation.confirmedAt.getTime()) ||
    !Array.isArray(confirmation.selectedImages) ||
    confirmation.selectedImages.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
    confirmation.summary === undefined
  ) return false;

  const references = new Set<string>();
  const mediaIds = new Set<string>();
  for (const image of confirmation.selectedImages) {
    if (
      image === null ||
      typeof image !== "object" ||
      typeof image.reference !== "string" ||
      !PROOF_REFERENCE.test(image.reference) ||
      !isPrivateGalleryProofFilename(image.filename) ||
      !isPrivateGalleryProofMediaId(image.mediaId) ||
      references.has(image.reference) ||
      mediaIds.has(image.mediaId)
    ) return false;
    references.add(image.reference);
    mediaIds.add(image.mediaId);
  }

  try {
    const summary = confirmation.summary;
    const expected = summarizePrivateGalleryProofSelection(
      {
        includedCount: summary.includedCount,
        extraUnitPriceMinor: summary.extraUnitPriceMinor,
        currency: summary.currency,
      },
      confirmation.selectedImages.length,
    );
    return (
      summary.selectedCount === expected.selectedCount &&
      summary.extraCount === expected.extraCount &&
      summary.extraTotalMinor === expected.extraTotalMinor
    );
  } catch {
    return false;
  }
}

export function buildPrivateGalleryProofNotification(params: {
  readonly confirmation: PrivateGalleryProofConfirmation;
  readonly galleryReference: string;
  readonly customerReference: string;
  readonly recipient: string;
  readonly outboxIdempotencyKey: string;
  readonly locale: string;
  readonly labels: BuiltInLabels["proofConfirmationEmail"];
}): PrivateGalleryProofNotification {
  const {
    confirmation,
    galleryReference,
    customerReference,
    recipient,
    outboxIdempotencyKey,
    locale,
    labels,
  } = params;

  if (!isValidGalleryNotificationRecipient(recipient)) fail("invalid-recipient");
  if (
    !isPrivateGalleryProofBusinessReference(galleryReference) ||
    !isPrivateGalleryProofBusinessReference(customerReference)
  ) fail("invalid-reference");
  if (
    !isValidGalleryNotificationIdempotencyKey(outboxIdempotencyKey)
  ) fail("invalid-idempotency-key");
  if (!validSnapshot(confirmation)) fail("invalid-confirmation");
  if (
    typeof labels.subject !== "string" ||
    labels.subject.length === 0 ||
    SINGLE_LINE_CONTROL.test(labels.subject)
  ) fail("invalid-confirmation");

  let unitPrice: string;
  let extraTotal: string;
  try {
    unitPrice = formatPrivateGalleryProofMoney(
      confirmation.summary.extraUnitPriceMinor,
      confirmation.summary.currency,
      locale,
    );
    extraTotal = formatPrivateGalleryProofMoney(
      confirmation.summary.extraTotalMinor,
      confirmation.summary.currency,
      locale,
    );
  } catch {
    // The future outbox records this redacted failure against the existing
    // version; it must never create another confirmation to make a resend work.
    fail("format-unavailable");
  }

  const { summary, selectedImages } = confirmation;
  return {
    to: recipient,
    subject: labels.subject,
    idempotencyKey: outboxIdempotencyKey,
    text: [
      `${labels.galleryReference}: ${galleryReference}`,
      `${labels.customerReference}: ${customerReference}`,
      `${labels.confirmedAt}: ${confirmation.confirmedAt.toISOString()}`,
      `${labels.version}: ${confirmation.version}`,
      "",
      `${labels.includedCount}: ${summary.includedCount}`,
      `${labels.selectedCount}: ${summary.selectedCount}`,
      `${labels.extraCount}: ${summary.extraCount}`,
      `${labels.unitPrice}: ${unitPrice}`,
      `${labels.currency}: ${summary.currency}`,
      `${labels.extraTotal}: ${extraTotal}`,
      "",
      `${labels.selectedImages}:`,
      ...(selectedImages.length === 0
        ? [labels.noneSelected]
        : selectedImages.map(
            (image) => `${image.reference} — ${image.filename}`,
          )),
    ].join("\n"),
  };
}
