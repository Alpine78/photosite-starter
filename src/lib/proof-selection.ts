/**
 * Proof selection planner (ADR-0038 decisions 3–5, action item 3, AB#130).
 *
 * Pure: it validates the documents the facade read — the published proof
 * gallery, its private terms, the working selection and a confirmed version —
 * and turns a customer request into the customer's view or one guarded
 * transaction. Every document ID and type is derived here from the validated
 * gallery identity; nothing in a request becomes an ID, a type or a field name.
 */
import "server-only";
import { ClientGalleryDataError } from "@/lib/client-gallery-model";
import { parseProofGallery, publishedProofState, PROOF_GALLERY_MAX_ITEMS } from "@/lib/proof-gallery-model";
import { isProofReference } from "@/lib/proof-references";
import { PROOF_CURRENCIES, PROOF_JOB_REFERENCE_MAX, PROOF_MAX_INCLUDED, PROOF_MAX_PRICE_MINOR } from "@/lib/proof-terms";

export const PROOF_SELECTION_TYPE = "clientProofSelection";
export const PROOF_VERSION_TYPE = "clientProofSelectionVersion";
export const PROOF_NOTICE_TYPE = "clientProofNotice";
const TERMS_TYPE = "clientProofTerms";
/** Bounds the version suffix so every private ID stays within Sanity's 128 characters. */
export const PROOF_MAX_VERSION = 999;

export const proofTermsDocumentId = (galleryId: string) => `proofTerms.${galleryId}`;
export const proofSelectionId = (galleryId: string) => `proofSelection.${galleryId}`;
export const proofVersionId = (galleryId: string, version: number) => `proofSelection.${galleryId}.v${version}`;
export const proofNoticeId = (galleryId: string, version: number) => `proofNotice.${galleryId}.v${version}`;

export class ProofSelectionDataError extends Error {
  constructor() { super("Malformed proof selection record"); this.name = "ProofSelectionDataError"; }
}
function invalid(): never { throw new ProofSelectionDataError(); }
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function revision(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : invalid();
}
function count(value: unknown, max: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max ? value as number : invalid();
}
const byNumber = (left: { reference: string }, right: { reference: string }) => Number(left.reference) - Number(right.reference);

export type SelectionItem = Readonly<{ key: string; reference: string; originalFilename: string }>;
export type SelectionGallery = Readonly<{
  id: string; revision: string; handle: string; available: boolean; deadline?: number; replacedBy?: string;
  items: readonly SelectionItem[];
}>;

/** The published gallery as publication fixed it: every proof numbered, uniquely. */
export function parseSelectionGallery(value: unknown, id: string, handle: string): SelectionGallery {
  try {
    const gallery = parseProofGallery(value, id);
    if (gallery.handle !== handle) return invalid();
    const numbers = publishedProofState(gallery).references;
    const authored = gallery.authored;
    const expiry = authored.availabilityMode === "until" ? Date.parse(authored.expiryInstant as string) : undefined;
    return {
      id, revision: gallery.revision, handle, available: authored.available as boolean,
      ...(expiry === undefined ? {} : { deadline: expiry }),
      ...(gallery.replacedBy === undefined ? {} : { replacedBy: gallery.replacedBy }),
      items: gallery.items.map((entry) => ({ key: entry._key, reference: numbers[entry._key].reference, originalFilename: entry.originalFilename })),
    };
  } catch (error) {
    if (error instanceof ClientGalleryDataError) return invalid();
    throw error;
  }
}

export function selectionGalleryOpen(gallery: SelectionGallery, now: number): boolean {
  return gallery.available && (gallery.deadline === undefined || now < gallery.deadline);
}

export type SelectionTerms = Readonly<{
  revision: string; keyHash: string; includedCount: number; extraUnitPriceMinor: number; currency: string; jobReference: string;
}>;

/** The private terms record; anything malformed is a data failure, never default prices. */
export function parseSelectionTerms(value: unknown, galleryId: string): SelectionTerms {
  const row = record(value);
  if (row._id !== proofTermsDocumentId(galleryId) || row._type !== TERMS_TYPE || row.galleryId !== galleryId) return invalid();
  if (typeof row.selectionKeyHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.selectionKeyHash)) return invalid();
  if (typeof row.currency !== "string" || !Object.hasOwn(PROOF_CURRENCIES, row.currency)) return invalid();
  if (typeof row.jobReference !== "string" || row.jobReference.length < 1 || row.jobReference.length > PROOF_JOB_REFERENCE_MAX) return invalid();
  return {
    revision: revision(row._rev), keyHash: row.selectionKeyHash,
    includedCount: count(row.includedCount, PROOF_MAX_INCLUDED), extraUnitPriceMinor: count(row.extraUnitPriceMinor, PROOF_MAX_PRICE_MINOR),
    currency: row.currency, jobReference: row.jobReference,
  };
}

export type WorkingSelection = Readonly<{
  revision: string; state: "open" | "confirmed"; items: readonly Readonly<{ key: string; reference: string }>[]; latestVersion: number;
}>;

