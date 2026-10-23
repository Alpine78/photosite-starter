import { describe, expect, it } from "vitest";
import { planProofPublication, relatedQueryInput, type PlanInput, type PublicationRead } from "@/lib/proof-publication";
import { decryptSelectionKey, selectionKeyHash } from "@/lib/proof-selection-key";

const secret = Buffer.alloc(32, 9);
const now = "2026-10-22T12:00:00.000Z";
const handle = "c".repeat(32);
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const item = (key: string, filename: string, n: string, reference?: string) => ({
  _key: key, _type: "clientProofItem", mediaType: "image", originalFilename: filename,
  image: { _type: "image", asset: { _type: "reference", _ref: asset(n) } }, ...(reference ? { reference } : {}),
});
const gallery = (id: string, items: unknown[], extra: Record<string, unknown> = {}) => ({
  _id: id, _type: "clientProofGallery", _rev: id.startsWith("drafts.") ? "draftrev" : "pubrev", handle,
  available: false, availabilityMode: "indefinite", items, ...extra,
});
const assets = (...ns: string[]) => ns.map((n) => ({ _id: asset(n), _type: "sanity.imageAsset", extension: "webp", mimeType: "image/webp", sha1hash: n.repeat(40), width: 1600, height: 1000, restricted: false }));
const terms = { _id: "proofTerms.g1", _rev: "termsrev", _type: "clientProofTerms", galleryId: "g1" };
const entered = { includedCount: 10, extraUnitPriceMinor: 1500, currency: "EUR", jobReference: "job-1", reminder: { delayDays: 7, customerEmail: "asiakas@example.fi" } };
function plan(read: Partial<PublicationRead>, overrides: Partial<PlanInput> = {}) {
  const full: PublicationRead = { draft: null, published: null, terms: null, versions: 0, ...read };
  // By default every asset the draft references exists and is valid.
  const letters = [...new Set(((full.draft as { items?: { image: { asset: { _ref: string } } }[] } | null)?.items ?? [])
    .map((entry) => entry.image.asset._ref.slice(6, 7)))];
  // A first publication carries the entered terms; a later one carries none.
  const defaults = { expectedDraftRevision: "draftrev", ...(full.published === null ? { terms: entered } : {}) };
  return planProofPublication({ galleryId: "g1", operation: "publish", read: full, related: { conflicts: [], assets: assets(...letters) }, now, secret, ...defaults, ...overrides });
}

