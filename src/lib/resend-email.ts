/**
 * Shared plain-text Resend HTTP provider boundary for contact and private galleries.
 * Uses `fetch` with no SDK, attachments, HTML part, tracking fields or new
 * runtime dependency. The API key is used only to authorize provider calls.
 *
 * Verified against Resend's API reference (2026-08-07):
 * `POST https://api.resend.com/emails` with `Authorization: Bearer`,
 * `Content-Type: application/json`, and an optional `Idempotency-Key` header
 * of 1–256 characters that expires after 24 hours; a failed call answers
 * `{ name, statusCode, message }`; the account rate limit is 10 requests per
 * second and answers 429 above it, as do `daily_quota_exceeded` and
 * `monthly_quota_exceeded`, which are not the same condition.
 */
import "server-only";

import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

export type ResendEmailRequest = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string;
  /** Fully namespaced by the caller; 1–256 characters. */
  readonly providerIdempotencyKey: string;
};

export type ResendEmailSettings = {
  readonly apiKey: string;
  readonly from: string;
  readonly fetchImplementation?: typeof fetch;
};

/**
 * Maps a provider response to a failure class and a retry decision.
 *
 * Only the provider's machine-readable error `name` is inspected. Its `message`
 * is human-readable prose that can restate parts of the request, so it is never
 * read, never returned, and never logged.
 */
function classifyFailure(
  status: number,
  errorName: string | undefined,
): ContactDeliveryOutcome {
  // The name is consulted before the status because 429 is not one condition.
  // Resend answers 429 both for its 10-requests-per-second rate limit, which a
  // retry a moment later passes, and for an exhausted daily or monthly quota,
  // which it does not — that resets on the provider's schedule or needs a plan
  // change. Offering "try again" for the second would be advice that cannot
  // work.
  switch (errorName) {
    case "rate_limit_exceeded":
    // Another request with this idempotency key is still in flight. The
    // original may yet succeed, so a retry either replays that result or
    // sends once.
    case "concurrent_idempotent_requests":
      return {
        status: "failed",
        errorClass: "provider-unavailable",
        retryable: true,
      };
    case "daily_quota_exceeded":
    case "monthly_quota_exceeded":
      return {
        status: "failed",
        errorClass: "provider-quota-exceeded",
        retryable: false,
      };
  }

  // The credential is wrong or revoked. Retrying cannot fix it, and it is the
  // deployment's problem rather than the provider's.
  if (status === 401 || status === 403) {
    return { status: "failed", errorClass: "configuration", retryable: false };
  }

  // A 429 whose name we did not recognize, or an outage. Treated as transient:
  // the named quota cases above are the ones a retry cannot help, and guessing
  // that an unrecognized code is permanent would strand a recoverable failure.
  if (status === 429 || status >= 500) {
    return {
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    };
  }

  // A 4xx the endpoint caused: an unverified sending domain, a malformed
  // address, or a reused idempotency key carrying a different message. Sending
  // the same request again produces the same answer.
  return { status: "failed", errorClass: "provider-rejected", retryable: false };
}

async function readErrorName(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "name" in body) {
      const { name } = body as { name: unknown };
      return typeof name === "string" ? name : undefined;
    }
  } catch {
    // A provider error that is not JSON tells us nothing beyond its status.
  }
  return undefined;
}

/** One bounded provider attempt. Queue, deduplication and retry live in the caller's outbox. */
export async function sendResendEmail(
  settings: ResendEmailSettings,
  request: ResendEmailRequest,
  timeoutMs: number,
): Promise<ContactDeliveryOutcome> {
  const send = settings.fetchImplementation ?? fetch;
  let response: Response;

  try {
    response = await send(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.providerIdempotencyKey,
      },
      body: JSON.stringify({
        from: settings.from,
        to: [request.to],
        ...(request.replyTo === undefined ? {} : { reply_to: request.replyTo }),
        subject: request.subject,
        text: request.text,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException &&
      (cause.name === "TimeoutError" || cause.name === "AbortError");
    return {
      status: "failed",
      errorClass: timedOut ? "timeout" : "provider-unavailable",
      retryable: true,
    };
  }

  if (response.ok) return { status: "delivered" };
  if (response.status >= 300 && response.status < 400) {
    // A redirect is not a provider error envelope: never let its body/name
    // override refusal or forward the message to the Location destination.
    void response.body?.cancel().catch(() => {});
    return classifyFailure(response.status, undefined);
  }
  return classifyFailure(response.status, await readErrorName(response));
}
