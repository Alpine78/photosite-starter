/** Guarded delivery publication and optional proof deletion (AB#396).
 * IO uses the signed-in editor's client. No public mapping or new record is written.
 */
import { validateClientDeliveryGallery } from "../sanity/schemas/client-delivery-gallery";
import type { SchemaValidationContext } from "../sanity/schemas/schema-types";
import { publicImageAssetRef, record } from "../sanity/schemas/closed-document";
import { transactionSyncLocked } from "./editor-lock";
import {
  cleanupControlId, cleanupControlMutation, cleanupPoliciesEqual, cleanupPolicyFromGallery, parseCleanupControl,
  type CleanupControl, type CleanupPolicy,
} from "../src/lib/client-gallery-cleanup-contract";
import type { ProofActionState, ProofValidationState } from "./proof-publish";
import {
  collectProofDeletion, planProofDeletion, proofDocumentCopies, readProofDocuments,
  PROOF_DELETE_MAX_BODY_BYTES, type ProofDeletionInventory, type ProofDeletionReader,
} from "./proof-delete";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const PROOF_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;
/** Exceeds Content Lake's documented three-minute mutation execution limit. */
export const DELIVERY_HANDOFF_MARGIN_MS = 5 * 60_000;
export const DELIVERY_LINKS_QUERY = '*[_type == "clientProofGallery" && replacedBy._ref == $id][0...3]{_id}';
export type DeliveryPublishReader = ProofDeletionReader & {
  /** Trusted provider time, never the browser clock. */
  time(): Promise<unknown>;
  links(id: string): Promise<unknown>;
  validation: SchemaValidationContext;
};
export type DeliveryPublishRequest = Readonly<{
  id: string; expectedRevision: string; proofId?: string; proofsEnabled: boolean;
  cleanup?: Readonly<{ enroll: boolean; publicationId: string; expectedPublished: boolean; expectedControlRevision?: string }>;
}>;
export type DeliveryMutation = Readonly<Record<string, unknown>>;
export type DeliveryPublishPlan = Readonly<{
  request: DeliveryPublishRequest;
  target: Readonly<Record<string, unknown>>;
  published?: Readonly<Record<string, unknown>>;
  draft?: Readonly<Record<string, unknown>>;
  proof?: ProofDeletionInventory;
  selectionState?: string;
  cleanup?: Readonly<{ previous?: CleanupControl; next?: CleanupControl; policy?: CleanupPolicy; enroll: boolean; expired: boolean; policyChanged: boolean }>;
  mutations: readonly DeliveryMutation[];
}>;
export type DeliveryPublishBlock = "unreadable" | "invalid" | "stale" | "copies" | "proof" | "linked" | "unavailable" | "too-large" | "deletion" | "cleanup";
export type DeliveryPublishReview = { ready: DeliveryPublishPlan } | { reason: DeliveryPublishBlock };
export type DeliveryPublishOutcome = "published" | "conflict" | "refused" | "uncertain";
export type DeliveryReconciliation = "published" | "not-observed" | "uncertain";

/** Validation is tied to the same revision the editor sees; fresh validation runs again during review. */
export function deliveryPublishReady(state: ProofActionState, validation: ProofValidationState, syncing: boolean): boolean {
  const source = state.draft ?? state.published;
  return state.type === "clientDeliveryGallery" && ID.test(state.id) && state.version == null && state.release === undefined &&
    state.ready && !transactionSyncLocked(state.transactionSyncLock) && !syncing && !validation.isValidating &&
    typeof source?._rev === "string" && REVISION.test(source._rev) && validation.revision === source._rev &&
    !validation.validation.some((marker) => marker.level === "error");
}

function authored(doc: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !["_id", "_rev", "_createdAt", "_updatedAt", "_system"].includes(key)));
}
/** Stable comparison of authored payloads, independent of response property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function providerTime(reader: DeliveryPublishReader): Promise<number> {
  const value = await reader.time();
  if (typeof value !== "string" || value.length > 30) throw new Error("clock");
  const now = Date.parse(value);
  if (!Number.isFinite(now) || new Date(now).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) throw new Error("clock");
  return now;
}
function usable(target: Readonly<Record<string, unknown>>, now: number): boolean {
  return target.available === true && (target.availabilityMode === "indefinite" ||
    typeof target.expiryInstant === "string" && Date.parse(target.expiryInstant) > now + DELIVERY_HANDOFF_MARGIN_MS);
}
const revisionGuard = (doc: Readonly<Record<string, unknown>>): DeliveryMutation => ({
  patch: { id: doc._id, ifRevisionID: doc._rev, set: { handle: doc.handle } },
});

/** Strict existence/permission handling; operational documents never use the query index. */
export async function readDeliveryCleanup(id: string, reader: DeliveryPublishReader): Promise<CleanupControl | undefined> {
  const controlId = await cleanupControlId(id), docs = await readProofDocuments(reader, [controlId]);
  const value = docs.get(controlId);
  if (!value) return undefined;
  const control = parseCleanupControl(value, controlId, id);
  if (!control._rev) throw new Error("Missing cleanup revision");
  return control;
}
/** Current absence cannot prove a gallery was never published (native unpublish retains a draft). */
export function deliveryCleanupDefault(gallery: Readonly<Record<string, unknown>>, control?: CleanupControl): boolean {
  return !!cleanupPolicyFromGallery(gallery) && !!control && ["enrolled", "pending"].includes(control.state);
}

