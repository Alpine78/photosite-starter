/**
 * AB#130 proof-selection rules behind the private metadata-store boundary.
 *
 * These functions plan writes; they perform no IO. The private store must commit
 * reference assignment, conditional draft update, immutable confirmation and
 * outbox insert in transactions with uniqueness constraints (ADR-0014 §8b, §8d).
 * Never log inputs, filenames, selection content or thrown values from this module.
 */

import "server-only";

import type { PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY } from "@/lib/private-gallery-limits";

export type PrivateGalleryProofPricing = {
  readonly includedCount: number;
  /** Integer minor currency units; never floating-point money. */
  readonly extraUnitPriceMinor: number;
  readonly currency: string;
};

export type PrivateGalleryProofSelectedImage = {
  readonly reference: string;
  readonly filename: string;
  readonly mediaId: string;
};

export type PrivateGalleryProofSummary = PrivateGalleryProofPricing & {
  readonly selectedCount: number;
  readonly extraCount: number;
  readonly extraTotalMinor: number;
};

export type PrivateGalleryProofDraft = {
  readonly galleryId: string;
  readonly revision: number;
  readonly selectedReferences: readonly string[];
  readonly confirmed: boolean;
};

export type PrivateGalleryProofConfirmation = {
  readonly galleryId: string;
  readonly version: number;
  readonly confirmedAt: Date;
  readonly summary: PrivateGalleryProofSummary;
  readonly selectedImages: readonly PrivateGalleryProofSelectedImage[];
};

export type PrivateGalleryProofErrorReason =
  | "invalid-input"
  | "duplicate-identity"
  | "duplicate-reference"
  | "unknown-reference"
  | "stale-revision"
  | "already-confirmed"
  | "not-confirmed"
  | "too-many-files"
  | "overflow";

export class PrivateGalleryProofError extends Error {
  readonly reason: PrivateGalleryProofErrorReason;

  constructor(reason: PrivateGalleryProofErrorReason) {
    // No input, filename, reference, or customer data in the error.
    super("[private-gallery-proof] " + reason);
    this.name = "PrivateGalleryProofError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryProofErrorReason): never {
  throw new PrivateGalleryProofError(reason);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * One complete local filename, never a path. Upload, reference assignment and
 * notification use the same check so a proof accepted at preparation cannot
 * become un-notifiable after confirmation.
 */
export function isPrivateGalleryProofFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 255 &&
    value !== "." &&
    value !== ".." &&
    !/[/\\\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
  );
}

/** A stable gallery-local media identity, kept out of paths and log lines. */
export function isPrivateGalleryProofMediaId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 128 &&
    !/[/\\\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
  );
}

/** Validate terms before publication; the store freezes the returned copy. */
export function validatePrivateGalleryProofPricing(
  pricing: PrivateGalleryProofPricing,
): PrivateGalleryProofPricing {
  if (
    !nonnegativeInteger(pricing.includedCount) ||
    !nonnegativeInteger(pricing.extraUnitPriceMinor) ||
    typeof pricing.currency !== "string" ||
    !/^[A-Z]{3}$/.test(pricing.currency)
  ) {
    fail("invalid-input");
  }
  return { ...pricing };
}

/**
 * Numeric runs compare by value without converting them to JS numbers.
 * Non-numeric runs compare by code point. Equal numeric values fall back to
 * the complete filename, making 02 versus 2 deterministic. This is a fixed
 * natural order, independent of the deployment's locale or ICU version.
 */
export function compareProofFilenames(left: string, right: string): number {
  const a = left.match(/\d+|\D+/g) ?? [];
  const b = right.match(/\d+|\D+/g) ?? [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index];
    const y = b[index];
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const nx = x.replace(/^0+(?=\d)/, "");
      const ny = y.replace(/^0+(?=\d)/, "");
      if (nx.length !== ny.length) return Math.sign(nx.length - ny.length);
      if (nx !== ny) return nx < ny ? -1 : 1;
      continue;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.length !== b.length) return Math.sign(a.length - b.length);
  return left === right ? 0 : left < right ? -1 : 1;
}

function comparePlacements(
  a: PrivateGalleryProofPlacement,
  b: PrivateGalleryProofPlacement,
): number {
  return (
    compareProofFilenames(a.filename, b.filename) ||
    (a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0)
  );
}

function validatePlacements(
  placements: readonly PrivateGalleryProofPlacement[],
): void {
  if (placements.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY) {
    fail("too-many-files");
  }
  const ids = new Set<string>();
  const mediaIds = new Set<string>();
  let galleryId: string | undefined;
  for (const item of placements) {
    if (
      item.derivativeKind !== "watermarked-proof" ||
      !isPrivateGalleryProofFilename(item.filename) ||
      !isPrivateGalleryProofMediaId(item.mediaId) ||
      typeof item.placementId !== "string" ||
      item.placementId.length === 0 ||
      typeof item.galleryId !== "string" ||
      item.galleryId.length === 0
    ) fail("invalid-input");
    if (galleryId !== undefined && galleryId !== item.galleryId) fail("invalid-input");
    galleryId = item.galleryId;
    if (ids.has(item.placementId) || mediaIds.has(item.mediaId)) {
      fail("duplicate-identity");
    }
    ids.add(item.placementId);
    mediaIds.add(item.mediaId);
  }
}

