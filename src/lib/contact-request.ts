/**
 * The HTTP boundary of the contact endpoint: everything that must be true
 * about a request before its contents are treated as a submission.
 *
 * The checks here are ordered cheapest-first and each one fails closed. They
 * exist because ADR-0004 §5 makes method, content-type, origin, size, schema,
 * timeout, replay, and abuse validation the application's own responsibility —
 * platform firewall rules are defense in depth on top of this, never a
 * substitute for it.
 *
 * They are exposed as two steps rather than one because the throttle belongs
 * *between* them. A browser can be made to send a simple cross-origin POST
 * without a preflight, so if throttling came first, another site could spend a
 * visitor's whole allowance on requests this module was always going to refuse
 * — and behind a shared address, spend several people's. `checkContactRequestHeaders`
 * therefore settles who is allowed to be asking before anything stateful
 * happens, and `readContactSubmission` reads the body only for requests that
 * passed both.
 *
 * Two decisions are worth stating rather than deducing from the code:
 *
 * - **JSON is the only accepted content type.** An HTML form cannot post JSON,
 *   and a cross-origin `fetch` that tries has to win a CORS preflight this
 *   application never answers. That makes the content-type check a real
 *   cross-site request control rather than a formality, and it is why the form
 *   submits with `fetch` instead of a native form POST.
 * - **The `Origin` check defends a browser, not the endpoint.** Any non-browser
 *   client can send whatever `Origin` it likes, so this is not authentication.
 *   It stops a visitor's browser from being used as a confused deputy by
 *   another site, which is exactly the threat a public form faces.
 *
 * The module holds no request state between calls and reads no configuration,
 * so it behaves the same on every runtime instance (ADR-0004 §2).
 */

import {
  CONTACT_FIELD_NAMES,
  parseContactMessage,
  type ContactFieldIssue,
  type ContactFieldName,
  type ContactMessage,
} from "@/lib/contact-message";

export const CONTACT_CONTENT_TYPE = "application/json";

/**
 * Hard ceiling on the request body, well above the sum of the field limits and
 * far below the platform's own 4.5 MB function limit (ADR-0004 §6). The
 * application owns the bound that matters, so the endpoint's behavior does not
 * change when it is hosted somewhere with a different platform limit.
 */
export const CONTACT_REQUEST_MAX_BYTES = 8 * 1024;

/**
 * A field no person can see or tab into, so a value in it means an automated
 * client filled the form by reading its markup. Named after something a
 * form-filling bot expects to exist rather than after its purpose.
 */
export const CONTACT_HONEYPOT_FIELD = "company";

/**
 * Client-generated identity of one submission attempt, used as the delivery
 * idempotency key: pressing "retry" after a timeout resends the same value, so
 * a message that did reach the provider is not delivered twice, while a new
 * enquiry carries a new one.
 *
 * It is accepted from the client because only the client knows whether a
 * request is a retry of the last one or a fresh submission. Nothing is trusted
 * on its basis — it is validated as an opaque UUID and used for nothing but
 * de-duplication within one deployment's own delivery account.
 */
export const CONTACT_SUBMISSION_ID_FIELD = "submissionId";

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const ACCEPTED_KEYS: readonly string[] = [
  ...CONTACT_FIELD_NAMES,
  CONTACT_HONEYPOT_FIELD,
  CONTACT_SUBMISSION_ID_FIELD,
];

/**
 * Why a request was refused. Deliberately coarse: the response says enough for
 * a developer integrating against the endpoint to fix their call, and nothing
 * that helps someone map the validation rules field by field.
 */
export type ContactRejectionReason =
  | "unsupported-media-type"
  | "payload-too-large"
  | "cross-origin"
  | "malformed-body"
  | "invalid-fields"
  | "rate-limited";

export type ContactRequestResult =
  | {
      readonly outcome: "accepted";
      readonly message: ContactMessage;
      readonly submissionId: string;
      /**
       * The raw string values of any `extraFields` the caller asked for that
       * the body actually carried. Present only when `extraFields` was passed
       * and non-empty — the contact endpoint asks for none, so its result shape
       * is unchanged. The gallery enquiry endpoint (AB#60) asks for its own
       * item-context fields here and hands them straight to its own validator;
       * nothing in this module interprets them.
       */
      readonly extra?: Readonly<Record<string, string>>;
    }
  /**
   * The honeypot was filled. The caller answers exactly as it answers a
   * successful submission and delivers nothing: telling an automated client
   * which control caught it is how the control stops working.
   */
  | { readonly outcome: "discarded" }
  | {
      readonly outcome: "rejected";
      readonly reason: ContactRejectionReason;
      readonly issues?: readonly ContactFieldIssue[];
    };

/** HTTP status for each refusal, kept beside the reasons it maps. */
export const CONTACT_REJECTION_STATUS: Record<ContactRejectionReason, number> = {
  "unsupported-media-type": 415,
  "payload-too-large": 413,
  "cross-origin": 403,
  "malformed-body": 400,
  "invalid-fields": 422,
  "rate-limited": 429,
};

/**
 * A JSON response that is never a cacheable representation of anything and
 * carries no CORS headers, so a cross-origin script cannot read it even if it
 * could provoke it. Shared by the contact and gallery-enquiry endpoints, which
 * answer with the same posture (ADR-0004 §5).
 */
