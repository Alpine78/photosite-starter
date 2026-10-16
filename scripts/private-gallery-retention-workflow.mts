/**
 * Provider-free AB#29 retention orchestration (ADR-0014 §7).
 * No scheduler, credentials, network client or production enablement lives here.
 * Ports are privileged server/worker adapters, never public request input.
 */
import { createHash } from "node:crypto";
import { privateGalleryObjectKeyPrefix } from "../src/lib/private-gallery-object-key.ts";
import {
  evaluatePrivateGalleryRetention,
  PRIVATE_GALLERY_BACKSTOP_OBJECT_AGE_DAYS,
  PRIVATE_GALLERY_BACKSTOP_NONCURRENT_VERSION_DAYS,
  PRIVATE_GALLERY_BACKSTOP_MULTIPART_ABORT_DAYS,
  PRIVATE_GALLERY_RETENTION_WINDOWS,
  type PrivateGalleryRetentionInput,
} from "../src/lib/private-gallery-retention.ts";
import { isPrivateGalleryState } from "../src/lib/private-gallery-state.ts";

export const RETENTION_MAX_GALLERIES = 20;
export const RETENTION_MAX_OBJECT_OPERATIONS = 100;
export const RETENTION_MAX_MANIFEST_KEYS = 5_000;
export const RETENTION_MAX_SESSION_REAP = 100;
export const RETENTION_LEASE_MS = 5 * 60_000;
export const RETENTION_FINISH_MARGIN_MS = 10_000;
export const RETENTION_PORT_TIMEOUT_MS = 5_000;

export type RetentionRow = PrivateGalleryRetentionInput & {
  readonly galleryId: string;
  readonly revision: number;
  /** Immutable from entering deleting; includes superseded ZIP/preparation keys. */
  readonly objectKeys: readonly string[];
  /** Number of manifest objects verified absent by previous committed slices. */
  readonly nextIndex: number;
  /** Unknown prefix objects require reconciliation, not blind automatic deletion. */
  readonly operatorAttentionRequired?: boolean;
};
export type RetentionClaim = { readonly token: string; readonly expiresAt: Date };
export type RetentionClaimWrite = {
  readonly galleryId: string;
  readonly token: string;
  readonly now: Date;
  readonly nextIndex: number;
  readonly outcome: "pending" | "failed" | "deleted";
  readonly reason?: "object-failed" | "unexpected-object";
};
/** All adapters must honor cancellation, bound transactions and reject late writes
 * at commit time (including lease expiry); a timeout is never proof of rollback. */
