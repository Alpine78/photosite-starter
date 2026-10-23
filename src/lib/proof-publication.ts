/**
 * Plans one proof publication or key rotation as a single atomic Sanity
 * transaction (ADR-0038 decisions 2–4 and the 2026-10-22 publication-path
 * amendment, AB#130). Pure: the route reads the state with the editor's token,
 * this module decides, and the same token commits the result, so Sanity itself
 * enforces membership and publish permission.
 *
 * Every write is guarded: the draft by `ifRevisionID`, a first publication by
 * `create` (fails if the document appeared meanwhile), a later publication and a
 * rotation by `ifRevisionID` on the documents they change.
 */
import "server-only";
import { CLIENT_GALLERY_FORMATS, ClientGalleryDataError } from "@/lib/client-gallery-model";
import { parseProofGallery, PROOF_GALLERY_OPTIONAL_FIELDS, publishedProofState, type ParsedProofGallery } from "@/lib/proof-gallery-model";
import { assignProofReferences, NEVER_PUBLISHED, proofReferenceProblem, type PublishedProofState } from "@/lib/proof-references";
import { createSelectionKey, encryptSelectionKey } from "@/lib/proof-selection-key";
import type { ProofPublicationOperation } from "@/lib/proof-publication-request";
import type { ProofTerms } from "@/lib/proof-terms";

export const PROOF_TERMS_TYPE = "clientProofTerms";
export const proofTermsId = (galleryId: string) => `proofTerms.${galleryId}`;
export const proofDraftId = (galleryId: string) => `drafts.${galleryId}`;
export const proofVersionsPath = (galleryId: string) => `versions.*.${galleryId}`;

export type PublicationRead = Readonly<{ draft: unknown; published: unknown; terms: unknown; versions: unknown }>;
export type PublicationRelated = Readonly<{ conflicts: unknown; assets: unknown }>;

export type PublicationRejection =
  | "not-found"
  | "invalid-gallery"
  | "unsupported-release"
  | "inconsistent"
  | "invalid-references"
  | "stale-draft"
  | "terms-required"
  | "terms-not-allowed";

export type PublicationPlan =
  | Readonly<{ kind: "rejected"; reason: PublicationRejection }>
  | Readonly<{
    kind: "ready";
    mutations: readonly Record<string, unknown>[];
    firstPublication: boolean;
    /** Plaintext key, returned to the editor only after the transaction commits. */
    selectionKey?: string;
  }>;

type TermsRecord = Readonly<{ revision: string }>;

