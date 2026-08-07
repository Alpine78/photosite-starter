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
 */

import {
  CONTACT_REJECTION_STATUS,
  readContactRequest,
  type ContactRejectionReason,
} from "@/lib/contact-request";
import {
  buildContactEmail,
  getContactDeliveryAdapter,
  type ContactDeliveryErrorClass,
} from "@/lib/contact-delivery";
import {
  createContactRateLimiter,
  deriveClientKey,
} from "@/lib/contact-rate-limit";
import { createCorrelationId, logContactEvent } from "@/lib/contact-log";
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

/** HTTP status for a delivery that was attempted and did not succeed. */
const DELIVERY_FAILURE_STATUS: Record<ContactDeliveryErrorClass, number> = {
  configuration: 500,
  "provider-rejected": 502,
  "provider-unavailable": 503,
  timeout: 503,
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      // A contact response describes one submission by one person. It is never
      // a cacheable representation of a resource, anywhere in the path.
      "Cache-Control": "no-store",
    },
  });
}

function rejected(
  reason: ContactRejectionReason,
  correlationId: string,
  issues?: unknown,
): Response {
  logContactEvent({ correlationId, state: "rejected", errorClass: reason });

  return jsonResponse(
    {
      status: "rejected",
      reason,
      correlationId,
      ...(issues === undefined ? {} : { issues }),
    },
    CONTACT_REJECTION_STATUS[reason],
  );
}

/**
 * A delivered submission and a discarded one answer identically. A person never
 * fills the hidden field, so the only client that sees this response after
 * discarding is an automated one, and telling it which control caught it is how
 * the control stops working.
 */
function accepted(correlationId: string): Response {
  return jsonResponse({ status: "delivered", correlationId }, 200);
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = createCorrelationId();

  if (!rateLimiter.tryConsume(deriveClientKey(request), Date.now())) {
    return rejected("rate-limited", correlationId);
  }

  const result = await readContactRequest(request);

  if (result.outcome === "rejected") {
    return rejected(result.reason, correlationId, result.issues);
  }
  if (result.outcome === "discarded") {
    logContactEvent({
      correlationId,
      state: "rejected",
      errorClass: "honeypot",
    });
    return accepted(correlationId);
  }

  logContactEvent({ correlationId, state: "accepted" });

  const settings = await getSiteSettings();
  const email = buildContactEmail(result.message, {
    siteName: settings.siteName,
    labels: getDefaultLocaleLabels(),
  });

  // A deployment that never configured delivery fails here rather than at
  // build time or at page render, so an unconfigured clone still serves a
  // working contact page and reports the missing setting when it matters.
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

  return jsonResponse(
    { status: "failed", retryable: outcome.retryable, correlationId },
    DELIVERY_FAILURE_STATUS[outcome.errorClass],
  );
}