export type RetentionMetadataPort = {
  /** Independent expiry-indexed session reap; return a count <= limit. */
  reapExpiredSessions(now: Date, limit: number, signal: AbortSignal): Promise<number>;
  /**
   * Discover only due/expired-lease cleanup candidates, using bounded indexed
   * queries ordered by oldest last-attempt first with stable id tie-break.
   * Failed/parked or leased rows cannot starve unattempted due rows. Exclude
   * acknowledged deletion-failed and operator-attention rows; read rechecks this before any mutation.
   */
  listCandidates(now: Date, limit: number, signal: AbortSignal): Promise<readonly string[]>;
  read(galleryId: string, signal: AbortSignal): Promise<RetentionRow | undefined>;
  /**
   * Transactional revision CAS: enter expiring, persist the exact original
   * trigger and bump capability generation together. Revokes live sessions.
   * Return false on a concurrent change; never overwrite an earlier trigger.
   */
  expire(input: { readonly galleryId: string; readonly expectedRevision: number; readonly cleanupTriggeredAt: Date; readonly now: Date }, signal: AbortSignal): Promise<boolean>;
  /**
   * Transactional revision CAS + exclusive expiring/failed/deleting claim.
   * Refuse acknowledged failure, operator-attention rows and an unexpired lease.
   * Every new lease gets a fresh unique opaque token, never reused for a gallery.
   * Move to deleting,
   * record last-attempt time (fair discovery), freeze the manifest and compare
   * SHA-256 of UTF-8 JSON.stringify(objectKeys), preserving array order, and
   * cursor with this read. All upload/publication writes must
   * refuse deleting. A crashed/expired claim may be taken over; never revive it.
   */
  claim(input: { readonly galleryId: string; readonly expectedRevision: number; readonly manifestDigest: string; readonly nextIndex: number; readonly now: Date; readonly expiresAt: Date }, signal: AbortSignal): Promise<RetentionClaim | undefined>;
  /**
   * Transactional active-token CAS with unexpired lease. Persist one cursor
   * per slice and release claim. pending stays deleting, failed enters
   * deletion-failed. unexpected-object sets operatorAttentionRequired, without
   * pretending a human has acknowledged the failure.
   * deleted is allowed only after complete manifest + whole-prefix absence;
   * atomically clear any prior row-defect flag and delete capability/session/
   * notification rows then, preserving
   * proof confirmations under ADR-0014's bounded separate retention policy.
   */
  finish(input: RetentionClaimWrite, signal: AbortSignal): Promise<boolean>;
  /** Record a redacted defect + last-attempt time even when row validation fails;
   * no gallery state or customer fields change. Recheck the observed defect in
   * the transaction; ignore missing/deleted or concurrently repaired rows.
   * A later successful claim or deleted completion clears the flag. */
  recordDefect(galleryId: string, now: Date, signal: AbortSignal): Promise<void>;
  /** Indexed aggregate counts include parked rows excluded from normal discovery. */
  readHealth(now: Date, signal: AbortSignal): Promise<{ readonly parked: number; readonly overdue: number; readonly defects: number }>;
};
export type RetentionObjectPort = {
  /** Fence cooperative upload preparations and prove every earlier write has
   * settled/aborted before deletion. Returning false fails closed; a concrete
   * adapter must prove this with its upload protocol, not just read a DB flag.
   * This grants no new provider credential operation or broad-key rotation. */
  quiesceGalleryUploads(prefix: string, signal: AbortSignal): Promise<boolean>;
  /**
   * One bounded, idempotent exact-key operation (not a provider HTTP call
   * count): remove current/noncurrent versions, delete markers and matching
   * incomplete multipart uploads, then verify all absent. Must honor signal
   * and bound pagination/retries; remaining is a failure, never success.
   */
  removeAndVerify(objectKey: string, signal: AbortSignal): Promise<"absent" | "remaining">;
  /** Bounded whole-prefix probe includes versions, delete markers and multipart uploads. Never deletes unknown keys. */
  verifyGalleryEmpty(prefix: string, signal: AbortSignal): Promise<boolean>;
  /** Final read-only drift check, independent of whether a gallery was due. */
  readBackstop(signal: AbortSignal): Promise<{ readonly enabled: boolean; readonly objectAgeDays: number; readonly noncurrentDays: number; readonly multipartDays: number }>;
};
export type RetentionIssue = "sessions-failed" | "discovery-failed" | "invalid-store-result" | "metadata-failed" | "object-failed" | "unexpected-object" | "backstop-drift" | "operator-attention" | "retention-overdue" | "uploads-active";
export type RetentionRunResult = {
  readonly discovered: number;
  readonly sessionsReaped: number;
  readonly deleted: number;
  readonly progressed: number;
  readonly failed: number;
  readonly notDue: number;
  readonly conflicts: number;
  readonly objectOperations: number;
  /** Count of committed cleanup checkpoints after their original deadline. */
  readonly overdueCheckpoints: number;
  readonly outstandingOverdue: number;
  readonly parked: number;
  readonly defects: number;
  readonly issues: readonly RetentionIssue[];
};

