/**
 * Contact-specific Resend adapter. It binds the configured owner recipient and
 * `contact-form/` idempotency namespace to the shared provider HTTP boundary
 * in `resend-email.ts`. Contact callers know only `ContactDeliveryAdapter`.
 */

import {
  CONTACT_DELIVERY_TIMEOUT_MS,
  type ContactDeliveryAdapter,
  type ContactDeliveryOutcome,
} from "@/lib/contact-delivery";

import { sendResendEmail } from "@/lib/resend-email";

/** Contact-specific namespace; no gallery attempt can collide with it. */
const IDEMPOTENCY_KEY_PREFIX = "contact-form/";

export type ResendDeliverySettings = {
  readonly apiKey: string;
  /** Verified sender, e.g. `Studio Example <contact@example.com>`. */
  readonly from: string;
  /** The site owner's mailbox. */
  readonly to: string;
  /** Injected in tests; production uses the global `fetch`. */
  readonly fetchImplementation?: typeof fetch;
};

export function createResendDeliveryAdapter(
  settings: ResendDeliverySettings,
): ContactDeliveryAdapter {
  const send = settings.fetchImplementation ?? fetch;
  return {
    name: "resend",
    deliver(request): Promise<ContactDeliveryOutcome> {
      return sendResendEmail({ ...settings, fetchImplementation: send }, {
        to: settings.to,
        replyTo: request.replyTo,
        subject: request.subject,
        text: request.text,
        providerIdempotencyKey: `${IDEMPOTENCY_KEY_PREFIX}${request.idempotencyKey}`,
      }, CONTACT_DELIVERY_TIMEOUT_MS);
    },
  };
}
