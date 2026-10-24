import { describe, expect, it, vi } from "vitest";
import {
  collectProofDeletion, createProofDeletionGuard, inventoryIds, planProofDeletion, proofDeleteCopy, proofDeletionCounts, proofDeletionReminderSteps,
  runProofDeletion, PROOF_DELETE_MAX_REMINDER_STEP, PROOF_DELETE_MAX_VERSION, PROOF_DELETE_REMINDER_STEP_MS,
  type ProofDeletionMutation, type ProofDeletionReader,
} from "./proof-delete";
import { PROOF_MAX_VERSION, proofNoticeId, proofSelectionId, proofTermsDocumentId, proofVersionId } from "../src/lib/proof-selection";
import { PROOF_MAX_REMINDER_STEP, proofReminderId, REMINDER_STEP_MS } from "../src/lib/proof-reminder";

import { lake } from "./test-support/proof-lake";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const PUBLISHED = "2026-08-01T00:00:00.000Z";

const asset = (id: string) => ({ _id: id, _type: "sanity.imageAsset" });
const item = (key: string, ref: string) => ({ _key: key, image: { _type: "image", asset: { _type: "reference", _ref: ref } } });
const gallery = (id = "g1") => [
  { _id: id, _type: "clientProofGallery", handle: `h-${id}`, items: [item("a", `image-${id}a-10x10-jpg`), item("b", `image-${id}b-10x10-jpg`)] },
  asset(`image-${id}a-10x10-jpg`), asset(`image-${id}b-10x10-jpg`),
  { _id: proofTermsDocumentId(id), _type: "clientProofTerms", galleryId: id, firstPublishedAt: PUBLISHED, reminderDelayDays: 7, customerEmail: "c@example.fi" },
  { _id: proofSelectionId(id), _type: "clientProofSelection", galleryId: id, state: "confirmed", latestVersion: 2 },
  { _id: proofVersionId(id, 1), _type: "clientProofSelectionVersion", galleryId: id, version: 1 },
  { _id: proofVersionId(id, 2), _type: "clientProofSelectionVersion", galleryId: id, version: 2 },
  { _id: proofNoticeId(id, 1), _type: "clientProofNotice", galleryId: id, version: 1, selection: { _type: "reference", _ref: proofVersionId(id, 1), _weak: true } },
  { _id: proofNoticeId(id, 2), _type: "clientProofNotice", galleryId: id, version: 2 },
  { _id: proofReminderId(id, 1), _type: "clientProofReminder", galleryId: id, step: 1 },
  { _id: proofReminderId(id, 2), _type: "clientProofReminder", galleryId: id, step: 2 },
];
const shared = [
  asset("image-other-10x10-jpg"),
  { _id: "article1", _type: "article", cover: { _type: "image", asset: { _type: "reference", _ref: "image-other-10x10-jpg" } } },
  { _id: "proofReminderCursor.daily", _type: "clientProofReminderCursor", after: "proofTerms.g1" },
];

async function ready(store: ReturnType<typeof lake>, id = "g1") {
  const result = await collectProofDeletion(id, store.reader, NOW);
  if (!("ready" in result)) throw new Error(`not ready: ${result.reason}`);
  return result.ready;
}
const run = (store: ReturnType<typeof lake>, mutations: ProofDeletionMutation[]) =>
  runProofDeletion(mutations, async (list) => store.commit(list as unknown as Record<string, unknown>[]));

