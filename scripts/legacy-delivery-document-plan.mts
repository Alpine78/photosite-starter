/** AB#250 offline declarations only. No asset verification, mutation or publication. */
import { createHash } from "node:crypto";
import { legacyGalleryManifestString } from "../src/lib/legacy-gallery-manifest.ts";
import {
  buildLegacyImportPlan, LegacyPlanError, MAX_TOTAL_IMAGES,
  type LegacyFile, type LegacyImage,
} from "./legacy-delivery-import-plan.mts";

export const LEGACY_DOCUMENT_PLAN_VERSION = "legacy-delivery-document-plan-v1";
export const MAX_LEGACY_BINDINGS = MAX_TOTAL_IMAGES + 256;

type CandidateAsset = Readonly<{
  sourceSha256: string; assetId: string; sha1: string; bytes: number; mimeType: string;
  width?: number; height?: number; orientation?: 1;
}>;
type Reference = Readonly<{ _type: "reference"; _ref: string }>;
export type LegacyGalleryCandidate = Readonly<{
  _id: string; _type: "legacyDeliveryGallery"; handle: string; migrationBatch: string;
  published: false; displayTitle?: string; availabilityMode: "until" | "indefinite";
  expiryInstant?: string; imageCount: number; manifestDigest: string;
  deliveryZip?: Readonly<{ _type: "file"; asset: Reference }>;
}>;
export type LegacyImageCandidate = Readonly<{
  _id: string; _type: "legacyDeliveryImage"; imageId: string; migrationBatch: string;
  gallery: Reference; position: number; source: Readonly<{ _type: "image"; asset: Reference }>;
  displayWidth: number; displayHeight: number; sourceOrientation: 1; alt: string;
}>;

