/** AB#304: offline availability data only. No transport, credentials or clock. */
import { canonicalJson, digest, LIMITS, strictJson } from "./identity-retirement-reconciliation.mts";

export const AVAILABILITY_INPUT_BYTES = 1024 * 1024;
export const AVAILABILITY_NOTICES = [
  "Page availability only; no asset revocation, unpublication or removal from the dataset.",
  "Image eligibility is not checked; native Studio and the fresh customer reader remain authoritative.",
  "Offline integrity checks are not authentication, fresh CMS evidence or write authorization.",
  "A future owner-authorized writer must refetch, refuse an existing draft, revalidate and compare-and-swap the published revision.",
] as const;
export class AvailabilityPlanError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "AvailabilityPlanError"; }
}
function fail(code: string): never { throw new AvailabilityPlanError(code); }
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_OBJECT");
  return value as Row;
}
function closed(value: Row, names: readonly string[]) {
  if (Object.keys(value).some((name) => !names.includes(name))) fail("FORBIDDEN_FIELDS");
}
export function availabilityJson(bytes: Uint8Array): unknown {
  if (!bytes.byteLength || bytes.byteLength > AVAILABILITY_INPUT_BYTES) return fail("INPUT_LIMIT");
  try {
    // Preserve a BOM so the JSON decoder rejects it instead of stripping it.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = strictJson(text, { ...LIMITS, depth: 32, nodes: 20_000 });
    const inspect = (item: unknown): void => {
      if (item !== null && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) fail("INVALID_JSON");
        inspect(child);
      }
    };
    inspect(value); return value;
  } catch { return fail("INVALID_JSON"); }
}
export function availabilityInstant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return fail("INVALID_INSTANT");
  const number = Date.parse(value);
  if (!Number.isFinite(number)) return fail("INVALID_INSTANT");
  const canonical = new Date(number).toISOString();
  if (canonical !== value && canonical.replace(".000Z", "Z") !== value) return fail("INVALID_INSTANT");
  return canonical;
}
function intentOf(value: unknown) {
  const data = row(value); closed(data, ["available", "availabilityMode", "expiryInstant"]);
  if (typeof data.available !== "boolean" || !["until", "indefinite"].includes(String(data.availabilityMode))) return fail("INVALID_INTENT");
  if (data.availabilityMode === "until") return { available: data.available, availabilityMode: "until" as const, expiryInstant: availabilityInstant(data.expiryInstant) };
  if (Object.hasOwn(data, "expiryInstant")) return fail("INVALID_INTENT");
  return { available: data.available, availabilityMode: "indefinite" as const };
}
function snapshotOf(value: unknown) {
  const data = row(value);
  closed(data, ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "_system", "handle", "title", "available", "availabilityMode", "expiryInstant", "items"]);
  if (data._type !== "clientDeliveryGallery" || typeof data._id !== "string" || data._id.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(data._id) || data._id.trim() !== data._id ||
    typeof data._rev !== "string" || data._rev.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(data._rev) ||
    data._rev.trim() !== data._rev || typeof data.handle !== "string" || data.handle.length !== 32 || !/^[a-f0-9]{32}$/u.test(data.handle) ||
    !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 256) return fail("INVALID_SNAPSHOT");
  const current = intentOf({ available: data.available, availabilityMode: data.availabilityMode,
    ...(data.expiryInstant == null ? {} : { expiryInstant: data.expiryInstant }) });
  return { data, id: data._id, revision: data._rev, current };
}
function future(intent: ReturnType<typeof intentOf>, instant: string) {
  if (intent.available && intent.availabilityMode === "until" && Date.parse(intent.expiryInstant) <= Date.parse(instant)) fail("DEADLINE_PASSED");
}
export function planClientGalleryAvailability(snapshot: Uint8Array, intent: Uint8Array, reference: string) {
  const source = snapshotOf(availabilityJson(snapshot)), requested = intentOf(availabilityJson(intent));
  const referenceInstant = availabilityInstant(reference);
  future(requested, referenceInstant);
  if (canonicalJson(source.current) === canonicalJson(requested)) return fail("NO_CHANGE");
  const patch = {
    id: source.id, ifRevisionID: source.revision,
    set: requested,
    ...(requested.availabilityMode === "indefinite" ? { unset: ["expiryInstant"] } : {}),
  };
  const body = {
    format: "client-gallery-availability-plan-v1", readyToWrite: false, eligibilityChecked: false,
    sourceId: source.id, sourceRevision: source.revision,
    sourceSha256: digest(Buffer.from(canonicalJson(source.data))),
    referenceInstant, intent: requested, patch, notices: AVAILABILITY_NOTICES,
  } as const;
  return { ...body, planSha256: digest(Buffer.from(canonicalJson(body))) };
}
export function verifyClientGalleryAvailability(planBytes: Uint8Array, snapshot: Uint8Array, approvedDigest: string, verifyAt: string) {
  const plan = row(availabilityJson(planBytes)), checkedAt = availabilityInstant(verifyAt);
  if (typeof plan.referenceInstant !== "string" || plan.intent === undefined) return fail("INVALID_PLAN");
  if (!/^[a-f0-9]{64}$/u.test(approvedDigest) || approvedDigest.length !== 64 || plan.planSha256 !== approvedDigest) return fail("APPROVAL_MISMATCH");
  const expected = planClientGalleryAvailability(snapshot, Buffer.from(canonicalJson(plan.intent)), String(plan.referenceInstant));
  if (canonicalJson(expected) !== canonicalJson(plan)) return fail("PLAN_OR_SOURCE_CHANGED");
  if (Date.parse(checkedAt) < Date.parse(expected.referenceInstant)) return fail("VERIFICATION_BEFORE_PLAN");
  future(expected.intent, checkedAt);
  return { format: "client-gallery-availability-check-v1", readyToWrite: false, offlineOnly: true,
    checkedAt, planSha256: expected.planSha256, patch: expected.patch, notices: AVAILABILITY_NOTICES } as const;
}