describe("collecting a proof gallery deletion", () => {
  it("lists every record by deterministic ID, terms first", async () => {
    const store = lake([...gallery(), ...gallery("g2"), ...shared]);
    const inventory = await ready(store);
    expect(inventoryIds(inventory)).toEqual([
      "proofTerms.g1", "g1", "proofSelection.g1", "proofSelection.g1.v1", "proofSelection.g1.v2", "proofNotice.g1.v1", "proofNotice.g1.v2",
      "proofReminder.g1.1", "proofReminder.g1.2",
    ]);
    expect(inventory.assets).toEqual(["image-g1a-10x10-jpg", "image-g1b-10x10-jpg"]);
    expect(proofDeletionCounts(inventory)).toEqual({ gallery: 1, terms: 1, selection: 1, versions: 2, notices: 2, reminders: 2, images: 2, sharedImages: 0 });
  });

  it("deletes exactly those records and the gallery's images, keeping the shared cursor and other galleries", async () => {
    const draft = { _id: "drafts.g1", _type: "clientProofGallery", items: [item("a", "image-g1a-10x10-jpg"), item("c", "image-g1c-10x10-jpg")] };
    const store = lake([...gallery(), draft, asset("image-g1c-10x10-jpg"), ...gallery("g2"), ...shared]);
    const inventory = await ready(store);
    expect(inventory.assets).toEqual(["image-g1a-10x10-jpg", "image-g1b-10x10-jpg", "image-g1c-10x10-jpg"]);
    const plan = planProofDeletion(inventory, "2026-10-23T12:00:00.000Z");
    expect(plan.slice(-3)).toEqual(inventory.assets.map((id) => ({ delete: { id } })));
    expect(await run(store, plan)).toBe("deleted");
    expect([...store.docs.keys()].sort()).toEqual([...gallery("g2").map((doc) => doc._id), ...shared.map((doc) => doc._id)].sort());
  });

  it("keeps an image another document uses and deletes the rest", async () => {
    const store = lake([...gallery(), ...shared, { _id: "article2", _type: "article", cover: { _type: "image", asset: { _type: "reference", _ref: "image-g1b-10x10-jpg" } } }]);
    const inventory = await ready(store);
    expect(inventory).toMatchObject({ assets: ["image-g1a-10x10-jpg"], sharedAssets: ["image-g1b-10x10-jpg"] });
    expect(await run(store, planProofDeletion(inventory, "t"))).toBe("deleted");
    expect(store.docs.has("image-g1b-10x10-jpg")).toBe(true);
    expect(store.docs.has("image-g1a-10x10-jpg")).toBe(false);
  });

  it("deletes nothing when a use of an image appears after the inventory", async () => {
    const store = lake([...gallery(), ...shared]);
    const inventory = await ready(store);
    store.put({ _id: "article2", _type: "article", cover: { _type: "image", asset: { _type: "reference", _ref: "image-g1a-10x10-jpg" } } });
    expect(await run(store, planProofDeletion(inventory, "t"))).toBe("conflict");
    expect(store.docs.has("g1")).toBe(true);
    expect((await ready(store)).sharedAssets).toEqual(["image-g1a-10x10-jpg"]);
  });

  it("skips an image asset that is already gone", async () => {
    const store = lake([...gallery().filter((doc) => doc._id !== "image-g1b-10x10-jpg")]);
    expect((await ready(store)).assets).toEqual(["image-g1a-10x10-jpg"]);
  });

  it("includes a record the lagging query index does not show yet", async () => {
    const store = lake([...gallery(), ...shared]);
    store.freezeIndex();
    store.put({ _id: proofReminderId("g1", 3), _type: "clientProofReminder", galleryId: "g1", step: 3 });
    expect(inventoryIds(await ready(store))).toContain("proofReminder.g1.3");
  });

  it("deletes a never-published draft and asserts that nothing else appeared", async () => {
    const store = lake([{ _id: "drafts.g1", _type: "clientProofGallery" }]);
    const inventory = await ready(store);
    expect(inventoryIds(inventory)).toEqual(["drafts.g1"]);
    expect(planProofDeletion(inventory, "t").filter((mutation) => "create" in mutation).map((mutation) => "create" in mutation && mutation.create._id))
      .toEqual(["proofTerms.g1", "g1", "proofSelection.g1"]);
    expect(await run(store, planProofDeletion(inventory, "t"))).toBe("deleted");
    expect(store.docs.size).toBe(0);
  });

  it.each([
    ["a permission omission", (body: { omitted: unknown[] }) => ({ ...body, omitted: body.omitted.map((entry) => ({ ...(entry as object), reason: "permission" })) })],
    ["an ID the API did not report", (body: { omitted: unknown[] }) => ({ ...body, omitted: [] })],
    ["a malformed response", () => ({ documents: "x" })],
  ])("refuses %s as unreadable, never as no record", async (_name, change) => {
    const store = lake([...gallery()]);
    const reader: ProofDeletionReader = { ...store.reader, docs: async (ids, all) => all ? store.reader.docs(ids, all) : change(await store.reader.docs(ids, all) as { omitted: unknown[] }) };
    expect(await collectProofDeletion("g1", reader, NOW)).toEqual({ reason: "unreadable" });
  });

  it("refuses when a read fails", async () => {
    const store = lake([...gallery()]);
    expect(await collectProofDeletion("g1", { ...store.reader, docs: async () => { throw new Error("offline"); } }, NOW)).toEqual({ reason: "unreadable" });
  });

  it.each([
    ["a fractional version count", { _id: proofSelectionId("g1"), _type: "clientProofSelection", galleryId: "g1", latestVersion: 1.5 }],
    ["a version count above the limit", { _id: proofSelectionId("g1"), _type: "clientProofSelection", galleryId: "g1", latestVersion: 1000 }],
    ["terms of another gallery", { _id: proofTermsDocumentId("g1"), _type: "clientProofTerms", galleryId: "g2", firstPublishedAt: PUBLISHED }],
    ["terms without a publication time", { _id: proofTermsDocumentId("g1"), _type: "clientProofTerms", galleryId: "g1" }],
    ["a record of another type", { _id: proofVersionId("g1", 1), _type: "clientProofNotice", galleryId: "g1" }],
    ["a malformed image reference", { _id: "g1", _type: "clientProofGallery", items: [item("a", "file-x-pdf")] }],
    ["an image asset ID of another type", { _id: "image-g1a-10x10-jpg", _type: "clientProofNotice" }],
  ])("refuses %s as inconsistent", async (_name, replacement) => {
    const store = lake([...gallery().filter((doc) => doc._id !== replacement._id), replacement]);
    expect(await collectProofDeletion("g1", store.reader, NOW)).toEqual({ reason: "inconsistent" });
  });

  it.each([
    ["a release version of the gallery", "versions.rABC.g1"],
    ["a draft of a private record", "drafts.proofTerms.g1"],
    ["a release version of a confirmed version", "versions.rABC.proofSelection.g1.v1"],
  ])("refuses %s", async (_name, id) => {
    const store = lake([...gallery(), { _id: id, _type: "clientProofGallery" }]);
    expect(await collectProofDeletion("g1", store.reader, NOW)).toEqual({ reason: "copies", ids: [id] });
  });

  it("refuses records of the gallery outside the computed bounds and references from outside", async () => {
    const stray = lake([...gallery(), { _id: proofVersionId("g1", 7), _type: "clientProofSelectionVersion", galleryId: "g1" }]);
    expect(await collectProofDeletion("g1", stray.reader, NOW)).toEqual({ reason: "unexpected", ids: ["proofSelection.g1.v7"] });
    const referenced = lake([...gallery(), { _id: "other", _type: "article", link: { _type: "reference", _ref: "g1" } }]);
    expect(await collectProofDeletion("g1", referenced.reader, NOW)).toEqual({ reason: "referenced", ids: ["other"] });
  });

  it("has nothing to delete for an unknown gallery", async () => {
    expect(await collectProofDeletion("g9", lake([...gallery()]).reader, NOW)).toEqual({ reason: "nothing" });
    expect(await collectProofDeletion("../g1", lake([]).reader, NOW)).toEqual({ reason: "inconsistent" });
  });
});

