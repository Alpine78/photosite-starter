import { describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { lake } from "./test-support/proof-lake";
import { parseClientGallery } from "../src/lib/client-gallery-model";
import { validateClientDeliveryGallery } from "../sanity/schemas/client-delivery-gallery";
import { validateClientProofGallery, clientProofGalleryType } from "../sanity/schemas/client-proof-gallery";
import { allowAction } from "./editorial-policy";
import { studioInterfaceText } from "./interface-locales";
import { clientProofSelectionType, clientProofSelectionVersionType, clientProofNoticeType, clientProofReminderType } from "../sanity/schemas/client-proof-records";
import type { SchemaValidationRule } from "../sanity/schemas/schema-types";
import { deliveryPublishCopy } from "./client-gallery-publish-copy";
import {
  reviewDeliveryPublication, publishDelivery, reconcileDeliveryPublication, deliveryPublishReady, DELIVERY_LINKS_QUERY,
  DELIVERY_HANDOFF_MARGIN_MS, type DeliveryPublishReader, type DeliveryPublishPlan, type DeliveryPublishRequest,
} from "./client-gallery-publish";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const ASSET = `image-${"a".repeat(40)}-1600x1000-webp`;
const UNUSED = `image-${"b".repeat(40)}-1600x1000-webp`;
const image = (id: string) => ({ _type: "image", asset: { _type: "reference", _ref: id } });
const item = { _key: "one", _type: "clientDeliveryItem", mediaType: "image", image: image(ASSET),
  alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Coast" }] };
const delivery = { _id: "drafts.delivery", _type: "clientDeliveryGallery", handle: "1".repeat(32), available: true,
  availabilityMode: "until", expiryInstant: "2027-04-24T12:00:00.000Z", items: [item] };
const initial = () => [delivery,
  ...[ASSET, UNUSED].map((_id) => ({ _id, _type: "sanity.imageAsset", sha1hash: _id.split("-")[1], extension: "webp", mimeType: "image/webp", metadata: { dimensions: { width: 1600, height: 1000 } } })),
  { _id: "proof", _type: "clientProofGallery", handle: "2".repeat(32), items: [{ image: image(ASSET) }, { image: image(UNUSED) }] },
  { _id: "proofTerms.proof", _type: "clientProofTerms", galleryId: "proof", firstPublishedAt: "2026-10-01T00:00:00.000Z" },
  { _id: "proofSelection.proof", _type: "clientProofSelection", galleryId: "proof", state: "reopened", latestVersion: 1 },
  { _id: "proofSelection.proof.v1", _type: "clientProofSelectionVersion", galleryId: "proof", version: 1 },
  { _id: "proofNotice.proof.v1", _type: "clientProofNotice", galleryId: "proof", version: 1 },
  { _id: "proofReminder.proof.1", _type: "clientProofReminder", galleryId: "proof", step: 1 },
];
function setup(docs = initial()) {
  const store = lake(docs);
  let time = NOW;
  const fetchQuery = async <T,>(query: string, params?: Readonly<Record<string, unknown>>): Promise<T> =>
    (await evaluate(parse(query), { dataset: [...store.docs.values()], params })).get();
  const validator = { fetch: fetchQuery, withConfig: () => validator };
  const reader: DeliveryPublishReader = { ...store.reader,
    time: async () => new Date(time).toISOString(), links: (id) => fetchQuery(DELIVERY_LINKS_QUERY, { id }),
    validation: { getClient: () => validator },
  };
  const request = (): DeliveryPublishRequest => ({ id: "delivery", expectedRevision: (store.docs.get("drafts.delivery") ?? store.docs.get("delivery"))!._rev, proofId: "proof", proofsEnabled: true });
  return { ...store, reader, request, setTime: (value: number) => { time = value; } };
}
async function ready(store: ReturnType<typeof setup>, request = store.request()) {
  const result = await reviewDeliveryPublication(request, store.reader);
  if (!("ready" in result)) throw new Error(`not ready: ${result.reason}`);
  return result.ready;
}
const run = (store: ReturnType<typeof setup>, plan: DeliveryPublishPlan) => publishDelivery(plan, store.reader, async (mutations) => store.commit(mutations));
const snapshot = (store: ReturnType<typeof setup>) => structuredClone([...store.docs]);

describe("atomic delivery publication replacing proofs", () => {
  it("publishes the reviewed payload, deletes the entire proof unit and unused assets, preserving target images even when the index lags", async () => {
    const store = setup(initial().filter((doc) => doc._id !== "drafts.delivery")); store.freezeIndex();
    // The query index predates the target draft and cannot report its image use.
    store.put({ ...delivery, _updatedAt: "2026-10-24T11:59:00.000Z", _system: { base: { id: "delivery" } } });
    const plan = await ready(store);
    expect(plan.proof?.assets).toEqual([UNUSED]);
    expect(plan.selectionState).toBe("reopened");
    expect(plan.mutations.at(-1)).toEqual({ delete: { id: UNUSED } });
    expect(await run(store, plan)).toBe("published");
    expect([...store.docs.keys()].sort()).toEqual([ASSET, "delivery"].sort());
    const target = store.docs.get("delivery")!;
    expect(target).not.toHaveProperty("_system");
    expect(target).not.toHaveProperty("_updatedAt");
    expect(target.expiryInstant).toBe(delivery.expiryInstant);
    expect(parseClientGallery(target, "delivery", delivery.handle).items[0].assetId).toBe(ASSET);
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("published");
    expect(await run(store, plan)).toBe("conflict");
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toEqual({ reason: "proof" });
  });
  it("keeps images used by other documents", async () => {
    const store = setup([...initial(), { _id: "article", _type: "article", cover: image(UNUSED) }]);
    const plan = await ready(store);
    expect(plan.proof?.assets).toEqual([]);
    expect(await run(store, plan)).toBe("published");
    expect(store.docs.has(UNUSED)).toBe(true);
  });
  it.each([
    ["target draft", (s: ReturnType<typeof setup>) => s.put({ ...s.docs.get("drafts.delivery")!, title: [{ _key: "en", _type: "localizedText", language: "en", value: "New" }] })],
    ["new published target", (s: ReturnType<typeof setup>) => s.put({ ...delivery, _id: "delivery" })],
    ["proof publication", (s: ReturnType<typeof setup>) => s.put(s.docs.get("proof")!)],
    ["new proof draft", (s: ReturnType<typeof setup>) => s.put({ ...s.docs.get("proof")!, _id: "drafts.proof" })],
    ["customer confirmation", (s: ReturnType<typeof setup>) => { s.put(s.docs.get("proofTerms.proof")!); s.put({ _id: "proofSelection.proof.v2", _type: "clientProofSelectionVersion", galleryId: "proof" }); }],
    ["reminder claim", (s: ReturnType<typeof setup>) => { s.put(s.docs.get("proofTerms.proof")!); s.put({ _id: "proofReminder.proof.2", _type: "clientProofReminder", galleryId: "proof" }); }],
    ["late shared image reference", (s: ReturnType<typeof setup>) => s.put({ _id: "late", _type: "article", cover: image(UNUSED) })],
  ])("a concurrent %s rejects everything", async (_name, change) => {
    const store = setup(), plan = await ready(store);
    change(store); const before = snapshot(store);
    expect(await run(store, plan)).toBe("conflict"); expect(snapshot(store)).toEqual(before);
  });
  it("a customer or reminder write after deletion fails its terms revision guard", async () => {
    const store = setup(), plan = await ready(store), terms = store.docs.get("proofTerms.proof")!;
    expect(await run(store, plan)).toBe("published"); const after = snapshot(store);
    expect(() => store.commit([{ patch: { id: terms._id, ifRevisionID: terms._rev, set: { changed: true } } },
      { create: { _id: "proofSelection.proof.v2", _type: "clientProofSelectionVersion" } }])).toThrow();
    expect(snapshot(store)).toEqual(after);
  });
  it("reviewed counts never silently change before submit", async () => {
    const store = setup(), plan = await ready(store);
    store.put({ _id: "proofReminder.proof.2", _type: "clientProofReminder", galleryId: "proof" });
    store.put(store.docs.get("proofTerms.proof")!);
    const commit = vi.fn(async (mutations) => store.commit(mutations));
    expect(await publishDelivery(plan, store.reader, commit)).toBe("conflict");
    expect(commit.mock.calls[0][0]).toEqual(plan.mutations);
  });
  it("supports explicitly replacing with an already published target without rewriting it", async () => {
    const store = setup(initial().map((doc) => doc._id === "drafts.delivery" ? { ...doc, _id: "delivery" } : doc));
    const plan = await ready(store);
    expect(plan.mutations.some((mutation) => "createOrReplace" in mutation)).toBe(false);
    expect(await run(store, plan)).toBe("published");
    expect(store.docs.get("delivery")?.items).toEqual(delivery.items);
  });
  it.each([false, true])("ordinary publication preserves native draft-to-published payload behavior with proofs enabled=%s", async (proofsEnabled) => {
    const store = setup();
    const plan = await ready(store, { ...store.request(), proofId: undefined, proofsEnabled });
    expect(plan.proof).toBeUndefined();
    expect(await run(store, plan)).toBe("published");
    expect(store.docs.get("delivery")).toMatchObject({ ...delivery, _id: "delivery" });
    expect(store.docs.has("drafts.delivery")).toBe(false); expect(store.docs.has("proof")).toBe(true);
  });
  it.each(["proof", "drafts.proof"])("a legacy link on %s requires explicit replacement", async (id) => {
    const store = setup(); store.put({ ...store.docs.get("proof")!, _id: id, replacedBy: { _type: "reference", _ref: "delivery", _weak: true } });
    expect(await reviewDeliveryPublication({ ...store.request(), proofId: undefined }, store.reader)).toEqual({ reason: "linked" });
    expect(await run(store, await ready(store))).toBe("published");
  });
  it("proof-disabled ordinary publication ignores inactive legacy proof links", async () => {
    const store = setup(); store.put({ ...store.docs.get("proof")!, replacedBy: { _ref: "delivery", _weak: true } });
    expect(await run(store, await ready(store, { ...store.request(), proofId: undefined, proofsEnabled: false }))).toBe("published");
    expect(store.docs.has("proof")).toBe(true);
  });
  it.each([
    ["paused", { available: false }], ["expired", { expiryInstant: "2026-10-24T11:00:00.000Z" }],
    ["inside margin", { expiryInstant: new Date(NOW + DELIVERY_HANDOFF_MARGIN_MS).toISOString() }],
  ])("refuses a %s replacement without mutating", async (_name, change) => {
    const store = setup(); store.put({ ...delivery, ...change }); const before = snapshot(store);
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toEqual({ reason: "unavailable" }); expect(snapshot(store)).toEqual(before);
  });
  it("checks provider time again immediately before commit and refuses a newly expired margin", async () => {
    const store = setup(), plan = await ready(store), commit = vi.fn();
    store.setTime(Date.parse(delivery.expiryInstant) - DELIVERY_HANDOFF_MARGIN_MS);
    expect(await publishDelivery(plan, store.reader, commit)).toBe("refused"); expect(commit).not.toHaveBeenCalled();
  });
  it("accepts explicit indefinite delivery and never uses the browser clock", async () => {
    const store = setup(); const value: Record<string, unknown> = { ...delivery }; delete value.expiryInstant;
    store.put({ ...value, availabilityMode: "indefinite" });
    vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01"));
    try { expect(await run(store, await ready(store))).toBe("published"); } finally { vi.useRealTimers(); }
  });
  it.each([
    ["wrong target type", "drafts.delivery", { _type: "article" }, "stale"],
    ["invalid image", "drafts.delivery", { items: [{ ...item, image: image(`image-${"a".repeat(40)}-4000x3000-jpg`) }] }, "invalid"],
    ["wrong source type", "proof", { _type: "gallery" }, "proof"],
    ["conflicting reverse link", "proof", { replacedBy: { _ref: "other", _weak: true } }, "linked"],
    ["changed handle", "delivery", { ...delivery, _id: "delivery", handle: "3".repeat(32) }, "invalid"],
  ])("refuses %s", async (_name, id, change, reason) => {
    const store = setup(); store.put({ ...store.docs.get(id as string), _id: id, ...change });
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toEqual({ reason });
  });
  it("explains missing proof terms as a missing proof unit instead of suggesting endless stale retries", async () => {
    const store = setup(initial().filter((doc) => doc._id !== "proofTerms.proof"));
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toEqual({ reason: "proof" });
    expect(store.docs.has("drafts.delivery")).toBe(true); expect(store.docs.has("proof")).toBe(true);
  });
  it.each(["delivery", "proof", "proofTerms.proof"])('refuses a release copy of %s', async (id) => {
    const store = setup(); store.put({ ...(store.docs.get(id) ?? delivery), _id: `versions.release.${id}` });
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toHaveProperty("reason", id === "delivery" ? "copies" : "deletion");
  });
  it("refuses permission omissions in allVersions even if earlier exact reads worked", async () => {
    const store = setup(), original = store.reader.docs;
    store.reader.docs = async (ids, all) => all ? { documents: [], omitted: ids.map((id) => ({ id, reason: "permission" })) } : original(ids, all);
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toEqual({ reason: "unreadable" });
  });
  it("refuses multiple legacy sources and a missing/permission-denied proof", async () => {
    const store = setup(); store.put({ _id: "other", _type: "clientProofGallery", replacedBy: { _ref: "delivery", _weak: true } });
    expect(await reviewDeliveryPublication(store.request(), store.reader)).toEqual({ reason: "linked" });
    const missing = setup(initial().filter((doc) => doc._id !== "proof"));
    expect(await reviewDeliveryPublication(missing.request(), missing.reader)).toEqual({ reason: "proof" });
  });
  it("refuses an oversized proof unit instead of splitting the atomic operation", async () => {
    const id = "p".repeat(96), store = setup(initial().map((doc) => doc._id === "proof" ? { ...doc, _id: id } :
      doc._id === "proofTerms.proof" ? { ...doc, _id: `proofTerms.${id}`, galleryId: id, firstPublishedAt: "1000-01-01T00:00:00.000Z" } : doc)
      .filter((doc) => !doc._id.startsWith("proofSelection.") && !doc._id.startsWith("proofNotice.") && !doc._id.startsWith("proofReminder.")));
    for (let n = 1; n <= 9999; n++) store.docs.set(`proofReminder.${id}.${n}`, { _id: `proofReminder.${id}.${n}`, _type: "clientProofReminder", galleryId: id, _rev: "r".repeat(128) });
    store.reader.docs = async (ids, all) => ({
      documents: ids.flatMap((key) => [store.docs.get(key), ...(all ? [store.docs.get(`drafts.${key}`)] : [])].filter(Boolean)),
      omitted: ids.filter((key) => !store.docs.has(key)).map((key) => ({ id: key, reason: "existence" })),
    });
    store.reader.sweep = async () => ({ extra: [], referencing: [], sharedAssets: [] });
    expect(await reviewDeliveryPublication({ ...store.request(), proofId: id }, store.reader)).toEqual({ reason: "deletion" });
    expect(store.docs.has(id)).toBe(true); expect(store.docs.has("drafts.delivery")).toBe(true);
  });
  it.each([400, 401, 403, 409, 429, 500, 503, undefined])("classifies commit status %s without retries", async (statusCode) => {
    const store = setup(), plan = await ready(store), commit = vi.fn(async () => { throw Object.assign(new Error("lost"), { statusCode }); });
    expect(await publishDelivery(plan, store.reader, commit)).toBe(statusCode === 409 ? "conflict" : statusCode && statusCode < 500 ? "refused" : "uncertain");
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it("reconciles a committed transaction whose response was lost using only fresh reads", async () => {
    const store = setup(), plan = await ready(store);
    expect(await publishDelivery(plan, store.reader, async (mutations) => { store.commit(mutations); throw new Error("network"); })).toBe("uncertain");
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("published");
  });
  it("an unapplied timeout may still finish later; a fresh attempt cannot duplicate it", async () => {
    const store = setup(), plan = await ready(store);
    expect(await publishDelivery(plan, store.reader, async () => { throw new Error("timeout"); })).toBe("uncertain");
    const before = snapshot(store);
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("not-observed"); expect(snapshot(store)).toEqual(before);
    const next = await ready(store);
    store.commit(plan.mutations); const applied = snapshot(store);
    expect(await run(store, next)).toBe("conflict"); expect(snapshot(store)).toEqual(applied);
  });
  it("mixed state or failed fresh reads remain uncertain", async () => {
    const store = setup(), plan = await ready(store); store.put({ ...delivery, _id: "delivery" });
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("uncertain");
    store.reader.docs = async () => { throw new Error("offline"); };
    expect(await reconcileDeliveryPublication(plan, store.reader)).toBe("uncertain");
  });
  it("proofs never return when delivery is later paused, expired, unpublished or deleted", async () => {
    const store = setup(); expect(await run(store, await ready(store))).toBe("published");
    store.put({ ...store.docs.get("delivery")!, available: false, expiryInstant: "2020-01-01T00:00:00.000Z" });
    store.docs.delete("delivery");
    expect([...store.docs.keys()]).toEqual([ASSET]);
  });
});

describe("Studio entry and bilingual copy", () => {
  it.each(["versions.release.delivery", "versions.schedule.delivery"])("gallery release validation blocks native release publication and scheduled drafts: %s", async (_id) => {
    const store = setup();
    expect(await validateClientDeliveryGallery({ ...delivery, _id }, store.reader.validation)).toMatch(/outside Content Releases/u);
    expect(await validateClientProofGallery({ _id, _type: "clientProofGallery" }, store.reader.validation)).toMatch(/outside Content Releases/u);
  });

  it("prevents private proof records from reappearing through Studio releases", () => {
    for (const type of [clientProofSelectionType, clientProofSelectionVersionType, clientProofNoticeType, clientProofReminderType]) {
      let check: ((value: unknown) => unknown) | undefined;
      const rule = { custom: (fn: typeof check) => { check = fn; return rule; } } as unknown as SchemaValidationRule;
      type.validation!(rule);
      expect(check!({ _id: "versions.release.proofSelection.proof" })).toMatch(/only by the site/u);
      expect(check!({ _id: "proofSelection.proof" })).toBe(true);
    }
  });
  it("removes native publication and scheduling actions for client galleries and keeps public content actions", () => {
    for (const action of ["publish", "schedule", "schedulePublish", "createVersion", "restore", "duplicate"]) {
      expect(allowAction("clientDeliveryGallery", action)).toBe(false); expect(allowAction("clientProofGallery", action)).toBe(false);
      expect(allowAction("gallery", action)).toBe(true); expect(allowAction("article", action)).toBe(true);
    }
    expect(clientProofGalleryType.fields.find((field) => field.name === "replacedBy")?.readOnly).toBe(true);
  });
  it("waits for validation at the exact source revision and rejects sync and release states", () => {
    const state = { id: "delivery", type: "clientDeliveryGallery", ready: true, draft: { _rev: "r1" }, published: null };
    const validation = { revision: "r1", isValidating: false, validation: [] };
    expect(deliveryPublishReady(state, validation, false)).toBe(true);
    expect(deliveryPublishReady(state, { ...validation, revision: "r2" }, false)).toBe(false);
    expect(deliveryPublishReady(state, validation, true)).toBe(false);
    expect(deliveryPublishReady({ ...state, version: { _id: "versions.r.delivery" } }, validation, false)).toBe(false);
    expect(deliveryPublishReady({ ...state, transactionSyncLock: { enabled: true } }, validation, false)).toBe(false);
  });
  it.each(["fi", "en"])("covers the editor flow in %s including the destructive confirmation and unknown-outcome path", (locale) => {
    const copy = deliveryPublishCopy(locale);
    for (const field of [copy.action, copy.choose, copy.replacement, copy.warning, copy.uncertain, copy.notObserved, ...Object.values(copy.errors)]) expect(field.trim().length).toBeGreaterThan(5);
    expect(copy.confirm).toContain("{id}");
    const message = "Client and proof galleries must be published with their own publication action, outside Content Releases and scheduled drafts.";
    if (locale === "fi") expect(studioInterfaceText(message, locale)).toMatch(/Asiakas- ja vedosgalleriat/u);
  });
});