/** Build exactly the operation the editor reviews. Submit never recollects a different deletion. */
export async function reviewDeliveryPublication(request: DeliveryPublishRequest, reader: DeliveryPublishReader): Promise<DeliveryPublishReview> {
  if (!ID.test(request.id) || !REVISION.test(request.expectedRevision) ||
    request.proofId !== undefined && (!request.proofsEnabled || !PROOF_ID.test(request.proofId) || request.proofId === request.id)) return { reason: "invalid" };
  try {
    const now = await providerTime(reader), draftId = `drafts.${request.id}`;
    const docs = await readProofDocuments(reader, [request.id, draftId]);
    const published = docs.get(request.id), draft = docs.get(draftId), source = draft ?? published;
    if (!source || source._type !== "clientDeliveryGallery" || published && published._type !== "clientDeliveryGallery" ||
      published && (typeof published._rev !== "string" || !REVISION.test(published._rev)) ||
      source._rev !== request.expectedRevision || !draft && !request.proofId) return { reason: "stale" };
    if ((await proofDocumentCopies(reader, [request.id], docs, draftId)).length > 0) return { reason: "copies" };
    if (await validateClientDeliveryGallery(source, reader.validation) !== true) return { reason: "invalid" };
    if (published && published.handle !== source.handle) return { reason: "invalid" };
    // Copy only the fully validated authored content, never draft/system metadata.
    const target = { ...authored(source), _id: request.id };
    let cleanup: DeliveryPublishPlan["cleanup"];
    if (request.cleanup) {
      if (!REVISION.test(request.cleanup.publicationId) || typeof request.cleanup.enroll !== "boolean") return { reason: "cleanup" };
      const previous = await readDeliveryCleanup(request.id, reader), policy = cleanupPolicyFromGallery(source);
      if (typeof request.cleanup.expectedPublished !== "boolean" || request.cleanup.expectedPublished !== !!published ||
        request.cleanup.expectedControlRevision !== previous?._rev) return { reason: "stale" };
      const controlId = await cleanupControlId(request.id);
      const controlDocs = new Map<string, Record<string, unknown> | undefined>([[controlId, previous as Record<string, unknown> | undefined]]);
      if ((await proofDocumentCopies(reader, [controlId], controlDocs)).length) return { reason: "copies" };
      if (request.cleanup.enroll && !policy) return { reason: "cleanup" };
      const next = policy || previous ? parseCleanupControl({
        _id: controlId, _type: "clientGalleryCleanup", version: 1, galleryId: request.id,
        policy: policy ?? previous!.policy, sourceDocumentId: source._id, sourceRevision: source._rev,
        publicationId: request.cleanup.publicationId, enrolledAt: new Date(now).toISOString(),
        state: request.cleanup.enroll ? "enrolled" : "disabled",
      }, controlId, request.id) : undefined;
      cleanup = { previous, next, policy, enroll: request.cleanup.enroll,
        expired: !!policy && Date.parse(policy.expiryInstant) <= now,
        policyChanged: !!previous && !!policy && !cleanupPoliciesEqual(previous.policy, policy) };
    }
    let proof: ProofDeletionInventory | undefined, selectionState: string | undefined;
    if (request.proofsEnabled) {
      const links = await reader.links(request.id);
      if (!Array.isArray(links) || links.some((row) => !record(row) || typeof row._id !== "string")) return { reason: "unreadable" };
      // A legacy link cannot silently turn into an ordinary replacement publish.
      if (links.some((row) => row._id !== request.proofId && row._id !== `drafts.${request.proofId}`)) return { reason: "linked" };
    }
    if (request.proofId) {
      if (!usable(target, now)) return { reason: "unavailable" };
      const proofDraftId = `drafts.${request.proofId}`, termsId = `proofTerms.${request.proofId}`;
      const proofDocs = await readProofDocuments(reader, [request.proofId, proofDraftId, termsId]);
      const proofDoc = proofDocs.get(request.proofId);
      // Exact existence read (not the query index): absent terms mean the unit is incomplete, so say so
      // before the collector can report an unrelated deletion reason. Permission omissions already threw.
      if (!proofDoc || proofDoc._type !== "clientProofGallery" || !proofDocs.get(termsId)) return { reason: "proof" };
      for (const key of [request.proofId, proofDraftId]) {
        const doc = proofDocs.get(key);
        if (doc?.replacedBy != null && (!record(doc.replacedBy) || doc.replacedBy._ref !== request.id)) return { reason: "linked" };
      }
      const deletion = await collectProofDeletion(request.proofId, reader, now);
      if (!("ready" in deletion)) return { reason: "deletion" };
      if (!deletion.ready.published || !deletion.ready.terms) return { reason: "proof" };
      if (deletion.ready.published.revision !== proofDoc._rev ||
        deletion.ready.draft?.revision !== proofDocs.get(`drafts.${request.proofId}`)?._rev) return { reason: "stale" };
      const protectedAssets = new Set((source.items as Record<string, unknown>[]).map((item) => publicImageAssetRef(item.image)));
      proof = { ...deletion.ready,
        assets: deletion.ready.assets.filter((id) => !protectedAssets.has(id)),
        sharedAssets: [...new Set([...deletion.ready.sharedAssets, ...deletion.ready.assets.filter((id) => protectedAssets.has(id))])],
      };
      if (proof.selection) {
        const selection = (await readProofDocuments(reader, [proof.selection.id])).get(proof.selection.id);
        if (selection?._rev !== proof.selection.revision) return { reason: "stale" };
        selectionState = typeof selection.state === "string" ? selection.state : "unknown";
      }
    }
    const deletion = proof ? planProofDeletion({ ...proof, assets: [] }, new Date(now).toISOString()) : [];
    const publication: DeliveryMutation[] = draft ? [
      revisionGuard(draft), { delete: { id: draftId } },
      ...(published ? [revisionGuard(published), { createOrReplace: target }] : [{ create: target }]),
    ] : [
      revisionGuard(published!), { create: { _id: draftId, _type: "clientDeliveryGallery" } }, { delete: { id: draftId } },
    ];
    const mutations = [...(cleanup?.next ? [cleanupControlMutation(cleanup.previous, cleanup.next)] : []),
      ...deletion, ...publication, ...(proof?.assets.map((id) => ({ delete: { id } })) ?? [])];
    if (new TextEncoder().encode(JSON.stringify({ mutations })).byteLength > PROOF_DELETE_MAX_BODY_BYTES) return { reason: "too-large" };
    // Snapshot caller data: subsequent edits cannot change what gets committed.
    return { ready: structuredClone({ request, target, published, draft, proof, selectionState, cleanup, mutations }) };
  } catch { return { reason: "unreadable" }; }
}