/** The working selection; `null` means the customer has not saved one yet. */
export function parseWorkingSelection(value: unknown, galleryId: string): WorkingSelection | undefined {
  if (value === null || value === undefined) return undefined;
  const row = record(value);
  if (row._id !== proofSelectionId(galleryId) || row._type !== PROOF_SELECTION_TYPE || row.galleryId !== galleryId ||
    (row.state !== "open" && row.state !== "confirmed") || !Array.isArray(row.items) || row.items.length > PROOF_GALLERY_MAX_ITEMS) return invalid();
  const keys = new Set<string>(), references = new Set<string>();
  const items = row.items.map((entry) => {
    const item = record(entry);
    if (typeof item._key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(item._key) || !isProofReference(item.reference) ||
      keys.has(item._key) || references.has(item.reference)) return invalid();
    keys.add(item._key); references.add(item.reference);
    return { key: item._key, reference: item.reference };
  });
  const latestVersion = count(row.latestVersion, PROOF_MAX_VERSION);
  if (row.state === "confirmed" && latestVersion === 0) return invalid();
  return { revision: revision(row._rev), state: row.state, items, latestVersion };
}

export type ConfirmedVersion = Readonly<{
  version: number; confirmedAt: string; includedCount: number; extraUnitPriceMinor: number; currency: string;
  selectedCount: number; extraCount: number; extraTotalMinor: number; references: readonly string[];
}>;

/** An immutable confirmed version, shown as recorded however the gallery changes later. */
export function parseConfirmedVersion(value: unknown, galleryId: string, version: number): ConfirmedVersion {
  const row = record(value);
  if (row._id !== proofVersionId(galleryId, version) || row._type !== PROOF_VERSION_TYPE || row.galleryId !== galleryId || row.version !== version ||
    typeof row.confirmedAt !== "string" || !Number.isFinite(Date.parse(row.confirmedAt))) return invalid();
  const terms = record(row.terms);
  if (typeof terms.currency !== "string" || !Object.hasOwn(PROOF_CURRENCIES, terms.currency) || !Array.isArray(row.items) ||
    row.items.length < 1 || row.items.length > PROOF_GALLERY_MAX_ITEMS) return invalid();
  const references = row.items.map((entry) => { const item = record(entry); return isProofReference(item.reference) ? item.reference : invalid(); });
  const totals = record(row.totals);
  const includedCount = count(terms.includedCount, PROOF_MAX_INCLUDED), extraUnitPriceMinor = count(terms.extraUnitPriceMinor, PROOF_MAX_PRICE_MINOR);
  const selectedCount = count(totals.selected, PROOF_GALLERY_MAX_ITEMS), extraCount = count(totals.extra, PROOF_GALLERY_MAX_ITEMS);
  const extraTotalMinor = count(totals.extraTotalMinor, PROOF_GALLERY_MAX_ITEMS * PROOF_MAX_PRICE_MINOR);
  if (selectedCount !== references.length || extraCount !== Math.max(0, selectedCount - includedCount) || extraTotalMinor !== extraCount * extraUnitPriceMinor) return invalid();
  return { version, confirmedAt: row.confirmedAt, includedCount, extraUnitPriceMinor, currency: terms.currency, selectedCount, extraCount, extraTotalMinor, references };
}

/** What the selection holder sees: never the job reference, address or key material. */
export type CustomerSelection = Readonly<{
  state: "open" | "confirmed";
  /** The working selection's revision, for the next save or confirmation; `null` before the first save. */
  revision: string | null;
  references: readonly string[];
  /** Some saved proofs are no longer in the gallery: save the selection again before confirming. */
  stale: boolean;
  includedCount: number; extraUnitPriceMinor: number; currency: string;
  selectedCount: number; extraCount: number; extraTotalMinor: number;
  version?: number; confirmedAt?: string;
}>;

function totals(selected: number, terms: Pick<SelectionTerms, "includedCount" | "extraUnitPriceMinor">) {
  const extraCount = Math.max(0, selected - terms.includedCount);
  return { selectedCount: selected, extraCount, extraTotalMinor: extraCount * terms.extraUnitPriceMinor };
}

/** Saved items whose identity and number still match the gallery, in numeric order, and whether any did not. */
function surviving(gallery: SelectionGallery, selection: WorkingSelection | undefined) {
  const current = new Map(gallery.items.map((item) => [item.key, item]));
  const kept = (selection?.items ?? []).filter((item) => current.get(item.key)?.reference === item.reference);
  return { items: kept.map((item) => current.get(item.key)!).sort(byNumber), stale: kept.length !== (selection?.items.length ?? 0) };
}

