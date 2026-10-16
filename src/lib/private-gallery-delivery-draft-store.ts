/** Development-only prepublication delivery setup; no capability or customer access. */
import "server-only";
import { randomUUID } from "node:crypto";
import { generateGalleryHandle } from "@/lib/private-gallery-capability";
import type { PrivateGallery } from "@/lib/private-gallery";
import { isPrivateGalleryProofBusinessReference } from "@/lib/private-gallery-proof";

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
};
export type PrivateGalleryDeliveryDraftStore = {
  create(input: PrivateGalleryDeliveryDraftInput, now: Date): Promise<PrivateGalleryDeliveryDraft>;
  updateReferences(input: { readonly handle: string; readonly expectedRevision: number;
    readonly references: PrivateGalleryDeliveryDraftInput }): Promise<PrivateGalleryDeliveryDraft>;
  list(limit: number): Promise<{ readonly items: readonly PrivateGalleryDeliveryDraft[]; readonly hasMore: boolean }>;
};
export class PrivateGalleryDeliveryDraftStoreError extends Error {
  constructor(readonly reason: "invalid-input" | "invalid-time" | "invalid-limit" | "identity-collision" | "capacity" | "not-found" | "conflict") {
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
    async list(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRIVATE_GALLERY_DELIVERY_DRAFT_LIST_LIMIT) throw new PrivateGalleryDeliveryDraftStoreError("invalid-limit");
      const sorted = [...rows.values()].sort((a, b) => b.gallery.createdAt.getTime() - a.gallery.createdAt.getTime() ||
        (a.gallery.galleryId < b.gallery.galleryId ? -1 : a.gallery.galleryId > b.gallery.galleryId ? 1 : 0));
      return { items: structuredClone(sorted.slice(0, limit)), hasMore: sorted.length > limit };
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
