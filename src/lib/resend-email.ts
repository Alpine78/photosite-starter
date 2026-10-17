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

/** A local resource bound, not a provider response-size guarantee. */
const MAX_ERROR_RESPONSE_BYTES = 16_384;

async function readErrorName(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  withinDeadline: <T>(operation: Promise<T>) => Promise<T>,
  timedOut: () => boolean,
): Promise<string | undefined> {
  try {
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) {
      const { done, value } = await withinDeadline(reader.read());
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > MAX_ERROR_RESPONSE_BYTES - total) return undefined;
      if (value.byteLength === 0) {
        // A non-cooperative port can return empty chunks forever. Yield so the
        // same attempt timer can run instead of starving it with microtasks.
        await withinDeadline(new Promise<void>(resolve => { setImmediate(resolve); }));
        continue;
      }
      total += value.byteLength; chunks.push(new Uint8Array(value));
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof body === "object" && body !== null && !Array.isArray(body) && "name" in body) {
      const { name } = body as { name: unknown };
      return typeof name === "string" ? name : undefined;
    }
  } catch {
    // Discard parse/read errors: their message can contain provider prose.
    // Only our own deadline, not a provider's AbortError text, is a timeout.
    if (timedOut()) throw new DOMException("", "TimeoutError");
  }
  return undefined;
}

/** Cleanup is observed but never allowed to replace or delay an outcome. */
function discard(action: () => Promise<unknown> | undefined): void {
  try { void action()?.catch(() => {}); } catch { /* best effort */ }
}

/** One bounded provider attempt. Queue, deduplication and retry live in the caller's outbox. */
export async function sendResendEmail(
  settings: ResendEmailSettings,
  request: ResendEmailRequest,
  timeoutMs: number,
): Promise<ContactDeliveryOutcome> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2 ** 31 - 1) {
    return { status: "failed", errorClass: "configuration", retryable: false };
  }
  const send = settings.fetchImplementation ?? fetch;
  const controller = new AbortController();
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let ended = false, cleaned = false, didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true; controller.abort();
  }, timeoutMs);
  // A shared pending race promise retains one reaction per completed read.
  // Instead each operation owns one listener, removed on either completion.
  const withinDeadline = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    let settled = false;
    function finish(outcome: () => void) {
      if (settled) return;
      settled = true; controller.signal.removeEventListener("abort", aborted); outcome();
    }
    const aborted = () => finish(() => reject(new DOMException("", "TimeoutError")));
    controller.signal.addEventListener("abort", aborted, { once: true });
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (controller.signal.aborted) aborted();
  });
  function cleanup() {
    if (cleaned || response === undefined) return;
    cleaned = true;
    if (reader) {
      discard(() => reader!.cancel());
      try { reader.releaseLock(); } catch { /* pending non-cooperative read */ }
    } else discard(() => response!.body?.cancel());
  }

  try {
    // The executor invokes fetch immediately and captures synchronous port throws.
    // Track the response before the race: a same-tick deadline must not lose it.
    const pending = new Promise<Response>(resolve => { resolve(send(RESEND_EMAILS_ENDPOINT, {
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
      signal: controller.signal,
      cache: "no-store",
    })); }).then(answer => {
      response = answer;
      if (ended) cleanup();
      return answer;
    });
    const answer = await withinDeadline(pending);
    if (answer.ok) return { status: "delivered" };
    if (answer.status >= 300 && answer.status < 400) {
      // Never parse a redirect's body or forward the message to Location.
      return classifyFailure(answer.status, undefined);
    }
    if (answer.body === null) return classifyFailure(answer.status, undefined);
    try { reader = answer.body.getReader(); }
    catch { return classifyFailure(answer.status, undefined); }
    return classifyFailure(answer.status, await readErrorName(reader, withinDeadline, () => didTimeout));
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException &&
      (cause.name === "TimeoutError" || cause.name === "AbortError");
    return {
      status: "failed",
      errorClass: timedOut ? "timeout" : "provider-unavailable",
      retryable: true,
    };
  } finally {
    ended = true; clearTimeout(timer); cleanup(); controller.abort();
  }
}
