import { jsonNoStore } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { createPrivateGalleryDeliveryDraftAsAdmin, getPrivateGalleryAdminStores, listPrivateGalleryDeliveryDraftsAsAdmin, updatePrivateGalleryDeliveryDraftReferencesAsAdmin } from "@/lib/private-gallery-access";
export const dynamic = "force-dynamic";
function refused(status: number) { return jsonNoStore({ ok: false }, status); }
function storesOrUndefined() { try { return getPrivateGalleryAdminStores(); } catch { return undefined; } }
export async function GET(request: Request): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  const stores = storesOrUndefined();
  if (!stores) return refused(401);
  const outcome = await listPrivateGalleryDeliveryDraftsAsAdmin(stores, { cookieHeader: request.headers.get("cookie"), now: new Date() });
  if (!outcome.ok) return refused(outcome.reason === "unauthorized" ? 401 : 503);
  return jsonNoStore({ ok: true, ...outcome.value }, 200);
}
export async function POST(request: Request): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  const stores = storesOrUndefined();
  if (!stores) return refused(401);
  const outcome = await createPrivateGalleryDeliveryDraftAsAdmin(stores, request, new Date());
  if (!outcome.ok) return refused(outcome.reason === "invalid-input" ? 400 : outcome.reason === "unauthorized" ? 401 : 503);
  return jsonNoStore({ ok: true, draft: outcome.value }, 201);
}
export async function PATCH(request: Request): Promise<Response> {
  if (getDeploymentConfig().privateGallery.store === "off") return refused(404);
  const stores = storesOrUndefined();
  if (!stores) return refused(401);
  const outcome = await updatePrivateGalleryDeliveryDraftReferencesAsAdmin(stores, request, new Date());
  if (!outcome.ok) return refused(outcome.reason === "invalid-input" ? 400 : outcome.reason === "unauthorized" ? 401
    : outcome.reason === "not-found" ? 404 : outcome.reason === "conflict" ? 409 : 503);
  return jsonNoStore({ ok: true, draft: outcome.value }, 200);
}
