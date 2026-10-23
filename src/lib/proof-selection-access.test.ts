import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFixtureProofSelection, runProofSelection, type ProofSelectionDependencies } from "@/lib/proof-selection-access";
import { ProofSelectionStoreError } from "@/lib/proof-selection-sanity";
import { createSelectionKey } from "@/lib/proof-selection-key";

vi.mock("@/lib/sanity-config", () => ({ getSanityConfig: () => ({ projectId: "example1", dataset: "fixture", apiVersion: "v2026-06-24", datasetVisibility: "public" }) }));
vi.mock("@/lib/deployment-config", async (original) => ({ ...await original<typeof import("@/lib/deployment-config")>(), getDeploymentConfig: () => ({ locale: "en-GB" }) }));

const handle = "c".repeat(32);
const { key, hash } = createSelectionKey();
const other = createSelectionKey();
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const item = (k: string, n: string, reference: string) => ({ _key: k, _type: "clientProofItem", mediaType: "image", originalFilename: `${k}.jpg`, reference,
  image: { _type: "image", asset: { _type: "reference", _ref: asset(n) } } });

/** An in-memory content lake: atomic transactions with Sanity's create/ifRevisionID rules. */
function lake() {
  const documents = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const put = (doc: Record<string, unknown>) => documents.set(doc._id as string, { ...structuredClone(doc), _rev: `r${++counter}` });
  put({ _id: "g1", _type: "clientProofGallery", handle, available: true, availabilityMode: "indefinite", referenceHighWater: 3,
    items: [item("a", "1", "001"), item("b", "2", "002"), item("c", "3", "003")] });
  put({ _id: "proofTerms.g1", _type: "clientProofTerms", galleryId: "g1", includedCount: 1, extraUnitPriceMinor: 500, currency: "EUR", jobReference: "J", selectionKeyHash: hash });
  const commit = vi.fn(async (mutations: readonly Record<string, unknown>[]) => {
    const next = new Map([...documents].map(([id, doc]) => [id, structuredClone(doc)]));
    for (const mutation of mutations) {
      if (mutation.create) {
        const doc = mutation.create as Record<string, unknown>;
        if (next.has(doc._id as string)) throw new ProofSelectionStoreError("conflict");
        next.set(doc._id as string, { ...doc, _rev: `r${++counter}` });
      } else {
        const patch = mutation.patch as { id: string; ifRevisionID: string; set: Record<string, unknown> };
        const current = next.get(patch.id);
        if (!current || current._rev !== patch.ifRevisionID) throw new ProofSelectionStoreError("conflict");
        next.set(patch.id, { ...current, ...patch.set, _rev: `r${++counter}` });
      }
    }
    documents.clear(); for (const [id, doc] of next) documents.set(id, doc);
  });
  const store = {
    discover: vi.fn(async (value: string) => [...documents.values()].filter((doc) => doc._type === "clientProofGallery" && doc.handle === value).map((doc) => ({ _id: doc._id }))),
    read: vi.fn(async (id: string) => structuredClone(documents.get(id) ?? null)),
    commit,
  };
  return { documents, put, store };
}

let world: ReturnType<typeof lake>;
let allowed: ReturnType<typeof vi.fn<(id: string) => boolean>>;
let sendNotice: ReturnType<typeof vi.fn<NonNullable<ProofSelectionDependencies["sendNotice"]>>>;
const deps = (extra: Partial<ProofSelectionDependencies> = {}): ProofSelectionDependencies => ({
  store: world.store as unknown as ProofSelectionDependencies["store"], galleryAllowed: allowed,
  replacementAvailable: vi.fn(async () => false), now: () => Date.parse("2026-10-23T10:00:00Z"), sendNotice, ...extra,
});
const run = (request: Record<string, unknown>, extra: Partial<ProofSelectionDependencies> = {}) =>
  runProofSelection({ handle, key, ...request } as never, "token", deps(extra));
