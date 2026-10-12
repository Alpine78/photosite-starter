import { describe, expect, it } from "vitest";
import { canonicalJson, digest, LIMITS } from "./identity-retirement-reconciliation.mts";
import { planIdentityChanges, untouchedValuesDigest } from "./identity-change-plan.mts";
import { encode, fixture, ndjson } from "./identity-change-plan-fixture.mts";

describe("offline identity change batches", () => {
  it("covers each document/field once and keeps language siblings and featured links together", () => {
    const f = fixture(), input = f.makeInput(), initial = input.map.toString(), plan = planIdentityChanges(input, 3);
    const rows = plan.batches.flatMap(batch => batch.documents);
    expect(rows).toHaveLength(8); expect(new Set(rows.map(row => row.documentId)).size).toBe(8);
    expect(rows.reduce((sum, row) => sum + Object.keys(row.fields).length, 0)).toBe(10);
    expect(rows.every(row => row.preWriteRevision === "r1")).toBe(true);
    expect(plan.counts).toMatchObject({ approvedDocuments: 8, approvedFields: 10, groups: 4, largestGroupDocuments: 3 });
    for (const group of [["article-fi", "article-en"], ["gallery-fi", "gallery-en", "settings"], ["placement-fi", "placement-en"]]) {
      expect(plan.batches.filter(batch => batch.documents.some(row => group.includes(row.documentId)))).toHaveLength(1);
    }
    expect(plan.batches.every(batch => batch.documents.length <= 3)).toBe(true);
    expect(rows.some(row => row.documentId.startsWith("drafts."))).toBe(false);
    expect(input.map.toString()).toBe(initial);
    expect(canonicalJson(plan)).toBe(canonicalJson(planIdentityChanges(f.makeInput(), 3)));
    const { planSha256, ...body } = plan; expect(planSha256).toBe(digest(Buffer.from(canonicalJson(body))));
    expect(plan.digests).toEqual({ approvedMap: digest(input.map), approval: digest(input.approval), baseline: digest(input.baseline), snapshot: digest(input.snapshot) });
  });
  it("joins identities transitively through a multi-field document", () => {
    const f = fixture(); delete f.documents[1].endGalleryId;
    f.documents.push({ _id: "article-third", _rev: "r1", _type: "article", endGalleryId: "joomla-end-1" });
    const plan = planIdentityChanges(f.makeInput(), 3);
    const articleBatch = plan.batches.find(batch => batch.documents.some(row => row.documentId === "article-fi"))!;
    expect(articleBatch.documents.map(row => row.documentId)).toEqual(["article-en", "article-fi", "article-third"]);
    expect(() => planIdentityChanges(f.makeInput(), 2)).toThrow("IDENTITY_GROUP_LIMIT");
  });
  it("rejects ambiguous cross-family names in reconciliation before grouping", () => {
    const f = fixture(); f.mapping[2].oldId = f.mapping[1].oldId;
    expect(() => planIdentityChanges(f.makeInput())).toThrow("MAPPING_COLLISION");
  });
  it("sorts whole groups independently of input enumeration using Unicode scalar IDs", () => {
    const f = fixture(); f.documents[0]._id = "\u{10000}"; f.documents[1].canonicalCategory = { _ref: "\u{10000}" }; f.documents[2].canonicalCategory = { _ref: "\u{10000}" };
    f.documents[7]._id = "\ue000";
    const input = f.makeInput(), first = planIdentityChanges(input);
    const map = JSON.parse(input.map.toString()); map.proposedChanges.reverse(); map.mapping.reverse();
    const changed = { ...input, map: encode(map), snapshot: ndjson([...f.documents].reverse()) };
    const approval = JSON.parse(changed.approval.toString()); approval.candidateFileSha256 = digest(changed.map);
    changed.approval = encode(approval); changed.approvedDigest = digest(changed.map);
    const second = planIdentityChanges(changed);
    expect(second.batches).toEqual(first.batches);
    const ids = first.batches.flatMap(batch => batch.documents.map(row => row.documentId));
    expect(ids.indexOf("\ue000")).toBeLessThan(ids.indexOf("\u{10000}"));
  });
  it("specifies rollback's future post-write guard and retains original selected values only", () => {
    const plan = planIdentityChanges(fixture().makeInput());
    const rows = plan.batches.flatMap(batch => batch.documents);
    for (const row of rows) {
      expect(row.rollback).toEqual({ originalValues: Object.fromEntries(Object.entries(row.fields).map(([field, pair]) => [field, pair.before])), revisionSource: "verified-post-write-receipt" });
    }
    expect(canonicalJson(plan)).not.toMatch(/"(?:patch|createOrReplace|ifRevisionID|mutations|postWriteRevision)"/u);
    expect(plan.writable).toBe(false); expect(plan.cutoverReady).toBe(false);
    expect(plan.reconciliationVersion).toBe("identity-reconciliation-v1");
    expect(plan.rollbackOrder).toBe("reverse-batch-sequence-requires-verified-receipts");
    expect(plan.remainingGates).toEqual(["snapshot-provenance-and-freeze", "accepted-deltas", "reader-import-writer-plan", "route-order-media-validation", "backup-restore-migration-rollback-rehearsal", "separate-cutover-approval"]);
  });
  it("hashes nested refs, keys, media, language, URLs and order while excluding managed update metadata", () => {
    const doc = fixture().documents[1], fields = { contentId: { before: "joomla-content-1", after: "article-coast" } };
    const original = untouchedValuesDigest(doc, fields);
    expect(untouchedValuesDigest({ ...doc, _rev: "r2", _updatedAt: "synthetic-time", contentId: "article-coast" }, fields)).toBe(original);
    for (const delta of [{ canonicalCategory: { _ref: "other" } }, { _key: "new" }, { media: { _ref: "other" } }, { order: 2 }, { slug: { current: "new" } }, { language: "en" }]) {
      expect(untouchedValuesDigest({ ...doc, ...delta }, fields)).not.toBe(original);
    }
    expect(untouchedValuesDigest({ ...doc, items: [1, 2], value: null }, fields)).not.toBe(untouchedValuesDigest({ ...doc, items: [2, 1], value: null }, fields));
    expect(untouchedValuesDigest({ ...doc, text: "\u00e4" }, fields)).not.toBe(untouchedValuesDigest({ ...doc, text: "a\u0308" }, fields));
    expect(untouchedValuesDigest(Object.fromEntries(Object.entries(doc).reverse()) as typeof doc, fields)).toBe(original);
  });
  it.each([0, 101, 1.5, NaN, Infinity, "50"])("rejects invalid pure-function batch limit %s", limit => {
    expect(() => planIdentityChanges(fixture().makeInput(), limit as number)).toThrow("INVALID_BATCH_LIMIT");
  });
  it("never splits a group to fit count or byte budgets and bounds total output", () => {
    const input = fixture().makeInput();
    expect(() => planIdentityChanges(input, 1)).toThrow("IDENTITY_GROUP_LIMIT");
    expect(() => planIdentityChanges(input, 50, { batchBytes: 1 })).toThrow("IDENTITY_GROUP_LIMIT");
    expect(() => planIdentityChanges(input, 50, { reportBytes: 1 })).toThrow("PLAN_OUTPUT_LIMIT");
    expect(() => planIdentityChanges(input, 50, { batchBytes: 999999 })).toThrow("INVALID_BATCH_LIMIT");
    const plan = planIdentityChanges(input), size = (rows: unknown[]) => Buffer.byteLength(canonicalJson(rows));
    const largest = Math.max(...plan.batches[0].documents.map(row => size([row])));
    const reduced = planIdentityChanges(input, 50, { batchBytes: largest * 3 + 10 });
    expect(reduced.batches.length).toBeGreaterThan(1);
    expect(reduced.batches.every(batch => size(batch.documents) <= reduced.limits.documentDataBytesPerBatch)).toBe(true);
  });
  it.each(["revision", "partial", "new", "missing-field", "draft", "release", "nested-consumer"])("rejects reconciliation blocker %s before producing batches", cause => {
    const f = fixture(), input = f.makeInput();
    if (cause === "revision") f.documents[1]._rev = "r2";
    if (cause === "partial" || cause === "new") f.documents[1].contentId = "article-coast";
    if (cause === "new") f.documents[1].endGalleryId = "article-coast-end";
    if (cause === "missing-field") delete f.documents[1].contentId;
    if (cause === "draft" || cause === "release") f.documents.push({ ...f.documents[1], _id: cause === "draft" ? "drafts.article-fi" : "versions.release.article-fi" });
    if (cause === "nested-consumer") f.documents[9].note = { text: "joomla-content-1" };
    input.snapshot = ndjson(f.documents);
    expect(() => planIdentityChanges(input)).toThrow("RECONCILIATION_BLOCKED");
  });
  it("inherits strict duplicate-key/BOM/digest checks before native parsing", () => {
    const input = fixture().makeInput();
    expect(() => planIdentityChanges({ ...input, snapshot: Buffer.from('{"_id":"a","_id":"b"}') })).toThrow("DUPLICATE_JSON_KEY");
    expect(() => planIdentityChanges({ ...input, snapshot: Buffer.concat([Buffer.from([239,187,191]), input.snapshot]) })).toThrow("UTF8_BOM");
    expect(() => planIdentityChanges({ ...input, map: Buffer.concat([input.map, Buffer.from(" ")]) })).toThrow("MAP_DIGEST_MISMATCH");
  });
  it("rejects oversized input before attempting to copy its bytes", () => {
    const input = fixture().makeInput();
    // The sentinel has no readable storage; copying it would throw a different error.
    const oversized = { byteLength: LIMITS.bytes + 1 } as Uint8Array;
    expect(() => planIdentityChanges({ ...input, snapshot: oversized })).toThrow("INPUT_LIMIT");
  });
});