export function customerSelection(gallery: SelectionGallery, terms: SelectionTerms, selection: WorkingSelection | undefined, confirmed?: ConfirmedVersion): CustomerSelection {
  if (selection?.state === "confirmed") {
    if (!confirmed || confirmed.version !== selection.latestVersion) return invalid();
    const { version, confirmedAt, includedCount, extraUnitPriceMinor, currency, selectedCount, extraCount, extraTotalMinor, references } = confirmed;
    return { state: "confirmed", revision: selection.revision, references: [...references].sort((a, b) => Number(a) - Number(b)), stale: false,
      includedCount, extraUnitPriceMinor, currency, selectedCount, extraCount, extraTotalMinor, version, confirmedAt };
  }
  const { items, stale } = surviving(gallery, selection);
  return { state: "open", revision: selection?.revision ?? null, references: items.map((item) => item.reference), stale,
    includedCount: terms.includedCount, extraUnitPriceMinor: terms.extraUnitPriceMinor, currency: terms.currency, ...totals(items.length, terms) };
}

export type SelectionRejection = "conflict" | "confirmed" | "unknown-reference" | "empty" | "stale-selection";
export type SelectionPlan =
  | Readonly<{ kind: "rejected"; reason: SelectionRejection }>
  | Readonly<{ kind: "ready"; mutations: readonly Record<string, unknown>[]; version?: number }>;

/** Fails the whole transaction if the key or terms changed after the key was checked. */
function termsGuard(gallery: SelectionGallery, terms: SelectionTerms, field: "lastSelectedAt" | "lastConfirmedAt", now: string) {
  return { patch: { id: proofTermsDocumentId(gallery.id), ifRevisionID: terms.revision, set: { [field]: now } } };
}

/**
 * Save the full desired set. `expectedRevision: null` creates the working
 * selection only if none exists; otherwise it must be the revision just read,
 * and the patch is guarded by it, so another tab's save is never overwritten.
 * The terms guard makes a link revoked by key rotation unable to save.
 */
export function planSelect(gallery: SelectionGallery, terms: SelectionTerms, selection: WorkingSelection | undefined, expectedRevision: string | null, references: readonly string[], now: string): SelectionPlan {
  if ((selection?.revision ?? null) !== expectedRevision) return { kind: "rejected", reason: "conflict" };
  if (selection?.state === "confirmed") return { kind: "rejected", reason: "confirmed" };
  const byReference = new Map(gallery.items.map((item) => [item.reference, item]));
  if (references.some((reference) => !byReference.has(reference))) return { kind: "rejected", reason: "unknown-reference" };
  const items = references.map((reference) => byReference.get(reference)!).sort(byNumber).map((item) => ({ _key: item.key, reference: item.reference }));
  if (!selection) {
    return { kind: "ready", mutations: [
      { create: { _id: proofSelectionId(gallery.id), _type: PROOF_SELECTION_TYPE, galleryId: gallery.id, state: "open", items, latestVersion: 0 } },
      termsGuard(gallery, terms, "lastSelectedAt", now),
    ] };
  }
  return { kind: "ready", mutations: [
    { patch: { id: proofSelectionId(gallery.id), ifRevisionID: selection.revision, set: { items } } },
    termsGuard(gallery, terms, "lastSelectedAt", now),
  ] };
}

/**
 * Confirm the open selection as the next immutable version, with its pending
 * notice, in one transaction. `create` refuses an existing version, the
 * selection patch is guarded by the revision the customer saw, and the terms
 * patch is guarded by the revision whose key was checked, so a retried request,
 * another tab or a key rotation in between all fail the whole transaction.
 * The version records the gallery revision it was validated against.
 */
export function planConfirm(gallery: SelectionGallery, terms: SelectionTerms, selection: WorkingSelection | undefined, expectedRevision: string, now: string): SelectionPlan {
  if (!selection || selection.revision !== expectedRevision) return { kind: "rejected", reason: "conflict" };
  if (selection.state === "confirmed") return { kind: "rejected", reason: "confirmed" };
  const { items, stale } = surviving(gallery, selection);
  if (stale) return { kind: "rejected", reason: "stale-selection" };
  if (items.length === 0) return { kind: "rejected", reason: "empty" };
  const version = selection.latestVersion + 1;
  if (version > PROOF_MAX_VERSION) return invalid();
  const sums = totals(items.length, terms);
  return {
    kind: "ready", version,
    mutations: [
      { create: {
        _id: proofVersionId(gallery.id, version), _type: PROOF_VERSION_TYPE, galleryId: gallery.id, version, confirmedAt: now,
        galleryRevision: gallery.revision,
        terms: { includedCount: terms.includedCount, extraUnitPriceMinor: terms.extraUnitPriceMinor, currency: terms.currency, jobReference: terms.jobReference },
        totals: { selected: sums.selectedCount, extra: sums.extraCount, extraTotalMinor: sums.extraTotalMinor },
        items: items.map((item) => ({ _key: item.key, reference: item.reference, originalFilename: item.originalFilename })),
      } },
      { create: { _id: proofNoticeId(gallery.id, version), _type: PROOF_NOTICE_TYPE, galleryId: gallery.id, version, state: "pending", createdAt: now } },
      { patch: { id: proofSelectionId(gallery.id), ifRevisionID: selection.revision, set: { state: "confirmed", latestVersion: version } } },
      termsGuard(gallery, terms, "lastConfirmedAt", now),
    ],
  };
}
