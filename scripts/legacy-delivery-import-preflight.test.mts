import { describe, expect, it } from "vitest";
import { buildLegacyImportPlan } from "./legacy-delivery-import-plan.mts";
import { buildLegacyDocumentPlan } from "./legacy-delivery-document-plan.mts";
import { buildLegacyImportPreflight, MAX_BASELINE_AGE_MS, MAX_BASELINE_DOCUMENTS } from "./legacy-delivery-import-preflight.mts";

const now = Date.parse("2026-10-11T14:00:00.000Z"), handle = "a".repeat(32);
function fixture() {
  const source = { version: 1, target: { projectId: "synthetic-project", dataset: "production" },
    sourceEvidence: { backupSha256: "a".repeat(64), availabilitySha256: "b".repeat(64), orderingSha256: "c".repeat(64), inventorySha256: "d".repeat(64) },
    excludedLegacyIds: [], galleries: [{ legacyId: 1, handle, legacyPath: "/clients/synthetic",
      availability: { mode: "indefinite" }, zip: null,
      images: [{ sourceLocator: "images/synthetic.jpg", sha1: "1".repeat(40), sha256: "2".repeat(64), bytes: 500,
        width: 3000, height: 2000, orientation: 1, alt: "Whole frame" }] }] };
  const reviewDigest = buildLegacyImportPlan(source, now).reviewDigest;
  const bindings = { version: 1, target: { ...source.target }, reviewDigest, assets: [{
    sourceSha256: "2".repeat(64), assetId: `image-${"1".repeat(40)}-3000x2000-jpg`, sha1: "1".repeat(40), bytes: 500,
    mimeType: "image/jpeg", width: 3000, height: 2000, orientation: 1 }] };
  const baseline = { version: 1, target: { ...source.target }, perspective: "raw", capturedAt: new Date(now).toISOString(),
    expectedDocumentCount: 1, documents: [row()] };
  return { source, bindings, baseline, reviewDigest };
}
function row(_id = "_system.unrelated") {
  return { _id, _type: "unknown-type", _rev: "synthetic-revision", migrationBatch: null as string | null,
    handle: null as string | null, galleryId: null as string | null };
}
function run(f = fixture(), clock = now) {
  return buildLegacyImportPreflight(f.source, f.reviewDigest, f.bindings, f.baseline, clock);
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}

