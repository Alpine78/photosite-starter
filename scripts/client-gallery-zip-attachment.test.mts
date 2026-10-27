import { describe, expect, it } from "vitest";
import { attachmentMutation, attachmentPlan, authoredHash, parseAttachmentArguments, parseAttachmentInput, privateJson, reconcileAttachment, zipField } from "./client-gallery-zip-attachment.mts";
const id = `file-${"a".repeat(40)}-zip`, old = `file-${"b".repeat(40)}-zip`;
const input = () => ({ target: { projectId: "fixture1", dataset: "production", apiVersion: "v2026-01-01" }, galleryId: "synthetic", expectedDraftRevision: "rev-before", expectedExistingZip: null, assetId: id, classification: "processed-jpeg-exports", exportsDirectory: "/private/exports", selectionFile: "/private/selection.tsv", archiveFile: "/private/delivery.zip" });
const draft = () => ({ _id: "drafts.synthetic", _type: "clientDeliveryGallery", _rev: "rev-before", title: [], available: false, items: [] });
const asset = () => ({ _id: id, _type: "sanity.fileAsset", _rev: "asset-before", sha1hash: "a".repeat(40), extension: "zip", mimeType: "application/zip", originalFilename: "delivery.zip", size: 123 });
describe("owner-run ZIP pure approval contract", () => {
  it("closes private JSON syntax, keys, UTF8 and prototype properties", () => {
    for (const text of ['{"assetId":1,"assetId":2}', '{"a":{"constructor":1}}', '\ufeff{}']) expect(() => privateJson(Buffer.from(text))).toThrow("INVALID_INPUT");
    expect(() => privateJson(Buffer.from([0xff]))).toThrow("INVALID_INPUT");
    for (const patch of [{ galleryId: "drafts.synthetic" }, { galleryId: "versions.release.synthetic" }, { assetId: "https://example.invalid/delivery.zip" }, { expectedExistingZip: undefined }, { classification: "camera-master" }, { target: { ...input().target, apiVersion: "v2026-02-30" } }, { target: { ...input().target, apiVersion: "v2025-02-18" } }, { unexpected: true }, { galleryId: "synthetic\n" }, { exportsDirectory: "/private/../exports" }]) expect(() => parseAttachmentInput({ ...input(), ...patch })).toThrow();
  });
  it("requires explicit digest apply and refuses duplicate/unknown CLI flags before IO", () => {
    expect(parseAttachmentArguments(["--input", "x", "--output", "y"]).apply).toBe(false);
    for (const args of [[], ["--input", "x", "--output", "y", "--apply"], ["--input", "x", "--output", "y", "--approved-digest", "a".repeat(64)], ["--input", "x", "--input", "y"], ["--unknown", "x"]]) expect(() => parseAttachmentArguments(args)).toThrow("INVALID_ARGUMENTS");
  });
  it("binds complete authored content, exact target/ref/revisions and generated report digests", () => {
    const i = parseAttachmentInput(input()), plan = attachmentPlan(i, draft(), asset(), { generated: { sha256: "synthetic" } });
    expect(attachmentMutation(plan)).toEqual({ patch: { id: "drafts.synthetic", ifRevisionID: "rev-before", set: { deliveryZip: zipField(id) } } });
    expect(attachmentPlan(i, draft(), asset(), { generated: { sha256: "changed" } }).digest).not.toBe(plan.digest);
    expect(attachmentPlan(i, draft(), { ...asset(), _rev: "asset-after" }, { generated: { sha256: "synthetic" } }).digest).not.toBe(plan.digest);
    for (const bad of [{ ...draft(), _rev: "stale" }, { ...draft(), _id: "drafts.other" }, { ...draft(), _type: "clientProofGallery" }, { ...draft(), zipUrl: "bad" }, { ...draft(), deliveryZip: zipField(old) }]) expect(() => attachmentPlan(i, bad, asset(), {})).toThrow();
    for (const patch of [{ title: "private label" }, { source: {} }, { metadata: { exif: true } }, { originalFilename: "private-job.zip" }]) expect(() => attachmentPlan(i, draft(), { ...asset(), ...patch }, {})).toThrow("INVALID_ASSET");
  });
  it("permits deliberate exact replacement and detach only", () => {
    const withOld = { ...draft(), deliveryZip: zipField(old) };
    const replace = attachmentPlan(parseAttachmentInput({ ...input(), expectedExistingZip: old }), withOld, asset(), {});
    expect(attachmentMutation(replace).patch).toHaveProperty("set.deliveryZip.asset._ref", id);
    const { classification: _classification, exportsDirectory: _directory, selectionFile: _selection, archiveFile: _archive, ...base } = input();
    void _classification; void _directory; void _selection; void _archive;
    const detach = attachmentPlan(parseAttachmentInput({ ...base, expectedExistingZip: old, assetId: null }), withOld, null, {});
    expect(attachmentMutation(detach)).toEqual({ patch: { id: "drafts.synthetic", ifRevisionID: "rev-before", unset: ["deliveryZip"] } });
    expect(() => parseAttachmentInput({ ...base, assetId: null })).toThrow();
    expect(() => attachmentPlan(parseAttachmentInput({ ...base, expectedExistingZip: id, assetId: null }), withOld, null, {})).toThrow("EXISTING_ZIP_MISMATCH");
  });
  it("classifies full readback conservatively including unrelated author changes", () => {
    const plan = attachmentPlan(parseAttachmentInput(input()), draft(), asset(), {});
    const after = { ...draft(), _rev: "rev-after", _updatedAt: "new", deliveryZip: zipField(id) };
    expect(authoredHash(after)).toBe(plan.expectedPostHash);
    expect(reconcileAttachment(plan, after)).toBe("observed");
    expect(reconcileAttachment(plan, draft())).toBe("not-observed");
    for (const bad of [null, { ...after, _rev: undefined }, { ...after, _rev: "rev-before" }, { ...after, title: ["concurrent"] }, { ...draft(), _rev: "concurrent" }, { ...after, _id: "drafts.other" }]) expect(reconcileAttachment(plan, bad)).toBe("uncertain");
  });
});
