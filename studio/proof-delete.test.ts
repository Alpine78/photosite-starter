import { describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import {
  collectProofDeletion, createProofDeletionGuard, inventoryIds, planProofDeletion, proofDeleteCopy, proofDeletionCounts, proofDeletionReminderSteps,
  runProofDeletion, PROOF_DELETE_MAX_REMINDER_STEP, PROOF_DELETE_MAX_VERSION, PROOF_DELETE_REMINDER_STEP_MS, PROOF_DELETE_SWEEP_QUERY,
  type ProofDeletionMutation, type ProofDeletionReader,
} from "./proof-delete";
import { PROOF_MAX_VERSION, proofNoticeId, proofSelectionId, proofTermsDocumentId, proofVersionId } from "../src/lib/proof-selection";
import { PROOF_MAX_REMINDER_STEP, proofReminderId, REMINDER_STEP_MS } from "../src/lib/proof-reminder";

type Doc = Record<string, unknown> & { _id: string; _rev: string };
const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const PUBLISHED = "2026-08-01T00:00:00.000Z";

/** A tiny Content Lake: fresh Doc reads, a query index that may lag, and atomic transactions. */
function lake(initial: Record<string, unknown>[]) {
  const docs = new Map<string, Doc>();
  let counter = 0;
  const put = (value: Record<string, unknown>) => docs.set(value._id as string, { ...value, _rev: `r${++counter}` } as Doc);
  initial.forEach(put);
  let index: Doc[] | undefined;
  const reader: ProofDeletionReader = {
    async docs(ids, allVersions) {
      if (allVersions) {
        return { documents: [...docs.values()].filter((doc) => ids.some((id) => doc._id === id || doc._id === `drafts.${id}` || new RegExp(`^versions\\.[^.]+\\.${id.replace(/\./gu, "\\.")}$`, "u").test(doc._id))), omitted: [] };
      }
      return { documents: ids.flatMap((id) => docs.has(id) ? [docs.get(id)] : []), omitted: ids.filter((id) => !docs.has(id)).map((id) => ({ id, reason: "existence" })) };
    },
    async sweep(galleryId, ids) {
      return (await evaluate(parse(PROOF_DELETE_SWEEP_QUERY), { dataset: index ?? [...docs.values()], params: { galleryId, ids } })).get();
    },
  };
  function commit(mutations: readonly Record<string, unknown>[]) {
    const next = new Map(docs);
    for (const mutation of mutations) {
      if ("create" in mutation) {
        const doc = mutation.create as Doc;
        if (next.has(doc._id)) throw Object.assign(new Error("exists"), { statusCode: 409 });
        next.set(doc._id, { ...doc, _rev: `r${++counter}` });
      } else if ("patch" in mutation) {
        const patch = mutation.patch as { id: string; ifRevisionID?: string; set?: Record<string, unknown> };
        const current = next.get(patch.id);
        if (!current) throw Object.assign(new Error("missing"), { statusCode: 409 });
        if (patch.ifRevisionID !== undefined && patch.ifRevisionID !== current._rev) throw Object.assign(new Error("revision"), { statusCode: 409 });
        next.set(patch.id, { ...current, ...patch.set, _rev: `r${++counter}` });
      } else {
        next.delete((mutation.delete as { id: string }).id);
      }
    }
    docs.clear();
    next.forEach((value, key) => docs.set(key, value));
  }
  return { docs, put, reader, commit, freezeIndex: () => { index = [...docs.values()]; } };
}

const gallery = (id = "g1") => [
  { _id: id, _type: "clientProofGallery", handle: `h-${id}`, items: [{ _key: "a", image: { asset: { _ref: "image-abc-10x10-jpg" } } }] },
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
  { _id: "image-abc-10x10-jpg", _type: "sanity.imageAsset" },
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
    expect(proofDeletionCounts(inventory)).toEqual({ gallery: 1, terms: 1, selection: 1, versions: 2, notices: 2, reminders: 2 });
  });

  it("deletes exactly those records, keeping images, the shared cursor and other galleries", async () => {
    const store = lake([...gallery(), { _id: "drafts.g1", _type: "clientProofGallery" }, ...gallery("g2"), ...shared]);
    const inventory = await ready(store);
    expect(await run(store, planProofDeletion(inventory, "2026-10-23T12:00:00.000Z"))).toBe("deleted");
    expect([...store.docs.keys()].sort()).toEqual([...gallery("g2").map((doc) => doc._id), ...shared.map((doc) => doc._id)].sort());
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
