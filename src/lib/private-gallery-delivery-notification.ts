/**
 * AB#145: plain-text customer access instructions, built immediately before send.
 *
 * The outbox must persist a recipient plus gallery/generation reference and the
 * existing encrypted capability, never this rendered bearer-bearing request.
 * A dispatcher must re-read current publication/generation before calling this
 * builder and discard retired attempts. Its result is transient, server-only,
 * and must never enter logs. The email provider necessarily receives the link;
 * open/click tracking and URL rewriting must remain disabled.
 * No publication, persistence, transport call or deduplication happens here.
 */
import "server-only";

import type { PrivateGallery } from "@/lib/private-gallery";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import { assertPrivateGalleryHandleShape } from "@/lib/private-gallery-exchange";
import { openCapability, capabilityEnvelopeKeyId, type PrivateGalleryCapabilityMaterial } from "@/lib/private-gallery-capability";
import { getBuiltInLabels, type BuiltInLabels } from "@/lib/deployment-config";
import {
  isValidGalleryNotificationRecipient,
  isValidGalleryNotificationIdempotencyKey,
  validateGalleryNotificationRequest,
  type GalleryNotificationRequest,
} from "@/lib/gallery-notification";

type Reason = "invalid-gallery" | "invalid-time" | "invalid-recipient" |
  "invalid-idempotency-key" | "invalid-address" | "invalid-locale" | "capability-unavailable";
export class PrivateGalleryDeliveryNotificationError extends Error {
  constructor(readonly reason: Reason) {
    super(`[private-gallery-delivery-notification] ${reason}`);
    this.name = "PrivateGalleryDeliveryNotificationError";
  }
}
function fail(reason: Reason): never { throw new PrivateGalleryDeliveryNotificationError(reason); }
function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function buildPrivateGalleryDeliveryNotification(input: {
  /** Fresh authoritative metadata, not a saved publication attempt snapshot. */
  readonly gallery: PrivateGallery;
  readonly capability: PrivateGalleryCapabilityMaterial;
  readonly keyring: PrivateGalleryCapabilityKeyring;
  readonly recipient: string;
  /** Use DeploymentConfig.canonicalBaseUrl.origin, without introducing a setting. */
  readonly canonicalOrigin: string;
  /** Use DeploymentConfig.privateGallery.routePrefix, already namespace-reserved. */
  readonly routePrefix: string;
  readonly locale: string;
  /** Outbox attempt identity; never derive this from the bearer capability. */
  readonly outboxIdempotencyKey: string;
  readonly now: Date;
}): GalleryNotificationRequest {
  const { gallery, recipient, canonicalOrigin, routePrefix, locale, now, outboxIdempotencyKey } = input;
  if (!gallery || gallery.kind !== "delivery" || gallery.state !== "published" ||
      !Number.isSafeInteger(gallery.capabilityGeneration) || gallery.capabilityGeneration < 0) fail("invalid-gallery");
  try { assertPrivateGalleryHandleShape(gallery.galleryHandle); } catch { fail("invalid-gallery"); }
  if (!validDate(now) || !validDate(gallery.createdAt) || !validDate(gallery.publishedAt) ||
      !validDate(gallery.accessExpiresAt) || gallery.publishedAt < gallery.createdAt ||
      gallery.accessExpiresAt <= gallery.publishedAt || now < gallery.publishedAt || now >= gallery.accessExpiresAt) fail("invalid-time");
  if (!isValidGalleryNotificationRecipient(recipient)) fail("invalid-recipient");
  if (!isValidGalleryNotificationIdempotencyKey(outboxIdempotencyKey)) fail("invalid-idempotency-key");
  let labels: BuiltInLabels["deliveryNotificationEmail"];
  try {
    if (typeof locale !== "string" || locale.length > 128) fail("invalid-locale");
    labels = getBuiltInLabels(locale).deliveryNotificationEmail;
  } catch { fail("invalid-locale"); }
  if (typeof canonicalOrigin !== "string" || canonicalOrigin.length > 2048 ||
      typeof routePrefix !== "string" || !/^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(routePrefix)) fail("invalid-address");
  let url: URL;
  try {
    url = new URL(canonicalOrigin);
    // Exact origin equality refuses normalization, userinfo, paths and controls.
    if (url.protocol !== "https:" || url.origin !== canonicalOrigin || url.port === "0") fail("invalid-address");
  } catch { fail("invalid-address"); }
  let secret: string;
  try {
    if (!input.capability || input.capability.keyId !== capabilityEnvelopeKeyId(input.capability.envelope)) fail("capability-unavailable");
    secret = openCapability(input.keyring, { galleryId: gallery.galleryId,
      handle: gallery.galleryHandle, generation: gallery.capabilityGeneration }, input.capability.envelope);
  } catch { fail("capability-unavailable"); }
  url.pathname = `/${routePrefix}/${gallery.galleryHandle}`;
  url.hash = secret;
  const request = {
    to: recipient,
    subject: labels.subject,
    idempotencyKey: outboxIdempotencyKey,
    text: [labels.ready, "", labels.openGallery, url.href, "", labels.download,
      labels.sharing, `${labels.expiresAt}: ${gallery.accessExpiresAt.toISOString()} (UTC)`, labels.replace].join("\n"),
  };
  validateGalleryNotificationRequest(request);
  return Object.freeze(request);
}