describe("deletion racing other writes", () => {
  /** The site's guarded customer write: a new version and notice, with the terms guard. */
  const confirm = (store: ReturnType<typeof lake>, termsRevision: string) => store.commit([
    { create: { _id: proofVersionId("g1", 3), _type: "clientProofSelectionVersion", galleryId: "g1" } },
    { create: { _id: proofNoticeId("g1", 3), _type: "clientProofNotice", galleryId: "g1" } },
    { patch: { id: proofSelectionId("g1"), set: { latestVersion: 3 } } },
    { patch: { id: proofTermsDocumentId("g1"), ifRevisionID: termsRevision, set: { lastSelectionWriteAt: "t" } } },
  ]);

  it("conflicts when a confirmation lands after the inventory, deleting nothing", async () => {
    const store = lake([...gallery()]);
    const inventory = await ready(store);
    confirm(store, store.docs.get("proofTerms.g1")!._rev);
    const before = [...store.docs.keys()];
    expect(await run(store, planProofDeletion(inventory, "t"))).toBe("conflict");
    expect([...store.docs.keys()]).toEqual(before);
    expect(inventoryIds(await ready(store))).toContain("proofSelection.g1.v3");
  });

  it("makes a confirmation read before the deletion fail without recreating anything", async () => {
    const store = lake([...gallery()]);
    const termsRevision = store.docs.get("proofTerms.g1")!._rev;
    expect(await run(store, planProofDeletion(await ready(store), "t"))).toBe("deleted");
    expect(() => confirm(store, termsRevision)).toThrow();
    expect(store.docs.size).toBe(0);
  });

  it("conflicts with a reminder claim, and a later claim fails", async () => {
    const store = lake([...gallery()]);
    const claim = (revision: string) => store.commit([
      { create: { _id: proofReminderId("g1", 3), _type: "clientProofReminder", galleryId: "g1" } },
      { patch: { id: proofTermsDocumentId("g1"), ifRevisionID: revision, set: { lastReminderClaimAt: "t" } } },
    ]);
    const stale = await ready(store);
    claim(store.docs.get("proofTerms.g1")!._rev);
    expect(await run(store, planProofDeletion(stale, "t"))).toBe("conflict");
    const revision = store.docs.get("proofTerms.g1")!._rev;
    expect(await run(store, planProofDeletion(await ready(store), "t"))).toBe("deleted");
    expect(() => claim(revision)).toThrow();
    expect(store.docs.size).toBe(0);
  });

  it("conflicts when an editor starts a draft after the inventory", async () => {
    const store = lake([...gallery()]);
    const inventory = await ready(store);
    store.put({ _id: "drafts.g1", _type: "clientProofGallery" });
    expect(await run(store, planProofDeletion(inventory, "t"))).toBe("conflict");
    expect(store.docs.has("g1")).toBe(true);
  });

  it("conflicts when a first publication beats the deletion of a draft", async () => {
    const store = lake([{ _id: "drafts.g1", _type: "clientProofGallery" }]);
    const inventory = await ready(store);
    store.commit([
      { create: { _id: proofTermsDocumentId("g1"), _type: "clientProofTerms", galleryId: "g1", firstPublishedAt: PUBLISHED } },
      { create: { _id: "g1", _type: "clientProofGallery" } },
      { delete: { id: "drafts.g1" } },
    ]);
    expect(await run(store, planProofDeletion(inventory, "t"))).toBe("conflict");
    expect([...store.docs.keys()].sort()).toEqual(["g1", "proofTerms.g1"]);
  });
});

