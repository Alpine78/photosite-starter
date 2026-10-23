import { describe, expect, it } from "vitest";
import {
  customerSelection, parseConfirmedVersion, parseSelectionGallery, parseSelectionTerms, parseWorkingSelection, planConfirm, planSelect,
  ProofSelectionDataError, selectionGalleryOpen, type ConfirmedVersion,
} from "@/lib/proof-selection";

const handle = "c".repeat(32);
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const item = (key: string, n: string, reference: string, filename = `${key}.jpg`) => ({
  _key: key, _type: "clientProofItem", mediaType: "image", originalFilename: filename, reference,
  image: { _type: "image", asset: { _type: "reference", _ref: asset(n) } },
});
function galleryDocument(extra: Record<string, unknown> = {}) {
  return { _id: "g1", _type: "clientProofGallery", _rev: "grev", handle, available: true, availabilityMode: "indefinite", referenceHighWater: 1000,
    items: [item("k999", "1", "999"), item("k1000", "2", "1000"), item("k2", "3", "002")], ...extra };
}
function termsDocument(extra: Record<string, unknown> = {}) {
  return { _id: "proofTerms.g1", _type: "clientProofTerms", _rev: "trev", galleryId: "g1", includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR",
    jobReference: "Job 7", reminderDelayDays: 7, customerEmail: "customer@example.com", selectionKeyHash: "a".repeat(64), ...extra };
}
function selectionDocument(extra: Record<string, unknown> = {}) {
  return { _id: "proofSelection.g1", _type: "clientProofSelection", _rev: "srev", galleryId: "g1", state: "open",
    items: [{ _key: "k1000", reference: "1000" }, { _key: "k999", reference: "999" }], latestVersion: 0, ...extra };
}
const gallery = parseSelectionGallery(galleryDocument(), "g1", handle);
const terms = parseSelectionTerms(termsDocument(), "g1");
const now = "2026-10-23T10:00:00.000Z";

describe("stored record validation", () => {
  it("reads the published gallery with numbers and filenames, and its availability", () => {
    expect(gallery.items.map((entry) => [entry.key, entry.reference, entry.originalFilename])).toEqual([["k999", "999", "k999.jpg"], ["k1000", "1000", "k1000.jpg"], ["k2", "002", "k2.jpg"]]);
    const finite = parseSelectionGallery(galleryDocument({ availabilityMode: "until", expiryInstant: "2026-11-01T00:00:00.000Z" }), "g1", handle);
    expect(selectionGalleryOpen(finite, Date.parse("2026-11-01T00:00:00.000Z") - 1)).toBe(true);
    expect(selectionGalleryOpen(finite, Date.parse("2026-11-01T00:00:00.000Z"))).toBe(false);
    expect(selectionGalleryOpen(parseSelectionGallery(galleryDocument({ available: false }), "g1", handle), 0)).toBe(false);
  });

  it.each([
    ["an unnumbered gallery", () => parseSelectionGallery(galleryDocument({ items: [{ ...item("k1", "1", "001"), reference: undefined }] }), "g1", handle)],
    ["another handle", () => parseSelectionGallery(galleryDocument(), "g1", "d".repeat(32))],
    ["terms of another gallery", () => parseSelectionTerms(termsDocument({ galleryId: "g2" }), "g1")],
    ["terms without a key hash", () => parseSelectionTerms(termsDocument({ selectionKeyHash: "short" }), "g1")],
    ["terms with an unknown currency", () => parseSelectionTerms(termsDocument({ currency: "XYZ" }), "g1")],
    ["terms with a fractional price", () => parseSelectionTerms(termsDocument({ extraUnitPriceMinor: 12.5 }), "g1")],
    ["a selection of another type", () => parseWorkingSelection(selectionDocument({ _type: "other" }), "g1")],
    ["a selection repeating a number", () => parseWorkingSelection(selectionDocument({ items: [{ _key: "a", reference: "001" }, { _key: "b", reference: "001" }] }), "g1")],
    ["a confirmed selection without a version", () => parseWorkingSelection(selectionDocument({ state: "confirmed", latestVersion: 0 }), "g1")],
    ["an unknown state", () => parseWorkingSelection(selectionDocument({ state: "reopened" }), "g1")],
  ])("refuses %s as a data failure, never a default", (_name, run) => {
    expect(run).toThrow(ProofSelectionDataError);
  });

  it("treats a missing working selection as none saved yet", () => {
    expect(parseWorkingSelection(null, "g1")).toBeUndefined();
  });
});

