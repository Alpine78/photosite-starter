/**
 * AB#394: pure candidate planning, never a deletion or operational approval.
 * Read completeness, enrollment and `now` are caller-supplied evidence. A later
 * executor must obtain fresh authoritative reads and guard every mutation.
 */
import "server-only";
import { CLIENT_GALLERY_MAX_ITEMS, isClientDocumentId, isClientGalleryHandle, parseClientGallery, type ParsedClientGallery } from "@/lib/client-gallery-model";
import { parseClientGalleryZipReference } from "@/lib/client-gallery-zip-contract";

export const RETENTION_MAX_REFERRERS = 100;
export const RETENTION_MAX_ASSETS = CLIENT_GALLERY_MAX_ITEMS + 1; // Web images and one whole ZIP.
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;
const DOCUMENT_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,255}$/u;

export type RetentionReason = "invalid-gallery" | "unsupported-type" | "invalid-clock" | "not-enrolled" |
  "enrollment-changed" | "indefinite" | "not-expired" | "incomplete-evidence" | "gallery-variants" |
  "invalid-assets" | "invalid-zip";
type Refusal = Readonly<{ state: "blocked" | "skipped"; reason: RetentionReason; readyToDelete: false; readyToWrite: false }>;
type Eligible = Readonly<{ state: "eligible"; gallery: { id: string; revision: string }; deadline: string; readyToDelete: false; readyToWrite: false }>;
type Asset = Readonly<{ id: string; revision: string; type: "sanity.imageAsset" | "sanity.fileAsset" }>;
export type CleanupCandidate = Readonly<{
  state: "candidate"; readyToDelete: false; readyToWrite: false;
  gallery: { id: string; revision: string }; deadline: string;
  /** Recognized owned locations; no authored text, handle, filename or URL. */
  references: readonly ({ kind: "image"; itemKey: string; assetId: string } | { kind: "zip"; assetId: string })[];
  candidates: readonly Asset[]; shared: readonly Asset[];
  counts: { images: number; zip: number; assets: number; candidates: number; shared: number };
}>;

const refuse = (state: Refusal["state"], reason: RetentionReason): Refusal => ({ state, reason, readyToDelete: false, readyToWrite: false });
function row(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
  // Evidence comes from JSON. Reject inherited, symbol and accessor fields.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(value).length || Object.values(descriptors).some(d => !("value" in d))) return undefined;
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown> | undefined, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)));
}
function list(value: unknown, max: number): value is unknown[] {
  return Array.isArray(value) && value.length <= max && Object.keys(value).length === value.length;
}
function revision(value: unknown): value is string { return typeof value === "string" && REVISION.test(value) && !value.endsWith("\n"); }
function documentId(value: unknown): value is string { return typeof value === "string" && DOCUMENT_ID.test(value) && !value.endsWith("\n"); }
const order = (a: Asset, b: Asset) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function eligibility(gallery: unknown, enrollment: unknown, now: number): Refusal | { parsed: ParsedClientGallery } {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return refuse("blocked", "invalid-clock");
  const raw = row(gallery);
  if (!raw || !isClientDocumentId(raw._id) || !revision(raw._rev)) return refuse("blocked", "invalid-gallery");
  if (raw._type !== "clientDeliveryGallery") return refuse("blocked", "unsupported-type");
  if (enrollment == null) return refuse("skipped", "not-enrolled");
  const enrolled = row(enrollment);
  if (!exact(enrolled, ["galleryId", "revision"]) || enrolled.galleryId !== raw._id || enrolled.revision !== raw._rev) return refuse("blocked", "enrollment-changed");
  try {
    if (!isClientGalleryHandle(raw.handle)) return refuse("blocked", "invalid-gallery");
    const parsed = parseClientGallery(raw, raw._id, raw.handle);
    if (parsed.deadline === undefined) return refuse("skipped", "indefinite");
    if (now < parsed.deadline) return refuse("skipped", "not-expired");
    return { parsed };
  } catch { return refuse("blocked", "invalid-gallery"); }
}

/** Cheap classification before any provider evidence reads; a pause is not a retention hold. */
export function classifyClientGalleryExpiry(gallery: unknown, enrollment: unknown, now: number): Refusal | Eligible {
  const result = eligibility(gallery, enrollment, now);
  if (!("parsed" in result)) return result;
  const { id, revision, expiryInstant } = result.parsed;
  return { state: "eligible", gallery: { id, revision }, deadline: expiryInstant!, readyToDelete: false, readyToWrite: false };
}

