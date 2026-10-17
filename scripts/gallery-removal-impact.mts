/** Offline observed references only: this module never authorizes a mutation. */
import { canonicalJson, digest, LIMITS, strictJson } from "./identity-retirement-reconciliation.mts";
export const REMOVAL_LIMITS = Object.freeze({ ...LIMITS, lineBytes: 8 * 1024 * 1024, evidenceBytes: 16_384, intentBytes: 4096 });
export class RemovalImpactError extends Error { readonly code: string; constructor(code: string) { super(`[removal-impact] ${code}`); this.code = code; } }
export function refuseRemoval(code: string): never { throw new RemovalImpactError(code); }
const notices = Object.freeze([
  "Completeness is owner-attested; absent references do not prove an asset is unused.",
  "A raw export may not represent one atomic point in time; fresh live revision/reference checks remain required.",
  "Hardcoded URLs, emails, other datasets, caches and downloaded copies are outside this snapshot.",
  "Page unpublication or expiry does not revoke public file URLs, caches or downloaded copies.",
  "Legacy links/deadlines and privateOnly/sales classifications are unchanged. No deletion or write is authorized.",
]);
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuseRemoval("INVALID_OBJECT"); return value as RecordValue;
}
function id(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_.-]+$/u.test(value); }
function revision(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/u.test(value); }
function closed(value: RecordValue, fields: readonly string[]) { if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) refuseRemoval("INVALID_FIELDS"); }
function decode(bytes: Uint8Array, maximum: number) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > maximum || (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)) refuseRemoval("INPUT_LIMIT");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refuseRemoval("INVALID_UTF8"); }
}
function baseOf(value: string): string | undefined {
  if (value.startsWith("drafts.")) {
    const base = value.slice(7); return base && !base.startsWith("drafts.") && !base.startsWith("versions.") ? base : undefined;
  }
  if (value.startsWith("versions.")) {
    const match = /^versions\.[^.]+\.(.+)$/u.exec(value), base = match?.[1];
    return base && !base.startsWith("drafts.") && !base.startsWith("versions.") ? base : undefined;
  }
  return value;
}
function assetKind(value: string): "sanity.imageAsset" | "sanity.fileAsset" | undefined {
  return value.startsWith("image-") ? "sanity.imageAsset" : value.startsWith("file-") ? "sanity.fileAsset" : undefined;
}
type Summary = { id: string; revision: string; type: string; refs: Set<string>; gallery?: string; issues: Set<string>; possibleMentions: number; externalRefs: number };
function summarize(raw: RecordValue): Summary {
  if (!id(raw._id) || !revision(raw._rev) || !id(raw._type)) refuseRemoval("INVALID_DOCUMENT_IDENTITY");
  const result: Summary = { id: raw._id, revision: raw._rev, type: raw._type, refs: new Set(), issues: new Set(), possibleMentions: 0, externalRefs: 0 };
  const gallery = raw.gallery;
  if (gallery && typeof gallery === "object" && !Array.isArray(gallery)) {
    const ref = gallery as RecordValue;
    if (ref._type === "reference" && id(ref._ref) && !Object.hasOwn(ref, "_dataset") && !Object.hasOwn(ref, "_projectId")) result.gallery = ref._ref;
  }
  function visit(value: unknown) {
    if (typeof value === "string") { if (/(?:image-|file-)[a-f0-9]{40}|cdn\.sanity\.io\//u.test(value)) result.possibleMentions++; return; }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry); return; }
    const record = value as RecordValue;
    if (Object.hasOwn(record, "_ref")) {
      if ((record._type !== "reference" && record._type !== "crossDatasetReference") || !id(record._ref) || (Object.hasOwn(record, "_weak") && typeof record._weak !== "boolean")) result.issues.add("malformed-reference");
      else if (record._type === "crossDatasetReference" || Object.hasOwn(record, "_dataset") || Object.hasOwn(record, "_projectId")) result.externalRefs++;
      else result.refs.add(record._ref);
    }
    for (const [key, entry] of Object.entries(record)) {
      // The asset document's own native URL identifies its bytes, not an authored use.
      const ownAssetUrl = record === raw && key === "url" && typeof entry === "string" && assetKind(result.id) === result.type;
      if (!["_id", "_rev", "_type", "_ref"].includes(key) && !ownAssetUrl) visit(entry);
    }
  }
  visit(raw); return result;
}
const ordered = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function inventoryGalleryRemoval(input: { snapshot: Uint8Array; evidence: Uint8Array; intent: Uint8Array }, limits = REMOVAL_LIMITS) {
  try {
    const evidence = object(strictJson(decode(input.evidence, limits.evidenceBytes), limits));
    closed(evidence, ["version", "snapshotSha256", "documentCount", "scope", "collection", "capturedAt"]);
    if (evidence.version !== 1 || evidence.scope !== "all-documents-including-drafts-and-releases" || evidence.collection !== "owner-attested-unfiltered" || typeof evidence.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(evidence.snapshotSha256) || typeof evidence.capturedAt !== "string" || !Number.isFinite(Date.parse(evidence.capturedAt)) || new Date(evidence.capturedAt).toISOString() !== evidence.capturedAt) refuseRemoval("INVALID_SNAPSHOT_EVIDENCE");
    const intent = object(strictJson(decode(input.intent, limits.intentBytes), limits)); closed(intent, ["version", "galleryId", "expectedRevision"]);
    if (intent.version !== 1 || !id(intent.galleryId) || baseOf(intent.galleryId) !== intent.galleryId || !revision(intent.expectedRevision)) refuseRemoval("INVALID_INTENT");
    if (digest(input.snapshot) !== evidence.snapshotSha256) refuseRemoval("SNAPSHOT_DIGEST_MISMATCH");
    const text = decode(input.snapshot, limits.bytes), lines = text.split(/\r?\n/u); if (lines.at(-1) === "") lines.pop();
    if (!lines.length || lines.length > limits.documents || evidence.documentCount !== lines.length) refuseRemoval("SNAPSHOT_COUNT_MISMATCH");
    const docs = new Map<string, Summary>(), budget = { nodes: 0 };
    for (const line of lines) {
      if (!line.trim() || Buffer.byteLength(line) > limits.lineBytes) refuseRemoval("SNAPSHOT_LINE_LIMIT");
      const summary = summarize(object(strictJson(line, limits, budget)));
      if (docs.has(summary.id)) refuseRemoval("DUPLICATE_DOCUMENT"); docs.set(summary.id, summary);
    }
    const gallery = docs.get(intent.galleryId);
    if (!gallery || !["clientDeliveryGallery", "legacyDeliveryGallery"].includes(gallery.type)) refuseRemoval("PUBLISHED_GALLERY_REQUIRED");
    if (gallery.revision !== intent.expectedRevision) refuseRemoval("GALLERY_REVISION_CHANGED");
    const variants = [...docs.values()].filter(doc => baseOf(doc.id) === gallery.id), owned = new Map(variants.map(doc => [doc.id, doc]));
    const blockers = new Set<string>();
    if (variants.some(doc => doc.type !== gallery.type)) blockers.add("gallery-variant-type-mismatch");
    if (gallery.type === "legacyDeliveryGallery") {
      const imageBases = new Set([...docs.values()].filter(doc => doc.type === "legacyDeliveryImage" && doc.gallery && baseOf(doc.gallery) === gallery.id).map(doc => baseOf(doc.id)).filter((base): base is string => base !== undefined));
      for (const doc of docs.values()) if (imageBases.has(baseOf(doc.id) ?? "")) {
        owned.set(doc.id, doc);
        if (doc.type !== "legacyDeliveryImage" || !doc.gallery || baseOf(doc.gallery) !== gallery.id) blockers.add("legacy-image-variant-ownership-mismatch");
      }
    }
    const assets = new Set<string>(), inbound = new Map<string, Summary[]>(); let missingReferences = 0, unstructuredMentions = 0, externalReferences = 0, malformedReferences = 0, untraversedOwnedReferences = 0;
    for (const doc of docs.values()) {
      if (baseOf(doc.id) === undefined) blockers.add("ambiguous-document-variant");
      if (doc.issues.size) { malformedReferences++; blockers.add("malformed-reference"); }
      unstructuredMentions += doc.possibleMentions; externalReferences += doc.externalRefs;
      for (const ref of doc.refs) {
        const target = docs.get(ref); if (!target) missingReferences++;
        const referrers = inbound.get(ref) ?? []; referrers.push(doc); inbound.set(ref, referrers);
        const kind = assetKind(ref);
        if (kind && target && target.type !== kind) blockers.add("asset-type-mismatch");
        if (target && ["sanity.imageAsset", "sanity.fileAsset"].includes(target.type) && target.type !== kind) blockers.add("asset-identity-type-mismatch");
        if (owned.has(doc.id)) {
          if (kind) assets.add(ref);
          else if (!owned.has(ref)) untraversedOwnedReferences++;
        }
      }
    }
    if (missingReferences) blockers.add("missing-reference-targets");
    if (externalReferences) blockers.add("cross-dataset-references-not-resolved");
    if (unstructuredMentions) blockers.add("possible-unstructured-asset-mentions");
    if (untraversedOwnedReferences) blockers.add("non-gallery-reference-targets-not-traversed");
    const assetReports = [...assets].sort(ordered).map(assetId => {
      const asset = docs.get(assetId), referrers = (inbound.get(assetId) ?? []).sort((a, b) => ordered(a.id, b.id));
      const other = referrers.filter(doc => !owned.has(doc.id)).length;
      return { assetId, present: Boolean(asset), expectedType: assetKind(assetId)!, ...(asset ? { observedType: asset.type, revision: asset.revision } : {}),
        otherReferrersObservedInSnapshot: other, referrers: referrers.map(doc => ({ documentId: doc.id, revision: doc.revision, type: doc.type, role: owned.has(doc.id) ? "selected-gallery-record" : "other-record" })) };
    });
    const galleryReferrers = [...inbound.entries()].filter(([target]) => baseOf(target) === gallery.id).sort(([a], [b]) => ordered(a, b))
      .flatMap(([targetDocumentId, referrers]) => [...referrers].sort((a, b) => ordered(a.id, b.id)).map(doc => ({
        targetDocumentId, documentId: doc.id, revision: doc.revision, type: doc.type,
        role: owned.has(doc.id) ? "selected-gallery-record" : "other-record",
      })));
    if (galleryReferrers.some(referrer => referrer.role === "other-record")) blockers.add("other-gallery-referrers-observed");
    const report = { version: 1, status: "observed-removal-impact-offline", readyToDelete: false, readyToWrite: false,
      snapshotSha256: evidence.snapshotSha256, evidenceSha256: digest(input.evidence), intentSha256: digest(input.intent),
      completeness: "owner-attested-not-independently-verified", capturedAt: evidence.capturedAt,
      gallery: { documentId: gallery.id, revision: gallery.revision, type: gallery.type },
      selectedRecords: [...owned.values()].sort((a, b) => ordered(a.id, b.id)).map(doc => ({ documentId: doc.id, revision: doc.revision, type: doc.type })),
      snapshotDocuments: docs.size, galleryReferrers, assetCount: assetReports.length, assets: assetReports,
      observations: { missingReferences, malformedReferences, externalReferences, unstructuredMentions, untraversedOwnedReferences }, blockers: [...blockers].sort(ordered), notices } as const;
    const serialized = canonicalJson(report); if (Buffer.byteLength(serialized) > limits.reportBytes) refuseRemoval("REPORT_LIMIT");
    return { report, reportSha256: digest(Buffer.from(serialized)) };
  } catch (error) { if (error instanceof RemovalImpactError) throw error; refuseRemoval("INVALID_INPUT"); }
}
export function verifyRemovalInventory(input: Parameters<typeof inventoryGalleryRemoval>[0], previous: unknown) {
  const current = inventoryGalleryRemoval(input);
  if (canonicalJson(current) !== canonicalJson(previous)) refuseRemoval("INVENTORY_OR_SOURCE_CHANGED"); return current;
}
