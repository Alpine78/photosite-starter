import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore } from "./private-gallery-delivery-draft-store";
import { dispatchPrivateGalleryDeliveryNotification, runPrivateGalleryDeliveryOutboxBatch, DELIVERY_OUTBOX_SEND_TIMEOUT_MS } from "./private-gallery-delivery-outbox";
import { DELIVERY_OUTBOX_LEASE_MS, DELIVERY_OUTBOX_RETRY_MS, DELIVERY_OUTBOX_RETRY_AGE_MS } from "./private-gallery-delivery-outbox-state";
import { privateGalleryDeliveryNotificationStatus } from "./private-gallery-delivery-notification-status";
import { openCapability } from "./private-gallery-capability";
import type { GalleryNotificationTransport } from "./gallery-notification";
const NOW = new Date("2026-10-16T12:00:00Z");
const keyring = { activeKeyId: "key-1", keyIds: ["key-1"], getKey: () => Buffer.alloc(32, 17) };
const clock = () => new Date(NOW);
async function setup(count = 1) {
  const store = createPrivateGalleryDeliveryDraftMemoryStore();
  const published = [];
  for (let i = 0; i < count; i++) {
    const draft = await store.create({}, NOW), handle = draft.gallery.galleryHandle;
    const plan = await store.openFirstPreparation({ handle, expectedRevision: 0, keyPrefix: "private", now: NOW,
      manifest: [{ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1000, width: 1200, height: 800 }, { kind: "zip", nominalBytes: 100000 }] });
    await store.completeFirstPreparation({ handle, expectedRevision: 1, preparationId: plan.preparation.preparationId, now: NOW,
      receipts: [], observations: plan.objects.map((item) => ({ objectKey: item.objectKey, sizeBytes: item.nominalBytes })) });
    published.push(await store.publishFirstDelivery({ handle, expectedRevision: 2, recipient: "client@example.test", locale: "en-GB",
      canonicalOrigin: "https://photo.example.test", routePrefix: "client", now: NOW, keyring }));
  }
  const identities = published.map((value) => ({ handle: value.gallery.galleryHandle, outboxId: value.outbox.outboxId }));
  const deliver = vi.fn<GalleryNotificationTransport["deliver"]>(async () => ({ status: "delivered" }));
  const transport: GalleryNotificationTransport = { name: "synthetic", deliver };
  return { store, identities, published, deliver, transport };
}
afterEach(() => { vi.useRealTimers(); });
describe("delivery notification claims and fresh dispatch", () => {
  it("preserves a capability rotation made during delivery when acknowledging the same claim", async () => {
    const { store, identities, published, transport, deliver } = await setup();
    const original = published[0];
    const rotatedKeys = { activeKeyId: "key-2", keyIds: ["key-1", "key-2"], getKey: (id: string) => Buffer.alloc(32, id === "key-1" ? 17 : 23) };
    deliver.mockImplementation(async () => {
      expect((await store.rotateCapabilityEnvelope({ handle: identities[0].handle, now: NOW, keyring: rotatedKeys })).rotated).toBe(true);
      return { status: "delivered" };
    });
    expect(await dispatchPrivateGalleryDeliveryNotification({ store, identity: identities[0], transport, keyring, clock }))
      .toEqual({ kind: "completed", state: "sent", timedOut: false });
    const saved = (await store.readPublication(identities[0].handle))!;
    expect(saved).toMatchObject({ revision: 6, capability: { keyId: "key-2" }, outbox: { state: "sent", attempts: 1, generation: 0 } });
    expect(saved.dispatch?.claim).toBeUndefined();
    const context = { galleryId: original.gallery.galleryId, handle: identities[0].handle, generation: 0 };
    const originalSecret = openCapability(keyring, context, original.capability.envelope);
    expect(openCapability(rotatedKeys, context, saved.capability.envelope)).toBe(originalSecret);
    expect(deliver.mock.calls[0][0].text).toContain(`#${originalSecret}`);
  });
  it("renders only transient instructions and commits a sent result with the original attempt identity", async () => {
    const { store, identities, published, transport, deliver } = await setup();
    const original = published[0];
    expect(await dispatchPrivateGalleryDeliveryNotification({ store, identity: identities[0], transport, keyring, clock }))
      .toEqual({ kind: "completed", state: "sent", timedOut: false });
    const request = deliver.mock.calls[0][0];
    expect(request.idempotencyKey).toBe(original.outbox.idempotencyKey);
    const secret = openCapability(keyring, { galleryId: original.gallery.galleryId, handle: original.gallery.galleryHandle, generation: 0 }, original.capability.envelope);
    expect(request.text).toContain(`#${secret}`);
    const saved = (await store.readPublication(identities[0].handle))!;
    expect(saved.outbox).toMatchObject({ state: "sent", attempts: 1, generation: 0, outboxId: original.outbox.outboxId });
    expect(saved.dispatch).toMatchObject({ firstClaimAt: NOW, sentAt: NOW });
    expect(saved.dispatch?.claim).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain(secret); expect(JSON.stringify(saved)).not.toContain(request.text);
    expect(JSON.parse(JSON.stringify(saved)).dispatch.firstClaimAt).toBe(NOW.toISOString());
    expect(await store.listDueDeliveryNotifications({ now: NOW, limit: 100 })).toEqual([]);
  });
  it("allows one claimant, reclaims an expired lease and discards the old or expired acknowledgment", async () => {
    const { store, identities } = await setup();
    const input = { ...identities[0], now: NOW };
    const results = await Promise.all([store.claimDeliveryNotification(input), store.claimDeliveryNotification(input)]);
    const first = results.find((value) => value !== undefined)!;
    expect(results.filter(Boolean)).toHaveLength(1);
    const serialized = JSON.parse(JSON.stringify(first));
    expect(serialized.publication.dispatch.claim.expiresAt).toBe(new Date(NOW.getTime() + DELIVERY_OUTBOX_LEASE_MS).toISOString());
    first.publication.capability.createdAt.setFullYear(1999);
    const later = new Date(NOW.getTime() + DELIVERY_OUTBOX_LEASE_MS);
    expect(await store.completeDeliveryNotification({ ...first.token, now: later, outcome: { status: "delivered" } })).toBeUndefined();
    const second = (await store.claimDeliveryNotification({ ...input, now: later }))!;
    expect(second.token.claimId).not.toBe(first.token.claimId);
    expect(await store.completeDeliveryNotification({ ...first.token, now: later, outcome: { status: "delivered" } })).toBeUndefined();
    expect(await store.completeDeliveryNotification({ ...second.token, now: later, outcome: { status: "delivered" } })).toBe("sent");
    expect((await store.readPublication(input.handle))!.outbox.attempts).toBe(2);
  });
  it("terminalizes three abandoned claims discovered after lease expiry", async () => {
    const { store, identities } = await setup();
    let now = NOW;
    for (let i = 0; i < 3; i++) {
      expect(await store.claimDeliveryNotification({ ...identities[0], now })).toBeDefined();
      now = new Date(now.getTime() + DELIVERY_OUTBOX_LEASE_MS);
    }
    expect(await store.listDueDeliveryNotifications({ now, limit: 1 })).toEqual(identities);
    expect(await store.claimDeliveryNotification({ ...identities[0], now })).toBeUndefined();
    const saved = (await store.readPublication(identities[0].handle))!;
    expect(saved.outbox).toMatchObject({ state: "failed", attempts: 3, lastError: "worker-interrupted" });
    expect(saved.dispatch?.retryable).toBe(false);
    expect(await store.listDueDeliveryNotifications({ now, limit: 1 })).toEqual([]);
  });
  it.each(["configuration", "provider-rejected", "provider-quota-exceeded", "provider-unavailable", "timeout"] as const)("applies the explicit retry matrix for %s", async (errorClass) => {
    const { store, identities, transport } = await setup();
    transport.deliver = async () => ({ status: "failed", errorClass, retryable: true });
    await dispatchPrivateGalleryDeliveryNotification({ store, identity: identities[0], transport, keyring, clock });
    const saved = (await store.readPublication(identities[0].handle))!;
    expect(saved.outbox.lastError).toBe(errorClass);
    expect(saved.dispatch?.retryable).toBe(["provider-unavailable", "timeout"].includes(errorClass));
    expect(await store.listDueDeliveryNotifications({ now: NOW, limit: 1 })).toEqual([]);
  });
  it("keeps the attempt stable across retries, caps its age and never silently starts a new notification", async () => {
    const { store, identities, published } = await setup();
    const first = (await store.claimDeliveryNotification({ ...identities[0], now: NOW }))!;
    await store.completeDeliveryNotification({ ...first.token, now: NOW, outcome: { status: "failed", errorClass: "provider-unavailable", retryable: true } });
    expect(await store.listDueDeliveryNotifications({ now: new Date(NOW.getTime() + DELIVERY_OUTBOX_RETRY_MS - 1), limit: 1 })).toEqual([]);
    const retry = (await store.claimDeliveryNotification({ ...identities[0], now: new Date(NOW.getTime() + DELIVERY_OUTBOX_RETRY_MS) }))!;
    expect(retry.publication.outbox.idempotencyKey).toBe(published[0].outbox.idempotencyKey);
    const late = new Date(NOW.getTime() + DELIVERY_OUTBOX_RETRY_AGE_MS);
    expect(await store.listDueDeliveryNotifications({ now: late, limit: 1 })).toEqual(identities);
    expect(await store.claimDeliveryNotification({ ...identities[0], now: late })).toBeUndefined();
    expect((await store.readPublication(identities[0].handle))!.outbox).toMatchObject({ state: "failed", attempts: 2, lastError: "retry-window-expired" });
  });
  it("makes the third retryable failure terminal and respects an explicit nonretryable provider result", async () => {
    for (const retryable of [true, false]) {
      const { store, identities, transport, deliver } = await setup();
      deliver.mockImplementation(async () => ({ status: "failed", errorClass: "provider-unavailable", retryable }));
      let now = NOW;
      for (let i = 0; i < (retryable ? 3 : 1); i++) {
        await dispatchPrivateGalleryDeliveryNotification({ store, identity: identities[0], transport, keyring, clock: () => new Date(now) });
        now = new Date(now.getTime() + DELIVERY_OUTBOX_RETRY_MS);
      }
      const saved = (await store.readPublication(identities[0].handle))!;
      expect(saved.dispatch?.retryable).toBe(false); expect(saved.dispatch?.nextAttemptAt).toBeUndefined();
      expect(await store.listDueDeliveryNotifications({ now, limit: 1 })).toEqual([]);
    }
  });
  it.each(["discovery", "claim", "crypto"])("refuses send when real revocation lands after %s", async (stage) => {
    const { store, identities, transport, deliver } = await setup();
    let revoked: Promise<unknown> | undefined;
    const revoke = (revision: number) => store.revokeDeliveryAccess({ handle: identities[0].handle, expectedRevision: revision, expectedGeneration: 0, now: NOW });
    const wrapped = { ...store };
    if (stage === "discovery") wrapped.listDueDeliveryNotifications = async (input) => { const due = await store.listDueDeliveryNotifications(input); await revoke(3); return due; };
    if (stage === "claim") wrapped.claimDeliveryNotification = async (input) => { const claim = await store.claimDeliveryNotification(input); await revoke(4); return claim; };
    const keys = stage === "crypto" ? { ...keyring, getKey: () => { revoked ??= revoke(4); return Buffer.alloc(32, 17); } } : keyring;
    expect(await runPrivateGalleryDeliveryOutboxBatch({ store: wrapped, transport, keyring: keys, clock, limit: 1 }))
      .toMatchObject({ completed: 0, notClaimable: 1, sent: 0 });
    await revoked;
    expect(deliver).not.toHaveBeenCalled();
    const saved = (await store.readPublication(identities[0].handle))!;
    expect(privateGalleryDeliveryNotificationStatus(saved, NOW)).toEqual({ state: "stopped", dispatchable: false });
    expect(saved.dispatch?.claim).toBeUndefined();
  });
  it("cannot overwrite stopped access with a delivered response from an already-started provider call", async () => {
    const { store, identities, transport } = await setup();
    transport.deliver = async () => { const fresh = (await store.readPublication(identities[0].handle))!;
      await store.revokeDeliveryAccess({ handle: identities[0].handle, expectedRevision: fresh.revision, expectedGeneration: 0, now: NOW }); return { status: "delivered" }; };
    expect(await runPrivateGalleryDeliveryOutboxBatch({ store, transport, keyring, clock, limit: 1 }))
      .toEqual({ listed: 1, completed: 0, sent: 0, failed: 0, notClaimable: 1, timedOut: 0 });
    expect((await store.readPublication(identities[0].handle))!.outbox).toMatchObject({ state: "failed", lastError: "access-revoked" });
  });
  it("completes crypto failure as configuration and a metadata-read failure as retryable worker-unavailable", async () => {
    for (const crypto of [true, false]) {
      const { store, identities, transport, deliver } = await setup();
      const canary = "private crypto/provider payload canary";
      const wrapped = { ...store, ...(crypto ? {} : { readClaimedDeliveryNotification: async () => { throw new Error(canary); } }) };
      const keys = crypto ? { ...keyring, getKey: () => { throw new Error(canary); } } : keyring;
      expect(await dispatchPrivateGalleryDeliveryNotification({ store: wrapped, transport, keyring: keys, identity: identities[0], clock })).toMatchObject({ kind: "completed", state: "failed" });
      const saved = (await store.readPublication(identities[0].handle))!;
      expect(saved.outbox.lastError).toBe(crypto ? "configuration" : "worker-unavailable");
      expect(saved.dispatch?.retryable).toBe(!crypto); expect(saved.dispatch?.claim).toBeUndefined();
      expect(JSON.stringify(saved)).not.toContain(canary); expect(deliver).not.toHaveBeenCalled();
    }
  });
  it("fails closed on a malformed fresh response even when its old generation still matches", async () => {
    const { store, identities, transport, deliver } = await setup();
    const wrapped = { ...store, readClaimedDeliveryNotification: async (input: Parameters<typeof store.readClaimedDeliveryNotification>[0]) => {
      const fresh = (await store.readClaimedDeliveryNotification(input))!;
      return { ...fresh, gallery: { ...fresh.gallery, state: "deleting" as const } };
    } };
    await dispatchPrivateGalleryDeliveryNotification({ store: wrapped, transport, keyring, identity: identities[0], clock });
    expect(deliver).not.toHaveBeenCalled();
  });
  it("times out an uncooperative transport, consumes its late rejection and stops further batch admission", async () => {
    const { store, transport, deliver } = await setup(2);
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    let reject!: (reason: unknown) => void;
    deliver.mockImplementation(() => new Promise((_resolve, refusal) => { reject = refusal; }));
    const pending = runPrivateGalleryDeliveryOutboxBatch({ store, transport, keyring, clock: () => new Date(), limit: 2 });
    await vi.advanceTimersByTimeAsync(DELIVERY_OUTBOX_SEND_TIMEOUT_MS);
    expect(await pending).toEqual({ listed: 2, completed: 1, sent: 0, failed: 1, notClaimable: 0, timedOut: 1 });
    expect(deliver).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    reject(new Error("late private response canary")); await Promise.resolve(); await Promise.resolve();
  });
  it("samples the clock again for each item and refuses later expired galleries", async () => {
    const { store, published, transport, deliver } = await setup(2);
    let now = NOW;
    const wrapped = { ...store, completeDeliveryNotification: async (input: Parameters<typeof store.completeDeliveryNotification>[0]) => {
      const result = await store.completeDeliveryNotification(input); now = published[0].gallery.accessExpiresAt!; return result;
    } };
    expect(await runPrivateGalleryDeliveryOutboxBatch({ store: wrapped, transport, keyring, clock: () => new Date(now), limit: 2 }))
      .toEqual({ listed: 2, completed: 1, sent: 1, failed: 0, notClaimable: 1, timedOut: 0 });
    expect(deliver).toHaveBeenCalledOnce();
  });
  it("rejects duplicate/unbounded discovery and redacts adapter failures with numeric partial progress", async () => {
    const { store, identities, transport, deliver } = await setup();
    const duplicate = { ...store, listDueDeliveryNotifications: async () => [identities[0], identities[0]] };
    await expect(runPrivateGalleryDeliveryOutboxBatch({ store: duplicate, transport, keyring, clock, limit: 2 })).rejects.toMatchObject({ reason: "store-failed", progress: { listed: 0 } });
    await expect(runPrivateGalleryDeliveryOutboxBatch({ store, transport, keyring, clock, limit: 101 })).rejects.toMatchObject({ reason: "invalid-input" });
    expect(deliver).not.toHaveBeenCalled();
    const failed = { ...store, completeDeliveryNotification: async () => { throw new Error("private acknowledgment canary"); } };
    await expect(dispatchPrivateGalleryDeliveryNotification({ store: failed, transport, keyring, clock, identity: identities[0] })).rejects.toThrow("[private-gallery-delivery-worker] store-failed");
  });
  it("never evaluates provider-result getters or persists arbitrary provider fields", async () => {
    const { store, identities, transport } = await setup();
    const getter = vi.fn(() => "delivered");
    const bad = { private: "private provider response canary" }; Object.defineProperty(bad, "status", { get: getter, enumerable: true });
    transport.deliver = async () => bad as never;
    await dispatchPrivateGalleryDeliveryNotification({ store, identity: identities[0], transport, keyring, clock });
    const saved = (await store.readPublication(identities[0].handle))!;
    expect(saved.outbox.lastError).toBe("provider-unavailable"); expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(saved)).not.toContain("private provider response canary");
  });
  it("preserves numeric progress when a later acknowledgment fails without exposing its exception", async () => {
    const { store, transport } = await setup(2);
    let count = 0;
    const wrapped = { ...store, completeDeliveryNotification: async (input: Parameters<typeof store.completeDeliveryNotification>[0]) => {
      if (++count === 2) throw new Error("private acknowledgment canary");
      return store.completeDeliveryNotification(input);
    } };
    let error: unknown;
    try { await runPrivateGalleryDeliveryOutboxBatch({ store: wrapped, transport, keyring, clock, limit: 2 }); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ progress: { listed: 2, completed: 1, sent: 1, failed: 0, notClaimable: 0, timedOut: 0 } });
    expect(String(error) + JSON.stringify(error)).not.toContain("private acknowledgment canary");
    expect((error as Error).cause).toBeUndefined();
  });
  it("fails closed when the clock regresses after claiming instead of acknowledging with stale time", async () => {
    const { store, transport, identities, deliver } = await setup();
    let now = NOW;
    const wrapped = { ...store, claimDeliveryNotification: async (input: Parameters<typeof store.claimDeliveryNotification>[0]) => {
      const claim = await store.claimDeliveryNotification(input); now = new Date(NOW.getTime() - 1); return claim;
    } };
    await expect(dispatchPrivateGalleryDeliveryNotification({ store: wrapped, transport, identity: identities[0], keyring, clock: () => new Date(now) })).rejects.toThrow("[private-gallery-delivery-worker]");
    expect(deliver).not.toHaveBeenCalled();
    expect((await store.readPublication(identities[0].handle))!.outbox.attempts).toBe(1);
  });
});
