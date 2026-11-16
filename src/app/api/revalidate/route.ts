/** Signed, POST-only Sanity cache revalidation endpoint (AB#83). */

import { revalidateTag } from "next/cache";

import {
  readSanityWebhook,
  SanityWebhookError,
  type SanityWebhookErrorClass,
} from "@/lib/sanity-revalidation";

import { createContactRateLimiter } from "@/lib/contact-rate-limit";

export const runtime = "nodejs";

/**
 * Most refusals arrive before the signature is checked, so anyone can cause
 * them. One line per refusal class per minute keeps the log useful for a real
 * misconfiguration without letting a stranger fill it (AB#420). Accepted and
 * failed invalidations stay logged every time: only a signed delivery reaches
 * them.
 */
const REJECTION_LOG_WINDOW_MS = 60_000;
const rejectionLogBudget = createContactRateLimiter({ maxAttempts: 1, windowMs: REJECTION_LOG_WINDOW_MS });

type RevalidationErrorClass = SanityWebhookErrorClass | "cache-unavailable";

function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function logEvent(event: {
  readonly correlationId: string;
  readonly state: "accepted" | "failed" | "rejected";
  readonly errorClass?: RevalidationErrorClass;
}): void {
  const write = event.state === "accepted" ? console.info : console.error;
  write(
    JSON.stringify({
      event: "sanity.revalidation",
      correlationId: event.correlationId,
      state: event.state,
      ...(event.errorClass === undefined
        ? {}
        : { errorClass: event.errorClass }),
    }),
  );
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = crypto.randomUUID();

  let plan;
  try {
    plan = await readSanityWebhook(request);
  } catch (cause) {
    const errorClass =
      cause instanceof SanityWebhookError
        ? cause.errorClass
        : "configuration";
    const status = cause instanceof SanityWebhookError ? cause.status : 500;
    // An unlogged refusal carries no correlation id: nobody could find it.
    if (!rejectionLogBudget.tryConsume(errorClass, Date.now()).allowed) {
      return response({ status: "rejected" }, status);
    }
    logEvent({ correlationId, state: "rejected", errorClass });
    return response({ status: "rejected", correlationId }, status);
  }

  try {
    // Route Handlers cannot use updateTag. An expire: 0 profile gives every
    // content transition the hard expiry ADR-0004 requires for removals and
    // visibility changes, and prevents gallery metadata/items from knowingly
    // straddling versions.
    for (const tag of plan.tags) revalidateTag(tag, { expire: 0 });
  } catch {
    logEvent({
      correlationId,
      state: "failed",
      errorClass: "cache-unavailable",
    });
    // Sanity retries 5xx deliveries. The response carries no provider error,
    // payload, tag, signature, secret, or idempotency key.
    return response({ status: "failed", correlationId }, 503);
  }

  logEvent({ correlationId, state: "accepted" });
  return response({ status: "accepted", correlationId }, 200);
}
