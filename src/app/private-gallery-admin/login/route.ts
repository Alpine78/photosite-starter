import { NextResponse } from "next/server";

import {
  createCorrelationId,
  logPrivateGalleryAdminEvent,
} from "@/lib/contact-log";
import { jsonNoStore, readBoundedBody } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  attemptPrivateGalleryAdminLogin,
  checkPrivateGalleryAdminLoginRequestHeaders,
  createPrivateGalleryAdminLoginIpLimiter,
  deriveClientKey,
  getPrivateGalleryAdminStores,
  PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH,
} from "@/lib/private-gallery-access";

/**
 * The administrator sign-in endpoint (ADR-0015 §3, §4).
 *
 * **Every refusal answers identically** — the same status, the same body, no
 * `Retry-After` — because a status or header that varied by cause would tell a
 * prober whether they are being throttled and therefore when to resume. There
 * is no account to enumerate here, but there is a rate-limit state and a
 * credential to probe. Only the operational log keeps the class, and only for
 * the failures the facade marks as a defect.
 *
 * The ordering that matters — throttle, then resolve the credential, then
 * verify, then mint — belongs to `attemptPrivateGalleryAdminLogin`, not to this
 * file. A route that assembled it itself could get it wrong in a way no test of
 * the individual pieces would catch.
 */
export const dynamic = "force-dynamic";

/**
 * `{"secret":"…"}` around a secret bounded at 512 characters, plus room for
 * whitespace and nothing else. Counted in bytes by `readBoundedBody`, which
 * abandons the stream the moment the bound is passed rather than buffering
 * first — this endpoint is reached before the throttle.
 */
const MAX_BODY_BYTES = PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH + 128;

/** One instance per process, so a login never spends another endpoint's allowance. */
const ipLimiter = createPrivateGalleryAdminLoginIpLimiter();

function refused(): Response {
  return jsonNoStore({ ok: false }, 401);
}

async function readSecret(request: Request): Promise<string | undefined> {
  const raw = await readBoundedBody(request, MAX_BODY_BYTES);
  if (raw === undefined) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  // A closed whitelist: exactly one field, nothing else accepted, so a caller
  // cannot probe which fields a later version might honour.
  if (Object.keys(record).length !== 1) return undefined;
  const secret = record.secret;
  return typeof secret === "string" ? secret : undefined;
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = createCorrelationId();
  const { privateGallery } = getDeploymentConfig();
  if (privateGallery.store === "off") return refused();

  if (checkPrivateGalleryAdminLoginRequestHeaders(request) !== undefined) {
    return refused();
  }

  const secret = await readSecret(request);
  if (secret === undefined) return refused();

  let stores;
  try {
    stores = getPrivateGalleryAdminStores();
  } catch {
    logPrivateGalleryAdminEvent({
      correlationId,
      state: "rejected",
      errorClass: "unexpected",
    });
    return refused();
  }

  const outcome = await attemptPrivateGalleryAdminLogin(
    {
      loginStore: stores.loginStore,
      sessionStore: stores.sessionStore,
      ipLimiter,
      environment: stores.environment,
    },
    { submittedSecret: secret, clientKey: deriveClientKey(request), now: new Date() },
  );

  if (!outcome.ok) {
    if (outcome.failure.logWorthy) {
      logPrivateGalleryAdminEvent({
        correlationId,
        state: "rejected",
        errorClass: outcome.failure.reason,
      });
    }
    return refused();
  }

  logPrivateGalleryAdminEvent({ correlationId, state: "accepted" });

  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
  const { name, value, options } = outcome.cookie;
  response.cookies.set(name, value, options);
  return response;
}