describe("the customer's view", () => {
  it("orders references numerically and computes integer totals, without job or contact data", () => {
    const view = customerSelection(gallery, terms, parseWorkingSelection(selectionDocument(), "g1"));
    expect(view).toEqual({ state: "open", revision: "srev", references: ["999", "1000"], stale: false, includedCount: 1, extraUnitPriceMinor: 1250,
      currency: "EUR", selectedCount: 2, extraCount: 1, extraTotalMinor: 1250 });
    expect(JSON.stringify(view)).not.toMatch(/Job 7|customer@|a{64}/u);
    expect(customerSelection(gallery, terms, undefined)).toMatchObject({ revision: null, references: [], selectedCount: 0, extraTotalMinor: 0 });
  });

  it("flags saved proofs that left the gallery or changed number, instead of hiding the difference", () => {
    const selection = parseWorkingSelection(selectionDocument({ items: [{ _key: "gone", reference: "005" }, { _key: "k2", reference: "003" }, { _key: "k999", reference: "999" }] }), "g1");
    expect(customerSelection(gallery, terms, selection)).toMatchObject({ references: ["999"], stale: true, selectedCount: 1 });
  });

  it("shows a confirmation exactly as recorded, whatever the gallery became", () => {
    const confirmed: ConfirmedVersion = { version: 2, confirmedAt: now, includedCount: 5, extraUnitPriceMinor: 900, currency: "SEK", selectedCount: 2, extraCount: 0, extraTotalMinor: 0, references: ["1000", "005"] };
    const selection = parseWorkingSelection(selectionDocument({ state: "confirmed", latestVersion: 2 }), "g1");
    expect(customerSelection(gallery, terms, selection, confirmed)).toMatchObject({ state: "confirmed", version: 2, references: ["005", "1000"], currency: "SEK", includedCount: 5 });
    expect(() => customerSelection(gallery, terms, selection, { ...confirmed, version: 1 })).toThrow(ProofSelectionDataError);
  });
});

describe("saving the selected set", () => {
  it("creates the working selection only when none exists, keyed by the gallery's own identities", () => {
    const plan = planSelect(gallery, terms, undefined, null, ["1000", "002"], now);
    expect(plan).toEqual({ kind: "ready", mutations: [
      { create: { _id: "proofSelection.g1", _type: "clientProofSelection", galleryId: "g1", state: "open",
        items: [{ _key: "k2", reference: "002" }, { _key: "k1000", reference: "1000" }], latestVersion: 0 } },
      // A link revoked by key rotation in the meantime cannot save.
      { patch: { id: "proofTerms.g1", ifRevisionID: "trev", set: { lastSelectedAt: now } } },
    ] });
  });

  it("patches under the revision just read, and saves an empty set", () => {
    const selection = parseWorkingSelection(selectionDocument(), "g1");
    expect(planSelect(gallery, terms, selection, "srev", [], now)).toEqual({ kind: "ready", mutations: [
      { patch: { id: "proofSelection.g1", ifRevisionID: "srev", set: { items: [] } } },
      { patch: { id: "proofTerms.g1", ifRevisionID: "trev", set: { lastSelectedAt: now } } },
    ] });
  });

  it.each([
    ["an old revision", parseWorkingSelection(selectionDocument(), "g1"), "old", ["999"], "conflict"],
    ["a create when one exists", parseWorkingSelection(selectionDocument(), "g1"), null, ["999"], "conflict"],
    ["a confirmed selection", parseWorkingSelection(selectionDocument({ state: "confirmed", latestVersion: 1 }), "g1"), "srev", ["999"], "confirmed"],
    ["a number not in the gallery", undefined, null, ["003"], "unknown-reference"],
  ] as const)("refuses %s", (_name, selection, revision, references, reason) => {
    expect(planSelect(gallery, terms, selection, revision, references, now)).toEqual({ kind: "rejected", reason });
  });
});