// Private subtype separates our fixed codes from exceptions thrown by input objects.
class DocumentPlanError extends LegacyPlanError {}
function fail(code: string): never { throw new DocumentPlanError(code); }
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("BINDING_OBJECT");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || fields.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) fail("BINDING_FIELDS");
  return value as Record<string, unknown>;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail("BINDING_DIGEST");
  return value;
}
function isImage(file: LegacyFile | LegacyImage): file is LegacyImage { return "width" in file; }
function signature(file: LegacyFile | LegacyImage): string {
  return JSON.stringify([file.sha1, file.bytes,
    isImage(file) ? [file.width, file.height, file.orientation] : null]);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** JSON-compatible input; declared candidate bindings never establish provider proof. */
export function buildLegacyDocumentPlan(
  source: unknown, expectedReviewDigest: unknown, candidateBindings: unknown, now: number,
) {
  try {
    return compile(source, expectedReviewDigest, candidateBindings, now);
  } catch (error) {
    // Never expose a getter/proxy/provider error or an input value as a diagnostic.
    if (error instanceof DocumentPlanError) throw error;
    throw new LegacyPlanError("DOCUMENT_INPUT_INVALID");
  }
}

function compile(source: unknown, expectedReviewDigest: unknown, candidateBindings: unknown, now: number) {
  const plan = buildLegacyImportPlan(source, now);
  if (hash(expectedReviewDigest) !== plan.reviewDigest) fail("SOURCE_DIGEST_MISMATCH");
  const root = object(candidateBindings, ["version", "target", "reviewDigest", "assets"]);
  const target = object(root.target, ["projectId", "dataset"]);
  if (root.version !== 1 || target.projectId !== plan.source.target.projectId ||
    target.dataset !== plan.source.target.dataset || hash(root.reviewDigest) !== plan.reviewDigest) fail("BINDING_TARGET_OR_PLAN");
  if (!Array.isArray(root.assets) || root.assets.length < 1 || root.assets.length > MAX_LEGACY_BINDINGS) fail("BINDING_COUNT");

  const expected = new Map<string, LegacyFile | LegacyImage>();
  for (const gallery of plan.source.galleries) {
    for (const file of [...gallery.images, ...(gallery.zip === null ? [] : [gallery.zip])]) {
      const prior = expected.get(file.sha256);
      if (prior !== undefined && signature(prior) !== signature(file)) fail("SOURCE_SHA256_CONFLICT");
      expected.set(file.sha256, file);
    }
  }
  const bound = new Map<string, CandidateAsset>(), assetIds = new Set<string>();
  for (let index = 0; index < root.assets.length; index += 1) {
    if (!Object.hasOwn(root.assets, index)) fail("BINDING_ARRAY_HOLE");
    const raw = root.assets[index];
    // Determine the closed shape using only an own data property, never an accessor.
    if (typeof raw !== "object" || raw === null) fail("BINDING_OBJECT");
    const declaredHash = Object.getOwnPropertyDescriptor(raw, "sourceSha256");
    if (declaredHash === undefined || !Object.hasOwn(declaredHash, "value")) fail("BINDING_FIELDS");
    const sourceSha256 = hash(declaredHash.value), file = expected.get(sourceSha256);
    if (file === undefined) fail("BINDING_EXTRA");
    const image = isImage(file);
    const row = object(raw, ["sourceSha256", "assetId", "sha1", "bytes", "mimeType",
      ...(image ? ["width", "height", "orientation"] : [])]);
    if (bound.has(sourceSha256)) fail("BINDING_DUPLICATE");
    if (typeof row.assetId !== "string" || row.assetId.length > 128 ||
      row.sha1 !== file.sha1 || row.bytes !== file.bytes) fail("BINDING_SOURCE_MISMATCH");
    const assetId = row.assetId;
    if (assetIds.has(assetId)) fail("BINDING_ASSET_COLLISION");
    let candidate: CandidateAsset;
    if (image) {
      // Exact runtime grammar. Round-trip tests guard against reader/compiler drift.
      const parts = /^image-([a-f0-9]{40})-([1-9]\d{0,4})x([1-9]\d{0,4})-(jpg|jpeg)$/u.exec(assetId);
      if (!parts || parts[1] !== file.sha1 || Number(parts[2]) !== file.width || Number(parts[3]) !== file.height ||
        row.mimeType !== "image/jpeg" || row.width !== file.width || row.height !== file.height ||
        row.orientation !== 1) fail("BINDING_IMAGE_MISMATCH");
      candidate = { sourceSha256, assetId, sha1: file.sha1, bytes: file.bytes, mimeType: "image/jpeg",
        width: file.width, height: file.height, orientation: 1 };
    } else {
      if (assetId !== `file-${file.sha1}-zip` ||
        (row.mimeType !== "application/zip" && row.mimeType !== "application/x-zip-compressed")) fail("BINDING_ZIP_MISMATCH");
      candidate = { sourceSha256, assetId, sha1: file.sha1, bytes: file.bytes, mimeType: row.mimeType };
    }
    bound.set(sourceSha256, candidate); assetIds.add(assetId);
  }
  if (bound.size !== expected.size) fail("BINDING_MISSING");

  const galleries: LegacyGalleryCandidate[] = [], images: LegacyImageCandidate[] = [];
  const documentIds = new Set<string>();
  const uniqueId = (id: string): string => {
    if (documentIds.has(id)) fail("DOCUMENT_ID_COLLISION");
    documentIds.add(id); return id;
  };
  for (let g = 0; g < plan.source.galleries.length; g += 1) {
    const gallery = plan.source.galleries[g], placements = plan.placements[g];
    const galleryId = uniqueId(`legacyDeliveryGallery-${gallery.handle}`);
    const manifestImages = gallery.images.map((image, position) => {
      const asset = bound.get(image.sha256)!;
      const imageId = placements.images[position].imageId;
      images.push({ _id: uniqueId(`legacyDeliveryImage-${imageId}`), _type: "legacyDeliveryImage",
        imageId, migrationBatch: plan.reviewDigest, gallery: { _type: "reference", _ref: galleryId },
        position, source: { _type: "image", asset: { _type: "reference", _ref: asset.assetId } },
        displayWidth: image.width, displayHeight: image.height, sourceOrientation: 1, alt: image.alt });
      return { id: imageId, position, assetId: asset.assetId, bytes: image.bytes,
        width: image.width, height: image.height, orientation: 1, alt: image.alt };
    });
    const archive = gallery.zip === null ? null : bound.get(gallery.zip.sha256)!;
    const manifestDigest = createHash("sha256").update(legacyGalleryManifestString(galleryId, plan.reviewDigest,
      manifestImages, archive === null ? null : { assetId: archive.assetId, bytes: archive.bytes })).digest("hex");
    galleries.push({ _id: galleryId, _type: "legacyDeliveryGallery", handle: gallery.handle,
      migrationBatch: plan.reviewDigest, published: false, availabilityMode: gallery.availability.mode,
      ...(gallery.availability.mode === "until" ? { expiryInstant: gallery.availability.expiryInstant } : {}),
      ...(gallery.displayTitle === undefined ? {} : { displayTitle: gallery.displayTitle }),
      imageCount: gallery.images.length, manifestDigest,
      ...(archive === null ? {} : { deliveryZip: { _type: "file" as const,
        asset: { _type: "reference" as const, _ref: archive.assetId } } }) });
  }
  const assets = [...bound.values()].sort((a, b) => a.sourceSha256 < b.sourceSha256 ? -1 : a.sourceSha256 > b.sourceSha256 ? 1 : 0);
  const candidateDocuments = [...galleries, ...images];
  const candidateDigest = createHash("sha256").update(JSON.stringify([
    LEGACY_DOCUMENT_PLAN_VERSION, plan.reviewDigest, plan.source.target.projectId, plan.source.target.dataset,
    assets.map((a) => [a.sourceSha256, a.assetId, a.sha1, a.bytes, a.mimeType, a.width ?? null, a.height ?? null, a.orientation ?? null]),
    candidateDocuments,
  ])).digest("hex");
  return freeze({ version: LEGACY_DOCUMENT_PLAN_VERSION, status: "offline-document-candidate" as const,
    reviewDigest: plan.reviewDigest, candidateDigest, target: { ...plan.source.target },
    candidateAssets: assets, candidateDocuments,
    counts: { ...plan.counts, uniqueAssets: assets.length, documents: candidateDocuments.length },
    unresolvedGates: ["fresh-source-and-cdn-byte-verification", "asset-metadata-review", "supported-whole-zip-transfer",
      "fresh-target-baseline", "existing-batch-conflicts", "provider-usage", "recovery", "notice-reconciliation",
      "owner-exact-mutation-approval", "fresh-availability-at-write", "publication"] as const,
    limitations: ["candidate-bindings-are-declarations-not-provider-proof", "unpublished-public-dataset-documents-are-enumerable",
      "page-expiry-does-not-revoke-assets-or-purge-cdn"] as const });
}
