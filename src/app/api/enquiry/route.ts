/**
 * The gallery-item enquiry endpoint (AB#60).
 *
 * A visitor open on one photograph asks the photographer about it. The browser
 * submits the same bounded JSON the contact form does — name, email, message, a
 * honeypot, a client submission id — plus the *public* identity of what they are
 * looking at: `kind` (`curated`/`dynamic`), the route `locale`, the gallery
 * `contentId` (curated only), and the `itemId` (a `placementId` or a `mediaId`,
 * ADR-0002 §1). The server turns that reference into the photographer-facing
 * facts — the stable `mediaId`, and, from the private dataset only, the
 * `archiveLocator` — none of which is ever echoed back or logged.
 *
 * Everything about privacy, abuse control, validation, and delivery is the
 * contact endpoint's, reused rather than restated: the same header checks ahead
 * of the throttle, the same bounded body and closed field whitelist (widened by
 * exactly the four context fields), the same honeypot rule, the same delivery
 * adapter and idempotency contract (namespaced so an enquiry and a contact
 * message can never share a provider key), and the same one-line operational
 * event — under its own name, `enquiry.submission`, with its own closed class
 * set (ADR-0004 §5).
 *
 * Every resolution failure — unknown item, unpublished gallery, private or
 * non-enquirable photograph, a dynamic enquiry this source cannot authorize —
 * collapses to one generic 404 in the response, so a probe cannot learn which
 * check it tripped; the operational log keeps the specific class. A store read
 * that fails transiently is a retryable 503; one that fails permanently, or
 * returns an untrusted shape, is a terminal 500. After the `accepted` event is
 * written, every path produces exactly one terminal event.
 */

import {
  CONTACT_REJECTION_STATUS,
  checkContactRequestHeaders,
  jsonNoStore,
  readContactSubmission,
  type ContactRejectionReason,
} from "@/lib/contact-request";
import {
  buildEnquiryEmail,
  DELIVERY_FAILURE_STATUS,
  getContactDeliveryAdapter,
} from "@/lib/contact-delivery";
import {
  createContactRateLimiter,
  deriveClientKey,
} from "@/lib/contact-rate-limit";
import { createCorrelationId, logEnquiryEvent } from "@/lib/contact-log";
import {
  classifyEnquiryFailure,
  resolveEnquiryTarget,
  type EnquiryResolutionRejection,
} from "@/lib/enquiry-media";
import { getDefaultLocaleLabels } from "@/lib/deployment-config";
import { getSiteSettings } from "@/lib/site-settings";

/** `node:crypto` and the delivery call both need the Node.js runtime (ADR-0004 §2). */
export const runtime = "nodejs";

/**
 * The public context fields the browser adds to a contact-shaped body. The one
 * source for both the `extraFields` whitelist and its test. `resolveEnquiryTarget`
 * is the closed per-kind validator for their *values*.
 */
export const ENQUIRY_CONTEXT_FIELDS = [
  "kind",
  "locale",
  "contentId",
  "itemId",
] as const;

/**
 * One limiter per runtime instance, and deliberately not the contact
 * endpoint's: an enquiry and a contact message are different actions and must
 * not spend each other's allowance.
 */
const rateLimiter = createContactRateLimiter();

/**
 * How each resolution rejection is answered. The five identity/authorization
 * outcomes are indistinguishable on purpose — the repository's rule is that an
 * unknown identity 404s without disclosing which check failed. The two
 * store-failure classes and `malformed-request` are their own answers.
 */
type ResolutionResponse =
  | { readonly kind: "rejected"; readonly reason: "malformed-body" | "item-unavailable" }
  | { readonly kind: "failed"; readonly retryable: boolean; readonly status: number };

const RESOLUTION_RESPONSE: Record<
  EnquiryResolutionRejection,
  ResolutionResponse
> = {
  "malformed-request": { kind: "rejected", reason: "malformed-body" },
  "unknown-item": { kind: "rejected", reason: "item-unavailable" },
  "container-unavailable": { kind: "rejected", reason: "item-unavailable" },
  "not-public": { kind: "rejected", reason: "item-unavailable" },
  "not-enquirable": { kind: "rejected", reason: "item-unavailable" },
  "dynamic-unsupported": { kind: "rejected", reason: "item-unavailable" },
  "source-unavailable": { kind: "failed", retryable: true, status: 503 },
  "source-error": { kind: "failed", retryable: false, status: 500 },
  "malformed-source": { kind: "failed", retryable: false, status: 500 },
};