class RetentionRowDefect extends Error {
  constructor() { super("Invalid retention row"); }
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function integer(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}
function validateRow(row: RetentionRow, galleryId: string, prefix: string, now: Date): void {
  if (typeof row !== "object" || row === null || row.galleryId !== galleryId ||
      !isPrivateGalleryState(row.state) || !integer(row.revision, Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(row.objectKeys) || row.objectKeys.length > RETENTION_MAX_MANIFEST_KEYS ||
      new Set(row.objectKeys).size !== row.objectKeys.length ||
      row.objectKeys.some((key) => typeof key !== "string" || key.length > 512 ||
        !key.startsWith(prefix) || !/^(preview|proof|zip)\/[A-Za-z0-9_-]{22}$/.test(key.slice(prefix.length))) ||
      !integer(row.nextIndex, row.objectKeys.length) ||
      (row.state !== "deleting" && row.state !== "deletion-failed" && row.nextIndex !== 0) ||
      (row.deletionFailureAcknowledged !== undefined && typeof row.deletionFailureAcknowledged !== "boolean") ||
      (row.operatorAttentionRequired !== undefined && typeof row.operatorAttentionRequired !== "boolean")) {
    throw new RetentionRowDefect();
  }
  for (const value of [row.preparationStartedAt, row.accessExpiresAt, row.accessSuspendedAt, row.cleanupTriggeredAt]) {
    if (value !== undefined && !validDate(value)) throw new RetentionRowDefect();
  }
  if (row.cleanupTriggeredAt !== undefined && row.cleanupTriggeredAt > now) throw new RetentionRowDefect();
  if (["expiring", "deleting", "deletion-failed"].includes(row.state) && !validDate(row.cleanupTriggeredAt)) {
    throw new RetentionRowDefect();
  }
}
function trigger(row: RetentionRow): Date {
  let deadline: Date;
  if (row.state === "published") deadline = row.accessExpiresAt!;
  else if (row.state === "preparing" || row.state === "ready") {
    deadline = new Date(row.preparationStartedAt!.getTime() + PRIVATE_GALLERY_RETENTION_WINDOWS.maxPreparationDays * 86_400_000);
  } else deadline = new Date(row.accessSuspendedAt!.getTime() + PRIVATE_GALLERY_RETENTION_WINDOWS.maxSuspensionDays * 86_400_000);
  return new Date(Math.min(deadline.getTime(), row.cleanupTriggeredAt?.getTime() ?? Infinity));
}

/** The race bounds even an adapter that ignores cancellation. Such a late
 * write must still be fenced by the adapter transaction; it is not a rollback. */
async function boundedPort<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = RETENTION_PORT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("retention-port-timeout")); }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

/**
 * One bounded pass, not one day of scheduled capacity. A future scheduler must
 * drain enough passes for ALL outstanding manifests before their original
 * deadlines, and run at least daily. A 5,000-key manifest alone requires up to
 * 50 successful default passes; retries and other galleries add work. Verify
 * capacity/deadline slack before activation, not only the 24-hour cadence.
 * All diagnostics are closed aggregate data without identities.
 */
