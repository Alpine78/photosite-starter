import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inventoryGalleryRemoval, REMOVAL_LIMITS, verifyRemovalInventory } from "./gallery-removal-impact.mts";
import { parseRemovalImpactArguments, runRemovalImpactInventory } from "./inventory-gallery-removal.mts";
import { writeRemovalImpactArtifact } from "./gallery-removal-impact-files.mts";
import * as files from "./delivery-zip-build-files.mts";
const exec = promisify(execFile), roots: string[] = [], digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const assetId = `image-${"a".repeat(40)}-80x40-jpg`, fileId = `file-${"b".repeat(40)}-zip`;
const ref = (id: string, extra = {}) => ({ _type: "reference", _ref: id, ...extra });
const doc = (_id: string, _type = "clientDeliveryGallery", values = {}) => ({ _id, _type, _rev: "r1", ...values });
function inputs(records = [doc("gallery", "clientDeliveryGallery", { items: [{ image: { asset: ref(assetId) } }], title: "private-content-canary" }), doc(assetId, "sanity.imageAsset")]) {
  const snapshot = Buffer.from(records.map(d => JSON.stringify(d)).join("\n") + "\n"), intent = Buffer.from(JSON.stringify({ version: 1, galleryId: "gallery", expectedRevision: "r1" }));
  const evidence = Buffer.from(JSON.stringify({ version: 1, snapshotSha256: digest(snapshot), documentCount: records.length, scope: "all-documents-including-drafts-and-releases", collection: "owner-attested-unfiltered", capturedAt: "2026-10-17T00:00:00.000Z" }));
  return { snapshot, evidence, intent };
}
async function setup(data = inputs()) {
  const base = await mkdtemp(path.join(os.tmpdir(), "removal-private-canary-")); roots.push(base); await chmod(base, 0o700);
  for (const [name, bytes] of Object.entries(data)) await writeFile(path.join(base, name), bytes, { mode: 0o600 });
  return { base, snapshot: path.join(base, "snapshot"), evidence: path.join(base, "evidence"), intent: path.join(base, "intent"), out: path.join(base, "report") };
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("observed report-only gallery removal inventory", () => {
  it("binds exact bytes/intent/evidence/revisions, carries limitations and never approves deletion", () => {
    const data = inputs(), before = Buffer.from(data.snapshot), result = inventoryGalleryRemoval(data);
    expect(result.report).toMatchObject({ readyToDelete: false, readyToWrite: false, snapshotDocuments: 2, assetCount: 1, completeness: "owner-attested-not-independently-verified" });
    expect(result.report.assets[0]).toMatchObject({ assetId, present: true, otherReferrersObservedInSnapshot: 0, referrers: [{ documentId: "gallery", revision: "r1", type: "clientDeliveryGallery", role: "selected-gallery-record" }] });
    expect(result.report.notices.join(" ")).toMatch(/not revoke public file URLs/); expect(JSON.stringify(result)).not.toContain("private-content-canary"); expect(data.snapshot).toEqual(before);
    expect(verifyRemovalInventory(data, result)).toEqual(result);
    expect(() => verifyRemovalInventory(data, { ...result, reportSha256: "0".repeat(64) })).toThrow("INVENTORY_OR_SOURCE_CHANGED");
  });
  it("counts shared draft/release/weak/custom-type references without dropping any", () => {
    const result = inventoryGalleryRemoval(inputs([
      doc("gallery", "clientDeliveryGallery", { items: [ref(assetId)] }), doc("drafts.gallery", "clientDeliveryGallery", { items: [ref(fileId)] }), doc("versions.release.gallery", "clientDeliveryGallery", { items: [ref(assetId)] }),
      doc("drafts.article", "article", { nested: { array: [{ value: ref(assetId, { _weak: true }) }] } }), doc("versions.release.custom", "customType", { file: ref(fileId) }), doc(assetId, "sanity.imageAsset"), doc(fileId, "sanity.fileAsset"),
    ]));
    expect(result.report.selectedRecords.map(d => d.documentId)).toEqual(["drafts.gallery", "gallery", "versions.release.gallery"]);
    expect(result.report.assets.map(a => [a.assetId, a.otherReferrersObservedInSnapshot])).toEqual([[fileId, 1], [assetId, 1]]);
    expect(result.report.assets[1].referrers).toHaveLength(3);
  });
  it("includes reverse legacy image ownership and all placement variants without traversing arbitrary content", () => {
    const result = inventoryGalleryRemoval(inputs([
      doc("gallery", "legacyDeliveryGallery", { deliveryZip: ref(fileId), arbitrary: ref("navigation") }), doc("legacyImage", "legacyDeliveryImage", { gallery: ref("gallery"), source: { asset: ref(assetId) } }),
      doc("drafts.legacyImage", "legacyDeliveryImage", { gallery: ref("gallery"), source: { asset: ref(assetId) } }), doc("navigation", "siteSettings", { any: ref(`image-${"c".repeat(40)}-1x1-jpg`) }), doc(assetId, "sanity.imageAsset"), doc(fileId, "sanity.fileAsset"),
    ]));
    expect(result.report.selectedRecords.map(d => d.documentId)).toEqual(["drafts.legacyImage", "gallery", "legacyImage"]); expect(result.report.assets).toHaveLength(2);
    expect(result.report.blockers).toContain("non-gallery-reference-targets-not-traversed"); expect(result.report.readyToDelete).toBe(false);
  });
  it("keeps dotted bases distinct, reports invalid variants/type mismatches and ignores system docs as ownership", () => {
    const data = inputs([doc("gallery"), doc("drafts.gallery", "article"), doc("drafts.drafts.gallery"), doc("_.system", "system"), doc("system.foo", "system")]);
    const report = inventoryGalleryRemoval(data).report; expect(report.blockers).toContain("ambiguous-document-variant"); expect(report.blockers).toContain("gallery-variant-type-mismatch");
    expect(report.selectedRecords.map(d => d.documentId)).toEqual(["drafts.gallery", "gallery"]);
    const dotted = inputs([doc("gallery.with.dots"), doc("versions.release.gallery.with.dots")]);
    dotted.intent = Buffer.from(JSON.stringify({ version: 1, galleryId: "gallery.with.dots", expectedRevision: "r1" })); expect(inventoryGalleryRemoval(dotted).report.selectedRecords).toHaveLength(2);
  });
  it("reports missing/malformed/external/unstructured references and asset kind mismatches", () => {
    const result = inventoryGalleryRemoval(inputs([doc("gallery", "clientDeliveryGallery", { a: ref(assetId), b: ref(fileId), c: { _ref: 17 }, d: ref(assetId, { _projectId: "other", _dataset: "elsewhere" }), e: "https://cdn.sanity.io/images/other/data/hash.jpg", f: ref("missing", { _weak: true }) }), doc(assetId, "sanity.fileAsset")]));
    expect(result.report.assets.find(a => a.assetId === fileId)?.present).toBe(false);
    expect(result.report.blockers).toEqual(expect.arrayContaining(["asset-type-mismatch", "malformed-reference", "missing-reference-targets", "cross-dataset-references-not-resolved", "possible-unstructured-asset-mentions"]));
    expect(result.report.observations).toMatchObject({ externalReferences: 1, malformedReferences: 1, missingReferences: 2, unstructuredMentions: 1 });
  });
  it("does not treat an asset's own delivery URL as an unstructured authored reference", () => {
    const records = [doc("gallery", "clientDeliveryGallery", { images: [ref(assetId)], zip: ref(fileId) }),
      doc(assetId, "sanity.imageAsset", { url: `https://cdn.sanity.io/images/project/production/${"a".repeat(40)}-80x40.jpg` }),
      doc(fileId, "sanity.fileAsset", { url: `https://cdn.sanity.io/files/project/production/${"b".repeat(40)}.zip` })];
    const clean = inventoryGalleryRemoval(inputs(records)).report;
    expect(clean.observations.unstructuredMentions).toBe(0); expect(clean.blockers).not.toContain("possible-unstructured-asset-mentions");
    const extra = inventoryGalleryRemoval(inputs([...records, doc("article", "article", { link: `https://cdn.sanity.io/images/project/production/${"a".repeat(40)}-80x40.jpg` })])).report;
    expect(extra.observations.unstructuredMentions).toBe(1); expect(extra.blockers).toContain("possible-unstructured-asset-mentions");
    const nested = inventoryGalleryRemoval(inputs([records[0], doc(assetId, "sanity.imageAsset", { url: `https://cdn.sanity.io/images/project/production/${"a".repeat(40)}-80x40.jpg`, metadata: { externalLink: `https://cdn.sanity.io/files/project/production/${"b".repeat(40)}.zip` } }), records[2]])).report;
    expect(nested.observations.unstructuredMentions).toBe(1);
  });
  it("lists inbound selected-page references from custom, draft and release records", () => {
    const records = [doc("gallery"), doc("drafts.gallery"), doc("versions.release.gallery"),
      doc("custom", "customType", { page: ref("gallery") }), doc("drafts.article", "article", { page: ref("drafts.gallery", { _weak: true }) }),
      doc("versions.release.navigation", "siteSettings", { links: [ref("versions.release.gallery"), ref("versions.other.gallery")] })];
    const report = inventoryGalleryRemoval(inputs(records)).report;
    expect(report.galleryReferrers).toEqual([
      { targetDocumentId: "drafts.gallery", documentId: "drafts.article", revision: "r1", type: "article", role: "other-record" },
      { targetDocumentId: "gallery", documentId: "custom", revision: "r1", type: "customType", role: "other-record" },
      { targetDocumentId: "versions.other.gallery", documentId: "versions.release.navigation", revision: "r1", type: "siteSettings", role: "other-record" },
      { targetDocumentId: "versions.release.gallery", documentId: "versions.release.navigation", revision: "r1", type: "siteSettings", role: "other-record" },
    ]);
    expect(report.blockers).toContain("other-gallery-referrers-observed"); expect(report.observations.missingReferences).toBe(1);
    expect(report.galleryReferrers).toEqual(inventoryGalleryRemoval(inputs([...records].reverse())).report.galleryReferrers);
    const own = inventoryGalleryRemoval(inputs([doc("gallery", "legacyDeliveryGallery"), doc("owned-image", "legacyDeliveryImage", { gallery: ref("gallery") })])).report;
    expect(own.galleryReferrers[0]).toMatchObject({ documentId: "owned-image", role: "selected-gallery-record" });
    expect(own.blockers).not.toContain("other-gallery-referrers-observed"); expect(own.readyToDelete).toBe(false);
  });
  it("refuses stale/missing published gallery revisions and incomplete attestations", () => {
    const data = inputs();
    for (const edit of [{ ...data, intent: Buffer.from('{"version":1,"galleryId":"gallery","expectedRevision":"r2"}') }, { ...data, evidence: Buffer.from(JSON.stringify({ ...JSON.parse(data.evidence.toString()), documentCount: 1 })) }, { ...data, evidence: Buffer.from(JSON.stringify({ ...JSON.parse(data.evidence.toString()), scope: "published-only" })) }, { ...data, snapshot: Buffer.concat([data.snapshot, Buffer.from(" ")]) }]) expect(() => inventoryGalleryRemoval(edit)).toThrow();
    expect(() => inventoryGalleryRemoval(inputs([doc("drafts.gallery")]))).toThrow("PUBLISHED_GALLERY_REQUIRED");
  });
  it("rejects duplicate decoded keys/IDs, blank lines, bad UTF8/BOM and excessive budgets", () => {
    const make = (snapshot: Buffer, count: number) => { const data = inputs(); data.snapshot = Buffer.from(snapshot); data.evidence = Buffer.from(JSON.stringify({ ...JSON.parse(data.evidence.toString()), snapshotSha256: digest(snapshot), documentCount: count })); return data; };
    for (const [snapshot, count] of [[Buffer.from('{"_id":"gallery","_id":"other","_rev":"r1","_type":"clientDeliveryGallery"}\n'), 1], [Buffer.from('{"_id":"gallery","_rev":"r1","_type":"clientDeliveryGallery"}\n'.repeat(2)), 2], [Buffer.from('{"_id":"gallery","_rev":"r1","_type":"clientDeliveryGallery"}\n\n'), 2], [Buffer.from([255]), 1], [Buffer.from('\ufeff{}\n'), 1]] as const) expect(() => inventoryGalleryRemoval(make(snapshot, count))).toThrow();
    expect(() => inventoryGalleryRemoval(inputs(), { ...REMOVAL_LIMITS, lineBytes: 16 })).toThrow("SNAPSHOT_LINE_LIMIT");
    expect(() => inventoryGalleryRemoval(inputs(), { ...REMOVAL_LIMITS, reportBytes: 32 })).toThrow("REPORT_LIMIT");
    expect(() => inventoryGalleryRemoval(inputs(), { ...REMOVAL_LIMITS, nodes: 3 })).toThrow("INVALID_INPUT");
  });
  it("resolves all referrers regardless of record order with deterministic report ordering", () => {
    const records = [doc("gallery", "clientDeliveryGallery", { item: ref(assetId) }), doc("z", "article", { item: ref(assetId) }), doc("a", "article", { item: ref(assetId) }), doc(assetId, "sanity.imageAsset")];
    const first = inventoryGalleryRemoval(inputs(records)).report, second = inventoryGalleryRemoval(inputs([...records].reverse())).report;
    expect(first.assets).toEqual(second.assets); expect(first.assets[0].referrers.map(d => d.documentId)).toEqual(["a", "gallery", "z"]);
    expect(first.snapshotSha256).not.toBe(second.snapshotSha256); // Different raw evidence has a different bound digest.
  });
  it("handles prototype-shaped keys as data and leaves authored objects untouched", () => {
    const data = inputs([JSON.parse('{"_id":"gallery","_rev":"r1","_type":"clientDeliveryGallery","__proto__":{"polluted":true},"constructor":{"x":1}}')]);
    expect(inventoryGalleryRemoval(data).report.assetCount).toBe(0); expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
describe("private removal-impact actual command", () => {
  it("runs real CLI with private report and redacted output, leaving all inputs unchanged", async () => {
    const f = await setup(), before = await readFile(f.snapshot);
    const { stdout, stderr } = await exec(process.execPath, ["scripts/inventory-gallery-removal.mts", "--snapshot", f.snapshot, "--evidence", f.evidence, "--intent", f.intent, "--out", f.out]);
    expect(stderr).toBe(""); const summary = JSON.parse(stdout); expect(summary).toMatchObject({ assetCount: 1, readyToDelete: false, readyToWrite: false });
    expect(stdout).not.toMatch(/private-content-canary|removal-private-canary|gallery\"|image-aaaa/);
    const artifact = JSON.parse(await readFile(path.join(f.out, "impact.json"), "utf8")); expect(artifact.reportSha256).toBe(summary.reportSha256); expect(artifact.report.gallery.documentId).toBe("gallery");
    expect((await lstat(path.join(f.out, "impact.json"))).mode & 0o777).toBe(0o600); expect(await readFile(f.snapshot)).toEqual(before);
  });
  it("rejects unsafe argument/input/output policies and preserves previous evidence", async () => {
    const f = await setup(), args = ["--snapshot", f.snapshot, "--evidence", f.evidence, "--intent", f.intent, "--out", f.out];
    for (const bad of [[...args, "--x", "secret"], args.slice(0, -2), args.map(v => v === f.out ? f.base : v)]) expect(() => parseRemovalImpactArguments(bad)).toThrow();
    await mkdir(f.out, { mode: 0o700 }); await writeFile(path.join(f.out, "existing"), "preserve"); await expect(runRemovalImpactInventory(f)).rejects.toThrow("LOCAL_INPUT_FAILED"); expect(await readFile(path.join(f.out, "existing"), "utf8")).toBe("preserve");
    await chmod(f.snapshot, 0o644); await expect(runRemovalImpactInventory(f)).rejects.toThrow("LOCAL_INPUT_FAILED");
  });
  it("closes earlier descriptors on later open failure without any report", async () => {
    const f = await setup(), open = files.openZipBuildInput, held: Awaited<ReturnType<typeof open>>[] = []; let calls = 0;
    vi.spyOn(files, "openZipBuildInput").mockImplementation(async (...args) => { if (++calls === 3) throw Error("private-error-canary"); const value = await open(...args); held.push(value); return value; });
    await expect(runRemovalImpactInventory(f)).rejects.toThrow("LOCAL_INPUT_FAILED"); for (const value of held) await expect(value.handle.stat()).rejects.toMatchObject({ code: "EBADF" }); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("removes only its own report after source changes/cancellation and preserves foreign artifacts", async () => {
    const data = inputs(), f = await setup(data), result = inventoryGalleryRemoval(data); let calls = 0;
    await expect(writeRemovalImpactArtifact(f.out, result, async () => { if (++calls === 2) throw Error("changed"); })).rejects.toThrow("changed"); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    const g = await setup(), controller = new AbortController(); calls = 0;
    await expect(writeRemovalImpactArtifact(g.out, result, async () => { if (++calls === 2) controller.abort(); }, controller.signal)).rejects.toThrow("INTERRUPTED"); await expect(lstat(g.out)).rejects.toMatchObject({ code: "ENOENT" });
    const h = await setup(); calls = 0;
    await expect(writeRemovalImpactArtifact(h.out, result, async () => { if (++calls === 2) await writeFile(path.join(h.out, "foreign"), "preserve"); })).rejects.toThrow("OUTPUT_CHANGED"); expect(await readdir(h.out)).toEqual(["foreign"]);
  });
  it("preserves a replaced report and redacts malformed input CLI failures", async () => {
    const f = await setup(), result = inventoryGalleryRemoval(inputs()); let calls = 0;
    await expect(writeRemovalImpactArtifact(f.out, result, async () => { if (++calls === 2) { await rename(path.join(f.out, "impact.json"), path.join(f.base, "ours")); await writeFile(path.join(f.out, "impact.json"), "preserve"); } })).rejects.toThrow("OUTPUT_CHANGED"); expect(await readFile(path.join(f.out, "impact.json"), "utf8")).toBe("preserve");
    const g = await setup(); await writeFile(g.intent, "private-error-canary");
    try { await exec(process.execPath, ["scripts/inventory-gallery-removal.mts", "--snapshot", g.snapshot, "--evidence", g.evidence, "--intent", g.intent, "--out", g.out]); throw Error("expected failure"); }
    catch (error) { const e = error as { stdout: string; stderr: string }; expect(e.stdout).toBe(""); expect(e.stderr).toBe("[removal-impact] INVALID_INPUT\n"); }
  });
});
