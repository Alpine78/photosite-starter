/**
 * The sink gallery-notification transport: accepts a request and sends
 * nothing. The development and Preview default for `PRIVATE_GALLERY_STORE`'s
 * notification path, mirroring `createSinkDeliveryAdapter` — it reports
 * success, which is the point everywhere it belongs and silent data loss in
 * production, so `buildGalleryNotificationTransport` refuses to build it
 * there.
 *
 * Unlike the contact sink, there is no visitor-controlled field to request a
 * specific failure class: a proof-confirmation notification's recipient is
 * the photographer's own configured mailbox, never something a customer
 * typed. The sink therefore always reports delivery; a caller that needs to
 * exercise a failure path injects a `GalleryNotificationTransport` test
 * double instead, as `private-gallery-proof-outbox.test.ts` already does.
 */
import type { GalleryNotificationTransport } from "@/lib/gallery-notification";

export function createSinkGalleryNotificationTransport(): GalleryNotificationTransport {
  return {
    name: "sink",
    async deliver() {
      return { status: "delivered" };
    },
  };
}
