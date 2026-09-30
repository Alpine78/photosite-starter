import {
  createCorrelationId,
  logPrivateGalleryMintEvent,
} from "@/lib/contact-log";
import {
  checkContactRequestHeaders,
  jsonNoStore,
  readBoundedBody,
} from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  authorizePrivateGalleryView,
  getPrivateGalleryStores,
  isPrivateGalleryHandle,
  mintPrivateGalleryAssetUrl,
  type PrivateGalleryMintRequest,
} from "@/lib/private-gallery-access";

/**
 * ADR-0014 §5 Stage 1 for one private asset. The browser names only a
 * server-owned placement identifier, or asks for this gallery's one active ZIP.
 * It can never submit an object key. The facade owns asset lookup, the atomic
 * access budget, and signing, in that order.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256;
const PLACEMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function refused(): Response {
  // One response for every refusal, including malformed input and missing
  // infrastructure: no status, body, or Retry-After existence oracle.
  return jsonNoStore({ ok: false }, 403);
}

async function readMintRequest(
  request: Request,
): Promise<PrivateGalleryMintRequest | undefined> {
  const raw = await readBoundedBody(request, MAX_BODY_BYTES);
  if (raw === undefined) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.kind === "zip" && keys.length === 1) {
    return { kind: "zip" };
  }
  if (
    record.kind === "preview" &&
    keys.length === 2 &&
    keys.includes("placementId") &&
    typeof record.placementId === "string" &&
    PLACEMENT_ID_PATTERN.test(record.placementId)
  ) {
    return { kind: "preview", placementId: record.placementId };
  }
  return undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { privateGallery } = getDeploymentConfig();
  if (privateGallery.store === "off") return refused();
  if (checkContactRequestHeaders(request) !== undefined) return refused();

  const { handle } = await params;
  if (!isPrivateGalleryHandle(handle)) return refused();

  const correlationId = createCorrelationId();
  let stores;
  try {
    stores = getPrivateGalleryStores();
  } catch {
    logPrivateGalleryMintEvent({
      correlationId,
      state: "rejected",
      errorClass: "unexpected",
    });
    return refused();
  }

  // The raw Cookie header preserves duplicates so the facade can reject a
  // cookie-tossed second session value. A parsed cookie accessor would hide it.
  const authorized = await authorizePrivateGalleryView(
    { sessionStore: stores.sessionStore, viewStore: stores.viewStore },
    {
      handle,
      cookieHeader: request.headers.get("cookie"),
      now: new Date(),
    },
  );
  if (!authorized.authorized) {
    if (authorized.failure.logWorthy) {
      logPrivateGalleryMintEvent({
        correlationId,
        state: "rejected",
        errorClass: authorized.failure.reason,
      });
    }
    return refused();
  }

  // An unauthenticated caller never gets a body read or a placement lookup.
  const mintRequest = await readMintRequest(request);
  if (mintRequest === undefined) return refused();

  const outcome = await mintPrivateGalleryAssetUrl(
    { deliveryStore: stores.deliveryStore },
    {
      gallery: authorized.gallery,
      session: authorized.session,
      request: mintRequest,
      now: new Date(),
    },
  );
  if (!outcome.ok) {
    if (outcome.failure.logWorthy) {
      logPrivateGalleryMintEvent({
        correlationId,
        state: "rejected",
        errorClass: outcome.failure.reason,
      });
    }
    return refused();
  }

  logPrivateGalleryMintEvent({ correlationId, state: "accepted" });
  return jsonNoStore(
    { ok: true, url: outcome.url, expiresAt: outcome.expiresAt.toISOString() },
    200,
  );
}
