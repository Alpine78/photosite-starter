import { jsonNoStore, readBoundedBody } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  checkPrivateGalleryAdminLoginRequestHeaders,
  getPrivateGalleryAdminStores,
  isPrivateGalleryHandle,
  readPrivateGalleryProofAdminStatus,
  reopenPrivateGalleryProofAsAdmin,
  resendPrivateGalleryProofNotificationAsAdmin,
} from "@/lib/private-gallery-access";

/**
 * The administrator's own view of one proof gallery (AB#130): its
 * draft/confirmation state, the current notification's delivery status, and
 * the two administrator-only actions — reopen and resend — that act on it.
 *
 * Every acting method re-authorizes the administrator session on every call,
 * exactly as the customer-facing proof endpoint re-authorizes the customer
 * session; there is no "the page loaded, so the action is authorized" gap.
 */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ handle: string }> };

/** One body shape per max 1 KiB request; bounded well above either payload. */
const MAX_BODY_BYTES = 1024;

function refused(status: number, reason?: string): Response {
  return jsonNoStore(reason === undefined ? { ok: false } : { ok: false, reason }, status);
}

function statusFor(reason: string): number {
  if (reason === "not-found") return 404;
  if (reason === "conflict") return 409;
  if (reason === "not-confirmed") return 422;
  return 401;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  const { handle } = await params;
  if (!isPrivateGalleryHandle(handle)) return refused(404);

  let stores;
  try {
    stores = getPrivateGalleryAdminStores();
  } catch {
    return refused(401);
  }

  const outcome = await readPrivateGalleryProofAdminStatus(
    { sessionStore: stores.sessionStore, environment: stores.environment,
      proofStore: stores.proofStore, findProofGalleryIdByHandle: stores.findProofGalleryIdByHandle },
    { handle, cookieHeader: request.headers.get("cookie"), now: new Date() },
  );
  if (!outcome.ok) return refused(statusFor(outcome.reason), outcome.reason);
  return jsonNoStore({ ok: true, status: outcome.value }, 200);
}

type ActionInput =
  | { readonly action: "reopen"; readonly expectedRevision: number }
  | { readonly action: "resend" };

async function readAction(request: Request): Promise<ActionInput | undefined> {
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
  const keys = Object.keys(record).sort();
  if (record.action === "resend" && keys.join(",") === "action") {
    return { action: "resend" };
  }
  if (
    record.action === "reopen" &&
    keys.join(",") === "action,expectedRevision" &&
    Number.isSafeInteger(record.expectedRevision) &&
    (record.expectedRevision as number) >= 0
  ) {
    return { action: "reopen", expectedRevision: record.expectedRevision as number };
  }
  return undefined;
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  if (checkPrivateGalleryAdminLoginRequestHeaders(request) !== undefined) {
    return refused(400);
  }

  const { handle } = await params;
  if (!isPrivateGalleryHandle(handle)) return refused(404);

  const input = await readAction(request);
  if (input === undefined) return refused(400);

  let stores;
  try {
    stores = getPrivateGalleryAdminStores();
  } catch {
    return refused(401);
  }

  const deps = {
    sessionStore: stores.sessionStore,
    environment: stores.environment,
    proofStore: stores.proofStore,
    findProofGalleryIdByHandle: stores.findProofGalleryIdByHandle,
  };
  const now = new Date();

  const outcome =
    input.action === "reopen"
      ? await reopenPrivateGalleryProofAsAdmin(deps, {
          handle, cookieHeader: request.headers.get("cookie"), now,
          expectedRevision: input.expectedRevision,
        })
      : await resendPrivateGalleryProofNotificationAsAdmin(deps, {
          handle, cookieHeader: request.headers.get("cookie"), now,
        });

  if (!outcome.ok) return refused(statusFor(outcome.reason), outcome.reason);
  return jsonNoStore({ ok: true, ...outcome.value }, 200);
}
