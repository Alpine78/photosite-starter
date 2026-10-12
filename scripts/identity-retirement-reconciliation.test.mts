import { describe, expect, it } from "vitest";
import { canonicalJson, digest, reconcileIdentities } from "./identity-retirement-reconciliation.mts";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const ndjson = (docs: unknown[]) => Buffer.from(docs.map(doc => JSON.stringify(doc)).join("\n") + "\n");
export function fixture() {
  const mapping = [
    { field: "contentId", oldId: "joomla-content-1", newId: "article-coast" },
    { field: "contentId", oldId: "joomla-content-2", newId: "gallery-coast" },
    { field: "categoryId", oldId: "joomla-category-1", newId: "category-trips" },
    { field: "endGalleryId", oldId: "joomla-end-1", newId: "article-coast-end" },
    { field: "placementId", oldId: "joomla-content-1-0001", newId: "article-coast-image-0001" },
    { field: "placementId", oldId: "joomla-content-2-0001", newId: "gallery-coast-image-0001" },
  ];
  const docs: Record<string, unknown>[] = [
    { _id: "category", _rev: "r1", _type: "category", categoryId: "joomla-category-1" },
    ...["fi", "en"].map(language => ({ _id: `article-${language}`, _rev: "r1", _type: "article", language, contentId: "joomla-content-1", endGalleryId: "joomla-end-1", canonicalCategory: { _ref: "category" } })),
    { _id: "gallery-fi", _rev: "r1", _type: "gallery", language: "fi", contentId: "joomla-content-2" },
    ...["fi", "en"].map(language => ({ _id: `placement-${language}`, _rev: "r1", _type: "articleEndGalleryPlacement", language, placementId: "joomla-content-1-0001", article: { _ref: `article-${language}` }, media: { _ref: "media" } })),
    { _id: "gallery-placement", _rev: "r1", _type: "galleryPlacement", placementId: "joomla-content-2-0001", gallery: { _ref: "gallery-fi" }, media: { _ref: "media" } },
    { _id: "media", _rev: "r1", _type: "media", mediaId: "coast" },
  ];
  const changes = docs.flatMap(doc => {
    const fields = Object.fromEntries(mapping.filter(row => doc[row.field] === row.oldId).map(row => [row.field, { before: row.oldId, after: row.newId }]));
    return Object.keys(fields).length ? [{ documentId: doc._id, expectedRevision: doc._rev, fields }] : [];
  });
  const baseline = ndjson(docs);
  const map = { version: "ab257-private-proposal-v1", writable: false, snapshotSha256: digest(baseline), mapping, proposedChanges: changes };
  const approval = { candidateFileSha256: digest(encode(map)), snapshotFileSha256: digest(baseline), productionWriteApproved: false,
    acceptedScope: { retainSanityDocumentIds: true, retainSanityReferences: true, contentId: 2, categoryId: 1, endGalleryId: 1, placementId: 2, totalDomainIdentities: 6, documents: 7, fieldChanges: 9 } };
  const input = () => ({ map: encode(map), approval: encode(approval), baseline, snapshot: ndjson(docs), approvedDigest: digest(encode(map)) });
  const reapprove = () => { approval.candidateFileSha256 = digest(encode(map)); };
  return { docs, mapping, map, approval, baseline, input, reapprove };
}
const codes = (input: ReturnType<ReturnType<typeof fixture>["input"]>) => reconcileIdentities(input).issues.map(issue => issue.code);

