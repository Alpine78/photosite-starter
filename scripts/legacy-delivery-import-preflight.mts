/** AB#250: offline collision evidence only; no provider IO or mutation capability. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { classifySanityDocumentId } from "./sanity-audit.mts";
import { buildLegacyDocumentPlan } from "./legacy-delivery-document-plan.mts";

export const LEGACY_PREFLIGHT_VERSION = "legacy-delivery-import-preflight-v1";
export const MAX_BASELINE_DOCUMENTS = 50_000;
export const MAX_BASELINE_AGE_MS = 300_000;

export class LegacyPreflightError extends Error {
  constructor(code: string) { super(code); this.name = "LegacyPreflightError"; }
}
class InputError extends LegacyPreflightError {}
function fail(code: string): never { throw new InputError(code); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value) || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("BASELINE_OBJECT");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key))) fail("BASELINE_FIELDS");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("BASELINE_FIELDS");
    result[key] = descriptor.value;
  }
  return result;
}
function rows(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || types.isProxy(value) || !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_BASELINE_DOCUMENTS) fail("BASELINE_DOCUMENTS");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail("BASELINE_DOCUMENTS");
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("BASELINE_DOCUMENTS");
    result.push(descriptor.value);
  }
  return result;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || !value.isWellFormed() ||
    Buffer.byteLength(value, "utf8") > max || /[\p{Cc}\p{Cf}]/u.test(value)) fail("BASELINE_STRING");
  return value;
}
function identity(value: unknown): string {
  const id = text(value);
  if (!/^[A-Za-z0-9_.-]+$/u.test(id)) fail("BASELINE_ID");
  if (id.startsWith("drafts.") && (!/^drafts\.[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(id) || id.slice(7).startsWith("drafts.") || id.slice(7).startsWith("versions."))) fail("BASELINE_ID");
  if (id.startsWith("versions.") && !/^versions\.[A-Za-z0-9_-]+\.(?!drafts\.|versions\.)[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(id)) fail("BASELINE_ID");
  return classifySanityDocumentId(id).publishedId;
}
function nullable(value: unknown): string | null { return value === null ? null : text(value); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const ROW_KEYS = ["_id", "_type", "_rev", "migrationBatch", "handle", "galleryId"] as const;
const COLLISIONS = ["DOCUMENT_ID_OCCUPIED", "BATCH_ALREADY_PRESENT", "HANDLE_ALREADY_PRESENT", "PROJECTED_REFERENCE_PRESENT"] as const;

/** Rebuild the candidate; neither a declared baseline nor this report authorizes a write. */
export function buildLegacyImportPreflight(
  source: unknown, expectedReviewDigest: unknown, candidateBindings: unknown, baseline: unknown, now: number,
) {
  try { return evaluate(source, expectedReviewDigest, candidateBindings, baseline, now); }
  catch (error) {
    if (error instanceof InputError) throw error;
    throw new LegacyPreflightError("PREFLIGHT_INPUT_INVALID");
  }
}
function evaluate(source: unknown, digest: unknown, bindings: unknown, value: unknown, now: number) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) fail("PREFLIGHT_CLOCK");
  const plan = buildLegacyDocumentPlan(source, digest, bindings, now);
  const root = record(value, ["version", "target", "perspective", "capturedAt", "expectedDocumentCount", "documents"]);
  const target = record(root.target, ["projectId", "dataset"]);
  if (root.version !== 1 || root.perspective !== "raw" || target.projectId !== plan.target.projectId ||
    target.dataset !== plan.target.dataset) fail("BASELINE_TARGET");
  if (typeof root.capturedAt !== "string" || root.capturedAt.length !== 24) fail("BASELINE_TIME");
  const capturedAt = root.capturedAt, captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured) || new Date(captured).toISOString() !== capturedAt) fail("BASELINE_TIME");
  if (captured > now || now - captured > MAX_BASELINE_AGE_MS) fail("BASELINE_STALE_OR_FUTURE");
  const inputRows = rows(root.documents);
  if (!Number.isSafeInteger(root.expectedDocumentCount) || root.expectedDocumentCount !== inputRows.length) fail("BASELINE_COUNT");
  const ids = new Set(plan.candidateDocuments.map((d) => d._id));
  const handles = new Set(plan.candidateDocuments.filter((d) => d._type === "legacyDeliveryGallery").map((d) => d.handle));
  const seen = new Set<string>(), counts = new Map<string, number>();
  const observe = (code: typeof COLLISIONS[number]): void => { counts.set(code, (counts.get(code) ?? 0) + 1); };
  const normalized = inputRows.map((input) => {
    const row = record(input, ROW_KEYS);
    const _id = text(row._id), publishedId = identity(_id), _type = text(row._type, 128), _rev = text(row._rev);
    const migrationBatch = nullable(row.migrationBatch), handle = nullable(row.handle), galleryId = nullable(row.galleryId);
    if (seen.has(_id)) fail("BASELINE_DUPLICATE_ID");
    seen.add(_id);
    if (ids.has(publishedId)) observe("DOCUMENT_ID_OCCUPIED");
    if (migrationBatch === plan.reviewDigest) observe("BATCH_ALREADY_PRESENT");
    // Handles are generated lowercase hex; conservatively catch differently cased claims.
    if (handle !== null && handles.has(handle.toLowerCase())) observe("HANDLE_ALREADY_PRESENT");
    if (galleryId !== null && ids.has(identity(galleryId))) observe("PROJECTED_REFERENCE_PRESENT");
    return { _id, _type, _rev, migrationBatch, handle, galleryId };
  }).sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
  const baselineDigest = createHash("sha256").update(JSON.stringify([
    LEGACY_PREFLIGHT_VERSION, plan.target.projectId, plan.target.dataset, "raw", capturedAt,
    root.expectedDocumentCount, normalized.map((r) => ROW_KEYS.map((key) => r[key])),
  ])).digest("hex");
  return freeze({ version: LEGACY_PREFLIGHT_VERSION, status: "offline-preflight-only" as const,
    target: { ...plan.target }, reviewDigest: plan.reviewDigest, candidateDigest: plan.candidateDigest,
    baselineDigest, capturedAt, evaluatedAt: new Date(now).toISOString(),
    noCollisionObservedInDeclaredBaseline: counts.size === 0,
    collisions: COLLISIONS.filter((code) => counts.has(code)).map((code) => ({ code, count: counts.get(code)! })),
    candidateIds: [...ids].sort(), counts: { baselineDocuments: normalized.length, candidateDocuments: ids.size },
    unresolvedGates: ["authenticated-complete-current-baseline", "fresh-source-and-cdn-byte-verification",
      "asset-metadata-review", "supported-whole-zip-transfer", "provider-usage", "recovery", "notice-reconciliation",
      "owner-exact-mutation-approval", "atomic-live-collision-recheck", "fresh-availability-at-write", "publication"],
    limitations: ["baseline-is-caller-declared-not-provider-proof", "reference-check-covers-only-projected-galleryId",
      "unpublished-public-dataset-documents-are-enumerable", "page-expiry-does-not-revoke-assets-or-purge-cdn"] });
}