const REJECTION_REASON_STATUS: Record<
  "malformed-body" | "item-unavailable",
  number
> = {
  "malformed-body": 400,
  "item-unavailable": 404,
};

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

/** A delivered submission and a discarded (honeypot) one answer identically. */
function accepted(correlationId: string): Response {
  return jsonNoStore({ status: "delivered", correlationId }, 200);
}

/**
 * Maps a classified resolution rejection to its response and writes the
 * terminal event, keeping the specific class in the log while the response
 * stays generic.
 */
function respondToRejection(
  rejection: EnquiryResolutionRejection,
  correlationId: string,
): Response {
  const mapped = RESOLUTION_RESPONSE[rejection];
  if (mapped.kind === "rejected") {
    logEnquiryEvent({ correlationId, state: "rejected", errorClass: rejection });
    return jsonNoStore(
      { status: "rejected", reason: mapped.reason, correlationId },
      REJECTION_REASON_STATUS[mapped.reason],
    );
  }
  logEnquiryEvent({
    correlationId,
    state: "delivery-failed",
    errorClass: rejection,
  });
  return jsonNoStore(
    { status: "failed", retryable: mapped.retryable, correlationId },
    mapped.status,
  );
}

export async function POST(request: Request): Promise<Response> {
  // Stateless and ahead of the throttle, so a cross-origin simple POST cannot
  // spend a visitor's — or a shared address's — allowance. Not logged: it never
  // became a submission.
  const headerRejection = checkContactRequestHeaders(request);
  if (headerRejection !== undefined) {
    return rejectionResponse(headerRejection);
  }

  const correlationId = createCorrelationId();
  const rateLimit = rateLimiter.tryConsume(deriveClientKey(request), Date.now());
  if (!rateLimit.allowed) {
    if (rateLimit.firstRefusalInWindow) {
      logEnquiryEvent({
        correlationId,
        state: "rejected",
        errorClass: "rate-limited",
      });
    }
    return rejectionResponse("rate-limited", {
      correlationId: rateLimit.firstRefusalInWindow ? correlationId : undefined,
    });
  }

  const result = await readContactSubmission(request, {
    extraFields: ENQUIRY_CONTEXT_FIELDS,
  });

  if (result.outcome === "rejected") {
    logEnquiryEvent({
      correlationId,
      state: "rejected",
      errorClass: result.reason,
    });
    return rejectionResponse(result.reason, {
      correlationId,
      issues: result.issues,
    });
  }
  if (result.outcome === "discarded") {
    logEnquiryEvent({
      correlationId,
      state: "rejected",
      errorClass: "honeypot",
    });
    return accepted(correlationId);
  }

  logEnquiryEvent({ correlationId, state: "accepted" });

  // Everything from here on writes exactly one terminal event before it
  // answers. A classified content-store failure (from the tree read, the
  // resolver, or the settings read) becomes its own generic response; anything
  // unclassifiable records an `internal` terminal event and then propagates, so
  // a genuine defect still surfaces a server-side stack.
  const unexpected = (error: unknown): Response | never => {
    const classified = classifyEnquiryFailure(error);
    if (classified !== undefined) {
      return respondToRejection(classified.rejection, correlationId);
    }
    logEnquiryEvent({
      correlationId,
      state: "delivery-failed",
      errorClass: "internal",
    });
    throw error;
  };

  let email;
  try {
    const target = await resolveEnquiryTarget(result.extra ?? {});
    const settings = await getSiteSettings();
    email = buildEnquiryEmail(result.message, target, {
      siteName: settings.siteName,
      labels: getDefaultLocaleLabels(),
    });
  } catch (error) {
    return unexpected(error);
  }

  let outcome;
  try {
    outcome = await getContactDeliveryAdapter().deliver({
      ...email,
      idempotencyKey: `enquiry:${result.submissionId}`,
    });
  } catch {
    outcome = {
      status: "failed",
      errorClass: "configuration",
      retryable: false,
    } as const;
  }

  if (outcome.status === "delivered") {
    logEnquiryEvent({ correlationId, state: "delivered" });
    return accepted(correlationId);
  }

  logEnquiryEvent({
    correlationId,
    state: "delivery-failed",
    errorClass: outcome.errorClass,
  });
  return jsonNoStore(
    { status: "failed", retryable: outcome.retryable, correlationId },
    DELIVERY_FAILURE_STATUS[outcome.errorClass],
  );
}
