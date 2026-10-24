import { describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { lake } from "./test-support/proof-lake";
import { cleanupControlId, cleanupControlMutation, parseCleanupControl, type CleanupControl } from "../src/lib/client-gallery-cleanup-contract";
import { reviewDeliveryPublication, publishDelivery, reconcileDeliveryPublication, deliveryCleanupDefault, DELIVERY_LINKS_QUERY, type DeliveryPublishReader, type DeliveryPublishPlan } from "./client-gallery-publish";
import { allowAction, allowTemplate } from "./editorial-policy";
import { loadStudioSettings } from "./settings";

const NOW = "2026-10-24T12:00:00.000Z", DEADLINE = "2027-04-24T12:00:00.000Z";
const ASSET = `image-${"a".repeat(40)}-1600x1000-webp`;
const source = { _id: "drafts.delivery", _type: "clientDeliveryGallery", handle: "1".repeat(32), available: true,
  availabilityMode: "until", expiryInstant: DEADLINE, items: [{ _key: "one", _type: "clientDeliveryItem", mediaType: "image",
    image: { _type: "image", asset: { _type: "reference", _ref: ASSET } }, alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Coast" }] }] };
function setup(extra: Record<string, unknown>[] = []) {
  const store = lake([source, { _id: ASSET, _type: "sanity.imageAsset", sha1hash: "a".repeat(40), extension: "webp", mimeType: "image/webp", metadata: { dimensions: { width: 1600, height: 1000 } } }, ...extra]);
  const fetchQuery = async <T,>(query: string, params?: Readonly<Record<string, unknown>>): Promise<T> => (await evaluate(parse(query), { dataset: [...store.docs.values()], params })).get();
  const validator = { fetch: fetchQuery, withConfig: () => validator };
  const reader: DeliveryPublishReader = { ...store.reader, time: async () => NOW, links: (id) => fetchQuery(DELIVERY_LINKS_QUERY, { id }), validation: { getClient: () => validator } };
  async function review(enroll = true, publicationId = "publish-1", cleanup = true) {
    const control = store.docs.get(await cleanupControlId("delivery"));
    return reviewDeliveryPublication({ id: "delivery", expectedRevision: (store.docs.get("drafts.delivery") ?? store.docs.get("delivery"))!._rev, proofsEnabled: false,
      ...(cleanup ? { cleanup: { enroll, publicationId, expectedPublished: store.docs.has("delivery"), expectedControlRevision: control?._rev } } : {}) }, reader);
  }
  async function ready(enroll = true, publicationId = "publish-1", cleanup = true) {
    const result = await review(enroll, publicationId, cleanup);
    if (!("ready" in result)) throw new Error(result.reason);
    return result.ready;
  }
  const run = (plan: DeliveryPublishPlan) => publishDelivery(plan, reader, async (mutations) => store.commit(mutations));
  return { ...store, reader, review, ready, run };
}
async function stored(store: ReturnType<typeof setup>) {
  const id = await cleanupControlId("delivery");
  return parseCleanupControl(store.docs.get(id), id, "delivery");
}
function pending(control: CleanupControl): CleanupControl { return { ...control, state: "pending", attempt: { operationId: "worker-1", at: NOW } }; }
function complete(control: CleanupControl): CleanupControl {
  return { ...control, state: "complete", attempt: undefined, receipt: { operationId: "worker-1", at: NOW,
    deletedAssets: [{ id: ASSET, revision: "asset-r1", type: "sanity.imageAsset" }], sharedAssets: [], deletedCount: 1, sharedCount: 0 } };
}
describe("publication-bound cleanup enrollment", () => {
  it("requires explicit consent for all unenrolled records, including new and previously unpublished galleries", async () => {
    const store = setup();
    expect(deliveryCleanupDefault(source)).toBe(false);
    // Native unpublish of an old unenrolled delivery leaves the same finite draft shape.
    store.put({ ...source, _id: "delivery" }); store.docs.delete("delivery");
    expect(deliveryCleanupDefault(store.docs.get("drafts.delivery")!)).toBe(false);
    await store.run(await store.ready()); const current = await stored(store);
    expect(deliveryCleanupDefault(source, current)).toBe(true);
    expect(deliveryCleanupDefault(source, pending(current))).toBe(true);
    expect(deliveryCleanupDefault(source, complete(current))).toBe(false);
    expect(deliveryCleanupDefault(source, { ...current, state: "disabled" })).toBe(false);
    expect(deliveryCleanupDefault({ ...source, availabilityMode: "indefinite" })).toBe(false);
  });
  it("atomically publishes the exact reviewed consent, private source identity and unchanged creation deadline", async () => {
    const store = setup(), plan = await store.ready();
    expect(plan.cleanup?.next).toMatchObject({ sourceDocumentId: "drafts.delivery", sourceRevision: store.docs.get("drafts.delivery")!._rev, publicationId: "publish-1", policy: { expiryInstant: DEADLINE } });
    expect(await store.run(plan)).toBe("published");
    const control = await stored(store);
    expect(control.state).toBe("enrolled");
    expect(control.sourceRevision).not.toBe(store.docs.get("delivery")!._rev);
    expect(store.docs.get("delivery")?.expiryInstant).toBe(DEADLINE);
    expect(store.docs.get("delivery")).not.toHaveProperty("cleanup");
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("published");
    expect(await store.run(plan)).toBe("conflict");
  });
  it("combines cleanup approval with the selected proof's complete deletion in one publication transaction", async () => {
    const store = setup([
      { _id: "proof", _type: "clientProofGallery", handle: "2".repeat(32), items: [{ image: { asset: { _ref: ASSET } } }] },
      { _id: "proofTerms.proof", _type: "clientProofTerms", galleryId: "proof", firstPublishedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    const review = await reviewDeliveryPublication({ id: "delivery", expectedRevision: store.docs.get("drafts.delivery")!._rev,
      proofId: "proof", proofsEnabled: true, cleanup: { enroll: true, publicationId: "replace-and-enroll", expectedPublished: false } }, store.reader);
    if (!("ready" in review)) throw new Error(review.reason);
    expect(review.ready.proof).toBeDefined(); expect(review.ready.cleanup?.next?.state).toBe("enrolled");
    expect(await store.run(review.ready)).toBe("published");
    expect(store.docs.has("proof")).toBe(false); expect(store.docs.has("proofTerms.proof")).toBe(false);
    expect(store.docs.has(ASSET)).toBe(true); expect((await stored(store)).publicationId).toBe("replace-and-enroll");
  });
  it.each(["control created", "draft changed", "publication created"])("a concurrent %s rolls back consent and publication together", async (race) => {
    const store = setup(), plan = await store.ready();
    if (race === "control created") store.put(plan.cleanup!.next!);
    else store.put({ ...source, _id: race === "draft changed" ? "drafts.delivery" : "delivery" });
    const before = structuredClone([...store.docs]);
    expect(await store.run(plan)).toBe("conflict"); expect([...store.docs]).toEqual(before);
  });
  it("refuses stale default-choice context instead of enrolling a concurrently published or withdrawn gallery", async () => {
    const store = setup(), revision = store.docs.get("drafts.delivery")!._rev;
    store.put({ ...source, _id: "delivery" });
    expect(await reviewDeliveryPublication({ id: "delivery", expectedRevision: revision, proofsEnabled: false,
      cleanup: { enroll: true, publicationId: "stale-default", expectedPublished: false } }, store.reader)).toEqual({ reason: "stale" });
    await store.run(await store.ready()); store.put(source);
    const prior = await stored(store);
    store.commit([cleanupControlMutation(prior, { ...prior, state: "disabled" })]);
    expect(await reviewDeliveryPublication({ id: "delivery", expectedRevision: store.docs.get("drafts.delivery")!._rev, proofsEnabled: false,
      cleanup: { enroll: true, publicationId: "stale-approval", expectedPublished: true, expectedControlRevision: prior._rev } }, store.reader)).toEqual({ reason: "stale" });
  });
  it("withdrawal fences a pending worker and clears attempt/receipt/result atomically", async () => {
    const store = setup(); await store.run(await store.ready());
    const old = await stored(store); store.commit([cleanupControlMutation(old, pending(old))]);
    const claimed = await stored(store);
    store.put({ ...source, title: [{ _key: "en", _type: "localizedText", language: "en", value: "New title" }] });
    const plan = await store.ready(false, "withdraw-1");
    expect(await store.run(plan)).toBe("published");
    expect(await stored(store)).toMatchObject({ state: "disabled", publicationId: "withdraw-1" });
    expect(await stored(store)).not.toHaveProperty("attempt");
    const after = structuredClone([...store.docs]);
    expect(() => store.commit([cleanupControlMutation(claimed, complete(claimed)), { delete: { id: "delivery" } }])).toThrow();
    expect([...store.docs]).toEqual(after);
  });
  it("a worker claim between review and publication rejects the entire publication", async () => {
    const store = setup(); await store.run(await store.ready()); store.put(source);
    const current = await stored(store), plan = await store.ready(true, "publish-2");
    store.commit([cleanupControlMutation(current, pending(current))]);
    const before = structuredClone([...store.docs]);
    expect(await store.run(plan)).toBe("conflict"); expect([...store.docs]).toEqual(before);
  });
  it("text edits retain consent after review; a changed deadline is explicitly visible and renewed", async () => {
    const store = setup(); await store.run(await store.ready());
    store.put({ ...source, title: [{ _key: "en", _type: "localizedText", language: "en", value: "Edited" }] });
    const text = await store.ready(true, "text-edit"); expect(text.cleanup?.policyChanged).toBe(false);
    await store.run(text); expect((await stored(store)).state).toBe("enrolled");
    store.put({ ...source, expiryInstant: "2027-04-25T12:00:00.000Z" });
    const changed = await store.ready(true, "policy-edit"); expect(changed.cleanup?.policyChanged).toBe(true);
    await store.run(changed); expect((await stored(store)).policy.expiryInstant).toBe("2027-04-25T12:00:00.000Z");
  });
  it("flag-off publication neither reads nor updates existing enrollment", async () => {
    const store = setup(); await store.run(await store.ready()); const before = await stored(store); store.put({ ...source, expiryInstant: "2027-05-24T12:00:00.000Z" });
    const docs = store.reader.docs;
    store.reader.docs = vi.fn((ids, all) => { if (ids.some((id) => id.startsWith("clientGalleryCleanup."))) throw new Error("must not read"); return docs(ids, all); });
    expect(await store.run(await store.ready(false, "ignored", false))).toBe("published");
    expect(await stored(store)).toEqual(before);
  });
  it("indefinite cannot enroll and withdraws previous consent; proof and legacy never acquire control records", async () => {
    const store = setup(); await store.run(await store.ready());
    const indefinite: Record<string, unknown> = { ...source, availabilityMode: "indefinite" }; delete indefinite.expiryInstant;
    store.put(indefinite);
    expect(await store.review(true)).toEqual({ reason: "cleanup" });
    expect(await store.run(await store.ready(false, "indefinite"))).toBe("published");
    expect((await stored(store)).state).toBe("disabled");
    for (const _type of ["clientProofGallery", "legacyDeliveryGallery"]) {
      const other = setup(); other.put({ ...source, _type });
      expect(await other.review()).toHaveProperty("reason", "stale");
      expect(other.docs.has(await cleanupControlId("delivery"))).toBe(false);
    }
    expect(allowTemplate("clientGalleryCleanup")).toBe(false); expect(allowAction("clientGalleryCleanup", "publish")).toBe(false);
  });
  it.each(["permission", "missing", "malformed", "variant"])("refuses %s control evidence", async (mode) => {
    const store = setup(), id = await cleanupControlId("delivery");
    if (mode === "malformed") store.put({ _id: id, _type: "clientGalleryCleanup", galleryId: "another" });
    if (mode === "variant") store.put({ _id: `drafts.${id}`, _type: "clientGalleryCleanup" });
    if (mode === "permission" || mode === "missing") {
      const original = store.reader.docs;
      store.reader.docs = async (ids, all) => ids.includes(id) ? { documents: [], omitted: mode === "permission" ? [{ id, reason: "permission" }] : [] } : original(ids, all);
    }
    expect(await store.review()).toHaveProperty("reason", mode === "variant" ? "copies" : "unreadable");
    expect(store.docs.has("delivery")).toBe(false);
  });
  it("unknown publication reconciles through worker advance and matching completed receipt, including immediately expired removal", async () => {
    const store = setup(); store.put({ ...source, expiryInstant: "2026-10-24T11:00:00.000Z" });
    const plan = await store.ready(); expect(plan.cleanup?.expired).toBe(true);
    const commit = vi.fn(async (mutations) => { store.commit(mutations); throw new Error("lost"); });
    expect(await publishDelivery(plan, store.reader, commit)).toBe("uncertain"); expect(commit).toHaveBeenCalledTimes(1);
    let current = await stored(store); store.commit([cleanupControlMutation(current, pending(current))]);
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("published");
    current = await stored(store); store.commit([cleanupControlMutation(current, complete(current)), { delete: { id: "delivery" } }, { delete: { id: ASSET } }]);
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("published");
    store.put({ ...await stored(store), publicationId: "another-publish" });
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("uncertain");
  });
  it("unchanged pre-state is not-observed, whereas a text-identical publication with different consent is uncertain", async () => {
    const store = setup(), plan = await store.ready();
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("not-observed");
    await store.run(await store.ready(false, "other"));
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("uncertain");
  });
});

describe("default-off Studio cleanup switch", () => {
  const environment = { SANITY_STUDIO_PROJECT_ID: "example1", SANITY_STUDIO_DATASET: "example", SANITY_STUDIO_DATASET_VISIBILITY: "public", SANITY_STUDIO_TITLE: "Example", SANITY_STUDIO_LOCALE_ROUTES: "fi||stories" };
  it.each([[undefined, false], ["", false], ["off", false], [" enabled ", true]])("reads %j as %s", (value, expected) => {
    expect(loadStudioSettings({ ...environment, SANITY_STUDIO_CLIENT_GALLERY_CLEANUP: value }).clientGalleryCleanup).toBe(expected);
  });
  it.each(["true", "1", "Enabled"])("rejects %j", (value) => expect(() => loadStudioSettings({ ...environment, SANITY_STUDIO_CLIENT_GALLERY_CLEANUP: value })).toThrow("SANITY_STUDIO_CLIENT_GALLERY_CLEANUP"));
});