describe("proof publication planning (ADR-0038, AB#130)", () => {
  it("numbers a first publication in natural order, creates the private record and removes the draft atomically", () => {
    const result = plan({ draft: gallery("drafts.g1", [item("k1", "IMG_10.jpg", "a"), item("k2", "IMG_9.jpg", "b")], { title: [{ _key: "fi", _type: "localizedText", language: "fi", value: "Vedokset" }] }) });
    if (result.kind !== "ready") throw new Error(result.reason);
    expect(result.firstPublication).toBe(true);
    const [guard, createGallery, createTerms, remove] = result.mutations as Record<string, Record<string, unknown>>[];
    expect(guard).toEqual({ patch: { id: "drafts.g1", ifRevisionID: "draftrev", set: { referenceHighWater: 2 } } });
    expect(createGallery.create).toMatchObject({ _id: "g1", _type: "clientProofGallery", handle, referenceHighWater: 2, title: expect.any(Array) });
    expect((createGallery.create as { items: { _key: string; reference: string }[] }).items.map((entry) => [entry._key, entry.reference])).toEqual([["k1", "002"], ["k2", "001"]]);
    expect(createGallery.create).not.toHaveProperty("_rev");
    const record = createTerms.create as Record<string, unknown>;
    expect(record).toMatchObject({ _id: "proofTerms.g1", _type: "clientProofTerms", galleryId: "g1", firstPublishedAt: now, keyIssuedAt: now,
      includedCount: 10, extraUnitPriceMinor: 1500, currency: "EUR", jobReference: "job-1", reminderDelayDays: 7, customerEmail: "asiakas@example.fi" });
    expect(record.selectionKeyHash).toBe(selectionKeyHash(result.selectionKey!));
    expect(decryptSelectionKey(record.selectionKeyCiphertext, "g1", secret)).toBe(result.selectionKey);
    expect(JSON.stringify(result.mutations)).not.toContain(result.selectionKey!);
    expect(remove).toEqual({ delete: { id: "drafts.g1" } });
  });

  it("keeps published numbers, appends additions, clears removed optional fields and leaves the key alone", () => {
    const published = gallery("g1", [item("k1", "IMG_10.jpg", "a", "002"), item("k2", "IMG_9.jpg", "b", "001")], { referenceHighWater: 2, title: [{ _key: "fi", _type: "localizedText", language: "fi", value: "Vanha" }], replacedBy: { _type: "reference", _ref: "delivery1", _weak: true } });
    const draft = gallery("drafts.g1", [item("k1", "IMG_10.jpg", "a", "002"), item("k3", "IMG_1.jpg", "b")], { referenceHighWater: 2 });
    const result = plan({ draft, published, terms });
    if (result.kind !== "ready") throw new Error(result.reason);
    expect(result.firstPublication).toBe(false);
    expect(result.selectionKey).toBeUndefined();
    const patch = (result.mutations[1] as { patch: { id: string; ifRevisionID: string; set: { items: { _key: string; reference: string }[]; referenceHighWater: number }; unset: string[] } }).patch;
    expect(patch.id).toBe("g1");
    expect(patch.ifRevisionID).toBe("pubrev");
    expect(patch.set.items.map((entry) => [entry._key, entry.reference])).toEqual([["k1", "002"], ["k3", "003"]]);
    expect(patch.set.referenceHighWater).toBe(3);
    // Clearing the replacement link really removes it, so the proofs show again (owner answer 5).
    expect(patch.unset).toEqual(["title", "replacedBy"]);
    expect(patch.set).not.toHaveProperty("_type");
    expect(patch.set).not.toHaveProperty("_id");
    expect(JSON.stringify(result.mutations)).not.toContain("proofTerms");
  });

  it("rotates the key on the private record, requiring publish permission through a guarded gallery write", () => {
    const published = gallery("g1", [item("k1", "IMG_1.jpg", "a", "001")], { referenceHighWater: 1 });
    const result = plan({ published, terms }, { operation: "rotate-key", related: undefined });
    if (result.kind !== "ready") throw new Error(result.reason);
    expect(result.mutations).toHaveLength(2);
    expect(result.mutations[0]).toEqual({ patch: { id: "g1", ifRevisionID: "pubrev", set: { referenceHighWater: 1 } } });
    const patch = (result.mutations[1] as { patch: { id: string; ifRevisionID: string; set: Record<string, unknown> } }).patch;
    expect(patch).toMatchObject({ id: "proofTerms.g1", ifRevisionID: "termsrev" });
    expect(patch.set.keyIssuedAt).toBe(now);
    expect(patch.set).not.toHaveProperty("firstPublishedAt");
    expect(decryptSelectionKey(patch.set.selectionKeyCiphertext, "g1", secret)).toBe(result.selectionKey);
    expect(plan({ published }, { operation: "rotate-key", related: undefined })).toEqual({ kind: "rejected", reason: "not-found" });
  });

  it.each([
    ["a missing draft", {}, "not-found"],
    ["a release version", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]), versions: 1 }, "unsupported-release"],
    ["a non-numeric version count", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]), versions: "1" }, "invalid-gallery"],
    ["an unknown draft field", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")], { price: 10 }) }, "invalid-gallery"],
    ["a private record without a published gallery", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]), terms }, "inconsistent"],
    ["a published gallery without its private record", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a", "001")]), published: gallery("g1", [item("k1", "IMG_1.jpg", "a", "001")], { referenceHighWater: 1 }) }, "inconsistent"],
    ["a changed handle", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a", "001")], { handle: "d".repeat(32) }), published: gallery("g1", [item("k1", "IMG_1.jpg", "a", "001")], { referenceHighWater: 1 }), terms }, "invalid-gallery"],
    ["a published gallery with repeated numbers", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]), published: gallery("g1", [item("k1", "IMG_1.jpg", "a", "001"), item("k2", "IMG_2.jpg", "b", "001")], { referenceHighWater: 2 }), terms }, "inconsistent"],
    ["a published number above the high-water mark", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]), published: gallery("g1", [item("k1", "IMG_1.jpg", "a", "002")], { referenceHighWater: 1 }), terms }, "inconsistent"],
    ["a replaced image under a published number", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "b", "001")]), published: gallery("g1", [item("k1", "IMG_1.jpg", "a", "001")], { referenceHighWater: 1 }), terms }, "invalid-references"],
  ])("refuses %s", (_name, read, reason) => {
    expect(plan(read as Partial<PublicationRead>)).toEqual({ kind: "rejected", reason });
  });

  it("publishes only the reviewed draft and snapshots terms exactly once", () => {
    const draft = gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]);
    expect(plan({ draft }, { expectedDraftRevision: "older" })).toEqual({ kind: "rejected", reason: "stale-draft" });
    expect(plan({ draft }, { expectedDraftRevision: undefined })).toEqual({ kind: "rejected", reason: "stale-draft" });
    expect(plan({ draft }, { terms: undefined })).toEqual({ kind: "rejected", reason: "terms-required" });
    const published = gallery("g1", [item("k1", "IMG_1.jpg", "a", "001")], { referenceHighWater: 1 });
    expect(plan({ draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a", "001")]), published, terms }, { terms: entered })).toEqual({ kind: "rejected", reason: "terms-not-allowed" });
    const noReminder = plan({ draft }, { terms: { ...entered, reminder: null } });
    if (noReminder.kind !== "ready") throw new Error(noReminder.reason);
    const record = (noReminder.mutations[2] as { create: Record<string, unknown> }).create;
    expect(record.reminderDelayDays).toBeNull();
    expect(record).not.toHaveProperty("customerEmail");
  });

  it("refuses a handle conflict and private-only, mismatched or missing assets", () => {
    const draft = gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a")]);
    expect(plan({ draft }, { related: { conflicts: [{ _id: "other" }], assets: assets("a") } })).toEqual({ kind: "rejected", reason: "invalid-gallery" });
    expect(plan({ draft }, { related: { conflicts: [], assets: [{ ...assets("a")[0], restricted: true }] } })).toEqual({ kind: "rejected", reason: "invalid-gallery" });
    expect(plan({ draft }, { related: { conflicts: [], assets: [{ ...assets("a")[0], width: 1599 }] } })).toEqual({ kind: "rejected", reason: "invalid-gallery" });
    expect(plan({ draft }, { related: { conflicts: [], assets: [] } })).toEqual({ kind: "rejected", reason: "invalid-gallery" });
    expect(plan({ draft }, { related: undefined })).toEqual({ kind: "rejected", reason: "invalid-gallery" });
  });

  it("names the related reads only for a parseable draft", () => {
    expect(relatedQueryInput("g1", { draft: gallery("drafts.g1", [item("k1", "IMG_1.jpg", "a"), item("k2", "IMG_2.jpg", "a")]), published: null, terms: null, versions: 0 }))
      .toEqual({ handle, assetIds: [asset("a")] });
    expect(relatedQueryInput("g1", { draft: { _id: "drafts.g1" }, published: null, terms: null, versions: 0 })).toBeUndefined();
  });

  it("publishes a replacement link as written and refuses any other reference shape", () => {
    const reference = { _type: "reference", _ref: "delivery1", _weak: true };
    const published = gallery("g1", [item("k1", "IMG_10.jpg", "a", "001")], { referenceHighWater: 1 });
    const ok = plan({ draft: gallery("drafts.g1", [item("k1", "IMG_10.jpg", "a", "001")], { referenceHighWater: 1, replacedBy: reference }), published, terms });
    if (ok.kind !== "ready") throw new Error(ok.reason);
    expect((ok.mutations[1] as { patch: { set: Record<string, unknown> } }).patch.set.replacedBy).toEqual(reference);
    for (const bad of [{ ...reference, _weak: false }, { ...reference, _strengthenOnPublish: { type: "clientDeliveryGallery", weak: true } }, { ...reference, _ref: "drafts.delivery1" }]) {
      const result = plan({ draft: gallery("drafts.g1", [item("k1", "IMG_10.jpg", "a", "001")], { referenceHighWater: 1, replacedBy: bad }), published, terms });
      expect(result.kind).toBe("rejected");
    }
  });
});