export async function runPrivateGalleryRetention(params: {
  readonly metadata: RetentionMetadataPort;
  readonly objects: RetentionObjectPort;
  readonly keyPrefix: string;
  readonly clock: () => Date;
  readonly galleryLimit?: number;
  readonly objectLimit?: number;
}): Promise<RetentionRunResult> {
  const { metadata, objects, keyPrefix, clock } = params;
  const galleryLimit = params.galleryLimit ?? RETENTION_MAX_GALLERIES;
  const objectLimit = params.objectLimit ?? RETENTION_MAX_OBJECT_OPERATIONS;
  // Validate operator configuration before reaching either privileged port.
  if (!integer(galleryLimit, RETENTION_MAX_GALLERIES) || galleryLimit < 1 ||
      !integer(objectLimit, RETENTION_MAX_OBJECT_OPERATIONS) || objectLimit < 1) throw new Error("Invalid retention limits");
  if (typeof keyPrefix !== "string" || keyPrefix.length > 128) throw new Error("Invalid retention key prefix");
  privateGalleryObjectKeyPrefix({ keyPrefix, galleryId: "validation" });
  const now = clock();
  if (!validDate(now)) throw new Error("Invalid retention clock");
  const result = { discovered: 0, sessionsReaped: 0, deleted: 0, progressed: 0, failed: 0, notDue: 0, conflicts: 0, objectOperations: 0, overdueCheckpoints: 0, outstandingOverdue: 0, parked: 0, defects: 0, issues: [] as RetentionIssue[] };
  const issue = (value: RetentionIssue) => { if (!result.issues.includes(value)) result.issues.push(value); };
  try {
    const count = await boundedPort((signal) => metadata.reapExpiredSessions(now, RETENTION_MAX_SESSION_REAP, signal));
    if (!integer(count, RETENTION_MAX_SESSION_REAP)) issue("invalid-store-result");
    else result.sessionsReaped = count;
  } catch { issue("sessions-failed"); }

  let candidates: readonly string[] = [];
  try {
    const found = await boundedPort((signal) => metadata.listCandidates(now, galleryLimit, signal));
    if (!Array.isArray(found) || found.length > galleryLimit || new Set(found).size !== found.length || found.some((id) => !validId(id))) issue("invalid-store-result");
    else candidates = [...found];
  } catch { issue("discovery-failed"); }
  result.discovered = candidates.length;
  for (const galleryId of candidates) {
    if (result.objectOperations >= objectLimit) break;
    const prefix = privateGalleryObjectKeyPrefix({ keyPrefix, galleryId });
    let row: RetentionRow;
    try {
      const read = await boundedPort((signal) => metadata.read(galleryId, signal));
      if (read === undefined) { result.conflicts++; continue; }
      validateRow(read, galleryId, prefix, now);
      // Isolate mutable adapter objects across awaited operations.
      row = structuredClone(read);
      if (row.operatorAttentionRequired === true) { result.notDue++; continue; }
      let decision;
      try { decision = evaluatePrivateGalleryRetention(row, now); }
      catch { throw new RetentionRowDefect(); }
      if (!decision.due && row.state !== "deleting") { result.notDue++; continue; }
      if (decision.due && decision.to === "expiring") {
        const changed = await boundedPort((signal) => metadata.expire({ galleryId, expectedRevision: row.revision, cleanupTriggeredAt: trigger(row), now }, signal));
        if (changed !== true) { if (changed !== false) issue("invalid-store-result"); result.conflicts++; continue; }
        const reread = await boundedPort((signal) => metadata.read(galleryId, signal));
        if (reread === undefined) { result.conflicts++; continue; }
        validateRow(reread, galleryId, prefix, now);
        row = structuredClone(reread);
      }
      if (!["expiring", "deleting", "deletion-failed"].includes(row.state) || (row.deletionFailureAcknowledged === true || row.operatorAttentionRequired === true)) { result.conflicts++; continue; }
    } catch (error) {
      result.failed++;
      if (!(error instanceof RetentionRowDefect)) { issue("metadata-failed"); continue; }
      issue("invalid-store-result");
      try { await boundedPort((signal) => metadata.recordDefect(galleryId, now, signal)); }
      catch { issue("metadata-failed"); }
      continue;
    }

    let claim: RetentionClaim | undefined;
    try {
      const claimedAt = clock();
      if (!validDate(claimedAt) || claimedAt < now) throw new Error("clock");
      claim = await boundedPort((signal) => metadata.claim({ galleryId, expectedRevision: row.revision,
        manifestDigest: createHash("sha256").update(JSON.stringify(row.objectKeys)).digest("hex"),
        nextIndex: row.nextIndex, now: claimedAt, expiresAt: new Date(claimedAt.getTime() + RETENTION_LEASE_MS) }, signal));
      if (claim === undefined) { result.conflicts++; continue; }
      if (typeof claim.token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(claim.token) ||
          !validDate(claim.expiresAt) || claim.expiresAt.getTime() <= claimedAt.getTime() + RETENTION_FINISH_MARGIN_MS || claim.expiresAt.getTime() > claimedAt.getTime() + RETENTION_LEASE_MS) throw new Error("claim");
    } catch { issue("metadata-failed"); result.failed++; continue; }
    claim = structuredClone(claim);
    const active = () => {
      try {
        const at = clock();
        return validDate(at) && at >= now && at < claim!.expiresAt ? at : undefined;
      } catch { return undefined; }
    };
    let nextIndex = row.nextIndex;
    let outcome: RetentionClaimWrite["outcome"] = "pending";
    let reason: RetentionClaimWrite["reason"];
    const ioStartedAt = active();
    if (ioStartedAt === undefined) { result.conflicts++; continue; }
    const ioBudget = () => {
      const at = active();
      return at === undefined ? 0 : claim!.expiresAt.getTime() - at.getTime() - RETENTION_FINISH_MARGIN_MS;
    };
    try {
      if (ioBudget() <= 0) throw new Error("lease-margin");
      const quiescent = await boundedPort((signal) => objects.quiesceGalleryUploads(prefix, signal), ioBudget());
      if (quiescent !== true) { outcome = "failed"; reason = "object-failed"; issue("uploads-active"); }
      while (quiescent === true && nextIndex < row.objectKeys.length && result.objectOperations < objectLimit) {
        if (ioBudget() <= 0) break;
        result.objectOperations++;
        const removed = await boundedPort((signal) => objects.removeAndVerify(row.objectKeys[nextIndex], signal), ioBudget());
        if (removed !== "absent") { outcome = "failed"; reason = "object-failed"; break; }
        nextIndex++;
      }
      if (quiescent === true && nextIndex === row.objectKeys.length && ioBudget() > 0) {
        if (await boundedPort((signal) => objects.verifyGalleryEmpty(prefix, signal), ioBudget()) === true) outcome = "deleted";
        else { outcome = "failed"; reason = "unexpected-object"; }
      }
    } catch { outcome = "failed"; reason = "object-failed"; }
    const finishedAt = active();
    if (finishedAt === undefined) { result.conflicts++; continue; }
    try {
      const saved = await boundedPort((signal) => metadata.finish({ galleryId, token: claim!.token, now: finishedAt, nextIndex, outcome, ...(reason === undefined ? {} : { reason }) }, signal));
      if (saved !== true) { if (saved !== false) issue("invalid-store-result"); result.conflicts++; continue; }
      if (row.cleanupTriggeredAt && finishedAt.getTime() >= row.cleanupTriggeredAt.getTime() + PRIVATE_GALLERY_RETENTION_WINDOWS.deletionGraceDays * 86_400_000) result.overdueCheckpoints++;
      if (outcome === "deleted") result.deleted++;
      else if (outcome === "failed") { result.failed++; issue(reason!); }
      else result.progressed++;
    } catch { issue("metadata-failed"); result.failed++; }
  }
  try {
    const health = await boundedPort((signal) => metadata.readHealth(clock(), signal));
    if (![health.parked, health.overdue, health.defects].every((n) => integer(n, Number.MAX_SAFE_INTEGER))) throw new Error("health");
    result.parked = health.parked; result.outstandingOverdue = health.overdue; result.defects = health.defects;
    if (health.parked > 0) issue("operator-attention");
    if (health.overdue > 0) issue("retention-overdue");
    if (health.defects > 0) issue("invalid-store-result");
  } catch { issue("metadata-failed"); }
  try {
    const policy = await boundedPort((signal) => objects.readBackstop(signal));
    if (policy.enabled !== true || policy.objectAgeDays !== PRIVATE_GALLERY_BACKSTOP_OBJECT_AGE_DAYS ||
        !integer(policy.noncurrentDays, PRIVATE_GALLERY_BACKSTOP_NONCURRENT_VERSION_DAYS) || policy.noncurrentDays < 1 ||
        !integer(policy.multipartDays, PRIVATE_GALLERY_BACKSTOP_MULTIPART_ABORT_DAYS) || policy.multipartDays < 1) issue("backstop-drift");
  } catch { issue("backstop-drift"); }
  return result;
}