export function jsonNoStore(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hasJsonContentType(request: Request): boolean {
  const header = request.headers.get("content-type");
  if (header === null) return false;
  // A charset or boundary parameter is allowed; the media type is not.
  return header.split(";")[0].trim().toLowerCase() === CONTACT_CONTENT_TYPE;
}

/**
 * The host the browser actually addressed. Behind a proxy the forwarded host
 * is the public one, and it is consulted only to compare against a header the
 * browser set itself — a forged pair proves nothing a forged `Origin` alone
 * would not, so trusting it here costs nothing.
 */
function resolveRequestHost(request: Request): string | undefined {
  const header =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = header?.split(",")[0]?.trim().toLowerCase();
  return host && host.length > 0 ? host : undefined;
}

function isSameOrigin(request: Request): boolean {
  // Browsers that send this header have already classified the request for us.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;

  // Every browser sends `Origin` on a POST. Its absence means the request did
  // not come from a page on this site, so there is nothing to compare.
  const origin = request.headers.get("origin");
  if (origin === null) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  const requestHost = resolveRequestHost(request);
  return requestHost !== undefined && originHost === requestHost;
}

/**
 * Reads at most `maxBytes` of the body, stopping the moment the limit is
 * passed. A declared `Content-Length` is checked first because it costs
 * nothing, but it is a claim rather than a measurement, so the stream is
 * counted as it arrives and an oversized body is abandoned instead of
 * buffered.
 */
async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return undefined;
  }

  const body = request.body;
  if (body === null) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Malformed UTF-8 becomes replacement characters, which the field rules then
  // measure and the visitor sees echoed back — a decoding failure is not a
  // separate error state worth reporting.
  return new TextDecoder("utf-8").decode(buffer);
}

/**
 * Whether the parsed body is an envelope this endpoint accepts: a plain object
 * whose keys are all whitelisted and whose values are all strings. Unknown keys
 * are refused rather than ignored, so a caller cannot discover which extra
 * fields a later version might start honoring.
 */
function isAcceptedEnvelope(
  parsed: unknown,
  acceptedKeys: readonly string[],
): parsed is Record<string, string> {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  return Object.entries(parsed).every(
    ([key, value]) =>
      acceptedKeys.includes(key) && typeof value === "string",
  );
}

/**
 * The stateless half of the boundary: whether this request is even shaped like
 * one of ours, decided from headers alone.
 *
 * Returns the reason to refuse, or `undefined` to continue. Nothing here reads
 * the body, allocates, or touches shared state, which is what makes it safe to
 * run before the throttle.
 */
export function checkContactRequestHeaders(
  request: Request,
): ContactRejectionReason | undefined {
  if (!hasJsonContentType(request)) return "unsupported-media-type";
  if (!isSameOrigin(request)) return "cross-origin";
  return undefined;
}

/**
 * The rest of the boundary: read the bounded body and decide what the
 * submission is. Call only after `checkContactRequestHeaders` passed and the
 * throttle allowed the attempt.
 *
 * The caller decides what to answer and what to log; this function decides only
 * what the request is.
 */
export async function readContactSubmission(
  request: Request,
  options?: { readonly extraFields?: readonly string[] },
): Promise<ContactRequestResult> {
  // A closed whitelist per call: the contact fields plus whatever context
  // fields this caller declared. An un-whitelisted key is still a
  // `malformed-body`, so a caller cannot probe which fields a later version
  // might honor.
  const extraFields = options?.extraFields ?? [];
  const acceptedKeys =
    extraFields.length === 0 ? ACCEPTED_KEYS : [...ACCEPTED_KEYS, ...extraFields];

  const body = await readBoundedBody(request, CONTACT_REQUEST_MAX_BYTES);
  if (body === undefined) {
    return { outcome: "rejected", reason: "payload-too-large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { outcome: "rejected", reason: "malformed-body" };
  }

  if (!isAcceptedEnvelope(parsed, acceptedKeys)) {
    return { outcome: "rejected", reason: "malformed-body" };
  }

  const submissionId = parsed[CONTACT_SUBMISSION_ID_FIELD];
  if (submissionId === undefined || !UUID_SHAPE.test(submissionId)) {
    return { outcome: "rejected", reason: "malformed-body" };
  }

  // Checked before the fields are validated: an automated client should not
  // learn which of its invented values the field rules would have accepted.
  if ((parsed[CONTACT_HONEYPOT_FIELD] ?? "").trim().length > 0) {
    return { outcome: "discarded" };
  }

  const fields: Partial<Record<ContactFieldName, string>> = {};
  for (const field of CONTACT_FIELD_NAMES) {
    fields[field] = parsed[field];
  }

  const result = parseContactMessage(fields);
  if (!result.ok) {
    return { outcome: "rejected", reason: "invalid-fields", issues: result.issues };
  }

  if (extraFields.length === 0) {
    return { outcome: "accepted", message: result.message, submissionId };
  }

  const extra: Record<string, string> = {};
  for (const field of extraFields) {
    if (field in parsed) extra[field] = parsed[field];
  }
  return { outcome: "accepted", message: result.message, submissionId, extra };
}