describe("running a deletion", () => {
  it.each([
    [409, "conflict"], [403, "refused"], [400, "refused"], [500, "uncertain"], [undefined, "uncertain"],
  ] as const)("classifies status %s as %s", async (statusCode, outcome) => {
    expect(await runProofDeletion([], async () => { throw Object.assign(new Error("x"), { statusCode }); })).toBe(outcome);
  });

  it("ignores a second press while one runs", async () => {
    const guard = createProofDeletionGuard();
    let release!: () => void;
    const commit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = guard([], commit);
    expect(await guard([], commit)).toBe("busy");
    release();
    expect(await first).toBe("deleted");
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe("bounds and copy", () => {
  it("keeps the limits and IDs in step with the site's planners", () => {
    expect(PROOF_DELETE_MAX_VERSION).toBe(PROOF_MAX_VERSION);
    expect(PROOF_DELETE_MAX_REMINDER_STEP).toBe(PROOF_MAX_REMINDER_STEP);
    expect(PROOF_DELETE_REMINDER_STEP_MS).toBe(REMINDER_STEP_MS);
  });

  it("reads one step past the latest any one-day delay could have reached", () => {
    const first = Date.parse(PUBLISHED);
    expect(proofDeletionReminderSteps(first, first)).toBe(2);
    expect(proofDeletionReminderSteps(first, first + 2 * REMINDER_STEP_MS + 1)).toBe(4);
    expect(proofDeletionReminderSteps(first, first - 10 * REMINDER_STEP_MS)).toBe(0);
    expect(proofDeletionReminderSteps(0, Number.MAX_SAFE_INTEGER)).toBe(PROOF_MAX_REMINDER_STEP);
  });

  it("has the same messages in both languages", () => {
    const keys = (value: object): string[] => Object.entries(value).flatMap(([key, entry]) => typeof entry === "object" && !Array.isArray(entry) ? keys(entry).map((sub) => `${key}.${sub}`) : [key]);
    expect(keys(proofDeleteCopy("fi-FI")).sort()).toEqual(keys(proofDeleteCopy("en-US")).sort());
  });
});
