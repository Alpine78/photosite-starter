/** Offline operator evidence checks; never performs or authorizes recovery. */
import { createHash } from "node:crypto";
import { verifyReleaseSource, type ExpectedRelease } from "./release-source-verification.mts";

type Expectations = { current: ExpectedRelease; rollback: ExpectedRelease };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const record = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const sha256 = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const keys = ["schemaVersion", "capturedAt", "currentReceiptSha256", "rollbackReceiptSha256", "snapshotSha256", "recoverySnapshotSha256", "fullSnapshotCaptured", "localAssetBytesVerified", "rollbackPreviouslyProduction", "hostingRollbackEligible", "runtimeReadAccessVerified", "runtimeSecretsVerified", "machineAliasesInventoried", "cacheRecoveryPlanned", "compatibility"];
const requiredChecks = ["fullSnapshotCaptured", "localAssetBytesVerified", "rollbackPreviouslyProduction", "hostingRollbackEligible", "runtimeReadAccessVerified", "runtimeSecretsVerified", "machineAliasesInventoried", "cacheRecoveryPlanned"];

export function verifyRollbackReadiness(currentBytes: Uint8Array, rollbackBytes: Uint8Array, observations: unknown, expected: Expectations, now: Date) {
  if (expected.current.projectId !== expected.rollback.projectId || expected.current.teamId !== expected.rollback.teamId || !Number.isFinite(now.getTime())) throw new Error("INVALID_EXPECTED_IDENTITY");
  const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const current = decode(currentBytes), rollback = decode(rollbackBytes);
  const currentCheck = verifyReleaseSource(current, expected.current), rollbackCheck = verifyReleaseSource(rollback, expected.rollback);
  const reasons = [...currentCheck.reasons.map(code => `CURRENT_${code}`), ...rollbackCheck.reasons.map(code => `ROLLBACK_${code}`)];
  if (record(current)?.target !== "production") reasons.push("CURRENT_NOT_PRODUCTION");
  if (record(rollback)?.target !== "production") reasons.push("ROLLBACK_NOT_PRODUCTION");
  if (expected.current.deploymentId === expected.rollback.deploymentId) reasons.push("SAME_DEPLOYMENT");
  const evidence = record(observations);
  if (!evidence || evidence.schemaVersion !== 1 || keys.some(k => !Object.hasOwn(evidence, k)) || Object.keys(evidence).some(k => !keys.includes(k))) reasons.push("INVALID_OBSERVATIONS");
  if (evidence?.currentReceiptSha256 !== hash(currentBytes) || evidence?.rollbackReceiptSha256 !== hash(rollbackBytes)) reasons.push("PROVIDER_RECEIPT_BINDING_MISMATCH");
  const at = typeof evidence?.capturedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(evidence.capturedAt) ? Date.parse(evidence.capturedAt) : NaN;
  if (!Number.isFinite(at) || new Date(at).toISOString() !== evidence?.capturedAt || at > now.getTime() || now.getTime() - at > 3_600_000) reasons.push("OBSERVATIONS_STALE_OR_INVALID");
  if (!sha256(evidence?.snapshotSha256) || evidence?.snapshotSha256 !== evidence?.recoverySnapshotSha256) reasons.push("RECOVERY_SNAPSHOT_MISMATCH");
  for (const name of requiredChecks) if (evidence?.[name] !== true) reasons.push(`UNVERIFIED_${name.toUpperCase()}`);
  const compatibility = evidence?.compatibility;
  // Two explicit source-bound observations, even when two builds share one SHA.
  if (!Array.isArray(compatibility) || compatibility.length !== 2 || [expected.current, expected.rollback].some((identity, index) => {
    const entry = record(compatibility[index]);
    return !entry || Object.keys(entry).sort().join(",") !== "deploymentId,mediaVerified,routesVerified,snapshotSha256,sourceSha" || entry.deploymentId !== identity.deploymentId || entry.sourceSha !== identity.sourceSha || entry.snapshotSha256 !== evidence?.snapshotSha256 || entry.routesVerified !== true || entry.mediaVerified !== true;
  })) reasons.push("UNVERIFIED_CMS_COMPATIBILITY");
  return { schemaVersion: 1, checkedAt: now.toISOString(), expected, preflightPassed: reasons.length === 0, reasons,
    currentReceiptSha256: hash(currentBytes), rollbackReceiptSha256: hash(rollbackBytes),
    observationAssertionsIndependentlyVerified: false, artifactContentsVerified: false,
    rollbackExecuted: false, cmsRestored: false, operationAuthorized: false, launchApproved: false };
}
