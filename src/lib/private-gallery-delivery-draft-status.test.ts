import { describe, expect, it, vi } from "vitest";
import { createPrivateGalleryDeliveryDraftMemoryStore } from "./private-gallery-delivery-draft-store";
import { projectPrivateGalleryDeliveryDraftStatus } from "./private-gallery-delivery-draft-status";
import { listDeliveryDraftsAsAdmin } from "./private-gallery-delivery-draft-admin";
const NOW = new Date("2026-10-16T12:00:00Z");
async function setup() {
  const store = createPrivateGalleryDeliveryDraftMemoryStore();
  const draft = await store.create({ customerReference: "summary-customer" }, NOW);
  const plan = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, keyPrefix: "private", now: NOW,
    manifest: [{ kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1000, width: 1200, height: 800 },
      { kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1200, width: 800, height: 1200 }, { kind: "zip", nominalBytes: 100000 }] });
  const preparing = (await store.list(100)).items[0];
  const complete = await store.completeFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 1,
    preparationId: plan.preparation.preparationId, now: NOW, receipts: [],
    observations: plan.objects.map((object) => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })) });
  if (!complete.ready) throw new Error("fixture not ready");
  return { store, draft, preparing, ready: complete.setup, plan };
}
describe("closed delivery plan summary", () => {
  it("projects real draft/preparing/ready transitions without claiming uploaded progress", async () => {
    const { draft, preparing, ready, plan } = await setup();
    expect(projectPrivateGalleryDeliveryDraftStatus(draft, NOW)).toEqual({ state: "draft" });
    const upload = { plannedPreviewCount: 2, plannedZipCount: 1, openedAt: NOW.toISOString(), deadline: plan.preparation.deadline.toISOString(), expired: false };
    // No observations or bytes were provided when the preparing snapshot was captured.
    expect(projectPrivateGalleryDeliveryDraftStatus(preparing, NOW)).toEqual({ state: "preparing", upload });
    expect(projectPrivateGalleryDeliveryDraftStatus(ready, NOW)).toEqual({ state: "ready", upload });
    expect(projectPrivateGalleryDeliveryDraftStatus(preparing, new Date(NOW.getTime() - 1))).toEqual({ state: "preparing", upload });
  });
  it("keeps expired plans visible and uses the exact existing deadline boundary", async () => {
    const { preparing, ready, plan } = await setup();
    for (const row of [preparing, ready]) {
      expect(projectPrivateGalleryDeliveryDraftStatus(row, new Date(plan.preparation.deadline.getTime() - 1))).toMatchObject({ upload: { expired: false } });
      expect(projectPrivateGalleryDeliveryDraftStatus(row, plan.preparation.deadline)).toMatchObject({ state: row.gallery.state, upload: { expired: true } });
    }
  });
  it("allowlists the whole administrator DTO and rejects a corrupt row without partial output", async () => {
    const { store, ready, plan } = await setup();
    const deps = { store, authorize: async () => true };
    const response = await listDeliveryDraftsAsAdmin(deps, { cookieHeader: null, now: NOW });
    expect(response).toMatchObject({ ok: true, value: { items: [{ state: "ready", upload: { plannedPreviewCount: 2, plannedZipCount: 1 } }] } });
    if (!response.ok) throw new Error("fixture list failed");
    expect(Object.keys(response.value.items[0]).sort()).toEqual(["createdAt", "customerReference", "handle", "revision", "state", "upload"]);
    const text = JSON.stringify(response);
    for (const value of [ready.gallery.galleryId, plan.preparation.preparationId, ...plan.preparation.objectKeys]) expect(text).not.toContain(value);
    const broken = { ...ready, gallery: { ...ready.gallery, kind: "proof" as const } };
    const list = vi.fn(async () => ({ items: [ready, broken], hasMore: false }));
    const corruptDeps = { ...deps, store: { ...store, list } };
    expect(await listDeliveryDraftsAsAdmin(corruptDeps, { cookieHeader: null, now: NOW })).toEqual({ ok: false, reason: "unavailable" });
    list.mockClear();
    expect(await listDeliveryDraftsAsAdmin({ ...corruptDeps, authorize: async () => false }, { cookieHeader: null, now: NOW }))
      .toEqual({ ok: false, reason: "unauthorized" });
    expect(list).not.toHaveBeenCalled();
  });
  it("refuses holes in committed or frozen identity arrays", async () => {
    const { ready, plan } = await setup();
    const placements = [...ready.readyDelivery!.placements]; delete placements[0];
    const verifiedObjects = [...ready.readyDelivery!.verifiedObjects]; delete verifiedObjects[0];
    const objectKeys = [...plan.preparation.objectKeys]; delete objectKeys[0];
    for (const row of [
      { ...ready, readyDelivery: { ...ready.readyDelivery!, placements } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, verifiedObjects } },
      { ...ready, preparation: { ...plan, preparation: { ...plan.preparation, objectKeys } } },
    ]) expect(() => projectPrivateGalleryDeliveryDraftStatus(row, NOW)).toThrow("invalid-record");
  });
  it("refuses inconsistent dates, classes, keys, cardinality and frozen summary identities", async () => {
    const { preparing, ready, draft, plan } = await setup();
    const invalid = [
      { ...draft, preparation: plan },
      { ...draft, revision: -1 },
      { ...draft, gallery: { ...draft.gallery, galleryHandle: "A".repeat(22) + "\n" } },
      { ...draft, gallery: { ...draft.gallery, galleryHandle: { toString: () => "A".repeat(22), privateCanary: "not-a-string" } } },
      { ...draft, gallery: { ...draft.gallery, createdAt: new Date(NaN) } },
      { ...preparing, gallery: { ...preparing.gallery, state: "published" as const } },
      { ...preparing, preparation: { ...plan, preparation: { ...plan.preparation, galleryId: "other" } } },
      { ...preparing, preparation: { ...plan, preparation: { ...plan.preparation, deadline: NOW } } },
      { ...preparing, preparation: { ...plan, preparation: { ...plan.preparation, deadline: new Date(NOW.getTime() + 31 * 86400000) } } },
      { ...preparing, preparation: { ...plan, objects: [] } },
      { ...preparing, preparation: { ...plan, objects: new Array(1001).fill(plan.objects[0]) } },
      { ...preparing, preparation: { ...plan, objects: [plan.objects[0], plan.objects[0], plan.objects[2]] } },
      { ...preparing, preparation: { ...plan, objects: [plan.objects[0], plan.objects[1], { ...plan.objects[2], objectKind: "proof" as const }] } },
      { ...preparing, preparation: { ...plan, objects: [plan.objects[0], plan.objects[1]] } },
      { ...preparing, preparation: { ...plan, preparation: { ...plan.preparation, objectKeys: ["unrelated", ...plan.preparation.objectKeys.slice(1)] } } },
      { ...preparing, readyDelivery: ready.readyDelivery },
      { ...ready, readyDelivery: undefined },
      { ...ready, gallery: { ...ready.gallery, activeZipObjectKey: plan.objects[0].objectKey } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, placements: [] } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, verifiedObjects: [] } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, verifiedObjects: plan.objects.map((_, i) => ({ objectKey: "unknown-" + i })) } },
      { ...ready, readyDelivery: { ...ready.readyDelivery!, placements: ready.readyDelivery!.placements.map((item) => ({ ...item, galleryId: "other" })) } },
    ];
    for (const row of invalid) expect(() => projectPrivateGalleryDeliveryDraftStatus(row as never, NOW)).toThrow("[private-gallery-delivery-draft-status] invalid-record");
    expect(() => projectPrivateGalleryDeliveryDraftStatus(ready, new Date(NaN))).toThrow("invalid-record");
  });
});
