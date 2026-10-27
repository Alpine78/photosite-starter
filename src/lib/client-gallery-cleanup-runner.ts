/** The control revision orders publication, cancellation and every destructive attempt. */
import "server-only";
import {
  cleanupControlId, cleanupControlMutation, cleanupPoliciesEqual, cleanupPolicyFromGallery, parseCleanupControl,
  type CleanupAsset, type CleanupControl, type CleanupReason,
} from "@/lib/client-gallery-cleanup-contract";
import { CLIENT_GALLERY_FORMATS, parseClientGallery, type ParsedClientGallery } from "@/lib/client-gallery-model";
import { planClientGalleryCleanup, RETENTION_MAX_REFERRERS, type CleanupCandidate } from "@/lib/client-gallery-retention";
import { cleanupDocumentId, type CleanupSnapshot } from "@/lib/client-gallery-cleanup-snapshot";
import { CleanupTransportError, type CleanupMutationResult } from "@/lib/client-gallery-cleanup-transport";
import { parseClientGalleryZipAsset } from "@/lib/client-gallery-zip-contract";

export const CLEANUP_CURSOR_ID = "clientGalleryCleanupCursor.daily";
export const CLEANUP_MAX_EXAMINED = 50;
export const CLEANUP_MAX_ATTEMPTS = 5;
export const CLEANUP_START_BUDGET_MS = 30_000;
export const CLEANUP_HARD_DEADLINE_MS = 185_000;
const CLAIM_RESERVE_MS = 35_000;
type Document = Record<string, unknown>;
type Reads = Readonly<{ documents: ReadonlyMap<string, Document>; omitted: ReadonlySet<string> }>;
type Outcome = "completed" | "skipped" | "blocked" | "conflict" | "refused" | "uncertain";
export type CleanupRunCounts = Record<Outcome, number> & { examined: number; attempts: number; deletedAssets: number; sharedAssets: number; deletedZips: number; sharedZips: number; completedPass: boolean; cursorWritten: boolean };
export type CleanupRunDependencies = Readonly<{
  snapshot: CleanupSnapshot;
  read: (ids: readonly string[], options?: { includeAllVersions?: boolean }) => Promise<Reads>;
  mutate: (mutations: readonly Readonly<Record<string, unknown>>[]) => Promise<CleanupMutationResult>;
  now: () => number;
  /** Conservative provider-bounded time for expiry only; audit times use now(). */
  expiryNow?: () => number;
  clock: () => number;
  operationId: () => string;
  remainingMs: () => number;
}>;

export class CleanupRunError extends Error {
  constructor(readonly reason: CleanupReason) { super(reason); }
}
function blocked(reason: CleanupReason): never { throw new CleanupRunError(reason); }
function failureReason(error: unknown): CleanupReason {
  if (error instanceof CleanupRunError) return error.reason;
  if (error instanceof CleanupTransportError) {
    if (error.code === "clock_untrusted") return "clock_skew";
    if (error.code === "provider_refused") return "refused";
    if (error.code === "snapshot_limit_exceeded") return "snapshot_limit_exceeded";
    return error.code === "provider_invalid" || error.code === "snapshot_invalid" ? "incomplete_evidence" : "provider_unavailable";
  }
  return "internal_error";
}
function samePublication(left: CleanupControl, right: CleanupControl): boolean {
  return left._id === right._id && left.galleryId === right.galleryId && left.publicationId === right.publicationId &&
    left.sourceDocumentId === right.sourceDocumentId && left.sourceRevision === right.sourceRevision && cleanupPoliciesEqual(left.policy, right.policy);
}
function copyOf(id: string, base: string): boolean {
  return id === base || id === `drafts.${base}` || id.startsWith("versions.") && id.slice(id.indexOf(".", 9) + 1) === base;
}
function onlyPublished(reads: Reads, id: string, reason: CleanupReason): Document | undefined {
  if ([...reads.documents.keys()].some((key) => copyOf(key, id) && key !== id)) blocked(reason);
  const value = reads.documents.get(id);
  if (!value && !reads.omitted.has(id)) blocked("incomplete_evidence");
  return value;
}
function requireRevision(control: CleanupControl): CleanupControl {
  if (!control._rev) blocked("incomplete_evidence");
  return control;
}
function assetMatches(raw: Document | undefined, item: ParsedClientGallery["items"][number]): raw is Document & { _rev: string } {
  const metadata = raw?.metadata as Record<string, unknown> | undefined;
  const dimensions = metadata?.dimensions as Record<string, unknown> | undefined;
  return Boolean(raw && raw._id === item.assetId && raw._type === "sanity.imageAsset" &&
    typeof raw._rev === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(raw._rev) &&
    raw.sha1hash === item.hash && raw.extension === item.extension && raw.mimeType === CLIENT_GALLERY_FORMATS[item.extension] &&
    dimensions?.width === item.width && dimensions?.height === item.height && raw.restricted !== true);
}

