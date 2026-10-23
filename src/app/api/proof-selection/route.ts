import { checkContactRequestHeaders, jsonNoStore, readBoundedBody, CONTACT_REJECTION_STATUS } from "@/lib/contact-request";
import { createContactRateLimiter, deriveClientKey } from "@/lib/contact-rate-limit";
import { createCorrelationId, logProofSelectionEvent, type ProofSelectionErrorClass } from "@/lib/contact-log";
import { parseProofSelectionBody, PROOF_SELECTION_BODY_BYTES, readProofSelectionConfig } from "@/lib/proof-selection-request";
import { runProofSelection } from "@/lib/proof-selection-access";

/**
 * Proof selection (ADR-0038 decision 5, action item 3, AB#130): read, save the
 * full selected set, or confirm it, holding the selection key from the link's
 * fragment. Off unless `PROOF_SELECTION=enabled`. Same-origin JSON only, the
 * client allowance before the body is read, the gallery allowance only after
 * the key matched (inside the facade). Every refusal of an unknown handle, a
 * wrong key or a closed or replaced gallery is the same 404.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One ordinary session: a read, a few dozen saves, conflicts and a confirmation.
const clientLimiter = createContactRateLimiter({ maxAttempts: 120 });
const galleryLimiter = createContactRateLimiter({ maxAttempts: 240 });

const REJECTION_STATUS: Record<string, number> = {
  conflict: 409, confirmed: 409, "stale-selection": 409, "unknown-reference": 422, empty: 422,
};

export async function POST(request: Request): Promise<Response> {
  const config = readProofSelectionConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const correlationId = createCorrelationId();
  const log = (state: "rejected" | "failed" | "unknown", errorClass: ProofSelectionErrorClass) => logProofSelectionEvent({ correlationId, state, errorClass });
  if (config.state === "misconfigured") {
    log("failed", "misconfigured");
    return jsonNoStore({ status: "failed", correlationId }, 503);
  }
  const headerRejection = checkContactRequestHeaders(request);
  if (headerRejection) {
    log("rejected", headerRejection === "cross-origin" ? "origin" : "malformed-request");
    return jsonNoStore({ status: "rejected", reason: headerRejection, correlationId }, CONTACT_REJECTION_STATUS[headerRejection]);
  }
  if (!clientLimiter.tryConsume(deriveClientKey(request), Date.now()).allowed) {
    log("rejected", "rate-limited");
    return jsonNoStore({ status: "rejected", reason: "rate-limited", retryable: true, correlationId }, 429);
  }
  const parsed = parseProofSelectionBody(await readBoundedBody(request, PROOF_SELECTION_BODY_BYTES));
  if (!parsed) {
    log("rejected", "malformed-request");
    return jsonNoStore({ status: "rejected", reason: "malformed-request", correlationId }, 400);
  }
  try {
    const result = await runProofSelection(parsed, config.token, {
      galleryAllowed: (galleryId) => galleryLimiter.tryConsume(galleryId, Date.now()).allowed,
    });
    switch (result.outcome) {
      case "ok":
        if (result.written) logProofSelectionEvent({ correlationId, state: result.written });
        return jsonNoStore({ status: "ok", selection: result.selection, correlationId }, 200);
      case "unavailable":
        log("rejected", "unavailable");
        return jsonNoStore({ status: "unavailable", correlationId }, 404);
      case "rejected":
        log("rejected", result.reason);
        return jsonNoStore({ status: "rejected", reason: result.reason, selection: result.selection, correlationId }, REJECTION_STATUS[result.reason] ?? 409);
      case "rate-limited":
        log("rejected", "rate-limited");
        return jsonNoStore({ status: "rejected", reason: "rate-limited", retryable: true, correlationId }, 429);
      case "committed":
        logProofSelectionEvent({ correlationId, state: result.written });
        // Written, but not read back: the client reads before acting again.
        return jsonNoStore({ status: "committed", written: result.written, correlationId }, 202);
      case "unknown":
        log("unknown", "store-unavailable");
        return jsonNoStore({ status: "unknown", correlationId }, 503);
      case "failed":
        log("failed", result.reason);
        return jsonNoStore({ status: "failed", retryable: result.reason === "store-unavailable", correlationId }, 503);
    }
  } catch {
    log("failed", "internal");
    return jsonNoStore({ status: "failed", correlationId }, 500);
  }
}