function reject(reason: PublicationRejection): PublicationPlan {
  return { kind: "rejected", reason };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function terms(value: unknown, galleryId: string): TermsRecord | undefined | "invalid" {
  if (value === null) return undefined;
  const row = record(value);
  if (!row || row._id !== proofTermsId(galleryId) || row._type !== PROOF_TERMS_TYPE || row.galleryId !== galleryId ||
    typeof row._rev !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(row._rev)) return "invalid";
  return { revision: row._rev };
}

function parse(value: unknown, id: string): ParsedProofGallery | undefined | "invalid" {
  if (value === null) return undefined;
  try {
    return parseProofGallery(value, id);
  } catch (error) {
    if (error instanceof ClientGalleryDataError) return "invalid";
    throw error;
  }
}

/** The assets every proof references must be complete public web images, never private-only. */
function assetsAreValid(gallery: ParsedProofGallery, assets: unknown): boolean {
  if (!Array.isArray(assets)) return false;
  const expected = new Map(gallery.items.map((entry) => [entry.image.assetId, entry.image]));
  if (assets.length !== expected.size) return false;
  const seen = new Set<string>();
  for (const value of assets) {
    const asset = record(value);
    const image = asset && typeof asset._id === "string" ? expected.get(asset._id) : undefined;
    if (!asset || !image || seen.has(image.assetId) || asset._type !== "sanity.imageAsset" || asset.restricted !== false ||
      asset.sha1hash !== image.hash || asset.width !== image.width || asset.height !== image.height ||
      asset.extension !== image.extension || CLIENT_GALLERY_FORMATS[image.extension] !== asset.mimeType) return false;
    seen.add(image.assetId);
  }
  return true;
}

/** The published document a publication writes: the draft's authored fields plus fixed numbers. */
function publishedBody(galleryId: string, draft: ParsedProofGallery, references: Readonly<Record<string, string>>, highWater: number) {
  const items = (draft.authored.items as readonly Record<string, unknown>[]).map((entry) => ({
    ...entry,
    reference: references[entry._key as string],
  }));
  return { ...draft.authored, _id: galleryId, items, referenceHighWater: highWater };
}

export type PlanInput = Readonly<{
  galleryId: string;
  operation: ProofPublicationOperation;
  read: PublicationRead;
  /** Read after the draft was parsed; `undefined` for a rotation, which touches no gallery content. */
  related?: PublicationRelated;
  now: string;
  secret: Buffer;
  /** The draft revision the editor's validated view was based on (publish only). */
  expectedDraftRevision?: string;
  /** Required on a first publication, refused on a later one. */
  terms?: ProofTerms;
  createKey?: typeof createSelectionKey;
}>;

/** The private record's snapshot of the terms; the address only when a reminder is on. */
function termsFields(terms: ProofTerms) {
  return {
    includedCount: terms.includedCount,
    extraUnitPriceMinor: terms.extraUnitPriceMinor,
    currency: terms.currency,
    jobReference: terms.jobReference,
    reminderDelayDays: terms.reminder?.delayDays ?? null,
    ...(terms.reminder === null ? {} : { customerEmail: terms.reminder.customerEmail }),
  };
}

/** Which documents the plan needs related data for, so the route can read it before planning. */
export function relatedQueryInput(galleryId: string, read: PublicationRead): Readonly<{ handle: string; assetIds: string[] }> | undefined {
  const draft = parse(read.draft, proofDraftId(galleryId));
  if (draft === undefined || draft === "invalid") return undefined;
  return { handle: draft.handle, assetIds: [...new Set(draft.items.map((entry) => entry.image.assetId))] };
}

export function planProofPublication(input: PlanInput): PublicationPlan {
  const { galleryId, read, now, secret } = input;
  const createKey = input.createKey ?? createSelectionKey;
  if (typeof read.versions !== "number" || !Number.isSafeInteger(read.versions) || read.versions < 0) return reject("invalid-gallery");
  if (read.versions > 0) return reject("unsupported-release");
  const published = parse(read.published, galleryId);
  const existingTerms = terms(read.terms, galleryId);
  if (published === "invalid" || existingTerms === "invalid") return reject("invalid-gallery");

  if (input.operation === "rotate-key") {
    if (published === undefined || existingTerms === undefined) return reject("not-found");
    const highWater = published.authored.referenceHighWater;
    if (!Number.isSafeInteger(highWater)) return reject("inconsistent");
    const { key, hash } = createKey();
    return {
      kind: "ready",
      firstPublication: false,
      selectionKey: key,
      mutations: [
        // Rewrites the published gallery's own value: a rotation then needs the same
        // publish permission as a publication, so an editor who may only edit drafts
        // cannot invalidate a customer's link.
        { patch: { id: galleryId, ifRevisionID: published.revision, set: { referenceHighWater: highWater } } },
        { patch: { id: proofTermsId(galleryId), ifRevisionID: existingTerms.revision, set: {
          selectionKeyHash: hash, selectionKeyCiphertext: encryptSelectionKey(key, galleryId, secret), keyIssuedAt: now,
        } } },
      ],
    };
  }

  const draft = parse(read.draft, proofDraftId(galleryId));
  if (draft === undefined) return reject("not-found");
  if (draft === "invalid") return reject("invalid-gallery");
  // Publish only the draft the editor reviewed: a newer edit must be validated first.
  if (input.expectedDraftRevision === undefined || draft.revision !== input.expectedDraftRevision) return reject("stale-draft");
  // A first publication creates the private record; a later one needs it.
  if ((published === undefined) !== (existingTerms === undefined)) return reject("inconsistent");
  if (published !== undefined && published.handle !== draft.handle) return reject("invalid-gallery");
  if (published === undefined && input.terms === undefined) return reject("terms-required");
  if (published !== undefined && input.terms !== undefined) return reject("terms-not-allowed");
  const related = input.related;
  const conflicts = related?.conflicts;
  if (!Array.isArray(conflicts) || conflicts.length !== 0 || !assetsAreValid(draft, related?.assets)) return reject("invalid-gallery");

  let fixed: PublishedProofState;
  try {
    fixed = published === undefined ? NEVER_PUBLISHED : publishedProofState(published);
  } catch (error) {
    if (error instanceof ClientGalleryDataError) return reject("inconsistent");
    throw error;
  }
  const { references, highWater } = assignProofReferences(draft.items, fixed);
  const numbered = draft.items.map((entry) => ({ ...entry, reference: references[entry._key] }));
  // A published proof keeps its photograph: a different image needs a new item.
  if (proofReferenceProblem(numbered, highWater, fixed)) return reject("invalid-references");

  const body = publishedBody(galleryId, draft, references, highWater);
  const draftGuard = { patch: { id: proofDraftId(galleryId), ifRevisionID: draft.revision, set: { referenceHighWater: highWater } } };
  const removeDraft = { delete: { id: proofDraftId(galleryId) } };

  if (published === undefined && input.terms !== undefined) {
    const { key, hash } = createKey();
    return {
      kind: "ready",
      firstPublication: true,
      selectionKey: key,
      mutations: [
        draftGuard,
        { create: body },
        { create: {
          _id: proofTermsId(galleryId), _type: PROOF_TERMS_TYPE, galleryId,
          firstPublishedAt: now, keyIssuedAt: now, ...termsFields(input.terms),
          selectionKeyHash: hash, selectionKeyCiphertext: encryptSelectionKey(key, galleryId, secret),
        } },
        removeDraft,
      ],
    };
  }

  // `_id` and `_type` never change; only authored content is set.
  if (published === undefined) return reject("terms-required");
  if (existingTerms === undefined) return reject("inconsistent");
  const set = Object.fromEntries(Object.entries(body).filter(([name]) => name !== "_id" && name !== "_type"));
  const unset = PROOF_GALLERY_OPTIONAL_FIELDS.filter((name) => !(name in set) && name in published.authored);
  return {
    kind: "ready",
    firstPublication: false,
    mutations: [
      draftGuard,
      { patch: { id: galleryId, ifRevisionID: published.revision, set, ...(unset.length > 0 ? { unset } : {}) } },
      { patch: { id: proofTermsId(galleryId), ifRevisionID: existingTerms.revision, set: { galleryPublishedAt: now } } },
      removeDraft,
    ],
  };
}
