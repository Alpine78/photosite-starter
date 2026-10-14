import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRollbackReadiness } from "./rollback-readiness.mts";
const now = new Date("2026-10-13T22:00:00.000Z"), snapshotSha256 = "c".repeat(64);
const identity = { projectId: "prj_fixture", teamId: "team_fixture" };
const expected = { current: { ...identity, sourceSha: "a".repeat(40), deploymentId: "dpl_current" }, rollback: { ...identity, sourceSha: "b".repeat(40), deploymentId: "dpl_rollback" } };
const provider = (key: "current" | "rollback") => ({ id: expected[key].deploymentId, projectId: identity.projectId, team: { id: identity.teamId }, target: "production", readyState: "READY", meta: { gitCommitSha: expected[key].sourceSha, gitDirty: "0", privateSecret: "MUST_NOT_BE_REPORTED" } });
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const fixture = () => {
  const current = bytes(provider("current")), rollback = bytes(provider("rollback"));
  const evidence: Record<string, unknown> = { schemaVersion: 1, capturedAt: now.toISOString(), currentReceiptSha256: hash(current), rollbackReceiptSha256: hash(rollback), snapshotSha256, recoverySnapshotSha256: snapshotSha256, fullSnapshotCaptured: true, localAssetBytesVerified: true, rollbackPreviouslyProduction: true, hostingRollbackEligible: true, runtimeReadAccessVerified: true, runtimeSecretsVerified: true, machineAliasesInventoried: true, cacheRecoveryPlanned: true,
    compatibility: [expected.current, expected.rollback].map(v => ({ deploymentId: v.deploymentId, sourceSha: v.sourceSha, snapshotSha256, routesVerified: true, mediaVerified: true })) };
  return { current, rollback, evidence };
};
const check = (f: ReturnType<typeof fixture>) => verifyRollbackReadiness(f.current, f.rollback, f.evidence, expected, now);
describe("rollback readiness evidence", () => {
  it("validates bindings without claiming execution, authorization or independent observation", () => {
    const result = check(fixture());
    expect(result).toMatchObject({ preflightPassed: true, reasons: [], observationAssertionsIndependentlyVerified: false, rollbackExecuted: false, cmsRestored: false, operationAuthorized: false, launchApproved: false });
    expect(JSON.stringify(result)).not.toContain("MUST_NOT_BE_REPORTED");
  });
  it.each(["current", "rollback"] as const)("refuses dirty %s input", key => {
    const f = fixture(); const input = provider(key); input.meta.gitDirty = "1"; f[key] = bytes(input);
    expect(check(f).reasons).toContain(`${key.toUpperCase()}_SOURCE_DIRTY`);
    expect(check(f).reasons).toContain("PROVIDER_RECEIPT_BINDING_MISMATCH");
  });
  it.each(["current", "rollback"] as const)("refuses a %s preview even with clean source", key => {
    const f = fixture(); f[key] = bytes({ ...provider(key), target: null });
    expect(check(f).reasons).toContain(`${key.toUpperCase()}_NOT_PRODUCTION`);
  });
  it.each(["fullSnapshotCaptured", "localAssetBytesVerified", "rollbackPreviouslyProduction", "hostingRollbackEligible", "runtimeReadAccessVerified", "runtimeSecretsVerified", "machineAliasesInventoried", "cacheRecoveryPlanned"])("requires observed %s", key => {
    const f = fixture(); f.evidence[key] = false; expect(check(f).preflightPassed).toBe(false);
  });
  it.each(["2026-10-13T20:59:59.999Z", "2026-10-13T22:00:00.001Z", "2026-02-30T22:00:00.000Z", "invalid", null])("refuses stale/future/malformed capture %j", value => {
    const f = fixture(); f.evidence.capturedAt = value; expect(check(f).reasons).toContain("OBSERVATIONS_STALE_OR_INVALID");
  });
  it("accepts exactly the one-hour age boundary", () => { const f = fixture(); f.evidence.capturedAt = "2026-10-13T21:00:00.000Z"; expect(check(f).preflightPassed).toBe(true); });
  it("requires recovery bytes for the same current snapshot", () => { const f = fixture(); f.evidence.recoverySnapshotSha256 = "d".repeat(64); expect(check(f).reasons).toContain("RECOVERY_SNAPSHOT_MISMATCH"); });
  it("requires compatibility for each exact deployment and snapshot", () => {
    const f = fixture(); (f.evidence.compatibility as Record<string, unknown>[])[1].snapshotSha256 = "d".repeat(64); expect(check(f).reasons).toContain("UNVERIFIED_CMS_COMPATIBILITY");
  });
  it("rejects unknown observation keys instead of forwarding them", () => { const f = fixture(); f.evidence.secret = "MUST_NOT_BE_REPORTED"; const result = check(f); expect(result.reasons).toContain("INVALID_OBSERVATIONS"); expect(JSON.stringify(result)).not.toContain("MUST_NOT_BE_REPORTED"); });
  it.each([null, [], {}])("fails closed on missing observation shape %j", value => { const f = fixture(); expect(verifyRollbackReadiness(f.current, f.rollback, value, expected, now).preflightPassed).toBe(false); });
  it("rejects recovery to the same deployment", () => { const f = fixture(); expect(verifyRollbackReadiness(f.current, f.current, f.evidence, { ...expected, rollback: expected.current }, now).reasons).toContain("SAME_DEPLOYMENT"); });
  it("rejects cross-project expectations", () => { const f = fixture(); expect(() => verifyRollbackReadiness(f.current, f.rollback, f.evidence, { ...expected, rollback: { ...expected.rollback, projectId: "prj_other" } }, now)).toThrow("INVALID_EXPECTED_IDENTITY"); });
  it("rejects malformed UTF-8", () => { const f = fixture(); expect(() => verifyRollbackReadiness(Buffer.from([0xff]), f.rollback, f.evidence, expected, now)).toThrow(); });
});