function reference(ordinal: number): string {
  if (!positiveInteger(ordinal)) fail("overflow");
  return String(ordinal).padStart(3, "0");
}

/** First-publication plan. The caller persists it before changing state. */
export function assignInitialProofReferences(
  placements: readonly PrivateGalleryProofPlacement[],
): readonly PrivateGalleryProofPlacement[] {
  validatePlacements(placements);
  if (placements.some((item) => item.reference !== undefined)) fail("invalid-input");
  const byId = new Map(
    [...placements].sort(comparePlacements).map((item, index) => [
      item.placementId,
      reference(index + 1),
    ]),
  );
  return placements.map((item) => ({
    ...item,
    reference: byId.get(item.placementId),
  }));
}

/**
 * lastAssignedOrdinal is the persisted gallery high-water mark, including
 * removed proofs. Active rows alone cannot prove a reference is unused. The
 * store must update the high-water mark atomically with these new rows.
 */
export function assignAddedProofReferences(params: {
  readonly existing: readonly PrivateGalleryProofPlacement[];
  readonly additions: readonly PrivateGalleryProofPlacement[];
  readonly lastAssignedOrdinal: number;
}): readonly PrivateGalleryProofPlacement[] {
  const { existing, additions, lastAssignedOrdinal } = params;
  if (!nonnegativeInteger(lastAssignedOrdinal)) fail("invalid-input");
  validatePlacements([...existing, ...additions]);
  if (additions.some((item) => item.reference !== undefined)) fail("invalid-input");
  const refs = new Set<string>();
  for (const item of existing) {
    if (
      item.reference === undefined ||
      !/^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$/.test(item.reference) ||
      Number(item.reference) > lastAssignedOrdinal
    ) fail("invalid-input");
    if (refs.has(item.reference)) fail("duplicate-reference");
    refs.add(item.reference);
  }
  if (!Number.isSafeInteger(lastAssignedOrdinal + additions.length)) fail("overflow");
  const byId = new Map(
    [...additions].sort(comparePlacements).map((item, index) => [
      item.placementId,
      reference(lastAssignedOrdinal + index + 1),
    ]),
  );
  return additions.map((item) => ({
    ...item,
    reference: byId.get(item.placementId),
  }));
}

/** Integer-only quote for every draft and its confirmation review. */
export function summarizePrivateGalleryProofSelection(
  pricing: PrivateGalleryProofPricing,
  selectedCount: number,
): PrivateGalleryProofSummary {
  const frozen = validatePrivateGalleryProofPricing(pricing);
  if (
    !nonnegativeInteger(selectedCount) ||
    selectedCount > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY
  ) fail("invalid-input");
  const extraCount = Math.max(0, selectedCount - frozen.includedCount);
  const extraTotalMinor = extraCount * frozen.extraUnitPriceMinor;
  if (!Number.isSafeInteger(extraTotalMinor)) fail("overflow");
  return { ...frozen, selectedCount, extraCount, extraTotalMinor };
}

function resolveSelection(
  references: readonly string[],
  placements: readonly PrivateGalleryProofPlacement[],
): readonly PrivateGalleryProofSelectedImage[] {
  validatePlacements(placements);
  if (references.length > placements.length) fail("invalid-input");
  const byReference = new Map<string, PrivateGalleryProofPlacement>();
  for (const item of placements) {
    if (item.reference === undefined) fail("invalid-input");
    if (byReference.has(item.reference)) fail("duplicate-reference");
    byReference.set(item.reference, item);
  }
  const seen = new Set<string>();
  return references.map((ref) => {
    if (typeof ref !== "string") fail("invalid-input");
    if (seen.has(ref)) fail("duplicate-reference");
    seen.add(ref);
    const item = byReference.get(ref);
    if (item === undefined) fail("unknown-reference");
    return { reference: ref, filename: item.filename, mediaId: item.mediaId };
  });
}

/** Customer edit plan; persisted by a conditional update on revision. */
export function editPrivateGalleryProofDraft(params: {
  readonly galleryId: string;
  readonly draft: PrivateGalleryProofDraft;
  readonly expectedRevision: number;
  readonly selectedReferences: readonly string[];
  readonly placements: readonly PrivateGalleryProofPlacement[];
}): PrivateGalleryProofDraft {
  const { galleryId, draft, expectedRevision, selectedReferences, placements } = params;
  if (draft.confirmed) fail("already-confirmed");
  if (
    typeof galleryId !== "string" ||
    galleryId.length === 0 ||
    draft.galleryId !== galleryId ||
    placements.some((item) => item.galleryId !== galleryId)
  ) fail("invalid-input");
  if (!nonnegativeInteger(draft.revision) || expectedRevision !== draft.revision) {
    fail("stale-revision");
  }
  if (!Number.isSafeInteger(draft.revision + 1)) fail("overflow");
  resolveSelection(selectedReferences, placements);
  return {
    galleryId,
    revision: draft.revision + 1,
    selectedReferences: [...selectedReferences],
    confirmed: false,
  };
}

