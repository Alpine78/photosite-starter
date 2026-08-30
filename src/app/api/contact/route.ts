/**
 * The contact endpoint: one fixed POST route, as ADR-0004 §5 requires.
 *
 * Only `POST` is exported, so every other method is refused by the framework
 * before any of this runs. Form fields travel in the bounded request body and
 * nowhere else — never in the path, never in a query string, and therefore
 * never in a referrer or a hosting-provider request log. Query parameters on
 * this route are not read, not consumed, and not copied anywhere.
 *
 * The handler itself is a sequence of decisions, not logic: the boundary in
 * `contact-request` decides what the request is, the configured adapter decides
 * whether it was delivered, and this file decides what to answer and what to
 * record. Nothing is stored. The response is always `no-store` and carries no
 * CORS headers, so a cross-origin script cannot read it even if it could
 * provoke it.
 *
 * The order below is the security-relevant part. Header checks come first and
 * cost nothing, so a request from another origin is refused without spending
 * anything a real visitor might need; the throttle is consumed only by requests
 * that were plausibly ours; and the body is read only by requests the throttle
 * allowed.
 */

import {
  CONTACT_REJECTION_STATUS,
  checkContactRequestHeaders,
  jsonNoStore,
  readContactSubmission,
  type ContactRejectionReason,
} from "@/lib/contact-request";
import {
  buildContactEmail,
  DELIVERY_FAILURE_STATUS,
  getContactDeliveryAdapter,
} from "@/lib/contact-delivery";
import {
  createContactRateLimiter,
  deriveClientKey,
} from "@/lib/contact-rate-limit";
import {
  createCorrelationId,
  logContactEvent,
  type ContactErrorClass,
} from "@/lib/contact-log";
import { getDefaultLocaleLabels } from "@/lib/deployment-config";
import { getSiteSettings } from "@/lib/site-settings";

/**
 * `node:crypto` and the delivery call both need the Node.js runtime, which
 * ADR-0004 §2 pins for the whole application rather than leaving to a moving
 * platform default. Declared here so the endpoint states its own requirement.
 */
export const runtime = "nodejs";

/**
 * One limiter per runtime instance, holding only salted client hashes for the
 * length of a window. Deliberately not shared between instances — see
 * `contact-rate-limit` for what that does and does not promise.
 */
const rateLimiter = createContactRateLimiter();

function rejectionResponse(
  reason: ContactRejectionReason,
  {
    correlationId,
    issues,
  }: { readonly correlationId?: string; readonly issues?: unknown } = {},
): Response {
  return jsonNoStore(
    {
      status: "rejected",
      reason,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(issues === undefined ? {} : { issues }),
    },
    CONTACT_REJECTION_STATUS[reason],
  );
}

function logged(
  correlationId: string,
  errorClass: ContactErrorClass,
): string {
  logContactEvent({ correlationId, state: "rejected", errorClass });
  return correlationId;
}

/**
 * A delivered submission and a discarded one answer identically. A person never
 * fills the hidden field, so the only client that sees this response after
 * discarding is an automated one, and telling it which control caught it is how
 * the control stops working.
 */
function accepted(correlationId: string): Response {
  return jsonNoStore({ status: "delivered", correlationId }, 200);
}

export async function POST(request: Request): Promise<Response> {
  // Stateless, allocation-free, and deliberately ahead of the throttle: a
  // browser can be made to send a simple cross-origin POST without a preflight,
  // and if those consumed the allowance, another site could exhaust a
  // visitor's — or, behind one shared address, several visitors' — before any
  // of them tried to send anything. Refused here, they cost nothing and, by the
  // same argument, are not logged either: they never became a submission, and
  // one line each would be an unbounded log-volume lever.
  const headerRejection = checkContactRequestHeaders(request);
  if (headerRejection !== undefined) {
    return rejectionResponse(headerRejection);
  }

  const correlationId = createCorrelationId();
  const rateLimit = rateLimiter.tryConsume(deriveClientKey(request), Date.now());
  if (!rateLimit.allowed) {
    // Once per window, not once per request: a client that keeps sending after
    // being throttled is the case this bound exists for.
    const loggedCorrelationId = rateLimit.firstRefusalInWindow
      ? logged(correlationId, "rate-limited")
      : undefined;
    return rejectionResponse("rate-limited", {
      correlationId: loggedCorrelationId,
    });
  }

  const result = await readContactSubmission(request);

  if (result.outcome === "rejected") {
    // Bounded by the throttle above, so these may be logged per occurrence.
    return rejectionResponse(result.reason, {
      correlationId: logged(correlationId, result.reason),
      issues: result.issues,
    });
  }
  if (result.outcome === "discarded") {
    logged(correlationId, "honeypot");
    return accepted(correlationId);
  }

  logContactEvent({ correlationId, state: "accepted" });

  const settings = await getSiteSettings();
  const email = buildContactEmail(result.message, {
    siteName: settings.siteName,
    labels: getDefaultLocaleLabels(),
  });

  // A deployment that never configured delivery — or configured the sink
  // adapter in production, which `buildContactDeliveryAdapter` refuses — fails
  // here rather than at build time or at page render, so an unconfigured clone
  // still serves a working contact page and reports the problem when it
  // matters. The cause is never echoed to the visitor.
  let outcome;
  try {
    outcome = await getContactDeliveryAdapter().deliver({
      ...email,
      idempotencyKey: result.submissionId,
    });
  } catch {
    outcome = {
      status: "failed",
      errorClass: "configuration",
      retryable: false,
    } as const;
  }

  if (outcome.status === "delivered") {
    logContactEvent({ correlationId, state: "delivered" });
    return accepted(correlationId);
  }

  logContactEvent({
    correlationId,
    state: "delivery-failed",
    errorClass: outcome.errorClass,
  });

  return jsonNoStore(
    { status: "failed", retryable: outcome.retryable, correlationId },
    DELIVERY_FAILURE_STATUS[outcome.errorClass],
  );
}
