/** Resend transport for one already-queued private gallery notification attempt. */
import "server-only";

import {
  validateGalleryNotificationRequest,
  type GalleryNotificationTransport,
} from "@/lib/gallery-notification";
import { sendResendEmail, type ResendEmailSettings } from "@/lib/resend-email";

const GALLERY_NOTIFICATION_TIMEOUT_MS = 10_000;
const IDEMPOTENCY_KEY_PREFIX = "gallery-notification/";

/** The outbox supplies a stable key per attempt; an admin resend supplies a new one. */
export function createResendGalleryNotificationTransport(
  settings: ResendEmailSettings,
): GalleryNotificationTransport {
  return {
    name: "resend",
    async deliver(request) {
      validateGalleryNotificationRequest(request);
      return sendResendEmail(settings, {
        to: request.to,
        subject: request.subject,
        text: request.text,
        providerIdempotencyKey: IDEMPOTENCY_KEY_PREFIX + request.idempotencyKey,
      }, GALLERY_NOTIFICATION_TIMEOUT_MS);
    },
  };
}
