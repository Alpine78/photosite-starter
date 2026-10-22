import { readBoundedBody } from "@/lib/contact-request";
import { createContactRateLimiter, deriveClientKey } from "@/lib/contact-rate-limit";
import { createCorrelationId, logProofPublicationEvent, type ProofPublicationErrorClass } from "@/lib/contact-log";
import {
  parseProofPublicationBody,
  PROOF_PUBLICATION_BODY_BYTES,
  readEditorToken,
  readProofPublicationConfig,
  studioCorsHeaders,
} from "@/lib/proof-publication-request";
import { runProofPublication } from "@/lib/proof-publication-access";

/**
 * Proof gallery publication and selection-key rotation (ADR-0038 amendment
 * 2026-10-22, AB#130). Called cross-origin by the Studio publish action with
 * the editor's own Sanity token; off unless `PROOF_PUBLICATION=enabled`.
 *
 * Order matters: the cheapest checks run first, the per-client limit runs
 * before the `/users/me` call, and the per-gallery limit only after the
 * caller is a proven user (inside `runProofPublication`), so strangers cannot
 * exhaust a gallery's allowance.
 * A selection key leaves this route only after its transaction committed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clientLimiter = createContactRateLimiter({ maxAttempts: 30 });

const REJECTION_STATUS: Record<string, number> = {
  "not-found": 404,
  "invalid-gallery": 422,
  "invalid-references": 422,
  "unsupported-release": 409,
  inconsistent: 409,
};

function isJson(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

export async function OPTIONS(request: Request): Promise<Response> {
  const config = readProofPublicationConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404 });
  if (config.state === "misconfigured") return new Response(null, { status: 503 });
  const cors = studioCorsHeaders(request.headers.get("origin"), config.studioOrigins);
  if (!cors || request.headers.get("access-control-request-method") !== "POST") return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(request: Request): Promise<Response> {
  const config = readProofPublicationConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404 });
  const correlationId = createCorrelationId();
  const fail = (state: "rejected" | "failed", errorClass: ProofPublicationErrorClass) =>
    logProofPublicationEvent({ correlationId, state, errorClass });
  if (config.state === "misconfigured") {
    fail("failed", "misconfigured");
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const cors = studioCorsHeaders(request.headers.get("origin"), config.studioOrigins);
  if (!cors) {
    fail("rejected", "origin");
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const respond = (body: Record<string, unknown>, status: number) =>
    Response.json({ ...body, correlationId }, { status, headers: { ...cors, "Cache-Control": "no-store" } });
  const reject = (errorClass: ProofPublicationErrorClass, status: number, retryable = false) => {
    fail(status >= 500 ? "failed" : "rejected", errorClass);
    return respond({ status: status >= 500 ? "failed" : "rejected", reason: errorClass, ...(retryable ? { retryable } : {}) }, status);
  };

  if (!isJson(request)) return reject("malformed-request", 415);
  if (!clientLimiter.tryConsume(deriveClientKey(request), Date.now()).allowed) return reject("rate-limited", 429, true);
  const token = readEditorToken(request.headers.get("authorization"));
  if (!token) return reject("unauthenticated", 401);
  const parsed = parseProofPublicationBody(await readBoundedBody(request, PROOF_PUBLICATION_BODY_BYTES));
  if (!parsed) return reject("malformed-request", 400);

  try {
    const result = await runProofPublication(parsed, token, config.secret);
    if (result.outcome === "rejected") {
      return result.reason === "rate-limited" ? reject("rate-limited", 429, true) : reject(result.reason, REJECTION_STATUS[result.reason] ?? 422);
    }
    if (result.outcome === "failed") {
      if (result.reason === "unauthenticated") return reject("unauthenticated", 401);
      if (result.reason === "forbidden") return reject("forbidden", 403);
      if (result.reason === "conflict") return reject("conflict", 409, true);
      if (result.reason === "misconfigured") return reject("misconfigured", 503);
      return reject("store-unavailable", 503, true);
    }
    logProofPublicationEvent({ correlationId, state: parsed.operation === "publish" ? "published" : "key-rotated" });
    return respond({
      status: parsed.operation === "publish" ? "published" : "key-rotated",
      firstPublication: result.firstPublication,
      ...(result.selectionKey === undefined ? {} : { selectionKey: result.selectionKey }),
    }, 200);
  } catch {
    return reject("internal", 500);
  }
}