/** Pure composition; every delete is preceded by an existence/revision assertion. */
export function cleanupDeletionMutations(control: CleanupControl, plan: CleanupCandidate, operationId: string, at: string): readonly Readonly<Record<string, unknown>>[] {
  if (control.state !== "pending" || control.attempt?.operationId !== operationId || !control._rev || plan.gallery.id !== control.galleryId) throw new Error("Cleanup attempt changed");
  const deletedAssets = plan.candidates as readonly CleanupAsset[], sharedAssets = plan.shared as readonly CleanupAsset[];
  const next: CleanupControl = { ...control, state: "complete", attempt: undefined, lastResult: undefined,
    receipt: { operationId, at, deletedAssets, sharedAssets, deletedCount: deletedAssets.length, sharedCount: sharedAssets.length } };
  // Remove undefined properties so the contract produces real unset operations.
  const complete = JSON.parse(JSON.stringify(next)) as CleanupControl;
  parseCleanupControl(complete, control._id, control.galleryId);
  const draftId = `drafts.${plan.gallery.id}`;
  const mutations = [cleanupControlMutation(control, complete),
    { patch: { id: plan.gallery.id, ifRevisionID: plan.gallery.revision, set: { cleanupAttempt: operationId } } },
    { delete: { id: plan.gallery.id } },
    { create: { _id: draftId, _type: "clientDeliveryGallery" } }, { delete: { id: draftId } },
    ...plan.candidates.map((asset) => ({ patch: { id: asset.id, ifRevisionID: asset.revision, set: { cleanupAttempt: operationId } } })),
    ...plan.candidates.map((asset) => ({ delete: { id: asset.id } })),
  ];
  if (new TextEncoder().encode(JSON.stringify({ mutations })).byteLength > 3_500_000) throw new Error("Cleanup transaction too large");
  return mutations;
}