describe("approved identity reconciliation", () => {
  it("covers both languages and all identity families without mutating inputs", () => {
    const f = fixture(), input = f.input(), before = JSON.stringify(input);
    const report = reconcileIdentities(input);
    expect(report.status).toBe("consistent-old");
    expect(report.counts).toEqual({ mappedIdentities: 6, approvedDocuments: 7, approvedFields: 9, currentDocuments: 8, references: 8, issues: 0 });
    expect(report.classifications.every(row => row.state === "old")).toBe(true);
    expect(report.byteIdenticalToBaseline).toBe(true);
    expect(report.writable).toBe(false); expect(report.cutoverReady).toBe(false);
    expect(JSON.stringify(input)).toEqual(before);
    expect(canonicalJson(report)).toBe(canonicalJson(reconcileIdentities(f.input())));
  });
  it("distinguishes already-new fields without asserting authorized migration", () => {
    const f = fixture();
    for (const doc of f.docs) for (const row of f.mapping) if (doc[row.field] === row.oldId) doc[row.field] = row.newId;
    const report = reconcileIdentities(f.input());
    expect(report.classifications.every(row => row.state === "already-new")).toBe(true);
    expect(report.writerReceiptRequired).toBe(true);
    expect(report.status).toBe("blocked");
    expect(new Set(report.issues.map(issue => issue.code))).toEqual(new Set(["WRITE_RECEIPT_REQUIRED"]));
  });
  it("flags partial multi-field edits, missing documents and revision drift", () => {
    const f = fixture(); f.docs[1].contentId = "article-coast"; f.docs[2]._rev = "r2"; f.docs.splice(3, 1);
    expect(codes(f.input())).toEqual(expect.arrayContaining(["FIELD_CONFLICT", "REVISION_DRIFT", "MISSING_APPROVED_DOCUMENT"]));
    const report = reconcileIdentities(f.input());
    expect(report.writerReceiptRequired).toBe(true);
    expect(report.classifications.find(row => row.documentId === "article-fi")?.fieldStates).toEqual({ contentId: "already-new", endGalleryId: "old" });
  });
  it.each(["drafts.article-fi", "versions.release.article-fi", "drafts.article-other", "versions.release.article-other"])("reports affected variant %s even without a published counterpart", id => {
    const f = fixture(); f.docs.push({ ...f.docs[1], _id: id });
    const report = reconcileIdentities(f.input());
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["ADDITIONAL_MAPPED_FIELD", "AFFECTED_UNPUBLISHED_VARIANT"]));
    expect(report.affectedVariants[0].publishedPresent).toBe(!id.endsWith("article-other"));
  });
  it("reports draft-only disappearance and additional fields on existing documents", () => {
    const f = fixture(); f.docs[1]._id = "drafts.article-fi";
    f.docs.push({ _id: "settings", _rev: "r1", _type: "siteSettings", featuredGalleryId: "joomla-content-2" });
    expect(codes(f.input())).toEqual(expect.arrayContaining(["MISSING_APPROVED_DOCUMENT", "ADDITIONAL_MAPPED_FIELD", "UNPUBLISHED_REFERENCE_TARGET"]));
  });
  it("reports reserved targets and unmapped legacy domain identities", () => {
    const f = fixture(); f.docs.push({ _id: "other", _rev: "r1", _type: "article", contentId: "article-coast", endGalleryId: "joomla-end-99" });
    expect(codes(f.input())).toEqual(expect.arrayContaining(["TARGET_COLLISION", "UNMAPPED_LEGACY_ID"]));
  });
  it("blocks missing unrelated baseline records instead of accepting a partial export", () => {
    const f = fixture(), input = f.input();
    input.baseline = ndjson([...f.docs, { _id: "unrelated", _rev: "r1", _type: "media" }]);
    f.map.snapshotSha256 = digest(input.baseline); f.approval.snapshotFileSha256 = digest(input.baseline); f.reapprove();
    input.map = encode(f.map); input.approval = encode(f.approval); input.approvedDigest = digest(input.map);
    const report = reconcileIdentities(input);
    expect(report.status).toBe("blocked"); expect(report.snapshotDelta.removed).toEqual(["unrelated"]);
    expect(report.issues.map(issue => issue.code)).toContain("SNAPSHOT_DOCUMENT_REMOVED");
  });
  it("consumes parent/placement overlaps and new-ID spans while finding embedded old consumers", () => {
    const f = fixture(); f.docs[0].note = "prefix joomla-content-1-0001 suffix";
    const report = reconcileIdentities(f.input());
    expect(report.issues.filter(issue => issue.code === "UNKNOWN_IDENTITY_CONSUMER")).toHaveLength(1);
    expect(report.issues.find(issue => issue.code === "UNKNOWN_IDENTITY_CONSUMER")?.path).toBe("note");
    f.mapping[0].newId = "article-joomla-content-1";
    f.map.proposedChanges.forEach(change => { if (change.fields.contentId?.before === "joomla-content-1") change.fields.contentId.after = f.mapping[0].newId; });
    f.reapprove(); f.docs[0].note = "article-joomla-content-1";
    expect(codes(f.input())).not.toContain("UNKNOWN_IDENTITY_CONSUMER");
  });
  it("preserves prototype-shaped JSON data and compares document-level changes", () => {
    const f = fixture(); Object.defineProperty(f.docs[0], "__proto__", { value: { constructor: "data" }, enumerable: true });
    const report = reconcileIdentities(f.input());
    expect(report.snapshotDelta.changed).toContain("category");
    expect(report.issues.map(issue => issue.code)).toContain("MAPPED_DOCUMENT_CHANGED");
    expect(Object.hasOwn({}, "constructor")).toBe(false);
  });
  it.each([
    [{ _ref: null }, "INVALID_REFERENCE"], [{ _ref: "missing" }, "DANGLING_REFERENCE"],
    [{ _ref: "missing", _weak: true }, "MISSING_WEAK_REFERENCE"], [{ _ref: "image-missing" }, "MISSING_ASSET_REFERENCE"],
    [{ _ref: "project:dataset:remote" }, "EXTERNAL_REFERENCE"],
  ])("reports reference closure conservatively: %s", (ref, code) => {
    const f = fixture(); f.docs[7].nested = [{ ref }]; expect(codes(f.input())).toContain(code);
  });
  it("preserves strengthening metadata on an exact, resolving weak reference", () => {
    const f = fixture(); f.docs[7].nested = { _ref: "category", _weak: true, _strengthenOnPublish: { type: "category" } };
    expect(codes(f.input())).toEqual([]);
  });
  it("rejects tampered map or baseline bytes before treating their data as approved", () => {
    const f = fixture(); const input = f.input(); input.map = Buffer.concat([input.map, Buffer.from(" ")]);
    expect(() => reconcileIdentities(input)).toThrow("MAP_DIGEST_MISMATCH");
    const changed = f.input(); changed.baseline = Buffer.concat([changed.baseline, Buffer.from(" ")]);
    expect(() => reconcileIdentities(changed)).toThrow("BASELINE_DIGEST_MISMATCH");
    f.approval.candidateFileSha256 = "0".repeat(64); expect(() => reconcileIdentities(f.input())).toThrow("APPROVAL_MAP_MISMATCH");
  });
  it("rejects duplicated mappings, incomplete changes, wrong family and receipt counts", () => {
    const f = fixture(); f.map.mapping.push(f.mapping[0]); f.reapprove(); expect(() => reconcileIdentities(f.input())).toThrow("MAPPING_COLLISION");
    const g = fixture(); g.map.proposedChanges[0].fields = { contentId: { before: "joomla-content-1", after: "article-coast" } }; g.reapprove(); expect(() => reconcileIdentities(g.input())).toThrow("INVALID_BASELINE_CHANGE");
    const h = fixture(); h.approval.acceptedScope.documents = 6; expect(() => reconcileIdentities(h.input())).toThrow("APPROVAL_COUNTS_MISMATCH");
  });
  it("rejects duplicate decoded keys in map and approval", () => {
    const f = fixture(), input = f.input();
    input.map = Buffer.from('{"writable":true,"writ\\u0061ble":false}'); input.approvedDigest = digest(input.map);
    expect(() => reconcileIdentities(input)).toThrow("DUPLICATE_JSON_KEY");
    const second = f.input(); second.approval = Buffer.from('{"a":1,"a":2}'); expect(() => reconcileIdentities(second)).toThrow("DUPLICATE_JSON_KEY");
  });
  it("rejects invalid UTF-8, BOM, blank lines and duplicate documents; permits CRLF", () => {
    const f = fixture();
    for (const [bytes, code] of [[Buffer.from([255]), "INVALID_UTF8"], [Buffer.concat([Buffer.from([239,187,191]), f.baseline]), "UTF8_BOM"], [Buffer.from(f.baseline.toString().replace("\n", "\n\n")), "EMPTY_NDJSON_RECORD"], [ndjson([f.docs[0], f.docs[0]]), "DUPLICATE_DOCUMENT"]] as const) {
      expect(() => reconcileIdentities({ ...f.input(), snapshot: bytes })).toThrow(code);
    }
    expect(reconcileIdentities({ ...f.input(), snapshot: Buffer.from(f.baseline.toString().replaceAll("\n", "\r\n")) }).issues).toEqual([]);
  });
  it("exercises byte, document, traversal, depth, number and report bounds", () => {
    const f = fixture();
    for (const limits of [{ bytes: 1 }, { documents: 1 }, { nodes: 1 }, { depth: 1 }, { reportBytes: 1 }]) expect(() => reconcileIdentities(f.input(), limits)).toThrow(/LIMIT/u);
    expect(() => reconcileIdentities({ ...f.input(), snapshot: Buffer.from('{"_id":"x","_type":"media","_rev":"r","n":9007199254740993}') })).toThrow("UNSAFE_NUMBER");
    expect(() => reconcileIdentities({ ...f.input(), snapshot: Buffer.from('{"_id":"x","_type":"media","_rev":"r","n":-0}') })).toThrow("UNSAFE_NUMBER");
  });
});