/**
 * Caller-supplied evidence contract, not a Sanity schema or HTTP response contract:
 * { galleryId, revision, variants: {complete, ids}, assetsComplete, assets }.
 * Each asset supplies {id, revision, type, complete, referenceCount, referrers};
 * referrers are exact full {id, revision} identities, including drafts/releases.
 * A list reaching its cap is treated as truncated. No "absence" is inferred.
 *
 * `zipReference`, if supplied, must match the gallery's actual native file field.
 * It cannot nominate an additional asset for deletion.
 */
export function planClientGalleryCleanup(input: Readonly<{
  gallery: unknown; enrollment: unknown; now: number; evidence: unknown; zipReference?: unknown;
}>): Refusal | CleanupCandidate {
  const result = eligibility(input.gallery, input.enrollment, input.now);
  if (!("parsed" in result)) return result;
  const gallery = result.parsed;
  const evidence = row(input.evidence);
  if (!exact(evidence, ["galleryId", "revision", "variants", "assetsComplete", "assets"]) ||
    evidence.galleryId !== gallery.id || evidence.revision !== gallery.revision || evidence.assetsComplete !== true) return refuse("blocked", "incomplete-evidence");
  const variants = row(evidence.variants);
  if (!exact(variants, ["complete", "ids"]) || variants.complete !== true || !list(variants.ids, 2)) return refuse("blocked", "incomplete-evidence");
  if (variants.ids.length !== 1 || variants.ids[0] !== gallery.id) return refuse("blocked", "gallery-variants");
  const references: CleanupCandidate["references"][number][] = gallery.items.map(item => ({ kind: "image", itemKey: item.key, assetId: item.assetId }));
  const owned = new Map<string, Asset["type"]>(gallery.items.map(item => [item.assetId, "sanity.imageAsset"]));
  if (input.zipReference !== undefined) {
    try {
      const zip = parseClientGalleryZipReference(input.zipReference);
      if (!zip || zip.assetId !== gallery.deliveryZip?.assetId) return refuse("blocked", "invalid-zip");
    } catch { return refuse("blocked", "invalid-zip"); }
  }
  if (gallery.deliveryZip) {
    references.push({ kind: "zip", assetId: gallery.deliveryZip.assetId }); owned.set(gallery.deliveryZip.assetId, "sanity.fileAsset");
  }
  if (!list(evidence.assets, RETENTION_MAX_ASSETS) || evidence.assets.length !== owned.size) return refuse("blocked", "invalid-assets");
  const seen = new Set<string>(), candidates: Asset[] = [], shared: Asset[] = [];
  for (const value of evidence.assets) {
    const asset = row(value);
    if (!exact(asset, ["id", "revision", "type", "complete", "referenceCount", "referrers"]) || typeof asset.id !== "string" ||
      !owned.has(asset.id) || seen.has(asset.id) || owned.get(asset.id) !== asset.type || !revision(asset.revision) ||
      asset.complete !== true || !list(asset.referrers, RETENTION_MAX_REFERRERS - 1) ||
      asset.referenceCount !== asset.referrers.length) return refuse("blocked", "invalid-assets");
    seen.add(asset.id);
    let anotherUse = false, selfSeen = false;
    const referrers = new Set<string>();
    for (const entry of asset.referrers) {
      const ref = row(entry);
      if (!exact(ref, ["id", "revision"]) || !documentId(ref.id) || !revision(ref.revision) || referrers.has(ref.id)) return refuse("blocked", "invalid-assets");
      referrers.add(ref.id);
      if (ref.id === gallery.id) {
        if (ref.revision !== gallery.revision) return refuse("blocked", "incomplete-evidence");
        selfSeen = true;
      } else anotherUse = true;
    }
    if (!selfSeen) return refuse("blocked", "incomplete-evidence");
    const identity: Asset = { id: asset.id, revision: asset.revision, type: owned.get(asset.id)! };
    (anotherUse ? shared : candidates).push(identity);
  }
  candidates.sort(order); shared.sort(order);
  return {
    state: "candidate", readyToDelete: false, readyToWrite: false,
    gallery: { id: gallery.id, revision: gallery.revision }, deadline: gallery.expiryInstant!, references, candidates, shared,
    counts: { images: gallery.items.length, zip: gallery.deliveryZip ? 1 : 0, assets: owned.size, candidates: candidates.length, shared: shared.length },
  };
}
