import "server-only";
import { readBoundedBody } from "@/lib/contact-request";
import { checkPrivateGalleryAdminLoginRequestHeaders } from "@/lib/private-gallery-admin-login";
import {
  PRIVATE_GALLERY_DELIVERY_DRAFT_LIST_LIMIT, PrivateGalleryDeliveryDraftStoreError,
  validateDeliveryDraftInput, type PrivateGalleryDeliveryDraft, type PrivateGalleryDeliveryDraftStore,
} from "@/lib/private-gallery-delivery-draft-store";

export type DeliveryDraftAdminItem = {
  readonly handle: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly customerReference?: string;
  readonly jobReference?: string;
};
export type DeliveryDraftAdminOutcome<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly reason: "unauthorized" | "invalid-input" | "unavailable" };
type Deps = {
  readonly store: PrivateGalleryDeliveryDraftStore;
  authorize(cookieHeader: string | null | undefined, now: Date): Promise<boolean>;
};
function project(row: PrivateGalleryDeliveryDraft): DeliveryDraftAdminItem {
  return { handle: row.gallery.galleryHandle, createdAt: row.gallery.createdAt.toISOString(), revision: row.revision,
    ...(row.customerReference === undefined ? {} : { customerReference: row.customerReference }),
    ...(row.jobReference === undefined ? {} : { jobReference: row.jobReference }) };
}
export async function createDeliveryDraftAsAdmin(deps: Deps, request: Request, now: Date): Promise<DeliveryDraftAdminOutcome<DeliveryDraftAdminItem>> {
  if (checkPrivateGalleryAdminLoginRequestHeaders(request) !== undefined) return { ok: false, reason: "invalid-input" };
  try {
    if (!await deps.authorize(request.headers.get("cookie"), now)) return { ok: false, reason: "unauthorized" };
    const raw = await readBoundedBody(request, 1024);
    if (raw === undefined) return { ok: false, reason: "invalid-input" };
    let input;
    try { input = validateDeliveryDraftInput(JSON.parse(raw)); }
    catch { return { ok: false, reason: "invalid-input" }; }
    return { ok: true, value: project(await deps.store.create(input, now)) };
  } catch (error) {
    return { ok: false, reason: error instanceof PrivateGalleryDeliveryDraftStoreError && error.reason === "invalid-input" ? "invalid-input" : "unavailable" };
  }
}
export async function listDeliveryDraftsAsAdmin(deps: Deps, request: { readonly cookieHeader: string | null | undefined; readonly now: Date }): Promise<DeliveryDraftAdminOutcome<{ readonly items: readonly DeliveryDraftAdminItem[]; readonly hasMore: boolean }>> {
  try {
    if (!await deps.authorize(request.cookieHeader, request.now)) return { ok: false, reason: "unauthorized" };
    const result = await deps.store.list(PRIVATE_GALLERY_DELIVERY_DRAFT_LIST_LIMIT);
    return { ok: true, value: { items: result.items.map(project), hasMore: result.hasMore } };
  } catch { return { ok: false, reason: "unavailable" }; }
}
