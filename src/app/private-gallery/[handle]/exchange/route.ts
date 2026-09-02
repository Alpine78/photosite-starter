import { NextResponse } from "next/server";

import {
  createCorrelationId,
  logPrivateGalleryExchangeEvent,
} from "@/lib/contact-log";
import {
  checkContactRequestHeaders,
  jsonNoStore,
  readBoundedBody,
} from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  createPrivateGalleryExchangeIpLimiter,
  deriveClientKey,
  exchangePrivateGalleryCapability,
  getPrivateGalleryStores,
  isPrivateGalleryHandle,
} from "@/lib/private-gallery-access";

/**
 * The capability exchange (ADR-0014 §3): the browser posts the capability it
 * read out of the link fragment, and receives a session cookie or one
 * indistinguishable refusal.
 *
 * **Every refusal answers identically** — the same status, the same body, no
 * `Retry-After` — because a status or header that varied by cause would tell a
 * prober whether a handle exists, however generic the words are. Only the
 * operational log keeps the class, and only for the refusals the facade marks
 * as a defect.
 */
export const dynamic = "force-dynamic";

/**
 * A capability is 43 base64url characters, so `{"capability":"…"}` is about 60
 * bytes; 512 leaves room for whitespace and nothing else. Counted in bytes by
 * `readBoundedBody`, which abandons the stream the moment the bound is passed
 * rather than buffering first and measuring after — the distinction matters
 * here, because this endpoint is reached before the per-IP throttle.
 */
const MAX_BODY_BYTES = 512;

/** One instance per process, so an exchange never spends another endpoint's allowance. */
const ipLimiter = createPrivateGalleryExchangeIpLimiter();

function refused(): Response {
  return jsonNoStore({ ok: false }, 403);
}

async function readCapability(request: Request): Promise<string | undefined> {
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
  // A closed whitelist: exactly one field, nothing else accepted.
  if (Object.keys(record).length !== 1) return undefined;
  const capability = record.capability;
  return typeof capability === "string" ? capability : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const correlationId = createCorrelationId();
  const { privateGallery } = getDeploymentConfig();
  if (privateGallery.store === "off") return refused();

  if (checkContactRequestHeaders(request) !== undefined) return refused();

  const { handle } = await params;
  if (!isPrivateGalleryHandle(handle)) return refused();

  const capability = await readCapability(request);
  if (capability === undefined) return refused();

  let stores;
  try {
    stores = getPrivateGalleryStores();
  } catch {
    logPrivateGalleryExchangeEvent({
      correlationId,
      state: "rejected",
      errorClass: "unexpected",
    });
    return refused();
  }

  const outcome = await exchangePrivateGalleryCapability(
    {
      exchangeStore: stores.exchangeStore,
      sessionStore: stores.sessionStore,
      keyring: stores.keyring,
      routePrefix: privateGallery.routePrefix,
      ipLimiter,
    },
    {
      handle,
      submittedSecret: capability,
      clientKey: deriveClientKey(request),
      now: new Date(),
    },
  );

  if (!outcome.ok) {
    if (outcome.failure.logWorthy) {
      logPrivateGalleryExchangeEvent({
        correlationId,
        state: "rejected",
        errorClass: outcome.failure.reason,
      });
    }
    return refused();
  }

  logPrivateGalleryExchangeEvent({ correlationId, state: "accepted" });

  // The framework owns the `Set-Cookie` wire format — slice 4 deliberately
  // ships no serializer of its own, so the two cannot drift.
  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
  const { name, value, options } = outcome.cookie;
  response.cookies.set(name, value, options);
  return response;
}
