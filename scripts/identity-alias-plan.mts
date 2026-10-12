/** AB#265: offline compatibility payload; never a CMS document or mutation. */
import { canonicalJson, digest, LIMITS, reconcileIdentities, ReconciliationError } from "./identity-retirement-reconciliation.mts";

// Restated from the application boundary, pinned by test-only interop imports.
export const ALIAS_PLAN_LIMITS = { identityLength: 256, payloadBytes: 256 * 1024, planBytes: 1024 * 1024 };
export const ALIAS_PAYLOAD_FORMAT = "identity-aliases-v1";
const FIELDS = ["contentId", "categoryId", "endGalleryId", "placementId"] as const;
type Field = (typeof FIELDS)[number];
type Row = { field: Field; newId: string; oldId: string };
type Input = Parameters<typeof reconcileIdentities>[0];
const sha = (value: unknown) => digest(Buffer.from(canonicalJson(value)));

export function planIdentityAliases(input: Input, budgets: { payloadBytes?: number; planBytes?: number } = {}) {
  const payloadBytes = budgets.payloadBytes ?? ALIAS_PLAN_LIMITS.payloadBytes;
  const planBytes = budgets.planBytes ?? ALIAS_PLAN_LIMITS.planBytes;
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 1 || payloadBytes > ALIAS_PLAN_LIMITS.payloadBytes ||
    !Number.isSafeInteger(planBytes) || planBytes < 1 || planBytes > ALIAS_PLAN_LIMITS.planBytes) throw new ReconciliationError("INVALID_ALIAS_LIMIT");
  if ([input.map, input.approval, input.baseline, input.snapshot].some(bytes => bytes.byteLength > LIMITS.bytes)) throw new ReconciliationError("INPUT_LIMIT");
  // Strict reconciliation and projection use one copy of each exact input.
  const data = { ...input, map: Buffer.from(input.map), approval: Buffer.from(input.approval), baseline: Buffer.from(input.baseline), snapshot: Buffer.from(input.snapshot) };
  const reconciliation = reconcileIdentities(data);
  if (reconciliation.status !== "consistent-old" || reconciliation.issues.length) throw new ReconciliationError("RECONCILIATION_BLOCKED");
  // Only these bytes have passed duplicate-key, receipt, coverage and revision checks.
  const mapping = (JSON.parse(data.map.toString("utf8")) as { mapping: Row[] }).mapping;
  const familyCounts: Record<Field, number> = { contentId: 0, categoryId: 0, endGalleryId: 0, placementId: 0 };
  const oldIds = new Set<string>(), newIds = new Set<string>();
  const aliases = mapping.map(({ field, newId, oldId }) => {
    if (!FIELDS.includes(field) || [newId, oldId].some(id => typeof id !== "string" || id.length > ALIAS_PLAN_LIMITS.identityLength || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) ||
      oldIds.has(oldId) || newIds.has(newId)) throw new ReconciliationError("INVALID_ALIAS_MAPPING");
    oldIds.add(oldId); newIds.add(newId); familyCounts[field]++;
    return { field, newId, oldId };
  });
  if (!aliases.length || [...oldIds].some(id => newIds.has(id)) || Object.values(familyCounts).reduce((sum, count) => sum + count, 0) !== aliases.length) throw new ReconciliationError("INVALID_ALIAS_MAPPING");
  const payload = { aliases, formatVersion: ALIAS_PAYLOAD_FORMAT, sourceMapSha256: reconciliation.digests.approvedMap };
  const canonicalPayload = canonicalJson(payload), canonicalByteCount = Buffer.byteLength(canonicalPayload);
  if (canonicalByteCount > payloadBytes) throw new ReconciliationError("ALIAS_PAYLOAD_LIMIT");
  const pins = { sourceMapSha256: payload.sourceMapSha256, payloadSha256: digest(Buffer.from(canonicalPayload)), expectedRowCount: aliases.length };
  const body = {
    version: "identity-alias-plan-v1", writable: false, cutoverReady: false,
    payload, pins, canonicalByteCount, familyCounts,
    reconciliationVersion: reconciliation.version, reconciliationSha256: reconciliation.reportSha256,
    digests: reconciliation.digests,
    remainingGates: [
      ...reconciliation.remainingGates,
      "named-alias-record-source-and-operation-approval",
      "supplied-snapshot-only-not-current-target-or-freeze-proof",
    ],
  };
  const result = { ...body, planSha256: sha(body) };
  // Private wrapper budget includes its one output LF; payload hash never does.
  if (Buffer.byteLength(canonicalJson(result)) + 1 > planBytes) throw new ReconciliationError("ALIAS_PLAN_OUTPUT_LIMIT");
  return result;
}