describe("offline legacy initial-import preflight", () => {
  it("reports only declared evidence, with no mutation or publication approval", () => {
    const f = fixture(), before = structuredClone(f), p = run(f);
    expect(p).toMatchObject({ status: "offline-preflight-only", noCollisionObservedInDeclaredBaseline: true,
      counts: { baselineDocuments: 1, candidateDocuments: 2 }, collisions: [] });
    expect(p.candidateIds).toContain(`legacyDeliveryGallery-${handle}`);
    expect(p.candidateDigest).toBe(buildLegacyDocumentPlan(f.source, f.reviewDigest, f.bindings, now).candidateDigest);
    expect(p.baselineDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(p.unresolvedGates).toEqual(["authenticated-complete-current-baseline", "fresh-source-and-cdn-byte-verification",
      "asset-metadata-review", "supported-whole-zip-transfer", "provider-usage", "recovery", "notice-reconciliation",
      "owner-exact-mutation-approval", "atomic-live-collision-recheck", "fresh-availability-at-write", "publication"]);
    expect(p.limitations).toContain("reference-check-covers-only-projected-galleryId");
    for (const key of ["mutations", "documents", "approved", "validUntil", "safe"]) expect(p).not.toHaveProperty(key);
    expect(f).toEqual(before); expect(Object.isFrozen(f.baseline.documents[0])).toBe(false);
    expect(run(frozen(f))).toEqual(p);
    expect(Object.isFrozen(p.unresolvedGates)).toBe(true);
    expect(() => Object.assign(p.target, { dataset: "preview" })).toThrow(TypeError);
    expect(run().unresolvedGates).not.toBe(p.unresolvedGates);
  });
  it.each(["", "drafts.", "versions.release."])("refuses occupied candidate IDs in %s state even for foreign types", (prefix) => {
    const f = fixture(); f.baseline.documents[0]._id = prefix + `legacyDeliveryGallery-${handle}`;
    expect(run(f)).toMatchObject({ noCollisionObservedInDeclaredBaseline: false,
      collisions: [{ code: "DOCUMENT_ID_OCCUPIED", count: 1 }] });
    f.baseline.documents[0]._type = "legacyDeliveryGallery";
    expect(run(f).noCollisionObservedInDeclaredBaseline).toBe(false);
  });
  it("collects all claim categories without exposing existing identities or handles", () => {
    const f = fixture(); f.baseline.documents = [row("private-canary-document"), row("other-private-canary")];
    f.baseline.expectedDocumentCount = 2;
    Object.assign(f.baseline.documents[0], { migrationBatch: f.reviewDigest, handle: handle.toUpperCase(),
      galleryId: `versions.release.legacyDeliveryGallery-${handle}` });
    f.baseline.documents[1].galleryId = "drafts." + buildLegacyDocumentPlan(f.source, f.reviewDigest, f.bindings, now).candidateDocuments[1]._id;
    const p = run(f);
    expect(p.collisions).toEqual([{ code: "BATCH_ALREADY_PRESENT", count: 1 }, { code: "HANDLE_ALREADY_PRESENT", count: 1 },
      { code: "PROJECTED_REFERENCE_PRESENT", count: 2 }]);
    expect(JSON.stringify(p)).not.toContain("private-canary");
    expect(p.noCollisionObservedInDeclaredBaseline).toBe(false);
  });
  it("allows unrelated types, batches and prototype-like strings without changing inputs", () => {
    const f = fixture(); f.baseline.documents = [row("__proto__"), row("constructor"), row("system.release.future")];
    f.baseline.expectedDocumentCount = 3; f.baseline.documents[0].migrationBatch = "foreign";
    f.baseline.documents[1].handle = "constructor"; f.baseline.documents[2].galleryId = "drafts.unrelated";
    expect(run(f).noCollisionObservedInDeclaredBaseline).toBe(true);
  });
  it("permits a truly empty declared baseline, without treating it as proof of emptiness", () => {
    const f = fixture(); f.baseline.documents = []; f.baseline.expectedDocumentCount = 0;
    expect(run(f)).toMatchObject({ noCollisionObservedInDeclaredBaseline: true, counts: { baselineDocuments: 0 } });
  });
  it("hashes canonical raw rows, including revisions and capture time", () => {
    const f = fixture(); f.baseline.documents.push(row("other")); f.baseline.expectedDocumentCount = 2;
    const p = run(f); f.baseline.documents.reverse(); expect(run(f)).toEqual(p);
    f.baseline.documents[0]._rev = "next-revision"; expect(run(f).baselineDigest).not.toBe(p.baselineDigest);
    f.baseline.documents[0]._rev = "synthetic-revision"; f.baseline.capturedAt = new Date(now - 1).toISOString();
    expect(run(f).baselineDigest).not.toBe(p.baselineDigest);
  });
  it.each([0, MAX_BASELINE_AGE_MS - 1, MAX_BASELINE_AGE_MS])("allows baseline age %s ms", (age) => {
    const f = fixture(); f.baseline.capturedAt = new Date(now - age).toISOString(); expect(run(f).noCollisionObservedInDeclaredBaseline).toBe(true);
  });
  it.each([-1, MAX_BASELINE_AGE_MS + 1])("refuses future or stale baseline age %s ms", (age) => {
    const f = fixture(); f.baseline.capturedAt = new Date(now - age).toISOString(); expect(() => run(f)).toThrow("BASELINE_STALE_OR_FUTURE");
  });
  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1])("rejects invalid clock %s", (clock) => {
    expect(() => run(fixture(), clock)).toThrow("PREFLIGHT_CLOCK");
  });
  it.each(["2026-02-30T14:00:00.000Z", "2026-10-11T14:00:00Z", "private-canary", "2026-10-11T16:00:00.000+02:00"])("rejects noncanonical time %s", (time) => {
    const f = fixture(); f.baseline.capturedAt = time; expect(() => run(f)).toThrow("BASELINE_TIME");
  });
  it("rejects target substitution, published-only perspective, count mismatch and duplicate raw IDs", () => {
    for (const edit of [
      (f: ReturnType<typeof fixture>) => { f.baseline.target.projectId = "other"; },
      (f: ReturnType<typeof fixture>) => { f.baseline.target.dataset = "preview"; },
      (f: ReturnType<typeof fixture>) => { f.baseline.perspective = "published"; },
      (f: ReturnType<typeof fixture>) => { f.baseline.expectedDocumentCount = 2; },
      (f: ReturnType<typeof fixture>) => { f.baseline.documents.push(row()); f.baseline.expectedDocumentCount = 2; },
    ]) { const f = fixture(); edit(f); expect(() => run(f)).toThrow(); }
  });
  it.each(["drafts.", "drafts.drafts.x", "drafts.versions.r.x", "versions.r", "versions..x", "versions.r.", "versions.r.drafts.x", "versions.r.versions.x"])("rejects ambiguous variant %s", (id) => {
    const f = fixture(); f.baseline.documents[0]._id = id; expect(() => run(f)).toThrow("BASELINE_ID");
  });
  it("refuses malformed rows, fields and accessor/proxy input without executing getters", () => {
    for (const make of [
      () => null, () => [], () => ({ ...row(), extra: true }),
      () => ({ ...row(), _rev: null }), () => ({ ...row(), handle: {} }),
      () => Object.create(row()), () => new Proxy(row(), { get() { throw Error("private-canary"); } }),
      () => Object.defineProperty(row(), "_rev", { get() { throw Error("private-canary"); } }),
      () => Object.defineProperty(row(), "extra", { value: true }),
      () => Object.defineProperty(row(), Symbol("extra"), { value: true }),
    ]) {
      const f = fixture(); const value = make();
      expect(() => buildLegacyImportPreflight(f.source, f.reviewDigest, f.bindings, { ...f.baseline, documents: [value] }, now)).toThrow();
      try { buildLegacyImportPreflight(f.source, f.reviewDigest, f.bindings, { ...f.baseline, documents: [value] }, now); }
      catch (e) { expect(String(e)).not.toContain("private-canary"); }
    }
  });
  it("rejects sparse, oversized, accessor, extra-property and proxy arrays", () => {
    const sparse = [row()]; delete sparse[0];
    const accessor = Object.defineProperty([row()], "0", { get() { throw Error("private-canary"); } });
    const extra = Object.assign([row()], { extra: true });
    for (const documents of [sparse, Array(MAX_BASELINE_DOCUMENTS + 1), accessor, extra, new Proxy([row()], {})]) {
      const f = fixture(); expect(() => buildLegacyImportPreflight(f.source, f.reviewDigest, f.bindings,
        { ...f.baseline, expectedDocumentCount: documents.length, documents }, now)).toThrow("BASELINE_DOCUMENTS");
    }
  });
  it("rejects open or effectful root/target boundaries and supports ordinary dataset size", () => {
    const f = fixture();
    for (const baseline of [null, [], { ...f.baseline, extra: true }, new Proxy(f.baseline, {}),
      { ...f.baseline, target: new Proxy(f.baseline.target, {}) },
      Object.defineProperty({ ...f.baseline }, "documents", { get() { throw Error("private-canary"); } }),
      Object.defineProperty({ ...f.baseline }, Symbol("extra"), { value: true })])
      expect(() => buildLegacyImportPreflight(f.source, f.reviewDigest, f.bindings, baseline, now)).toThrow();
    f.baseline.documents = Array.from({ length: 4000 }, (_, index) => row(`_system.synthetic-${index}`));
    f.baseline.expectedDocumentCount = 4000;
    expect(run(f).counts.baselineDocuments).toBe(4000);
  });
  it("rebuilds source approval and refuses expiry exactly at the deadline", () => {
    const f = fixture(); f.reviewDigest = "f".repeat(64); expect(() => run(f)).toThrow("PREFLIGHT_INPUT_INVALID");
    const s = fixture(); Object.assign(s.source.galleries[0].availability, { mode: "until", expiryInstant: "2026-10-11T14:00:01Z" });
    s.reviewDigest = buildLegacyImportPlan(s.source, now).reviewDigest; s.bindings.reviewDigest = s.reviewDigest;
    expect(run(s, now + 999).noCollisionObservedInDeclaredBaseline).toBe(true);
    expect(() => run(s, now + 1000)).toThrow("PREFLIGHT_INPUT_INVALID");
  });
});
