/** Development-only prepublication delivery setup; no capability or customer access. */
import "server-only";
import { randomUUID } from "node:crypto";
import { generateGalleryHandle } from "@/lib/private-gallery-capability";
import type { PrivateGallery, PrivateGalleryPlacement } from "@/lib/private-gallery";
import { isPrivateGalleryProofBusinessReference } from "@/lib/private-gallery-proof";

import { openPrivateGalleryUploadPreparation, isPrivateGalleryPreparationExpired,
  type PrivateGalleryManifestEntry, type PrivateGalleryUploadPlan } from "@/lib/private-gallery-upload";
import { verifyPrivateGalleryUpload, type PrivateGalleryVerifiedObject,
  type PrivateGalleryVerificationFailure } from "@/lib/private-gallery-upload-completion";
import { snapshotPrivateGalleryUploadCompletionEvidence, type PrivateGalleryUploadCompletionEvidence } from "@/lib/private-gallery-upload-evidence";
import { buildVerifiedFirstDeliveryData } from "@/lib/private-gallery-delivery-upload";
import { evaluatePrivateGalleryReadiness } from "@/lib/private-gallery-readiness";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";

export const PRIVATE_GALLERY_DELIVERY_DRAFT_LIST_LIMIT = 100;
/** Process-local development guard, not a production storage policy. */
export const PRIVATE_GALLERY_DELIVERY_DRAFT_CAPACITY = 1000;
export type PrivateGalleryDeliveryDraftInput = {
  readonly customerReference?: string;
  readonly jobReference?: string;
};
export type PrivateGalleryDeliveryDraft = PrivateGalleryDeliveryDraftInput & {
  readonly gallery: PrivateGallery;
  readonly revision: number;
  readonly preparation?: PrivateGalleryUploadPlan;
  readonly preparationKeyPrefix?: string;
  readonly readyDelivery?: {
    readonly placements: readonly PrivateGalleryPlacement[];
    readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
  };
};
export type PrivateGalleryDeliveryDraftCompletionInput = PrivateGalleryUploadCompletionEvidence & {
  readonly handle: string; readonly expectedRevision: number; readonly preparationId: string; readonly now: Date;
};
export type PrivateGalleryDeliveryDraftCompletion =
  | { readonly ready: true; readonly setup: PrivateGalleryDeliveryDraft }
  | { readonly ready: false; readonly failures: readonly PrivateGalleryVerificationFailure[]; readonly truncated: boolean };
