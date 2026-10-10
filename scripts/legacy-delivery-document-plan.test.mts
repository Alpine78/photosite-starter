import { describe, expect, it, vi } from "vitest";
import { buildLegacyImportPlan, LegacyPlanError, type LegacySource, type LegacyFile, type LegacyImage } from "./legacy-delivery-import-plan.mts";
import { buildLegacyDocumentPlan, MAX_LEGACY_BINDINGS } from "./legacy-delivery-document-plan.mts";
import { createLegacyGalleryReader } from "../src/lib/legacy-gallery-sanity.ts";
import { legacyDeliveryGalleryType } from "../sanity/schemas/legacy-delivery-gallery.ts";
import { legacyDeliveryImageType } from "../sanity/schemas/legacy-delivery-image.ts";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const now = Date.parse("2026-10-10T12:00:00Z"), deadline = Date.parse("2027-01-07T22:00:00Z");
function fixture(): Mutable<LegacySource> {
  return { version: 1, target: { projectId: "synthetic-project", dataset: "production" },
    sourceEvidence: { backupSha256: "a".repeat(64), availabilitySha256: "b".repeat(64),
      orderingSha256: "c".repeat(64), inventorySha256: "d".repeat(64) }, excludedLegacyIds: [3],
    galleries: [{ legacyId: 2, handle: "1".repeat(32), legacyPath: "/clients/synthetic",
      displayTitle: "Synthetic delivery", availability: { mode: "until", expiryInstant: "2027-01-07T22:00:00Z" },
      images: [
        { sourceLocator: "images/one.jpg", sha1: "1".repeat(40), sha256: "1".repeat(64), bytes: 500,
          width: 3000, height: 2000, orientation: 1, alt: "Whole frame" },
        { sourceLocator: "images/two.jpg", sha1: "2".repeat(40), sha256: "2".repeat(64), bytes: 501,
          width: 2000, height: 3000, orientation: 1, alt: "" },
      ], zip: { sourceLocator: "packages/one.zip", sha1: "3".repeat(40), sha256: "3".repeat(64), bytes: 2032617616 } }] };
}
type Binding = { sourceSha256: string; assetId: string; sha1: string; bytes: number; mimeType: string;
  width?: number; height?: number; orientation?: number };
function isImage(file: LegacyFile | LegacyImage): file is LegacyImage { return "width" in file; }
function bindingFixture(source = fixture()) {
  const p = buildLegacyImportPlan(source, now), files = new Map<string, Binding>();
  for (const gallery of p.source.galleries) {
    for (const file of [...gallery.images, ...(gallery.zip === null ? [] : [gallery.zip])]) {
      const image = isImage(file);
      files.set(file.sha256, { sourceSha256: file.sha256, sha1: file.sha1, bytes: file.bytes,
        assetId: image ? `image-${file.sha1}-${file.width}x${file.height}-jpg` : `file-${file.sha1}-zip`,
        mimeType: image ? "image/jpeg" : "application/zip",
        ...(image ? { width: file.width, height: file.height, orientation: 1 } : {}) });
    }
  }
  return { version: 1, target: { ...source.target }, reviewDigest: p.reviewDigest, assets: [...files.values()] };
}
function compile(source = fixture(), bindings = bindingFixture(source), clock = now) {
  return buildLegacyDocumentPlan(source, bindings.reviewDigest, bindings, clock);
}

