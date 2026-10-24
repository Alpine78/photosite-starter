/** Private operational metadata shared by authenticated Studio and the cleanup worker.
 * Pure browser/server contract: no CMS SDK, credentials or public gallery projection.
 */
export const CLEANUP_CONTROL_TYPE = "clientGalleryCleanup" as const;
export const CLEANUP_CONTROL_PREFIX = "clientGalleryCleanup.";
export const CLEANUP_MAX_ASSETS = 256;
export const CLEANUP_REASONS = [
  "policy_changed", "gallery_variants", "control_variants", "cursor_variants", "incomplete_evidence",
  "invalid_gallery", "invalid_assets", "missing_gallery", "incoming_reference", "conflict", "refused",
  "uncertain", "internal_error", "snapshot_limit_exceeded", "clock_skew", "provider_unavailable",
] as const;
export type CleanupReason = typeof CLEANUP_REASONS[number];
export type CleanupPolicy = Readonly<{ handle: string; expiryInstant: string; assetIds: readonly string[] }>;
export type CleanupAsset = Readonly<{ id: string; revision: string; type: "sanity.imageAsset" }>;
export type CleanupReceipt = Readonly<{
  operationId: string; at: string; deletedAssets: readonly CleanupAsset[]; sharedAssets: readonly CleanupAsset[];
  deletedCount: number; sharedCount: number;
}>;
export type CleanupControl = Readonly<{
  _id: string; _type: typeof CLEANUP_CONTROL_TYPE; _rev?: string; _createdAt?: string; _updatedAt?: string;
  version: 1; galleryId: string; policy: CleanupPolicy; sourceDocumentId: string; sourceRevision: string;
  publicationId: string; enrolledAt: string; state: "enrolled" | "pending" | "complete" | "disabled";
  attempt?: Readonly<{ operationId: string; at: string }>;
  receipt?: CleanupReceipt;
  lastResult?: Readonly<{ reason: CleanupReason; at: string }>;
}>;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const REV = /^[A-Za-z0-9_-]{1,128}$/u;
const OPERATION = /^[A-Za-z0-9_-]{1,128}$/u;
const ASSET = /^image-[a-f0-9]{40}-[1-9][0-9]{0,5}x[1-9][0-9]{0,5}-(?:jpg|jpeg|png|webp|avif)$/u;
const CONTROL = /^clientGalleryCleanup\.[a-f0-9]{64}$/u;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
function closed(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).every((key) => allowed.includes(key));
}
function text(value: unknown, pattern: RegExp): value is string { return typeof value === "string" && pattern.exec(value)?.[0] === value; }
export function cleanupInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
}
function sorted<T>(value: unknown, parse: (entry: unknown) => T, key: (entry: T) => string): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > CLEANUP_MAX_ASSETS ||
    Reflect.ownKeys(value).length !== value.length + 1 || Object.keys(value).length !== value.length ||
    Object.keys(value).some((key, index) => key !== String(index) || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error("Invalid cleanup list");
  const rows = value.map(parse);
  if (rows.some((row, index) => index > 0 && key(rows[index - 1]) >= key(row))) throw new Error("Unsorted cleanup list");
  return rows;
}
function assetId(value: unknown): string {
  if (!text(value, ASSET)) throw new Error("Invalid cleanup asset");
  return value;
}
function parsePolicy(value: unknown): CleanupPolicy {
  if (!closed(value, ["handle", "expiryInstant", "assetIds"]) || !text(value.handle, /^[a-f0-9]{32}$/u) || !cleanupInstant(value.expiryInstant)) throw new Error("Invalid cleanup policy");
  const assetIds = sorted(value.assetIds, assetId, (id) => id);
  if (!assetIds.length) throw new Error("Empty cleanup policy");
  return { handle: value.handle, expiryInstant: value.expiryInstant, assetIds };
}
function parseAsset(value: unknown): CleanupAsset {
  if (!closed(value, ["id", "revision", "type"]) || !text(value.id, ASSET) || !text(value.revision, REV) || value.type !== "sanity.imageAsset") throw new Error("Invalid cleanup asset evidence");
  return { id: value.id, revision: value.revision, type: value.type };
}
/** Reject prefixes rather than silently normalize a hostile draft/version identity. */
export async function cleanupControlId(galleryId: string): Promise<string> {
  if (!text(galleryId, ID)) throw new Error("Invalid cleanup gallery identity");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(galleryId));
  return CLEANUP_CONTROL_PREFIX + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Caller verifies the deterministic ID via cleanupControlId; expectedId must come from that function. */