/**
 * The initial confirmation's outbox key, deterministic from the gallery and
 * version alone. A deliberate resend (see {@link planPrivateGalleryProofResend})
 * gets a distinct key under the same confirmation version; this is only ever
 * the one queued at confirmation time, which the store's resend path needs
 * to find the frozen notification without tracking anything extra.
 */
export function initialProofOutboxIdempotencyKey(
  galleryId: string,
  confirmationVersion: number,
): string {
  if (
    typeof galleryId !== "string" ||
    galleryId.length === 0 ||
    !positiveInteger(confirmationVersion)
  ) fail("invalid-input");
  return "proof-confirmation:" + galleryId + ":" + confirmationVersion;
}

/** Confirmation and unique initial outbox key, committed in one transaction. */
export function confirmPrivateGalleryProofSelection(params: {
  readonly galleryId: string;
  readonly draft: PrivateGalleryProofDraft;
  readonly expectedRevision: number;
  readonly previousVersion: number;
  readonly pricing: PrivateGalleryProofPricing;
  readonly placements: readonly PrivateGalleryProofPlacement[];
  readonly now: Date;
}): {
  readonly draft: PrivateGalleryProofDraft;
  readonly confirmation: PrivateGalleryProofConfirmation;
  readonly outboxIdempotencyKey: string;
} {
  const { galleryId, draft, expectedRevision, previousVersion, pricing, placements, now } = params;
  if (draft.confirmed) fail("already-confirmed");
  if (!nonnegativeInteger(draft.revision) || expectedRevision !== draft.revision) fail("stale-revision");
  if (
    typeof galleryId !== "string" || galleryId.length === 0 ||
    draft.galleryId !== galleryId ||
    !nonnegativeInteger(previousVersion) ||
    !(now instanceof Date) || !Number.isFinite(now.getTime())
  ) fail("invalid-input");
  if (
    !Number.isSafeInteger(previousVersion + 1) ||
    !Number.isSafeInteger(draft.revision + 1)
  ) fail("overflow");
  if (placements.some((item) => item.galleryId !== galleryId)) fail("invalid-input");
  const selectedImages = resolveSelection(draft.selectedReferences, placements);
  const version = previousVersion + 1;
  return {
    draft: {
      galleryId,
      revision: draft.revision + 1,
      selectedReferences: [...draft.selectedReferences],
      confirmed: true,
    },
    confirmation: {
      galleryId,
      version,
      confirmedAt: new Date(now),
      summary: summarizePrivateGalleryProofSelection(pricing, selectedImages.length),
      selectedImages,
    },
    outboxIdempotencyKey: initialProofOutboxIdempotencyKey(galleryId, version),
  };
}

/**
 * A deliberate resend is a separate outbox attempt against the same immutable
 * confirmation. The store must require administrator authorization and a unique
 * attemptId; it must not insert a new confirmation version.
 */
export function planPrivateGalleryProofResend(params: {
  readonly confirmation: PrivateGalleryProofConfirmation;
  readonly attemptId: string;
}): { readonly confirmationVersion: number; readonly outboxIdempotencyKey: string } {
  const { confirmation, attemptId } = params;
  if (
    !positiveInteger(confirmation.version) ||
    typeof confirmation.galleryId !== "string" ||
    confirmation.galleryId.length === 0 ||
    typeof attemptId !== "string" ||
    attemptId.length === 0
  ) fail("invalid-input");
  return {
    confirmationVersion: confirmation.version,
    outboxIdempotencyKey:
      "proof-confirmation-resend:" + confirmation.galleryId + ":" +
      confirmation.version + ":" + attemptId,
  };
}

/** Administrator-only reopen plan; previous snapshots stay untouched. */
export function reopenPrivateGalleryProofSelection(params: {
  readonly draft: PrivateGalleryProofDraft;
  readonly accessExpiresAt: Date;
}): { readonly draft: PrivateGalleryProofDraft; readonly accessExpiresAt: Date } {
  const { draft, accessExpiresAt } = params;
  if (!draft.confirmed) fail("not-confirmed");
  if (
    typeof draft.galleryId !== "string" ||
    draft.galleryId.length === 0 ||
    !nonnegativeInteger(draft.revision) ||
    !Number.isSafeInteger(draft.revision + 1) ||
    !(accessExpiresAt instanceof Date) ||
    !Number.isFinite(accessExpiresAt.getTime())
  ) fail("invalid-input");
  return {
    draft: {
      galleryId: draft.galleryId,
      revision: draft.revision + 1,
      selectedReferences: [...draft.selectedReferences],
      confirmed: false,
    },
    accessExpiresAt: new Date(accessExpiresAt),
  };
}
