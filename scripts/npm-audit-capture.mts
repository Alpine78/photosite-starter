/** Same-operation producer for AB329; no registry/runtime attestation. */
import { createHash } from "node:crypto";
import { AUDIT_TRIAGE_LIMITS, triageSavedAudit } from "./npm-audit-triage.mts";

export const AUDIT_CAPTURE_LIMITS = {
  stdoutBytes: AUDIT_TRIAGE_LIMITS.envelopeBytes - 512,
  stderrBytes: 64 * 1024,
  deadlineMs: 120_000,
  cleanupMs: 2_000,
} as const;
export const AUDIT_TARGETS = ["root", "studio"] as const;
export type AuditTarget = typeof AUDIT_TARGETS[number];
export type CaptureCode = "configuration" | "lockfile-invalid" | "digest-drift" | "spawn-failed" |
  "deadline" | "output-overflow" | "signal" | "canceled" | "exit-unexpected" | "json-invalid" |
  "audit-error-object" | "triage-rejected" | "artifact-invalid" | "internal";
export class AuditCaptureError extends Error {
  readonly code: CaptureCode;
  constructor(code: CaptureCode) { super(code); this.code = code; }
}
export const digestBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export type AuditChildResult = { stdout: Buffer; stderrBytes: number; exitCode: number | null; signal: string | null };

export function classifyAuditCapture(before: Uint8Array, after: Uint8Array, child: AuditChildResult) {
  if (before.byteLength > AUDIT_TRIAGE_LIMITS.lockfileBytes || after.byteLength > AUDIT_TRIAGE_LIMITS.lockfileBytes) throw new AuditCaptureError("lockfile-invalid");
  const lockfileSha256 = digestBytes(before);
  if (digestBytes(after) !== lockfileSha256) throw new AuditCaptureError("digest-drift");
  if (child.stdout.length > AUDIT_CAPTURE_LIMITS.stdoutBytes || child.stderrBytes > AUDIT_CAPTURE_LIMITS.stderrBytes) throw new AuditCaptureError("output-overflow");
  if (child.signal) throw new AuditCaptureError("signal");
  if (child.exitCode !== 0 && child.exitCode !== 1) throw new AuditCaptureError("exit-unexpected");
  let audit: unknown;
  try { audit = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(child.stdout)); }
  catch { throw new AuditCaptureError("json-invalid"); }
  if (audit && typeof audit === "object" && Object.hasOwn(audit, "error")) throw new AuditCaptureError("audit-error-object");
  const envelope = { schemaVersion: 1, lockfileSha256, audit };
  let triage: ReturnType<typeof triageSavedAudit>;
  try { triage = triageSavedAudit(envelope, before); }
  catch { throw new AuditCaptureError("triage-rejected"); }
  const counts = triage.summary.entriesBySeverity;
  const gateExit = counts.low + counts.moderate + counts.high + counts.critical > 0 ? 1 : 0;
  if (child.exitCode !== gateExit) throw new AuditCaptureError("exit-unexpected");
  return { envelope, triage, gateExit };
}

export type CaptureTargetSummary = {
  target: AuditTarget; status: "clean" | "findings" | "accepted" | "tool-error"; gateExit: number;
  reason: CaptureCode | null; lockfileSha256: string | null;
  report: { file: string; sha256: string; bytes: number } | null;
  /** AB#380: the dated exceptions that turned every finding green, and when. */
  acceptance: { evaluatedAt: string; applied: { ghsa: string; advisorySource: number; workItem: string; expiresOn: string }[] } | null;
};
export function captureManifest(buildId: string, attempt: string, targets: CaptureTargetSummary[]) {
  return {
    schemaVersion: 1, buildId, jobAttempt: attempt,
    gateExit: Math.max(...targets.map(target => target.gateExit)), targets,
    evidence: {
      pairing: "local-capture-bracketed-by-equal-lockfile-digests",
      registryAttestationVerified: false, reportFreshnessBeyondCaptureVerified: false,
      lockfileABASafetyVerified: false, bundleInclusionVerified: false,
      exploitabilityVerified: false, fixProposalsVerified: false,
    },
  };
}
