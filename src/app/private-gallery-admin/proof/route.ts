import { jsonNoStore } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  createPrivateGalleryProofDraftAsAdmin,
  getPrivateGalleryAdminStores,
  listPrivateGalleryProofDraftsAsAdmin,
} from "@/lib/private-gallery-access";

/** Administrator-only, development-memory proof setup. Every response is uncached. */
export const dynamic = "force-dynamic";

function refused(status: number): Response {
  return jsonNoStore({ ok: false }, status);
}

function storesOrUndefined() {
  try {
    return getPrivateGalleryAdminStores();
  } catch {
    return undefined;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  const stores = storesOrUndefined();
  if (stores === undefined) return refused(401);
  const outcome = await listPrivateGalleryProofDraftsAsAdmin(stores, {
    cookieHeader: request.headers.get("cookie"), now: new Date(),
  });
  if (!outcome.ok) return refused(outcome.reason === "unauthorized" ? 401 : 503);
  return jsonNoStore({ ok: true, ...outcome.value }, 200);
}

export async function POST(request: Request): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  const stores = storesOrUndefined();
  if (stores === undefined) return refused(401);
  const outcome = await createPrivateGalleryProofDraftAsAdmin(stores, request, new Date());
  if (!outcome.ok) return refused(outcome.reason === "invalid-input" ? 400 : outcome.reason === "unauthorized" ? 401 : 503);
  return jsonNoStore({ ok: true, draft: outcome.value }, 201);
}
