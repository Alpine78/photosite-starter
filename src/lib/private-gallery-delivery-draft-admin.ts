import "server-only";
import { readPrivateDraftCursor, buildPrivateDraftCursor, PrivateDraftCursorError } from "@/lib/private-gallery-draft-cursor";
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
  { readonly ok: false; readonly reason: "unauthorized" | "invalid-input" | "unavailable" | "not-found" | "conflict" };
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
export async function listDeliveryDraftsAsAdmin(deps: Deps, request: { readonly cookieHeader: string | null | undefined; readonly now: Date; readonly listUrl?: string }): Promise<DeliveryDraftAdminOutcome<{ readonly items: readonly DeliveryDraftAdminItem[]; readonly hasMore: boolean; readonly nextCursor?: string }>> {
  try {
    if (!await deps.authorize(request.cookieHeader, request.now)) return { ok: false, reason: "unauthorized" };
    const after = readPrivateDraftCursor(request.listUrl, "delivery");
    const result = await deps.store.list(PRIVATE_GALLERY_DELIVERY_DRAFT_LIST_LIMIT, after);
    const items = result.items.map(project);
    return { ok: true, value: { items, hasMore: result.hasMore,
      ...(result.hasMore && items.length ? { nextCursor: buildPrivateDraftCursor("delivery", items.at(-1)!.handle) } : {}) } };
  } catch (error) {
    if (error instanceof PrivateDraftCursorError || (error instanceof PrivateGalleryDeliveryDraftStoreError && error.reason === "invalid-cursor")) return { ok: false, reason: "invalid-input" };
    return { ok: false, reason: "unavailable" };
  }
}

/** Replace both external references on an unpublished draft, guarded by revision. */
export async function updateDeliveryDraftReferencesAsAdmin(deps: Deps, request: Request, now: Date): Promise<DeliveryDraftAdminOutcome<DeliveryDraftAdminItem>> {
  if (checkPrivateGalleryAdminLoginRequestHeaders(request) !== undefined) return { ok: false, reason: "invalid-input" };
  try {
    if (!await deps.authorize(request.headers.get("cookie"), now)) return { ok: false, reason: "unauthorized" };
    const raw = await readBoundedBody(request, 1024);
    if (raw === undefined) return { ok: false, reason: "invalid-input" };
    let input;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).sort().join(",") !== "expectedRevision,handle,references") return { ok: false, reason: "invalid-input" };
      const row = value as Record<string, unknown>;
      if (typeof row.handle !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(row.handle) ||
          !Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0) return { ok: false, reason: "invalid-input" };
      input = { handle: row.handle, expectedRevision: row.expectedRevision as number,
        references: validateDeliveryDraftInput(row.references) };
    } catch { return { ok: false, reason: "invalid-input" }; }
    return { ok: true, value: project(await deps.store.updateReferences(input)) };
  } catch (error) {
    if (error instanceof PrivateGalleryDeliveryDraftStoreError &&
        ["invalid-input", "not-found", "conflict"].includes(error.reason)) {
      return { ok: false, reason: error.reason as "invalid-input" | "not-found" | "conflict" };
    }
    return { ok: false, reason: "unavailable" };
  }
}