describe("offline legacy document candidates", () => {
  it("makes unpublished allowlisted documents with exact dimensions, order and deadline", () => {
    const source = fixture(), bindings = bindingFixture(source), before = structuredClone({ source, bindings });
    const p = compile(source, bindings), gallery = p.candidateDocuments[0];
    expect(gallery).toMatchObject({ _id: `legacyDeliveryGallery-${source.galleries[0].handle}`,
      _type: "legacyDeliveryGallery", published: false, imageCount: 2,
      availabilityMode: "until", expiryInstant: "2027-01-07T22:00:00Z", migrationBatch: p.reviewDigest });
    expect(p.counts).toEqual({ galleries: 1, images: 2, zips: 1, excluded: 1, uniqueAssets: 3, documents: 3 });
    expect(p.candidateDocuments.slice(1)).toMatchObject([
      { position: 0, displayWidth: 3000, displayHeight: 2000, sourceOrientation: 1, alt: "Whole frame" },
      { position: 1, displayWidth: 2000, displayHeight: 3000, sourceOrientation: 1, alt: "" },
    ]);
    expect({ source, bindings }).toEqual(before);
    const payload = JSON.stringify(p.candidateDocuments);
    for (const excluded of ["sourceLocator", "legacyPath", "legacyId", "sourceSha256", "backupSha256", "https:", "originalFilename"])
      expect(payload).not.toContain(excluded);
    expect(new Set(p.candidateDocuments.map((d) => d._id)).size).toBe(3);
    expect(p.candidateDocuments.every((d) => /^[A-Za-z][A-Za-z0-9-]{1,127}$/u.test(d._id))).toBe(true);
  });
  it("keeps fabricated well-formed descriptors explicitly unverified and gated", () => {
    const p = compile();
    expect(p.status).toBe("offline-document-candidate");
    expect(p.unresolvedGates).toEqual(expect.arrayContaining(["fresh-source-and-cdn-byte-verification",
      "asset-metadata-review", "supported-whole-zip-transfer", "existing-batch-conflicts", "fresh-availability-at-write",
      "recovery", "notice-reconciliation", "owner-exact-mutation-approval", "publication"]));
    expect(p.limitations).toContain("candidate-bindings-are-declarations-not-provider-proof");
    expect(p.limitations).toContain("unpublished-public-dataset-documents-are-enumerable");
    expect(p.limitations).toContain("page-expiry-does-not-revoke-assets-or-purge-cdn");
    expect(p).not.toHaveProperty("mutations"); expect(p).not.toHaveProperty("documents");
  });
  it("returns detached deep-frozen output without freezing or mutating inputs", () => {
    const source = fixture(), b = bindingFixture(source), p = compile(source, b), digest = p.candidateDigest;
    expect(Object.isFrozen(source)).toBe(false); expect(Object.isFrozen(b.assets[0])).toBe(false);
    b.assets[0].assetId = "changed"; source.galleries[0].images[0].alt = "changed";
    expect(p.candidateDigest).toBe(digest); expect(p.candidateAssets[0].assetId).not.toBe("changed");
    expect(() => Object.assign(p.candidateDocuments[0], { published: true })).toThrow(TypeError);
    expect(() => Object.assign(p.candidateAssets[0], { bytes: 1 })).toThrow(TypeError);
    expect(() => p.candidateDocuments.push(p.candidateDocuments[0])).toThrow(TypeError);
  });
  it("shares source assets while preserving every repeated placement and gallery reference", () => {
    const s = fixture(); s.galleries[0].images.push(structuredClone(s.galleries[0].images[0]));
    const other = structuredClone(s.galleries[0]); other.legacyId = 10; other.handle = "2".repeat(32); other.legacyPath = "/clients/other";
    s.galleries.unshift(other); const p = compile(s);
    expect(p.counts).toMatchObject({ uniqueAssets: 3, images: 6, documents: 8 });
    expect(p.candidateDocuments.filter((d) => d._type === "legacyDeliveryImage").map((d) => d.position)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(new Set(p.candidateDocuments.map((d) => d._id)).size).toBe(8);
  });
  it("omits absent ZIP and indefinite deadline without inventing a package or date", () => {
    const s = fixture(); s.galleries[0].availability = { mode: "indefinite" }; s.galleries[0].zip = null;
    delete s.galleries[0].displayTitle;
    const p = compile(s, bindingFixture(s), deadline + 1000), gallery = p.candidateDocuments[0];
    expect(gallery).not.toHaveProperty("expiryInstant"); expect(gallery).not.toHaveProperty("deliveryZip");
    expect(gallery).not.toHaveProperty("displayTitle"); expect(p.counts).toMatchObject({ zips: 0, uniqueAssets: 2 });
  });
  it.each([deadline, deadline + 1, NaN])("refuses expired or invalid-clock source at %s", (clock) => {
    expect(() => compile(fixture(), bindingFixture(), clock)).toThrow("DOCUMENT_INPUT_INVALID");
  });
  it("allows only time strictly before the exclusive deadline, without changing identity", () => {
    expect(compile(fixture(), bindingFixture(), deadline - 1)).toEqual(compile());
  });
  it("canonicalizes binding, gallery and object-key order without changing image order", () => {
    const s = fixture(), other = structuredClone(s.galleries[0]);
    other.legacyId = 10; other.handle = "2".repeat(32); other.legacyPath = "/clients/other";
    s.galleries.push(other); const b = bindingFixture(s), before = compile(s, b);
    s.galleries.reverse(); b.assets.reverse();
    b.assets = b.assets.map((asset) => Object.fromEntries(Object.entries(asset).reverse()) as Binding);
    expect(compile(s, b)).toEqual(before);
  });
  it("binds candidate identity separately from the source batch identity", () => {
    const source = fixture(), b = bindingFixture(source), first = compile(source, b);
    b.assets[0].assetId = b.assets[0].assetId.replace(/-jpg$/u, "-jpeg");
    const next = compile(source, b);
    expect(next.reviewDigest).toBe(first.reviewDigest); expect(next.candidateDigest).not.toBe(first.candidateDigest);
    expect(next.candidateDocuments[0]).not.toEqual(first.candidateDocuments[0]);
    source.galleries[0].images.reverse();
    expect(() => compile(source, b)).toThrow("SOURCE_DIGEST_MISMATCH");
    const changed = compile(source); expect(changed.reviewDigest).not.toBe(first.reviewDigest);
    expect(changed.candidateDigest).not.toBe(first.candidateDigest);
  });
  it.each([null, [], { version: 1 }, { ...bindingFixture(), extra: true }, { ...bindingFixture(), __proto__: {} }])
    ("rejects malformed or open binding roots", (bindings) => {
      expect(() => buildLegacyDocumentPlan(fixture(), bindingFixture().reviewDigest, bindings, now)).toThrow();
    });
  it("rejects unknown fields at target and both asset boundaries, symbols and own prototype keys", () => {
    for (const index of [-1, 0, 2]) {
      const b = bindingFixture(), row = index === -1 ? b.target : b.assets[index];
      Object.defineProperty(row, "__proto__", { enumerable: true, value: "extra" });
      expect(() => compile(fixture(), b)).toThrow("BINDING_FIELDS");
    }
    const b = bindingFixture(); Object.defineProperty(b.assets[0], Symbol("extra"), { value: true });
    expect(() => compile(fixture(), b)).toThrow("BINDING_FIELDS");
  });
  it("rejects missing, extra, duplicate and sparse candidate bindings", () => {
    const missing = bindingFixture(); missing.assets.pop(); expect(() => compile(fixture(), missing)).toThrow("BINDING_MISSING");
    const extra = bindingFixture(); extra.assets.push({ ...extra.assets[0], sourceSha256: "f".repeat(64) });
    expect(() => compile(fixture(), extra)).toThrow("BINDING_EXTRA");
    const duplicate = bindingFixture(); duplicate.assets.push(duplicate.assets[0]);
    expect(() => compile(fixture(), duplicate)).toThrow("BINDING_DUPLICATE");
    const sparse = bindingFixture(); delete sparse.assets[1]; expect(() => compile(fixture(), sparse)).toThrow("BINDING_ARRAY_HOLE");
    const oversized = bindingFixture(); oversized.assets = Array(MAX_LEGACY_BINDINGS + 1);
    expect(() => compile(fixture(), oversized)).toThrow("BINDING_COUNT");
  });
  it("rejects target/version/plan substitution and malformed expected digest", () => {
    for (const edit of [
      (b: ReturnType<typeof bindingFixture>) => { b.target.projectId = "other-project"; },
      (b: ReturnType<typeof bindingFixture>) => { b.target.dataset = "preview" as "production"; },
      (b: ReturnType<typeof bindingFixture>) => { b.version = 2; },
      (b: ReturnType<typeof bindingFixture>) => { b.reviewDigest = "f".repeat(64); },
    ]) { const b = bindingFixture(); edit(b);
      expect(() => buildLegacyDocumentPlan(fixture(), bindingFixture().reviewDigest, b, now)).toThrow("BINDING_TARGET_OR_PLAN"); }
    for (const digest of [null, 1, "A".repeat(64), "f".repeat(63), "f".repeat(64)])
      expect(() => buildLegacyDocumentPlan(fixture(), digest, bindingFixture(), now)).toThrow();
  });
  it.each([
    { sha1: "f".repeat(40) }, { bytes: 499 }, { bytes: NaN }, { bytes: Infinity }, { bytes: -0 },
    { bytes: Number.MAX_SAFE_INTEGER + 1 }, { assetId: `image-${"f".repeat(40)}-3000x2000-jpg` },
    { assetId: `image-${"1".repeat(40)}-03000x2000-jpg` }, { assetId: `image-${"1".repeat(40)}-2000x3000-jpg` },
    { assetId: `image-${"1".repeat(40)}-3000x2000-png` }, { assetId: "https://other.test/photo.jpg" },
    { assetId: "a".repeat(129) }, { width: 2000 }, { height: 2000.5 }, { orientation: 6 },
    { mimeType: "image/png" }, { sourceSha256: "F".repeat(64) },
  ])("rejects contradictory image binding %j", (change) => {
    const b = bindingFixture(); Object.assign(b.assets[0], change); expect(() => compile(fixture(), b)).toThrow();
  });
  it.each([{ assetId: `file-${"f".repeat(40)}-zip` }, { mimeType: "application/octet-stream" },
    { bytes: 2032617615 }, { width: 1 }, { assetId: `file-${"3".repeat(40)}-jpg` }])
    ("rejects contradictory whole ZIP binding %j", (change) => {
      const b = bindingFixture(); Object.assign(b.assets[2], change); expect(() => compile(fixture(), b)).toThrow();
    });
  it("refuses one source SHA256 describing inconsistent content", () => {
    const s = fixture(); s.galleries[0].images[1].sha256 = s.galleries[0].images[0].sha256;
    const digest = buildLegacyImportPlan(s, now).reviewDigest, b = bindingFixture(s);
    expect(() => buildLegacyDocumentPlan(s, digest, b, now)).toThrow("SOURCE_SHA256_CONFLICT");
  });
  it("keeps square frames at orientation 1 and refuses orientation 8 even without a dimension swap", () => {
    const s = fixture(); s.galleries[0].images[0].height = 3000;
    const b = bindingFixture(s);
    expect(compile(s, b).candidateDocuments[1]).toMatchObject({ displayWidth: 3000, displayHeight: 3000, sourceOrientation: 1 });
    b.assets[0].orientation = 8; expect(() => compile(s, b)).toThrow("BINDING_IMAGE_MISMATCH");
    Object.assign(s.galleries[0].images[0], { orientation: 8 });
    expect(() => compile(s, b)).toThrow("DOCUMENT_INPUT_INVALID");
  });
  it("does not swap or rotate a nonsquare orientation-8 declaration", () => {
    const b = bindingFixture(); Object.assign(b.assets[0], { orientation: 8, width: 2000, height: 3000 });
    expect(() => compile(fixture(), b)).toThrow("BINDING_IMAGE_MISMATCH");
  });
  it("does not leak accessor/proxy errors, even if they impersonate the source error class", () => {
    const b = bindingFixture(); Object.defineProperty(b.assets[0], "bytes", { get() { throw new Error("sensitive"); } });
    expect(() => compile(fixture(), b)).toThrow("BINDING_FIELDS");
    const throwing = new Proxy({}, { ownKeys() { throw new LegacyPlanError("sensitive"); } });
    expect(() => buildLegacyDocumentPlan(fixture(), bindingFixture().reviewDigest, throwing, now)).toThrow("DOCUMENT_INPUT_INVALID");
    const s = fixture(); Object.defineProperty(s, "galleries", { get() { throw new LegacyPlanError("sensitive"); } });
    expect(() => buildLegacyDocumentPlan(s, bindingFixture().reviewDigest, bindingFixture(), now)).toThrow("DOCUMENT_INPUT_INVALID");
  });
  it("projects only declared schema fields, covering every optional variant", () => {
    const withOptional = compile(), s = fixture(); s.galleries[0].availability = { mode: "indefinite" }; s.galleries[0].zip = null;
    delete s.galleries[0].displayTitle;
    const docs = [...withOptional.candidateDocuments, ...compile(s).candidateDocuments];
    for (const schema of [legacyDeliveryGalleryType, legacyDeliveryImageType]) {
      const declared = new Set(schema.fields.map((f) => f.name));
      const seen = new Set(docs.filter((d) => d._type === schema.name).flatMap((d) => Object.keys(d).filter((k) => !k.startsWith("_"))));
      expect(seen).toEqual(declared);
    }
  });
  it.each(["jpg", "jpeg"])("round-trips %s and both ZIP MIME values through the real reader without transforms", async (extension) => {
    for (const mimeType of ["application/zip", "application/x-zip-compressed"]) {
      const s = fixture(), b = bindingFixture(s);
      b.assets[0].assetId = b.assets[0].assetId.replace(/-jpg$/u, `-${extension}`); b.assets[2].mimeType = mimeType;
      const p = compile(s, b), gallery = p.candidateDocuments.find((d) => d._type === "legacyDeliveryGallery")!;
      const candidates = p.candidateDocuments.filter((d) => d._type === "legacyDeliveryImage");
      const assets = new Map(p.candidateAssets.map((a) => [a.assetId, a]));
      const data = { images: candidates.map((d) => ({ ...d,
        galleryId: d.gallery._ref, galleryReferenceType: d.gallery._type,
        sourceAssetId: d.source.asset._ref, sourceReferenceType: d.source.asset._type,
        asset: { _id: d.source.asset._ref, _type: "sanity.imageAsset", sha1hash: assets.get(d.source.asset._ref)!.sha1,
          size: assets.get(d.source.asset._ref)!.bytes, mimeType: "image/jpeg" } })),
        zip: { _id: b.assets[2].assetId, _type: "sanity.fileAsset", sha1hash: b.assets[2].sha1,
          size: b.assets[2].bytes, mimeType } };
      const document = { ...gallery, _rev: "synthetic-revision" }, query = vi.fn().mockResolvedValue(data);
      const settings = { config: p.target, batch: p.reviewDigest, documents: { read: vi.fn().mockResolvedValue(document) }, query: { query }, now: () => deadline - 1 };
      expect(await createLegacyGalleryReader(settings).read(gallery.handle)).toBeUndefined(); expect(query).not.toHaveBeenCalled();
      const readable = { ...document, published: true };
      const reader = createLegacyGalleryReader({ ...settings, documents: { read: vi.fn().mockResolvedValue(readable) } });
      const view = await reader.read(gallery.handle);
      expect(view?.images.map((i) => [i.width, i.height])).toEqual([[3000, 2000], [2000, 3000]]);
      expect(view?.images[0].src).toBe(`https://cdn.sanity.io/images/synthetic-project/production/${"1".repeat(40)}-3000x2000.${extension}`);
      expect(view?.zipUrl).toBe(`https://cdn.sanity.io/files/synthetic-project/production/${"3".repeat(40)}.zip?dl=photographs.zip`);
      expect(gallery.published).toBe(false);
      expect(await createLegacyGalleryReader({ ...settings, documents: { read: vi.fn().mockResolvedValue(readable) }, now: () => deadline }).read(gallery.handle)).toBeUndefined();
    }
  });
});