export function parseCleanupControl(value: unknown, expectedId: string, expectedGalleryId?: string): CleanupControl {
  if (!closed(value, ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "version", "galleryId", "policy", "sourceDocumentId", "sourceRevision", "publicationId", "enrolledAt", "state", "attempt", "receipt", "lastResult"]) ||
    !text(value._id, CONTROL) || value._id !== expectedId || value._type !== CLEANUP_CONTROL_TYPE || value.version !== 1 ||
    !text(value.galleryId, ID) || expectedGalleryId !== undefined && value.galleryId !== expectedGalleryId ||
    value.sourceDocumentId !== value.galleryId && value.sourceDocumentId !== `drafts.${value.galleryId}` ||
    !text(value.sourceRevision, REV) || !text(value.publicationId, OPERATION) || !cleanupInstant(value.enrolledAt) ||
    typeof value.state !== "string" || !["enrolled", "pending", "complete", "disabled"].includes(value.state) ||
    value._rev !== undefined && !text(value._rev, REV) || value._createdAt !== undefined && !cleanupInstant(value._createdAt) ||
    value._updatedAt !== undefined && !cleanupInstant(value._updatedAt)) throw new Error("Invalid cleanup control");
  const policy = parsePolicy(value.policy);
  if ((value.state === "pending") !== (value.attempt !== undefined) || (value.state === "complete") !== (value.receipt !== undefined)) throw new Error("Invalid cleanup state");
  if (value.attempt !== undefined && (!closed(value.attempt, ["operationId", "at"]) || !text(value.attempt.operationId, OPERATION) || !cleanupInstant(value.attempt.at))) throw new Error("Invalid cleanup attempt");
  if (value.receipt !== undefined) {
    const receipt = value.receipt;
    if (!closed(receipt, ["operationId", "at", "deletedAssets", "sharedAssets", "deletedCount", "sharedCount"]) || !text(receipt.operationId, OPERATION) || !cleanupInstant(receipt.at)) throw new Error("Invalid cleanup receipt");
    const deleted = sorted(receipt.deletedAssets, parseAsset, (row) => row.id), shared = sorted(receipt.sharedAssets, parseAsset, (row) => row.id);
    if (receipt.deletedCount !== deleted.length || receipt.sharedCount !== shared.length ||
      !cleanupPoliciesEqual({ ...policy, assetIds: [...deleted, ...shared].map((row) => row.id).sort() }, policy)) throw new Error("Incomplete cleanup receipt");
  }
  if (value.lastResult !== undefined && (!closed(value.lastResult, ["reason", "at"]) || !CLEANUP_REASONS.includes(value.lastResult.reason as CleanupReason) || !cleanupInstant(value.lastResult.at))) throw new Error("Invalid cleanup result");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 128 * 1024) throw new Error("Oversized cleanup control");
  return structuredClone({ ...value, policy }) as CleanupControl;
}
/** Source schema/parser must validate the full gallery independently before using this projection. */
export function cleanupPolicyFromGallery(gallery: Readonly<Record<string, unknown>>): CleanupPolicy | undefined {
  if (gallery._type !== "clientDeliveryGallery" || gallery.availabilityMode !== "until" || !Array.isArray(gallery.items)) return undefined;
  try {
    const ids = gallery.items.map((item) => {
      if (!object(item) || !object(item.image) || !object(item.image.asset) || item.image.asset._weak === true) throw new Error();
      return assetId(item.image.asset._ref);
    });
    return parsePolicy({ handle: gallery.handle, expiryInstant: gallery.expiryInstant, assetIds: [...new Set(ids)].sort() });
  } catch { return undefined; }
}
export function cleanupPoliciesEqual(left: CleanupPolicy, right: CleanupPolicy): boolean {
  return left.handle === right.handle && Date.parse(left.expiryInstant) === Date.parse(right.expiryInstant) &&
    left.assetIds.length === right.assetIds.length && left.assetIds.every((id, index) => id === right.assetIds[index]);
}
export function cleanupControlPayload(control: CleanupControl): Record<string, unknown> {
  return Object.fromEntries(Object.entries(control).filter(([key, value]) => value !== undefined && !["_rev", "_createdAt", "_updatedAt"].includes(key)));
}
/** No createOrReplace: every existing control update arbitrates against the exact observed revision. */
export function cleanupControlMutation(current: CleanupControl | undefined, next: CleanupControl): Readonly<Record<string, unknown>> {
  const payload = cleanupControlPayload(next);
  if (!current) return { create: payload };
  if (!current._rev || current._id !== next._id || current.galleryId !== next.galleryId) throw new Error("Missing cleanup control revision");
  const set = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "_id" && key !== "_type"));
  return { patch: { id: current._id, ifRevisionID: current._rev, set,
    unset: ["attempt", "receipt", "lastResult"].filter((key) => !(key in payload)) } };
}