describe("confirming", () => {
  const selection = parseWorkingSelection(selectionDocument({ latestVersion: 1 }), "g1")!;

  it("creates the next immutable version and its pending notice, guarded by the selection and the terms", () => {
    const plan = planConfirm(gallery, terms, selection, "srev", now);
    if (plan.kind !== "ready") throw new Error(plan.reason);
    expect(plan.version).toBe(2);
    const [version, notice, patch, termsGuard] = plan.mutations as Record<string, Record<string, unknown>>[];
    expect(version.create).toEqual({
      _id: "proofSelection.g1.v2", _type: "clientProofSelectionVersion", galleryId: "g1", version: 2, confirmedAt: now, galleryRevision: "grev",
      terms: { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR", jobReference: "Job 7" },
      totals: { selected: 2, extra: 1, extraTotalMinor: 1250 },
      items: [{ _key: "k999", reference: "999", originalFilename: "k999.jpg" }, { _key: "k1000", reference: "1000", originalFilename: "k1000.jpg" }],
    });
    expect(notice.create).toEqual({ _id: "proofNotice.g1.v2", _type: "clientProofNotice", galleryId: "g1", version: 2, state: "pending", createdAt: now,
      selection: { _type: "reference", _ref: "proofSelection.g1.v2", _weak: true } });
    expect(patch.patch).toEqual({ id: "proofSelection.g1", ifRevisionID: "srev", set: { state: "confirmed", latestVersion: 2 } });
    expect(termsGuard.patch).toEqual({ id: "proofTerms.g1", ifRevisionID: "trev", set: { lastConfirmedAt: now } });
    expect(JSON.stringify(plan.mutations)).not.toContain("customer@example.com");
    // The recorded version parses back as it will be shown.
    expect(parseConfirmedVersion({ ...version.create, _rev: "vrev" }, "g1", 2)).toMatchObject({ selectedCount: 2, extraTotalMinor: 1250, references: ["999", "1000"] });
  });

  it.each([
    ["no saved selection", undefined, "srev", "conflict"],
    ["an old revision", selection, "old", "conflict"],
    ["a confirmed selection", parseWorkingSelection(selectionDocument({ state: "confirmed", latestVersion: 1 }), "g1"), "srev", "confirmed"],
    ["an empty selection", parseWorkingSelection(selectionDocument({ items: [] }), "g1"), "srev", "empty"],
    ["a stale selection", parseWorkingSelection(selectionDocument({ items: [{ _key: "gone", reference: "005" }] }), "g1"), "srev", "stale-selection"],
  ] as const)("refuses %s", (_name, current, revision, reason) => {
    expect(planConfirm(gallery, terms, current, revision, now)).toEqual({ kind: "rejected", reason });
  });

  it("refuses a recorded version whose totals do not add up", () => {
    const plan = planConfirm(gallery, terms, selection, "srev", now);
    if (plan.kind !== "ready") throw new Error(plan.reason);
    const version = (plan.mutations[0] as { create: Record<string, unknown> }).create;
    expect(() => parseConfirmedVersion({ ...version, totals: { selected: 2, extra: 1, extraTotalMinor: 1 } }, "g1", 2)).toThrow(ProofSelectionDataError);
  });
});