/** Single attempt; revision/create/reference guards arbitrate across tabs and editors. */
export async function publishDelivery(
  plan: DeliveryPublishPlan, reader: DeliveryPublishReader,
  commit: (mutations: readonly DeliveryMutation[]) => Promise<void>,
): Promise<DeliveryPublishOutcome> {
  if (plan.proof) {
    try { if (!usable(plan.target, await providerTime(reader))) return "refused"; }
    catch { return "refused"; }
  }
  try { await commit(plan.mutations); return "published"; }
  catch (error) {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    return status === 409 ? "conflict" : typeof status === "number" && status >= 400 && status < 500 ? "refused" : "uncertain";
  }
}

/** Read-only reconciliation. Pre-state means not observed applied, never proof a timed-out request stopped. */
export async function reconcileDeliveryPublication(plan: DeliveryPublishPlan, reader: DeliveryPublishReader): Promise<DeliveryReconciliation> {
  const id = plan.request.id, draftId = `drafts.${id}`;
  const sentinels = plan.proof ? [plan.proof.galleryId, `drafts.${plan.proof.galleryId}`, `proofTerms.${plan.proof.galleryId}`] : [];
  try {
    const docs = await readProofDocuments(reader, [id, draftId, ...sentinels]);
    const target = docs.get(id);
    const cleanup = plan.cleanup ? await readDeliveryCleanup(id, reader) : undefined;
    const intended = plan.cleanup?.next;
    const cleanupMatches = !plan.cleanup || !intended && !cleanup || !!intended && !!cleanup &&
      intended.publicationId === cleanup.publicationId && intended.sourceDocumentId === cleanup.sourceDocumentId &&
      intended.sourceRevision === cleanup.sourceRevision && intended.enrolledAt === cleanup.enrolledAt &&
      cleanupPoliciesEqual(intended.policy, cleanup.policy) &&
      (intended.state === "disabled" ? cleanup.state === "disabled" : ["enrolled", "pending", "complete"].includes(cleanup.state));
    const publishedTarget = target ? canonical(authored(target)) === canonical(authored(plan.target)) :
      !!intended && intended.state === "enrolled" && cleanup?.state === "complete";
    if (publishedTarget && cleanupMatches && !docs.get(draftId) && sentinels.every((key) => !docs.get(key))) return "published";
    const same = (key: string, revision: unknown) => docs.get(key)?._rev === revision;
    if (cleanup?._rev === plan.cleanup?.previous?._rev && same(id, plan.published?._rev) && same(draftId, plan.draft?._rev) && (!plan.proof ||
      same(plan.proof.galleryId, plan.proof.published?.revision) && same(`drafts.${plan.proof.galleryId}`, plan.proof.draft?.revision) &&
      same(`proofTerms.${plan.proof.galleryId}`, plan.proof.terms?.revision))) return "not-observed";
    return "uncertain";
  } catch { return "uncertain"; }
}