/** No caller can replay a stored plan: pending carries only operation identity. */
export async function runClientGalleryCleanup(dependencies: CleanupRunDependencies): Promise<CleanupRunCounts> {
  const counts: CleanupRunCounts = { examined: 0, attempts: 0, completed: 0, skipped: 0, blocked: 0, conflict: 0, refused: 0, uncertain: 0, deletedAssets: 0, sharedAssets: 0, deletedZips: 0, sharedZips: 0, completedPass: false, cursorWritten: false };
  const started = dependencies.clock(), iso = () => new Date(dependencies.now()).toISOString();
  const expiryNow = dependencies.expiryNow ?? dependencies.now;
  const note = (outcome: Outcome) => { counts[outcome]++; };
  const hasTime = () => dependencies.clock() - started < CLEANUP_START_BUDGET_MS && dependencies.remainingMs() >= CLAIM_RESERVE_MS;

  async function readControl(id: string): Promise<CleanupControl | undefined> {
    const reads = await dependencies.read([id], { includeAllVersions: true });
    const raw = onlyPublished(reads, id, "control_variants");
    if (!raw) return undefined;
    const galleryId = raw.galleryId;
    if (typeof galleryId !== "string" || await cleanupControlId(galleryId) !== id) blocked("incomplete_evidence");
    return requireRevision(parseCleanupControl(raw, id, galleryId));
  }
  async function record(control: CleanupControl, reason: CleanupReason): Promise<void> {
    // A result write is itself a fence. A concurrent publication/attempt wins by revision.
    const next = { ...control, state: control.state === "pending" ? "enrolled" : control.state, lastResult: { reason, at: iso() } } as CleanupControl;
    const payload = { ...next };
    if (payload.state !== "pending") delete (payload as { attempt?: unknown }).attempt;
    try { await dependencies.mutate([cleanupControlMutation(control, payload)]); } catch { /* closed aggregate still reports the block */ }
  }
  async function reconcile(control: CleanupControl, operationId: string): Promise<boolean> {
    try {
      const fresh = await readControl(control._id);
      if (fresh && samePublication(control, fresh) && fresh.state === "complete" && fresh.receipt?.operationId === operationId) {
        counts.deletedAssets += fresh.receipt.deletedCount; counts.sharedAssets += fresh.receipt.sharedCount;
        counts.deletedZips += fresh.receipt.deletedAssets.filter((asset) => asset.type === "sanity.fileAsset").length;
        counts.sharedZips += fresh.receipt.sharedAssets.filter((asset) => asset.type === "sanity.fileAsset").length;
        return true;
      }
    } catch { /* an unreadable response proves nothing */ }
    return false;
  }
  async function recordCurrentEnrollment(control: CleanupControl, reason: CleanupReason): Promise<void> {
    try {
      const fresh = await readControl(control._id);
      // Never overwrite another publication or cancel a different runner's claim merely to report ours.
      if (fresh && samePublication(control, fresh) && fresh.state === "enrolled") await record(fresh, reason);
    } catch { /* provider read/write permission failures remain visible in aggregate counts */ }
  }
  async function inventory(control: CleanupControl): Promise<CleanupCandidate> {
    const galleryReads = await dependencies.read([control.galleryId], { includeAllVersions: true });
    const raw = onlyPublished(galleryReads, control.galleryId, "gallery_variants");
    if (!raw) return blocked("missing_gallery");
    let parsed: ParsedClientGallery;
    try { parsed = parseClientGallery(raw, control.galleryId, control.policy.handle); } catch { return blocked("invalid_gallery"); }
    const policy = cleanupPolicyFromGallery(raw);
    if (!policy || !cleanupPoliciesEqual(policy, control.policy)) return blocked("policy_changed");
    if (parsed.deadline === undefined || expiryNow() < parsed.deadline) return blocked("policy_changed");
    const snapshotGallery = dependencies.snapshot.documents.get(parsed.id);
    if (!snapshotGallery || snapshotGallery.type !== "clientDeliveryGallery") return blocked("incomplete_evidence");
    if (dependencies.snapshot.referrers(parsed.id).length) return blocked("incoming_reference");
    // Export sees every token-readable document, including weak uses and versions.
    if ([...dependencies.snapshot.documents.keys()].some((id) => id !== parsed.id && copyOf(id, parsed.id))) return blocked("gallery_variants");
    const assetReads = await dependencies.read(policy.assetIds);
    const assets = policy.assetIds.map((id) => {
      const observed = dependencies.snapshot.documents.get(id), fresh = assetReads.documents.get(id);
      let revision: string, type: CleanupAsset["type"];
      if (id === parsed.deliveryZip?.assetId) {
        if (!observed || observed.type !== "sanity.fileAsset") return blocked("invalid_assets");
        try { revision = parseClientGalleryZipAsset(fresh, id).revision; } catch { return blocked("invalid_assets"); }
        type = "sanity.fileAsset";
      } else {
        const item = parsed.items.find((entry) => entry.assetId === id);
        if (!observed || observed.type !== "sanity.imageAsset" || !item || !assetMatches(fresh, item)) return blocked("invalid_assets");
        revision = fresh._rev; type = "sanity.imageAsset";
      }
      const refs = dependencies.snapshot.referrers(id);
      if (refs.length >= RETENTION_MAX_REFERRERS) return blocked("invalid_assets");
      if (!refs.some((entry) => entry.id === parsed.id)) return blocked("incomplete_evidence");
      const referrers = refs.map((entry) => ({ id: entry.id, revision: entry.id === parsed.id ? parsed.revision : entry.revision }));
      return { id, revision, type, complete: true, referenceCount: referrers.length, referrers };
    });
    const planned = planClientGalleryCleanup({ gallery: raw, enrollment: { galleryId: parsed.id, revision: parsed.revision }, now: expiryNow(),
      evidence: { galleryId: parsed.id, revision: parsed.revision, variants: { complete: true, ids: [parsed.id] }, assetsComplete: true, assets } });
    if (planned.state !== "candidate") return blocked(planned.reason === "invalid-assets" ? "invalid_assets" : "incomplete_evidence");
    return planned;
  }
  async function one(id: string): Promise<void> {
    counts.examined++;
    let control: CleanupControl | undefined;
    try {
      control = await readControl(id);
      if (!control || control.state === "disabled" || control.state === "complete") return note("skipped");
      if (control.state === "pending") {
        const pending = control;
        const { attempt: discarded, ...rest } = pending; void discarded;
        const fenced: CleanupControl = { ...rest, state: "enrolled", lastResult: { reason: "uncertain", at: iso() } };
        const result = await dependencies.mutate([cleanupControlMutation(pending, fenced)]);
        if (result.kind === "conflict") {
          if (await reconcile(pending, pending.attempt!.operationId)) return note("completed");
          await recordCurrentEnrollment(pending, "conflict");
          return note("conflict");
        }
        if (result.kind === "refused") { await record(pending, "refused"); return note("refused"); }
        const fresh = await readControl(id);
        if (!fresh || !samePublication(pending, fresh) || fresh.state !== "enrolled") {
          if (await reconcile(pending, pending.attempt!.operationId)) return note("completed");
          return note("uncertain");
        }
        control = fresh;
      }
      if (expiryNow() < Date.parse(control.policy.expiryInstant)) return note("skipped");
      const plan = await inventory(control);
      if (dependencies.remainingMs() < CLAIM_RESERVE_MS) return note("skipped");
      const operationId = dependencies.operationId();
      const { lastResult: discarded, ...rest } = control; void discarded;
      const pending: CleanupControl = { ...rest, state: "pending", attempt: { operationId, at: iso() } };
      parseCleanupControl(pending, control._id, control.galleryId);
      counts.attempts++;
      const claim = await dependencies.mutate([cleanupControlMutation(control, pending)]);
      if (claim.kind === "conflict" || claim.kind === "refused") {
        await recordCurrentEnrollment(control, claim.kind);
        return note(claim.kind);
      }
      const claimed = await readControl(id);
      if (!claimed || !samePublication(control, claimed) || claimed.state !== "pending" || claimed.attempt?.operationId !== operationId) {
        if (await reconcile(control, operationId)) return note("completed");
        await recordCurrentEnrollment(control, "uncertain");
        return note("uncertain");
      }
      control = claimed;
      const outcome = await dependencies.mutate(cleanupDeletionMutations(claimed, plan, operationId, iso()));
      // A lost body can conceal a successful transaction. Never resend it.
      if (outcome.kind === "committed") {
        counts.deletedAssets += plan.candidates.length; counts.sharedAssets += plan.shared.length;
        counts.deletedZips += plan.candidates.filter((asset) => asset.type === "sanity.fileAsset").length;
        counts.sharedZips += plan.shared.filter((asset) => asset.type === "sanity.fileAsset").length;
        return note("completed");
      }
      if (await reconcile(claimed, operationId)) return note("completed");
      await record(claimed, outcome.kind);
      note(outcome.kind);
    } catch (error) {
      if (control) await record(control, failureReason(error));
      note("blocked");
    }
  }

  const cursorReads = await dependencies.read([CLEANUP_CURSOR_ID], { includeAllVersions: true });
  const cursor = onlyPublished(cursorReads, CLEANUP_CURSOR_ID, "cursor_variants");
  if (cursor && (cursor._type !== "clientGalleryCleanupCursor" || typeof cursor._rev !== "string" ||
    typeof cursor.after !== "string" || cursor.after !== "" && !cleanupDocumentId(cursor.after))) blocked("incomplete_evidence");
  const start = cursor?.after as string ?? "";
  const sorted = [...dependencies.snapshot.controlIds].sort();
  const ordered = [...sorted.filter((id) => id > start), ...sorted.filter((id) => id <= start)];
  let after = start, processed = 0;
  for (const id of ordered) {
    if (!hasTime() || counts.examined >= CLEANUP_MAX_EXAMINED || counts.attempts >= CLEANUP_MAX_ATTEMPTS) break;
    await one(id);
    after = id; processed++;
  }
  if (processed === ordered.length) { counts.completedPass = true; after = ""; }
  if (processed || counts.completedPass) {
    const next = { _id: CLEANUP_CURSOR_ID, _type: "clientGalleryCleanupCursor", after, updatedAt: iso() };
    const mutation = cursor ? { patch: { id: CLEANUP_CURSOR_ID, ifRevisionID: cursor._rev, set: { after, updatedAt: next.updatedAt } } } : { create: next };
    try { counts.cursorWritten = (await dependencies.mutate([mutation])).kind === "committed"; }
    catch { /* false reports unconfirmed progress without leaking a provider error */ }
  }
  return counts;
}