afterEach(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  world = lake(); allowed = vi.fn(() => true); sendNotice = vi.fn(async () => ({ status: "delivered" as const }));
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proof selection facade", () => {
  it("reads an empty open selection with the terms summary", async () => {
    expect(await run({ operation: "read" })).toEqual({ outcome: "ok", selection: expect.objectContaining({ state: "open", revision: null, references: [], includedCount: 1, currency: "EUR" }) });
    expect(allowed).toHaveBeenCalledWith("g1");
  });

  it("refuses unknown handles, wrong keys and closed galleries alike, before the gallery allowance and any write", async () => {
    const results = [
      await runProofSelection({ operation: "read", handle: "d".repeat(32), key }, "token", deps()),
      await run({ operation: "select", key: other.key, expectedRevision: null, references: ["001"] }),
    ];
    world.store.read.mockClear();
    world.put({ ...world.documents.get("g1")!, available: false });
    results.push(await run({ operation: "select", expectedRevision: null, references: ["001"] }));
    world.put({ ...world.documents.get("g1")!, available: true, availabilityMode: "until", expiryInstant: "2026-10-23T10:00:00.000Z" });
    results.push(await run({ operation: "read" }));
    expect(results).toEqual(Array(4).fill({ outcome: "unavailable" }));
    expect(allowed).not.toHaveBeenCalled(); expect(world.store.commit).not.toHaveBeenCalled();
    // A closed gallery is refused before its private records are read.
    expect(world.store.read.mock.calls.map(([id]) => id)).not.toContain("proofTerms.g1");
  });

  it("refuses writes while an available delivery gallery replaces the proofs (owner answer 5)", async () => {
    world.put({ ...world.documents.get("g1")!, replacedBy: { _type: "reference", _ref: "delivery1", _weak: true } });
    world.put({ _id: "delivery1", _type: "clientDeliveryGallery", handle: "d".repeat(32) });
    const replacementAvailable = vi.fn(async () => true);
    expect(await run({ operation: "select", expectedRevision: null, references: ["001"] }, { replacementAvailable })).toEqual({ outcome: "unavailable" });
    expect(replacementAvailable).toHaveBeenCalledWith("d".repeat(32), "delivery1", "en-GB");
    // A deleted replacement no longer replaces.
    world.documents.delete("delivery1");
    expect(await run({ operation: "read" }, { replacementAvailable })).toMatchObject({ outcome: "ok" });
  });

  it("saves, conflicts with another tab's save showing the fresh state, and confirms once", async () => {
    const first = await run({ operation: "select", expectedRevision: null, references: ["003", "001"] });
    if (first.outcome !== "ok") throw new Error(first.outcome);
    expect(first.selection).toMatchObject({ references: ["001", "003"], selectedCount: 2, extraCount: 1, extraTotalMinor: 500 });
    expect(await run({ operation: "select", expectedRevision: null, references: ["002"] })).toMatchObject({ outcome: "rejected", reason: "conflict", selection: { references: ["001", "003"] } });
    const confirmed = await run({ operation: "confirm", expectedRevision: first.selection.revision });
    expect(confirmed).toMatchObject({ outcome: "ok", written: "confirmed", selection: { state: "confirmed", version: 1, references: ["001", "003"] } });
    expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "sent", version: 1 });
    // A retried confirmation with the old revision cannot write a second version.
    expect(await run({ operation: "confirm", expectedRevision: first.selection.revision })).toMatchObject({ outcome: "rejected", reason: "conflict", selection: { state: "confirmed", version: 1 } });
    expect([...world.documents.keys()].filter((id) => id.startsWith("proofSelection.g1.v"))).toEqual(["proofSelection.g1.v1"]);
    expect(await run({ operation: "select", expectedRevision: (confirmed as { selection: { revision: string } }).selection.revision, references: [] })).toMatchObject({ outcome: "rejected", reason: "confirmed" });
  });

  it("fails a confirmation whose key was rotated between the check and the commit, and then refuses the old key", async () => {
    const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
    if (saved.outcome !== "ok") throw new Error(saved.outcome);
    const commit = world.store.commit.getMockImplementation()!;
    world.store.commit.mockImplementationOnce(async (mutations) => {
      world.put({ ...world.documents.get("proofTerms.g1")!, selectionKeyHash: other.hash });
      return commit(mutations);
    });
    expect(await run({ operation: "confirm", expectedRevision: saved.selection.revision })).toEqual({ outcome: "unavailable" });
    expect(world.documents.has("proofSelection.g1.v1")).toBe(false);
    expect(world.documents.get("proofSelection.g1")).toMatchObject({ state: "open" });
  });

  it("refuses a save from a link revoked by key rotation between the check and the commit", async () => {
    const commit = world.store.commit.getMockImplementation()!;
    world.store.commit.mockImplementationOnce(async (mutations) => {
      world.put({ ...world.documents.get("proofTerms.g1")!, selectionKeyHash: other.hash });
      return commit(mutations);
    });
    expect(await run({ operation: "select", expectedRevision: null, references: ["001"] })).toEqual({ outcome: "unavailable" });
    expect(world.documents.has("proofSelection.g1")).toBe(false);
  });

  it("fails a save when publication pauses the gallery between the gallery and terms reads", async () => {
    const read = world.store.read.getMockImplementation()!;
    let published = false;
    world.store.read.mockImplementation(async (id: string) => {
      if (id === "proofTerms.g1" && !published) {
        published = true;
        world.put({ ...world.documents.get("g1")!, available: false });
        world.put({ ...world.documents.get("proofTerms.g1")!, galleryPublishedAt: "2026-10-23T10:00:00.000Z" });
      }
      return read(id);
    });
    expect(await run({ operation: "select", expectedRevision: null, references: ["001"] })).toEqual({ outcome: "failed", reason: "store-unavailable" });
    expect(world.store.commit).not.toHaveBeenCalled();
    expect(world.documents.has("proofSelection.g1")).toBe(false);
  });

  it("fails a confirmation when publication removes a proof between the gallery and terms reads", async () => {
    const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
    if (saved.outcome !== "ok") throw new Error(saved.outcome);
    const selection = structuredClone(world.documents.get("proofSelection.g1"));
    world.store.commit.mockClear();
    const read = world.store.read.getMockImplementation()!;
    let published = false;
    world.store.read.mockImplementation(async (id: string) => {
      if (id === "proofTerms.g1" && !published) {
        published = true;
        world.put({ ...world.documents.get("g1")!, items: [item("b", "2", "002"), item("c", "3", "003")] });
        world.put({ ...world.documents.get("proofTerms.g1")!, galleryPublishedAt: "2026-10-23T10:00:00.000Z" });
      }
      return read(id);
    });
    expect(await run({ operation: "confirm", expectedRevision: saved.selection.revision })).toEqual({ outcome: "failed", reason: "store-unavailable" });
    expect(world.store.commit).not.toHaveBeenCalled();
    expect(world.documents.has("proofSelection.g1.v1")).toBe(false);
    expect(world.documents.has("proofNotice.g1.v1")).toBe(false);
    expect(world.documents.get("proofSelection.g1")).toEqual(selection);
  });

  it("refuses a save when a publication pauses the gallery between authorization and commit", async () => {
    const commit = world.store.commit.getMockImplementation()!;
    world.store.commit.mockImplementationOnce(async (mutations) => {
      world.put({ ...world.documents.get("g1")!, available: false });
      world.put({ ...world.documents.get("proofTerms.g1")!, galleryPublishedAt: "2026-10-23T10:00:00.000Z" });
      return commit(mutations);
    });
    expect(await run({ operation: "select", expectedRevision: null, references: ["001"] })).toEqual({ outcome: "unavailable" });
    expect(world.documents.has("proofSelection.g1")).toBe(false);
    expect(world.documents.get("proofTerms.g1")).not.toHaveProperty("lastSelectedAt");
  });

  it("rolls back a confirmation when a publication removes a selected proof between authorization and commit", async () => {
    const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
    if (saved.outcome !== "ok") throw new Error(saved.outcome);
    const selection = structuredClone(world.documents.get("proofSelection.g1"));
    const commit = world.store.commit.getMockImplementation()!;
    world.store.commit.mockImplementationOnce(async (mutations) => {
      world.put({ ...world.documents.get("g1")!, items: [item("b", "2", "002"), item("c", "3", "003")] });
      world.put({ ...world.documents.get("proofTerms.g1")!, galleryPublishedAt: "2026-10-23T10:00:00.000Z" });
      return commit(mutations);
    });
    expect(await run({ operation: "confirm", expectedRevision: saved.selection.revision })).toMatchObject({
      outcome: "rejected", reason: "conflict", selection: { state: "open", references: [], stale: true },
    });
    expect(world.documents.has("proofSelection.g1.v1")).toBe(false);
    expect(world.documents.has("proofNotice.g1.v1")).toBe(false);
    expect(world.documents.get("proofSelection.g1")).toEqual(selection);
    expect(world.documents.get("proofTerms.g1")).not.toHaveProperty("lastConfirmedAt");
  });

  it("reports a committed write whose result could not be read back, never a retryable failure", async () => {
    const read = world.store.read.getMockImplementation()!, commit = world.store.commit.getMockImplementation()!;
    let committed = false;
    world.store.commit.mockImplementationOnce(async (mutations) => { await commit(mutations); committed = true; });
    world.store.read.mockImplementation(async (id: string) => {
      if (committed && id === "proofSelection.g1") throw new ProofSelectionStoreError("unavailable");
      return read(id);
    });
    expect(await run({ operation: "select", expectedRevision: null, references: ["001"] })).toEqual({ outcome: "committed", written: "selected" });
    expect(world.documents.get("proofSelection.g1")).toMatchObject({ items: [{ reference: "001" }] });
  });

  it("rolls back a confirmation whose notice already exists", async () => {
    const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
    if (saved.outcome !== "ok") throw new Error(saved.outcome);
    world.put({ _id: "proofNotice.g1.v1", _type: "clientProofNotice", galleryId: "g1", version: 1, state: "pending" });
    expect(await run({ operation: "confirm", expectedRevision: saved.selection.revision })).toMatchObject({ outcome: "rejected", reason: "conflict", selection: { state: "open" } });
    expect(world.documents.has("proofSelection.g1.v1")).toBe(false);
  });

  it("reports an unknown outcome when the transaction answer is lost, and a later read shows what happened", async () => {
    const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
    if (saved.outcome !== "ok") throw new Error(saved.outcome);
    const commit = world.store.commit.getMockImplementation()!;
    world.store.commit.mockImplementationOnce(async (mutations) => { await commit(mutations); throw new ProofSelectionStoreError("unknown"); });
    expect(await run({ operation: "confirm", expectedRevision: saved.selection.revision })).toEqual({ outcome: "unknown" });
    expect(await run({ operation: "read" })).toMatchObject({ outcome: "ok", selection: { state: "confirmed", version: 1 } });
  });

  it("refuses to plan past the deadline crossed during the reads", async () => {
    world.put({ ...world.documents.get("g1")!, availabilityMode: "until", expiryInstant: "2026-10-23T10:00:01.000Z" });
    let clock = Date.parse("2026-10-23T10:00:00Z");
    const now = () => { const value = clock; clock += 1000; return value; };
    expect(await run({ operation: "select", expectedRevision: null, references: ["001"] }, { now })).toEqual({ outcome: "unavailable" });
    expect(world.store.commit).not.toHaveBeenCalled();
  });

  it("treats missing or malformed private records as a data failure, never as defaults", async () => {
    world.documents.delete("proofTerms.g1");
    expect(await run({ operation: "read" })).toEqual({ outcome: "failed", reason: "malformed-record" });
    world = lake(); world.put({ ...world.documents.get("proofTerms.g1")!, currency: "XYZ" });
    expect(await run({ operation: "read" })).toEqual({ outcome: "failed", reason: "malformed-record" });
  });

  it("answers the gallery allowance after the key matched", async () => {
    allowed.mockReturnValue(false);
    expect(await run({ operation: "read" })).toEqual({ outcome: "rate-limited" });
  });

  it("keeps each harness key's synthetic selection apart and refuses the reserved key prefix", async () => {
    const first = createSelectionKey().key, second = createSelectionKey().key, handle7 = "7".repeat(32);
    const saved = await runFixtureProofSelection({ operation: "select", handle: handle7, key: first, expectedRevision: null, references: ["014"] });
    expect(saved).toMatchObject({ outcome: "ok", selection: { references: ["014"], currency: "EUR" } });
    expect(await runFixtureProofSelection({ operation: "read", handle: handle7, key: second })).toMatchObject({ outcome: "ok", selection: { references: [] } });
    expect(await runFixtureProofSelection({ operation: "read", handle: handle7, key: `AAAA${first.slice(4)}` })).toEqual({ outcome: "unavailable" });
  });

  describe("the photographer's notice (decision 6)", () => {
    async function confirmOne(extra: Partial<ProofSelectionDependencies> = {}) {
      const saved = await run({ operation: "select", expectedRevision: null, references: ["001", "003"] });
      if (saved.outcome !== "ok") throw new Error(saved.outcome);
      return run({ operation: "confirm", expectedRevision: saved.selection.revision }, extra);
    }

    it("sends one deterministic email from the version after the commit and records it sent", async () => {
      expect(await confirmOne()).toMatchObject({ outcome: "ok", written: "confirmed" });
      expect(sendNotice).toHaveBeenCalledTimes(1);
      const [email, key] = sendNotice.mock.calls[0];
      expect(key).toBe("proof-notice/g1/v1");
      expect(email.subject).toContain("J"); expect(email.text).toContain("001 — a.jpg"); expect(email.text).toContain("003 — c.jpg");
      expect(email.text).not.toContain(hash);
      expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "sent", attemptedAt: "2026-10-23T10:00:00.000Z" });
    });

    it("records a failed send without changing the confirmation, and never marks a refused idempotent repeat sent", async () => {
      sendNotice.mockResolvedValue({ status: "failed", errorClass: "provider-unavailable", retryable: true });
      expect(await confirmOne()).toMatchObject({ outcome: "ok", selection: { state: "confirmed" } });
      expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "failed", errorClass: "provider-unavailable" });
    });

    it("leaves the notice pending when the provider accepted but recording failed, and sends no second email", async () => {
      const commit = world.store.commit.getMockImplementation()!;
      let confirmed = false;
      world.store.commit.mockImplementation(async (mutations) => {
        const patch = (mutations[0] as { patch?: { id: string } }).patch;
        if (confirmed && patch?.id === "proofNotice.g1.v1") throw new ProofSelectionStoreError("unknown");
        await commit(mutations);
        if ((mutations[0] as { create?: { _id: string } }).create?._id === "proofSelection.g1.v1") confirmed = true;
      });
      expect(await confirmOne()).toMatchObject({ outcome: "ok", selection: { state: "confirmed" } });
      expect(sendNotice).toHaveBeenCalledTimes(1);
      expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "pending" });
    });

    it("still notifies when a committed confirmation cannot be read back", async () => {
      const read = world.store.read.getMockImplementation()!;
      world.store.read.mockImplementation(async (id: string) => {
        if (id === "proofSelection.g1" && world.documents.get("proofSelection.g1")?.state === "confirmed") throw new ProofSelectionStoreError("unavailable");
        return read(id);
      });
      expect(await confirmOne()).toEqual({ outcome: "committed", written: "confirmed" });
      expect(sendNotice).toHaveBeenCalledTimes(1);
      expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "sent" });
    });

    it("sends nothing when the confirmation's outcome is unknown, or for a save", async () => {
      const commit = world.store.commit.getMockImplementation()!;
      const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
      if (saved.outcome !== "ok") throw new Error(saved.outcome);
      world.store.commit.mockImplementationOnce(async (mutations) => { await commit(mutations); throw new ProofSelectionStoreError("unknown"); });
      expect(await run({ operation: "confirm", expectedRevision: saved.selection.revision })).toEqual({ outcome: "unknown" });
      expect(sendNotice).not.toHaveBeenCalled();
      expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "pending" });
    });

    it("keeps a missing mail configuration from touching the customer's answer", async () => {
      // Arrange the missing configuration explicitly: the ambient environment must never decide, or send real mail.
      for (const name of ["CONTACT_DELIVERY_ADAPTER", "CONTACT_DELIVERY_TO", "CONTACT_DELIVERY_FROM", "RESEND_API_KEY"]) vi.stubEnv(name, "");
      const result = await confirmOne({ sendNotice: undefined });
      expect(result).toMatchObject({ outcome: "ok", selection: { state: "confirmed" } });
      expect(world.documents.get("proofNotice.g1.v1")).toMatchObject({ state: "pending" });
    });
  });

  it("lets a reopened selection be changed and confirmed as the next version, keeping the earlier one (decision 5)", async () => {
    const saved = await run({ operation: "select", expectedRevision: null, references: ["001"] });
    if (saved.outcome !== "ok") throw new Error(saved.outcome);
    await run({ operation: "confirm", expectedRevision: saved.selection.revision });
    // The Studio reopen action: one patch guarded by the reviewed revision.
    const selection = world.documents.get("proofSelection.g1")!;
    await world.store.commit([{ patch: { id: "proofSelection.g1", ifRevisionID: selection._rev, set: { state: "open" } } }]);
    const reopened = await run({ operation: "read" });
    expect(reopened).toMatchObject({ outcome: "ok", selection: { state: "open", references: ["001"] } });
    const changed = await run({ operation: "select", expectedRevision: (reopened as { selection: { revision: string } }).selection.revision, references: ["001", "002"] });
    if (changed.outcome !== "ok") throw new Error(changed.outcome);
    expect(await run({ operation: "confirm", expectedRevision: changed.selection.revision })).toMatchObject({ outcome: "ok", selection: { state: "confirmed", version: 2, references: ["001", "002"] } });
    expect(world.documents.get("proofSelection.g1.v1")).toMatchObject({ totals: { selected: 1 } });
    expect(world.documents.get("proofNotice.g1.v1")).toBeDefined(); expect(world.documents.get("proofNotice.g1.v2")).toBeDefined();
  });
});
