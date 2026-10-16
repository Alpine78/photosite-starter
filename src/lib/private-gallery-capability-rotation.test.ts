import { describe, expect, it, vi } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore, type PrivateGalleryDeliveryDraft } from "./private-gallery-delivery-draft-store";
import { buildRotatedCapabilityCandidate } from "./private-gallery-capability-rotation";
import { openCapability } from "./private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "./private-gallery-config";
const NOW = new Date("2026-10-16T12:00:00Z");
function ring(activeKeyId: string): PrivateGalleryCapabilityKeyring {
  return { activeKeyId, keyIds: ["legacy-rotation-key", "active-rotation-key", "next-rotation-key"], getKey(id) {
    const value = { "legacy-rotation-key": 1, "active-rotation-key": 2, "next-rotation-key": 3 }[id];
    return value === undefined ? undefined : Buffer.alloc(32, value);
  } };
}
async function setup() {
  const store = createPrivateGalleryDeliveryDraftMemoryStore();
  const draft = await store.create({ customerReference: "customer-ref", jobReference: "job-ref" }, NOW);
  const handle = draft.gallery.galleryHandle;
  const plan = await store.openFirstPreparation({ handle, expectedRevision: 0, keyPrefix: "private", now: NOW,
    manifest: [{ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1000, width: 1200, height: 800 }, { kind: "zip", nominalBytes: 100000 }] });
  const completion = await store.completeFirstPreparation({ handle, expectedRevision: 1, preparationId: plan.preparation.preparationId,
    now: NOW, receipts: [], observations: plan.objects.map((item) => ({ objectKey: item.objectKey, sizeBytes: item.nominalBytes })) });
  if (!completion.ready) throw new Error("fixture not ready");
  const original = await store.publishFirstDelivery({ handle, expectedRevision: 2, recipient: "client@example.test", locale: "en-GB",
    canonicalOrigin: "https://photo.example.test", routePrefix: "client", now: NOW, keyring: ring("legacy-rotation-key") });
  const row: PrivateGalleryDeliveryDraft = { ...completion.setup, gallery: original.gallery, revision: original.revision,
    publication: { sourceRevision: original.sourceRevision, capability: original.capability, outbox: original.outbox, notification: original.notification } };
  const input = { handle, now: new Date(NOW), keyring: ring("active-rotation-key") };
  return { store, input, original, row };
}
describe("conditional capability envelope rotation", () => {
  it("persists the same bearer under the active key and preserves every other field", async () => {
    const { store, input, original, row } = await setup();
    const result = await store.rotateCapabilityEnvelope(input);
    expect(result.rotated).toBe(true);
    expect(result.publication.revision).toBe(original.revision + 1);
    const current = result.publication;
    expect({ ...current, revision: original.revision, capability: original.capability }).toEqual(original);
    expect(current.capability).toMatchObject({ keyId: "active-rotation-key", createdAt: original.capability.createdAt,
      galleryId: original.gallery.galleryId, capabilityGeneration: original.gallery.capabilityGeneration });
    const context = { galleryId: original.gallery.galleryId, handle: input.handle, generation: original.gallery.capabilityGeneration };
    const secret = openCapability(ring("legacy-rotation-key"), context, original.capability.envelope);
    const onlyNew = { activeKeyId: "active-rotation-key", keyIds: ["active-rotation-key"], getKey: (id: string) => id === "active-rotation-key" ? Buffer.alloc(32, 2) : undefined };
    expect(openCapability(onlyNew, context, current.capability.envelope)).toBe(secret);
    expect(JSON.stringify(current)).not.toContain(secret);
    const candidate = buildRotatedCapabilityCandidate(row, input);
    expect(candidate.readyDelivery).toBe(row.readyDelivery); expect(candidate.preparation).toBe(row.preparation);
    expect(candidate.publication?.outbox).toBe(row.publication?.outbox);
    expect(JSON.stringify(candidate)).not.toContain("legacy-rotation-key");
    current.capability.createdAt.setFullYear(1999); current.gallery.accessExpiresAt!.setFullYear(1999);
    expect((await store.readPublication(input.handle))?.capability.createdAt).toEqual(original.capability.createdAt);
    expect((await store.readPublication(input.handle))?.gallery).toEqual(original.gallery);
  });
  it("authenticates an already-active envelope as a no-op with no new revision or outbox attempt", async () => {
    const { store, input } = await setup();
    const results = await Promise.all([store.rotateCapabilityEnvelope(input), store.rotateCapabilityEnvelope(input)]);
    expect(results.map((result) => result.rotated)).toEqual([true, false]);
    expect(results[1].publication).toEqual(results[0].publication);
    const failedKeyring = { ...input.keyring, getKey: () => { throw new Error("private key bytes canary"); } };
    await expect(store.rotateCapabilityEnvelope({ ...input, keyring: failedKeyring })).rejects.toThrow("[private-gallery-capability-rotation] capability-unavailable");
    expect(await store.readPublication(input.handle)).toEqual(results[0].publication);
  });
  it.each([false, true])("discards a candidate when a reentrant rotation wins (outer no-op=%s)", async (noOp) => {
    const { store, input } = await setup();
    if (noOp) await store.rotateCapabilityEnvelope(input);
    let winner: ReturnType<typeof store.rotateCapabilityEnvelope> | undefined;
    let entered = false;
    const target = noOp ? "next-rotation-key" : "active-rotation-key";
    const normal = ring("active-rotation-key");
    const reentrant = { ...normal, getKey(id: string) {
      if (!entered) { entered = true; winner = store.rotateCapabilityEnvelope({ ...input, keyring: ring(target) }); }
      return normal.getKey(id);
    } };
    await expect(store.rotateCapabilityEnvelope({ ...input, keyring: reentrant })).rejects.toMatchObject({ reason: "conflict" });
    expect(await store.readPublication(input.handle)).toEqual((await winner)!.publication);
  });
  it("refuses expired/current-generation/corrupt-envelope data before a commit and redacts crypto errors", async () => {
    const { store, input, original, row } = await setup();
    const before = JSON.stringify(row);
    const getKey = vi.fn(input.keyring.getKey);
    for (const changed of [
      { ...row, gallery: { ...row.gallery, state: "access-suspended" as const } },
      { ...row, gallery: { ...row.gallery, capabilityGeneration: row.gallery.capabilityGeneration + 1 } },
      { ...row, gallery: { ...row.gallery, accessExpiresAt: NOW } },
      { ...row, publication: { ...row.publication!, capability: { ...row.publication!.capability, keyId: "wrong" } } },
    ]) expect(() => buildRotatedCapabilityCandidate(changed, { ...input, keyring: { ...input.keyring, getKey } })).toThrow();
    expect(getKey).not.toHaveBeenCalled();
    const corrupt = JSON.parse(row.publication!.capability.envelope);
    const tag = Buffer.from(corrupt.tag, "base64url"); tag[0] ^= 1; corrupt.tag = tag.toString("base64url");
    expect(() => buildRotatedCapabilityCandidate({ ...row, publication: { ...row.publication!, capability: { ...row.publication!.capability, envelope: JSON.stringify(corrupt) } } }, input)).toThrow("capability-unavailable");
    await expect(store.rotateCapabilityEnvelope({ ...input, keyring: { ...input.keyring, getKey: () => undefined } })).rejects.toThrow("[private-gallery-capability-rotation] capability-unavailable");
    await expect(store.rotateCapabilityEnvelope({ ...input, now: original.gallery.accessExpiresAt! })).rejects.toMatchObject({ reason: "unavailable" });
    expect(await store.readPublication(input.handle)).toEqual(original); expect(JSON.stringify(row)).toBe(before);
  });
  it("maps missing old/active keys and arbitrary keyring exceptions to redacted errors", async () => {
    const { store, input, original } = await setup();
    const canary = "private-keyring-material-canary";
    const getKeys = [
      (id: string) => id === "active-rotation-key" ? Buffer.alloc(32, 2) : undefined,
      (id: string) => id === "legacy-rotation-key" ? Buffer.alloc(32, 1) : undefined,
      () => { throw new Error(canary); },
    ];
    for (const getKey of getKeys) {
      let error: unknown;
      try { await store.rotateCapabilityEnvelope({ ...input, keyring: { ...input.keyring, getKey } }); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ reason: "capability-unavailable" });
      expect((error as Error).cause).toBeUndefined();
      expect(String(error) + JSON.stringify(error)).not.toContain(canary);
      expect(await store.readPublication(input.handle)).toEqual(original);
    }
  });
  it("rejects caller accessors and proxies before invoking them", async () => {
    const { store, input } = await setup();
    const getter = vi.fn(() => input.handle);
    const value = { ...input }; Object.defineProperty(value, "handle", { enumerable: true, get: getter });
    await expect(store.rotateCapabilityEnvelope(value)).rejects.toMatchObject({ reason: "invalid-input" });
    const trap = vi.fn(() => { throw new Error("private proxy canary"); });
    await expect(store.rotateCapabilityEnvelope(new Proxy(input, { ownKeys: trap }))).rejects.toMatchObject({ reason: "invalid-input" });
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it.each([null, {}, { extra: true }, { handle: "invalid" }, { now: new Date(NaN) }, { keyring: null }, { keyring: undefined }])("refuses invalid input %j", async (invalid) => {
    const { store, input, original } = await setup();
    const value = invalid === null || Object.keys(invalid).length === 0 ? invalid : { ...input, ...invalid };
    await expect(store.rotateCapabilityEnvelope(value as never)).rejects.toMatchObject({ reason: "invalid-input" });
    expect(await store.readPublication(input.handle)).toEqual(original);
  });
});
