/**
 * The sink delivery adapter: accepts a message and sends nothing.
 *
 * This is the adapter Preview and the public-journey suite run on (ADR-0004
 * §3): the release candidate and the Playwright journey exercise the real
 * endpoint, the real validation, and the real response contract without a
 * credential in the environment or a synthetic enquiry in a real mailbox. It is
 * a delivery boundary that succeeds, not a stub of the endpoint.
 *
 * It reports success, which is the whole point everywhere it belongs and silent
 * data loss in production — a visitor would be told their enquiry was sent and
 * it would exist nowhere. `buildContactDeliveryAdapter` therefore refuses to
 * build it in a production deployment; documentation saying where it belongs is
 * not a control, and this one is worth having as code.
 *
 * ## Reserved failure addresses
 *
 * An adapter that only ever succeeds leaves the other half of the endpoint —
 * the failure classification, the status it maps to, and the advice the form
 * gives a visitor — reachable in a browser only by breaking something. So a
 * reply-to address of the form `<error-class>@delivery-failure.test` reports
 * that class of failure instead of delivering.
 *
 * Three properties make this safe rather than clever:
 *
 * - **No person can trigger it.** `.test` is reserved by RFC 6761 and never
 *   resolves, so no address anyone could actually receive mail at ends in this
 *   domain. A real enquiry cannot land on a failure by coincidence.
 * - **It cannot reach production.** The behavior lives in the sink, and the
 *   sink is refused outright in a production deployment.
 * - **It classifies, it does not fabricate.** Each address maps to a real
 *   `ContactDeliveryErrorClass` with that class's real retry decision, so what
 *   the endpoint answers and what the form advises are the endpoint's own
 *   behavior, not the test's.
 *
 * A Preview reviewer can therefore see the failure states the same way AB#89's
 * journey suite does, by typing an address instead of by breaking a deployment.
 */

import type {
  ContactDeliveryAdapter,
  ContactDeliveryErrorClass,
  ContactDeliveryOutcome,
} from "@/lib/contact-delivery";

/** Reserved by RFC 6761: it never resolves and belongs to no one. */
export const CONTACT_SINK_FAILURE_DOMAIN = "delivery-failure.test";

/**
 * Whether submitting the same message again could succeed, per failure class.
 *
 * The values are the ones a real provider adapter reaches: an outage or a
 * timeout may pass a moment later, while a refused request, an exhausted
 * allowance, and a missing setting all stay refused until someone changes
 * something. Keeping the table here rather than taking it from the caller is
 * what makes the sink's failures indistinguishable from a provider's.
 */
const RETRYABLE_BY_ERROR_CLASS: Record<ContactDeliveryErrorClass, boolean> = {
  configuration: false,
  "provider-rejected": false,
  "provider-quota-exceeded": false,
  "provider-unavailable": true,
  timeout: true,
};

/**
 * The address that makes the sink report `errorClass`. Exported so a test names
 * a failure by its class instead of restating a string that could drift.
 */
export function contactSinkFailureAddress(
  errorClass: ContactDeliveryErrorClass,
): string {
  return `${errorClass}@${CONTACT_SINK_FAILURE_DOMAIN}`;
}

/**
 * The failure a reply-to address asks for, or `undefined` for every address
 * that does not name one — which is every address a visitor could own.
 *
 * The domain is compared case-insensitively because a visitor types an address
 * rather than a token, and `Object.hasOwn` keeps an inherited property name
 * from passing as an error class.
 */
function requestedFailure(
  replyTo: string,
): ContactDeliveryErrorClass | undefined {
  const separator = replyTo.lastIndexOf("@");
  if (separator < 0) return undefined;

  const domain = replyTo.slice(separator + 1).toLowerCase();
  if (domain !== CONTACT_SINK_FAILURE_DOMAIN) return undefined;

  const requested = replyTo.slice(0, separator).toLowerCase();
  return Object.hasOwn(RETRYABLE_BY_ERROR_CLASS, requested)
    ? (requested as ContactDeliveryErrorClass)
    : undefined;
}

export function createSinkDeliveryAdapter(): ContactDeliveryAdapter {
  return {
    name: "sink",
    async deliver({ replyTo }): Promise<ContactDeliveryOutcome> {
      const errorClass = requestedFailure(replyTo);

      return errorClass === undefined
        ? { status: "delivered" }
        : {
            status: "failed",
            errorClass,
            retryable: RETRYABLE_BY_ERROR_CLASS[errorClass],
          };
    },
  };
}