export type PrivateGalleryDeliveryDraftStore = {
  create(input: PrivateGalleryDeliveryDraftInput, now: Date): Promise<PrivateGalleryDeliveryDraft>;
  updateReferences(input: { readonly handle: string; readonly expectedRevision: number;
    readonly references: PrivateGalleryDeliveryDraftInput }): Promise<PrivateGalleryDeliveryDraft>;
  openFirstPreparation(input: { readonly handle: string; readonly expectedRevision: number; readonly keyPrefix: string;
    readonly manifest: readonly PrivateGalleryManifestEntry[]; readonly now: Date }): Promise<PrivateGalleryUploadPlan>;
  /** Server-only observations must come from metadata reads, never browser assertions. */
  completeFirstPreparation(input: PrivateGalleryDeliveryDraftCompletionInput): Promise<PrivateGalleryDeliveryDraftCompletion>;
  list(limit: number, afterHandle?: string): Promise<{ readonly items: readonly PrivateGalleryDeliveryDraft[]; readonly hasMore: boolean }>;
};
export class PrivateGalleryDeliveryDraftStoreError extends Error {
  constructor(readonly reason: "invalid-input" | "invalid-time" | "invalid-limit" | "invalid-cursor" | "identity-collision" | "capacity" | "not-found" | "conflict" | "preparation-expired" | "readiness-failed") {
    super("[private-gallery-delivery-draft-store] " + reason);
    this.name = "PrivateGalleryDeliveryDraftStoreError";
  }
}
export function validateDeliveryDraftInput(value: unknown): PrivateGalleryDeliveryDraftInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["customerReference", "jobReference"].includes(key)) ||
      (input.customerReference !== undefined && !isPrivateGalleryProofBusinessReference(input.customerReference)) ||
      (input.jobReference !== undefined && !isPrivateGalleryProofBusinessReference(input.jobReference))) {
    throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
  }
  return {
    ...(input.customerReference === undefined ? {} : { customerReference: input.customerReference as string }),
    ...(input.jobReference === undefined ? {} : { jobReference: input.jobReference as string }),
  };
}
export function createPrivateGalleryDeliveryDraftMemoryStore(): PrivateGalleryDeliveryDraftStore {
  const rows = new Map<string, PrivateGalleryDeliveryDraft>();
  const handles = new Map<string, string>();
  return {
    async create(input, now) {
      const validated = validateDeliveryDraftInput(input);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new PrivateGalleryDeliveryDraftStoreError("invalid-time");
      if (rows.size >= PRIVATE_GALLERY_DELIVERY_DRAFT_CAPACITY) throw new PrivateGalleryDeliveryDraftStoreError("capacity");
      const galleryId = randomUUID();
      // A handle is a non-secret identifier. No customer capability is minted here.
      const galleryHandle = generateGalleryHandle();
      if (rows.has(galleryId) || handles.has(galleryHandle)) throw new PrivateGalleryDeliveryDraftStoreError("identity-collision");
      const row: PrivateGalleryDeliveryDraft = { ...validated, revision: 0, gallery: {
        galleryId, galleryHandle, kind: "delivery", state: "draft", capabilityGeneration: 0, createdAt: new Date(now),
      } };
      rows.set(galleryId, row);
      handles.set(galleryHandle, galleryId);
      return structuredClone(row);
    },
    async updateReferences(input) {
      if (!input || typeof input !== "object" || Array.isArray(input) ||
          Object.keys(input).sort().join(",") !== "expectedRevision,handle,references" ||
          typeof input.handle !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(input.handle) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
      }
      const references = validateDeliveryDraftInput(input.references);
      const id = handles.get(input.handle);
      const current = id === undefined ? undefined : rows.get(id);
      if (!current) throw new PrivateGalleryDeliveryDraftStoreError("not-found");
      if (current.gallery.state !== "draft" || current.revision !== input.expectedRevision ||
          current.revision === Number.MAX_SAFE_INTEGER) throw new PrivateGalleryDeliveryDraftStoreError("conflict");
      // Replace the whole references object; omitted references are cleared.
      // No await between lookup and commit. A production adapter needs a DB CAS.
      const updated = { gallery: current.gallery, revision: current.revision + 1, ...references };
      rows.set(current.gallery.galleryId, updated);
      return structuredClone(updated);
    },
    async openFirstPreparation(input) {
      if (!input || typeof input.handle !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(input.handle) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
      if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new PrivateGalleryDeliveryDraftStoreError("invalid-time");
      const now = new Date(input.now);
      const id = handles.get(input.handle);
      const current = id === undefined ? undefined : rows.get(id);
      if (!current) throw new PrivateGalleryDeliveryDraftStoreError("not-found");
      if (current.gallery.state !== "draft" || current.preparation !== undefined ||
          current.revision !== input.expectedRevision || current.revision === Number.MAX_SAFE_INTEGER) throw new PrivateGalleryDeliveryDraftStoreError("conflict");
      if (now < current.gallery.createdAt) throw new PrivateGalleryDeliveryDraftStoreError("invalid-time");
      // Both classes must be in the first committed plan. No ZIP-only partial ready path.
      if (!Array.isArray(input.manifest) || input.manifest.length < 2 ||
          input.manifest.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY) throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
      let zips = 0;
      for (const entry of input.manifest) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
        if (entry.kind === "zip" && Object.keys(entry).sort().join(",") === "kind,nominalBytes") zips++;
        else if (entry.kind !== "derivative" || entry.derivativeKind !== "delivery-preview" ||
            Object.keys(entry).sort().join(",") !== "derivativeKind,height,kind,nominalBytes,width") throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
      }
      if (zips !== 1) throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
      const keyPrefix = input.keyPrefix;
      let plan;
      try { plan = openPrivateGalleryUploadPreparation({ galleryId: current.gallery.galleryId, galleryKind: "delivery",
        state: current.gallery.state, keyPrefix, preparationId: randomUUID(), manifest: input.manifest, now }); }
      catch { throw new PrivateGalleryDeliveryDraftStoreError("invalid-input"); }
      if (rows.get(current.gallery.galleryId) !== current) throw new PrivateGalleryDeliveryDraftStoreError("conflict");
      rows.set(current.gallery.galleryId, { ...current, gallery: { ...current.gallery, state: "preparing" },
        preparation: plan, preparationKeyPrefix: keyPrefix, revision: current.revision + 1 });
      return structuredClone(plan);
    },
    async completeFirstPreparation(input) {
      if (!input || typeof input.handle !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(input.handle) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
          typeof input.preparationId !== "string" || input.preparationId.length < 1 || input.preparationId.length > 128) throw new PrivateGalleryDeliveryDraftStoreError("invalid-input");
      if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new PrivateGalleryDeliveryDraftStoreError("invalid-time");
      const now = new Date(input.now);
      const id = handles.get(input.handle);
      const current = id === undefined ? undefined : rows.get(id);
      if (!current) throw new PrivateGalleryDeliveryDraftStoreError("not-found");
      const plan = current.preparation;
      if (current.gallery.state !== "preparing" || current.readyDelivery !== undefined || current.revision !== input.expectedRevision ||
          current.revision === Number.MAX_SAFE_INTEGER || !plan || plan.preparation.preparationId !== input.preparationId) throw new PrivateGalleryDeliveryDraftStoreError("conflict");
      if (plan.galleryKind !== "delivery" || plan.preparation.galleryId !== current.gallery.galleryId ||
          current.preparationKeyPrefix === undefined) throw new PrivateGalleryDeliveryDraftStoreError("readiness-failed");
      if (now < plan.preparation.openedAt) throw new PrivateGalleryDeliveryDraftStoreError("invalid-time");
      if (isPrivateGalleryPreparationExpired(plan.preparation, now)) throw new PrivateGalleryDeliveryDraftStoreError("preparation-expired");
      let completion;
      try {
        completion = verifyPrivateGalleryUpload({ preparation: plan.preparation, expected: plan.objects,
          ...snapshotPrivateGalleryUploadCompletionEvidence(input, plan), keyPrefix: current.preparationKeyPrefix, now });
      } catch { throw new PrivateGalleryDeliveryDraftStoreError("invalid-input"); }
      if (!completion.verified) return { ready: false, failures: completion.failures, truncated: completion.truncated };
      let ready;
      try { ready = buildVerifiedFirstDeliveryData(plan, completion); }
      catch { throw new PrivateGalleryDeliveryDraftStoreError("readiness-failed"); }
      const gallery = { ...current.gallery, state: "ready" as const, activeZipObjectKey: ready.activeZipObjectKey };
      if (!evaluatePrivateGalleryReadiness({ gallery, verifiedObjects: completion.objects }).ready) throw new PrivateGalleryDeliveryDraftStoreError("readiness-failed");
      const updated: PrivateGalleryDeliveryDraft = { ...current, gallery, revision: current.revision + 1,
        readyDelivery: { placements: ready.placements, verifiedObjects: completion.objects } };
      // Reentrant adapter getters cannot overwrite an intervening revision.
      if (rows.get(current.gallery.galleryId) !== current) throw new PrivateGalleryDeliveryDraftStoreError("conflict");
      rows.set(current.gallery.galleryId, updated);
      return { ready: true, setup: structuredClone(updated) };
    },
    async list(limit, afterHandle) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRIVATE_GALLERY_DELIVERY_DRAFT_LIST_LIMIT) throw new PrivateGalleryDeliveryDraftStoreError("invalid-limit");
      const sorted = [...rows.values()].sort((a, b) => b.gallery.createdAt.getTime() - a.gallery.createdAt.getTime() ||
        (a.gallery.galleryId < b.gallery.galleryId ? -1 : a.gallery.galleryId > b.gallery.galleryId ? 1 : 0));
      const anchor = afterHandle === undefined ? -1 : sorted.findIndex((row) => row.gallery.galleryHandle === afterHandle);
      if (afterHandle !== undefined && (typeof afterHandle !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(afterHandle) || anchor < 0)) throw new PrivateGalleryDeliveryDraftStoreError("invalid-cursor");
      const start = anchor + 1;
      return { items: structuredClone(sorted.slice(start, start + limit)), hasMore: sorted.length > start + limit };
    },
  };
}
const stores = new WeakMap<object, PrivateGalleryDeliveryDraftStore>();
/** Scope lifetime to the existing development fixture, including its reset. */
export function getPrivateGalleryDeliveryDraftMemoryStore(owner: object): PrivateGalleryDeliveryDraftStore {
  let store = stores.get(owner);
  if (!store) { store = createPrivateGalleryDeliveryDraftMemoryStore(); stores.set(owner, store); }
  return store;
}
