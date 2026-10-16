import { describe, expect, it, vi } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore, type PrivateGalleryDeliveryDraft } from "./private-gallery-delivery-draft-store";
import { revokeDeliveryAccessAsAdmin } from "./private-gallery-delivery-lifecycle";
import { buildRevokedDeliveryCandidate } from "./private-gallery-delivery-revocation";
import { privateGalleryDeliveryNotificationStatus } from "./private-gallery-delivery-notification-status";
import { createPrivateGalleryAdminSession, PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME,
  PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS, type PrivateGalleryAdminSessionStore } from "./private-gallery-admin-session";
import { encodePrivateGalleryAdminCredential } from "./private-gallery-admin-credential-format";
import { loadPrivateGalleryAdminCredential } from "./private-gallery-admin-credential";
import { createPrivateGallerySession, authorizePrivateGallerySessionRequest, PRIVATE_GALLERY_SESSION_COOKIE_NAME, type PrivateGallerySessionStore } from "./private-gallery-session";
import { resolveVerifiedPrivateGalleryCapability } from "./private-gallery-exchange";
import { buildPrivateGalleryDeliveryNotification } from "./private-gallery-delivery-notification";
import { openCapability } from "./private-gallery-capability";
import type { PrivateGalleryAdminSession, PrivateGallerySession } from "./private-gallery";
const NOW = new Date("2026-10-16T12:00:00Z");
const environment = { PRIVATE_GALLERY_ADMIN_SECRET_HASH: encodePrivateGalleryAdminCredential({ secret: Buffer.alloc(32, 7).toString("base64url"), salt: Buffer.alloc(16, 9) }) };
const generation = loadPrivateGalleryAdminCredential(environment).generation;
const keyring = { activeKeyId: "key-1", keyIds: ["key-1"], getKey: () => Buffer.alloc(32, 17) };
async function setup() {
  const store = createPrivateGalleryDeliveryDraftMemoryStore();
  const draft = await store.create({ customerReference: "client-ref", jobReference: "job-ref" }, NOW);
  const handle = draft.gallery.galleryHandle;
  const plan = await store.openFirstPreparation({ handle, expectedRevision: 0, keyPrefix: "private", now: NOW,
    manifest: [{ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1000, width: 1200, height: 800 }, { kind: "zip", nominalBytes: 100000 }] });
  const done = await store.completeFirstPreparation({ handle, expectedRevision: 1, preparationId: plan.preparation.preparationId, now: NOW,
    receipts: [], observations: plan.objects.map((item) => ({ objectKey: item.objectKey, sizeBytes: item.nominalBytes })) });
  if (!done.ready) throw new Error("fixture not ready");
  const publish = { handle, expectedRevision: 2, recipient: "client@example.test", locale: "fi", canonicalOrigin: "https://photo.example.test", routePrefix: "client", now: NOW, keyring };
  const original = await store.publishFirstDelivery(publish);
  const row: PrivateGalleryDeliveryDraft = { ...done.setup, gallery: original.gallery, revision: original.revision,
    publication: { sourceRevision: original.sourceRevision, capability: original.capability, outbox: original.outbox, notification: original.notification } };
  const admins = new Map<string, PrivateGalleryAdminSession>();
  const sessionStore: PrivateGalleryAdminSessionStore = { async create(session) { admins.set(session.sessionIdHash, structuredClone(session)); },
    async findByHash(hash) { return structuredClone(admins.get(hash)); }, async deleteByHash(hash) { admins.delete(hash); } };
  const admin = await createPrivateGalleryAdminSession(sessionStore, { credentialGeneration: generation, now: new Date(NOW.getTime() - 3600000) });
  admins.set(admin.session.sessionIdHash, { ...admin.session, reauthenticatedAt: NOW });
  const request = { handle, expectedRevision: 3, expectedGeneration: 0, now: new Date(NOW), cookieHeader: `${PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME}=${admin.cookie.value}` };
  return { store, original, row, publish, request, admins, admin, deps: { sessionStore, environment: { ...environment }, publicationStore: store } };
}
describe("reauthenticated delivery access revocation", () => {
  it("requires a fresh revision after envelope rotation and preserves the rotated envelope on revoke", async () => {
    const { store, original, request, deps } = await setup();
    const rotated = await store.rotateCapabilityEnvelope({ handle: request.handle, now: NOW,
      keyring: { activeKeyId: "key-2", keyIds: ["key-1", "key-2"], getKey: (id) => Buffer.alloc(32, id === "key-1" ? 17 : 23) } });
    expect(rotated.publication.revision).toBe(4);
    expect(await revokeDeliveryAccessAsAdmin(deps, request)).toEqual({ ok: false, reason: "conflict" });
    expect(await store.readPublication(request.handle)).toEqual(rotated.publication);
    expect((await revokeDeliveryAccessAsAdmin(deps, { ...request, expectedRevision: 4 })).ok).toBe(true);
    const revoked = (await store.readPublication(request.handle))!;
    expect(revoked).toMatchObject({ revision: 5, gallery: { state: "access-suspended", capabilityGeneration: 1 } });
    expect(revoked.capability).toEqual(rotated.publication.capability);
    expect(revoked.gallery.accessExpiresAt).toEqual(original.gallery.accessExpiresAt);
    const getKey = vi.fn(keyring.getKey);
    await expect(store.rotateCapabilityEnvelope({ handle: request.handle, now: NOW, keyring: { ...keyring, getKey } }))
      .rejects.toMatchObject({ reason: "unavailable" });
    expect(getKey).not.toHaveBeenCalled();
  });
  it("discards an in-progress envelope rotation when the actual revoke transaction wins", async () => {
    const { store, original, request } = await setup();
    let winner: ReturnType<typeof store.revokeDeliveryAccess> | undefined;
    let entered = false;
    await expect(store.rotateCapabilityEnvelope({ handle: request.handle, now: NOW,
      keyring: { activeKeyId: "key-2", keyIds: ["key-1", "key-2"], getKey(id) {
        if (!entered) {
          entered = true;
          winner = store.revokeDeliveryAccess({ handle: request.handle, expectedRevision: 3, expectedGeneration: 0, now: NOW });
        }
        return Buffer.alloc(32, id === "key-1" ? 17 : 23);
      } } })).rejects.toMatchObject({ reason: "conflict" });
    const revoked = await winner;
    expect(revoked).toMatchObject({ revision: 4, gallery: { state: "access-suspended", capabilityGeneration: 1 } });
    expect(revoked!.capability).toEqual(original.capability);
    expect(await store.readPublication(request.handle)).toEqual(revoked);
  });
  it("atomically suspends access, retires the generation and stops an unsent notification with a safe DTO", async () => {
    const { store, original, request, deps, publish } = await setup();
    expect(privateGalleryDeliveryNotificationStatus(original, NOW)).toEqual({ state: "pending", dispatchable: true });
    const result = await revokeDeliveryAccessAsAdmin(deps, request);
    expect(result).toEqual({ ok: true, value: { handle: request.handle, revision: 4, capabilityGeneration: 1, state: "access-suspended", accessExpiresAt: original.gallery.accessExpiresAt!.toISOString() } });
    const after = (await store.readPublication(request.handle))!;
    expect(after.gallery).toEqual({ ...original.gallery, state: "access-suspended", capabilityGeneration: 1 });
    expect(after.capability).toEqual(original.capability);
    expect(after.capability.capabilityGeneration).not.toBe(after.gallery.capabilityGeneration);
    expect(after.outbox).toEqual({ ...original.outbox, state: "failed", lastError: "access-revoked" });
    expect(privateGalleryDeliveryNotificationStatus(after, NOW)).toEqual({ state: "stopped", dispatchable: false });
    expect(JSON.stringify(result)).not.toMatch(/recipient|envelope|galleryId|objectKey|client@example|outbox/);
    await expect(store.publishFirstDelivery(publish)).rejects.toMatchObject({ reason: "conflict" });
    expect(await store.readPublication(request.handle)).toEqual(after);
    await expect(store.revokeDeliveryAccess({ handle: request.handle, expectedRevision: 4, expectedGeneration: 1, now: NOW })).rejects.toMatchObject({ reason: "conflict" });
    after.gallery.accessExpiresAt!.setFullYear(1999);
    expect((await store.readPublication(request.handle))!.gallery.accessExpiresAt).toEqual(original.gallery.accessExpiresAt);
  });
  it.each(["missing", "customer-cookie", "expired", "stale-credential", "not-recent", "future-reauth"])("refuses %s before any publication-store call", async (kind) => {
    const { request, deps, admins, admin } = await setup();
    const record = admins.get(admin.session.sessionIdHash)!;
    if (kind === "missing") request.cookieHeader = "";
    if (kind === "customer-cookie") request.cookieHeader = `${PRIVATE_GALLERY_SESSION_COOKIE_NAME}=${admin.cookie.value}`;
    if (kind === "expired") admins.set(record.sessionIdHash, { ...record, expiresAt: NOW });
    if (kind === "stale-credential") admins.set(record.sessionIdHash, { ...record, credentialGeneration: "old-generation" });
    if (kind === "not-recent") admins.set(record.sessionIdHash, { ...record, reauthenticatedAt: new Date(NOW.getTime() - PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS - 1) });
    if (kind === "future-reauth") admins.set(record.sessionIdHash, { ...record, reauthenticatedAt: new Date(NOW.getTime() + 1) });
    const revoke = vi.spyOn(deps.publicationStore, "revokeDeliveryAccess");
    expect(await revokeDeliveryAccessAsAdmin(deps, request)).toEqual({ ok: false, reason: ["not-recent", "future-reauth"].includes(kind) ? "reauthentication-required" : "unauthorized" });
    expect(revoke).not.toHaveBeenCalled();
  });
  it("uses the exact recent-auth boundary and hides malformed anonymous operation fields", async () => {
    const { request, deps, admins, admin } = await setup();
    expect(await revokeDeliveryAccessAsAdmin(deps, { ...request, cookieHeader: "", handle: "invalid", expectedRevision: -1 })).toEqual({ ok: false, reason: "unauthorized" });
    expect(await revokeDeliveryAccessAsAdmin(deps, { ...request, handle: "invalid" })).toEqual({ ok: false, reason: "invalid-input" });
    const record = admins.get(admin.session.sessionIdHash)!;
    admins.set(record.sessionIdHash, { ...record, reauthenticatedAt: new Date(NOW.getTime() - PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS) });
    expect((await revokeDeliveryAccessAsAdmin(deps, request)).ok).toBe(true);
  });
  it("allows only one concurrent CAS and refuses stale revision or generation without a second bump", async () => {
    const { store, request } = await setup();
    await expect(store.revokeDeliveryAccess({ ...request, expectedRevision: 2 } as never)).rejects.toMatchObject({ reason: "invalid-input" });
    const input = { handle: request.handle, expectedRevision: 3, expectedGeneration: 0, now: NOW };
    for (const wrong of [{ expectedRevision: 2 }, { expectedGeneration: 1 }]) await expect(store.revokeDeliveryAccess({ ...input, ...wrong })).rejects.toMatchObject({ reason: "conflict" });
    const results = await Promise.allSettled([store.revokeDeliveryAccess(input), store.revokeDeliveryAccess(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([{ reason: { reason: "conflict" } }]);
    expect((await store.readPublication(request.handle))!.gallery.capabilityGeneration).toBe(1);
  });
  it("proves old capability, live session and queued notification refuse fresh revoked metadata without decryption", async () => {
    const { store, request, original } = await setup();
    const context = { galleryId: original.gallery.galleryId, handle: request.handle, generation: 0 };
    const secret = openCapability(keyring, context, original.capability.envelope);
    const sessions = new Map<string, PrivateGallerySession>();
    const sessionStore: PrivateGallerySessionStore = { async create(value) { sessions.set(value.sessionIdHash, value); },
      async findByHash(hash) { return sessions.get(hash); }, async deleteByHash(hash) { sessions.delete(hash); } };
    const session = await createPrivateGallerySession(sessionStore, { galleryId: context.galleryId, galleryHandle: request.handle, capabilityGeneration: 0,
      routePrefix: "client", accessExpiresAt: original.gallery.accessExpiresAt!, now: NOW });
    const after = await store.revokeDeliveryAccess({ handle: request.handle, expectedRevision: 3, expectedGeneration: 0, now: NOW });
    const getKey = vi.fn(keyring.getKey);
    await expect(resolveVerifiedPrivateGalleryCapability({ keyring: { ...keyring, getKey }, store: { async consumeExchangeAttempt() {
      const fresh = (await store.readPublication(request.handle))!;
      return { outcome: "ok", gallery: fresh.gallery, capability: fresh.capability };
    } } }, { handle: request.handle, submittedSecret: secret, now: NOW })).rejects.toThrow();
    await expect(authorizePrivateGallerySessionRequest(sessionStore, after.gallery, session.cookie.value, NOW)).rejects.toThrow();
    await expect(authorizePrivateGallerySessionRequest(sessionStore, { ...after.gallery, state: "published" }, session.cookie.value, NOW)).rejects.toMatchObject({ reason: "stale-generation" });
    expect(() => buildPrivateGalleryDeliveryNotification({ gallery: after.gallery, capability: after.capability, keyring: { ...keyring, getKey },
      recipient: "client@example.test", canonicalOrigin: "https://photo.example.test", routePrefix: "client", locale: "fi", outboxIdempotencyKey: after.outbox.idempotencyKey, now: NOW })).toThrow();
    expect(getKey).not.toHaveBeenCalled();
  });
  it("preserves child identities and historical sent status, and refuses overflow/expiry/deletion states", async () => {
    const { row, request } = await setup();
    const input = { handle: request.handle, expectedRevision: 3, expectedGeneration: 0, now: NOW };
    const next = buildRevokedDeliveryCandidate(row, input);
    expect(next.readyDelivery).toBe(row.readyDelivery); expect(next.preparation).toBe(row.preparation);
    const sent = buildRevokedDeliveryCandidate({ ...row, publication: { ...row.publication!, outbox: { ...row.publication!.outbox, state: "sent" } } }, input);
    expect(sent.publication!.outbox.state).toBe("sent");
    for (const state of ["expiring", "deleting", "deleted", "deletion-failed"] as const) expect(() => buildRevokedDeliveryCandidate({ ...row, gallery: { ...row.gallery, state } }, input)).toThrow("conflict");
    expect(() => buildRevokedDeliveryCandidate({ ...row, revision: Number.MAX_SAFE_INTEGER }, { ...input, expectedRevision: Number.MAX_SAFE_INTEGER })).toThrow("conflict");
    expect(() => buildRevokedDeliveryCandidate({ ...row, gallery: { ...row.gallery, capabilityGeneration: Number.MAX_SAFE_INTEGER } }, { ...input, expectedGeneration: Number.MAX_SAFE_INTEGER })).toThrow("conflict");
    expect(() => buildRevokedDeliveryCandidate(row, { ...input, now: row.gallery.accessExpiresAt! })).toThrow("unavailable");
  });
  it("snapshots operation fields before an asynchronous auth lookup", async () => {
    const { request, deps } = await setup();
    const find = deps.sessionStore.findByHash;
    deps.sessionStore.findByHash = async (hash) => { request.handle = "invalid"; request.expectedGeneration = 999; request.now.setFullYear(1999); return find(hash); };
    expect((await revokeDeliveryAccessAsAdmin(deps, request)).ok).toBe(true);
  });
  it("keeps a conflict classified across independently loaded server modules", async () => {
    const { request, deps } = await setup();
    vi.resetModules();
    try {
      const other = await import("./private-gallery-delivery-revocation");
      const publicationStore = { revokeDeliveryAccess: vi.fn().mockRejectedValue(new other.PrivateGalleryDeliveryLifecycleError("conflict")) };
      expect(await revokeDeliveryAccessAsAdmin({ ...deps, publicationStore }, request)).toEqual({ ok: false, reason: "conflict" });
    } finally { vi.resetModules(); }
  });
  it("redacts arbitrary adapter exceptions and refuses a provider result that did not suspend access", async () => {
    const { request, deps, original } = await setup();
    const canary = "private recipient/key/provider canary";
    const publicationStore = { revokeDeliveryAccess: vi.fn().mockRejectedValue(new Error(canary)) };
    expect(await revokeDeliveryAccessAsAdmin({ ...deps, publicationStore }, request)).toEqual({ ok: false, reason: "unavailable" });
    publicationStore.revokeDeliveryAccess.mockResolvedValue(original);
    expect(await revokeDeliveryAccessAsAdmin({ ...deps, publicationStore }, request)).toEqual({ ok: false, reason: "unavailable" });
  });
});
