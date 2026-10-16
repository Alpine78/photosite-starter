/** Administrator-authorized delivery revoke orchestration; no HTTP route. */
import "server-only";
import { types } from "node:util";
import { authorizePrivateGalleryAdministrator, requirePrivateGalleryAdminReauthentication,
  type PrivateGalleryAdminRequestDeps } from "@/lib/private-gallery-access";
import type { PrivateGalleryDeliveryPublicationStore } from "@/lib/private-gallery-delivery-publication-store";
import { PrivateGalleryDeliveryLifecycleError, readDeliveryRevokeData, snapshotDeliveryRevokeInput,
  type PrivateGalleryDeliveryRevokeInput } from "@/lib/private-gallery-delivery-revocation";

type Outcome = { readonly ok: false; readonly reason: "invalid-input" | "not-found" | "conflict" | "unavailable" | "unauthorized" | "reauthentication-required" } | {
  readonly ok: true; readonly value: { readonly handle: string; readonly revision: number;
    readonly capabilityGeneration: number; readonly state: "access-suspended"; readonly accessExpiresAt: string };
};
/** HTTP callers must supply server time and perform their existing origin/body checks. */
export async function revokeDeliveryAccessAsAdmin(
  deps: PrivateGalleryAdminRequestDeps & { readonly publicationStore: Pick<PrivateGalleryDeliveryPublicationStore, "revokeDeliveryAccess"> },
  request: PrivateGalleryDeliveryRevokeInput & { readonly cookieHeader: string | null | undefined },
): Promise<Outcome> {
  try {
    // Copy raw fields before awaits; validate operation-specific values only
    // after authorization so malformed anonymous requests share one refusal.
    const raw = readDeliveryRevokeData(request);
    if (!raw || !types.isDate(raw.now) || !(raw.cookieHeader === null || raw.cookieHeader === undefined || typeof raw.cookieHeader === "string")) return { ok: false, reason: "unauthorized" };
    const now = new Date(Date.prototype.getTime.call(raw.now));
    if (!Number.isFinite(now.getTime())) return { ok: false, reason: "unauthorized" };
    const auth = await authorizePrivateGalleryAdministrator(deps, { cookieHeader: raw.cookieHeader, now });
    if (!auth.ok) return { ok: false, reason: "unauthorized" };
    const recent = requirePrivateGalleryAdminReauthentication(auth.session, now);
    if (!recent.ok) return { ok: false, reason: "reauthentication-required" };
    if (Object.keys(raw).sort().join(",") !== "cookieHeader,expectedGeneration,expectedRevision,handle,now") return { ok: false, reason: "invalid-input" };
    const input = snapshotDeliveryRevokeInput({ handle: raw.handle, expectedRevision: raw.expectedRevision, expectedGeneration: raw.expectedGeneration, now });
    const result = await deps.publicationStore.revokeDeliveryAccess(input);
    if (!result?.gallery || result.gallery.galleryHandle !== input.handle || result.gallery.state !== "access-suspended" ||
        result.revision !== input.expectedRevision + 1 || result.gallery.capabilityGeneration !== input.expectedGeneration + 1 ||
        !(result.gallery.accessExpiresAt instanceof Date) || !Number.isFinite(result.gallery.accessExpiresAt.getTime())) return { ok: false, reason: "unavailable" };
    return { ok: true, value: { handle: result.gallery.galleryHandle, revision: result.revision,
      capabilityGeneration: result.gallery.capabilityGeneration, state: "access-suspended", accessExpiresAt: result.gallery.accessExpiresAt!.toISOString() } };
  } catch (error) {
    if (error instanceof PrivateGalleryDeliveryLifecycleError) return { ok: false, reason: error.reason };
    return { ok: false, reason: "unavailable" };
  }
}
