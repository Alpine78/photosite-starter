/**
 * AB#170: the pure half of writing an approved rally gallery conversion
 * (ADR-0022 §7) to Sanity.
 *
 * `write-rally-conversion.mts` owns every read and write; this module decides:
 *
 * - whether a conversion plan file is exactly the shape
 *   `rally-conversion-plan.mts` emits;
 * - **what remains to do**, from a fresh raw-perspective read taken at write
 *   time (`reconcileRallyConversion`) — never from the plan's own snapshot,
 *   which can be stale by the time an operator runs this. An already-applied
 *   media patch or an already-deleted placement is recognized as done, not
 *   redone; anything the plan did not expect (a new placement, a changed
 *   `captureSequence`, an unpublished draft of a document the plan touches)
 *   refuses the whole run. This is what makes the command safe to interrupt
 *   and rerun;
 * - which mutations to send, batched so that **no request boundary can leave
 *   a gallery in the one state the public read refuses** — `orderingRule`
 *   switched to `capture-sequence` while a `galleryPlacement` still
 *   references it (`src/lib/sanity-gallery.ts`'s own "capture-sequence
 *   gallery must not have galleryPlacement documents" guard, ADR-0022 §1). A
 *   language's remaining placement deletions and its `orderingRule` switch
 *   are therefore always sent in the same mutation call;
 * - whether the read-back after the write agrees with the plan.
 */

import {
  CAPTURE_SEQUENCE_ORDERING_RULE,
  IDENTITY_PATTERN,
  LANGUAGE_SUBTAG,
  type PlannedDocument,
} from "./rally-import-plan.mts";
import { publishedIdOf } from "./rally-import-write.mts";
import type { SeedMutation } from "./sanity-seed-http.mts";
import {
  conversionDigest,
  RALLY_CONVERSION_PLAN_VERSION,
  type RallyConversionPlan,
  type RallyMediaPatch,
} from "./rally-conversion-plan.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "./sanity-seed-fixtures.mts";

const PLAN_FIELDS = new Set([
  "version", "contentId", "galleries", "mediaPatches", "newMediaDocuments",
  "newAssetRequirements", "placementDeletions", "acceptedRemovedDuplicates", "conversionDigest",
]);
const MEDIA_PATCH_FIELDS = new Set(["_id", "mediaId", "captureSequence", "caption"]);
const NEW_MEDIA_FIELDS = new Set(["_id", "_type", "mediaId", "mediaType", "alt", "publiclyRenderable", "captureSequence", "image"]);
const ASSET_FIELDS = new Set(["mediaId", "documentId", "relativePath", "contentHash", "width", "height"]);
const CONTENT_HASH = /^[0-9a-f]{64}$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Checks a parsed conversion-plan file against exactly the shape
 * `buildRallyConversionPlan` produces. An API write bypasses every Studio
 * rule, so a hand-edited plan is refused rather than trusted. Returns every
 * issue at once.
 */
export function validateRallyConversionPlanContract(raw: unknown): {
  readonly plan: RallyConversionPlan | undefined;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  if (!isPlainObject(raw)) return { plan: undefined, issues: ["the plan must be a JSON object"] };
  for (const field of extraFields(raw, PLAN_FIELDS)) issues.push(`the plan has an unknown field "${field}"`);
  if (raw.version !== RALLY_CONVERSION_PLAN_VERSION) {
    issues.push(`the plan version must be ${RALLY_CONVERSION_PLAN_VERSION}; regenerate it with plan:rally-conversion`);
  }
  const contentId = raw.contentId;
  if (typeof contentId !== "string" || !IDENTITY_PATTERN.test(contentId)) issues.push("contentId is invalid");
  if (typeof raw.acceptedRemovedDuplicates !== "boolean") issues.push("acceptedRemovedDuplicates must be a boolean");

  const galleries = raw.galleries;
  if (!Array.isArray(galleries) || galleries.length === 0) {
    issues.push("galleries must be a non-empty list");
  } else {
    const languages = new Set<string>();
    for (const [index, entry] of galleries.entries()) {
      const at = `galleries[${index}]`;
      if (!isPlainObject(entry) || typeof entry._id !== "string" || typeof entry.language !== "string") {
        issues.push(`${at} is malformed`);
        continue;
      }
      if (!LANGUAGE_SUBTAG.test(entry.language)) issues.push(`${at}.language is invalid`);
      // A conversion's gallery documents keep their existing (often `migrated--…`)
      // id, never a freshly derived one the way a new import's does.
      if (entry._id.length === 0) issues.push(`${at} has no _id`);
      if (languages.has(entry.language)) issues.push(`${at} repeats language ${entry.language}`);
      languages.add(entry.language);
    }
  }
  const galleryIds = new Set(
    Array.isArray(galleries) ? galleries.flatMap((entry) => (isPlainObject(entry) && typeof entry._id === "string" ? [entry._id] : [])) : [],
  );

  const mediaPatches = raw.mediaPatches;
  const patchedMediaIds = new Set<string>();
  if (!Array.isArray(mediaPatches) || mediaPatches.length === 0) {
    issues.push("mediaPatches must be a non-empty list");
  } else {
    for (const [index, entry] of mediaPatches.entries()) {
      const at = `mediaPatches[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(`${at} is not an object`);
        continue;
      }
      for (const field of extraFields(entry, MEDIA_PATCH_FIELDS)) issues.push(`${at} has an unexpected field "${field}"`);
      const mediaId = entry.mediaId;
      if (typeof mediaId !== "string" || !IDENTITY_PATTERN.test(mediaId)) {
        issues.push(`${at} has an invalid mediaId`);
        continue;
      }
      // A conversion's media documents keep their existing id — often `migrated--…`
      // from an earlier importer, never a freshly derived one the way a new
      // import's does — so only that it is a real id is checked here.
      if (typeof entry._id !== "string" || entry._id.length === 0) issues.push(`${at} has no _id`);
      if (patchedMediaIds.has(mediaId)) issues.push(`${at} repeats mediaId ${mediaId}`);
      patchedMediaIds.add(mediaId);
      const capture = entry.captureSequence;
      if (
        !isPlainObject(capture) ||
        capture.galleryContentId !== contentId ||
        typeof capture.sequence !== "number" ||
        !Number.isSafeInteger(capture.sequence) ||
        capture.sequence < 1 ||
        typeof capture.sectionId !== "string" ||
        !IDENTITY_PATTERN.test(capture.sectionId) ||
        Object.keys(capture).length !== 3
      ) {
        issues.push(`${at} has an invalid captureSequence`);
      }
      if (entry.caption !== undefined) {
        if (!Array.isArray(entry.caption) || entry.caption.length === 0) {
          issues.push(`${at}.caption must be a non-empty list when present`);
        } else {
          for (const item of entry.caption) {
            if (
              !isPlainObject(item) ||
              item._type !== "localizedText" ||
              !nonEmptyString(item._key) ||
              !nonEmptyString(item.language) ||
              !nonEmptyString(item.value) ||
              Object.keys(item).length !== 4
            ) {
              issues.push(`${at}.caption has a malformed entry`);
            }
          }
        }
      }
    }
  }

  const newMediaDocuments = raw.newMediaDocuments;
  const newMediaIds = new Set<string>();
  if (!Array.isArray(newMediaDocuments)) {
    issues.push("newMediaDocuments must be a list");
  } else {
    for (const [index, entry] of newMediaDocuments.entries()) {
      const at = `newMediaDocuments[${index}]`;
      if (!isPlainObject(entry) || entry._type !== "media" || typeof entry.mediaId !== "string") {
        issues.push(`${at} is malformed`);
        continue;
      }
      for (const field of extraFields(entry, NEW_MEDIA_FIELDS)) issues.push(`${at} has an unexpected field "${field}"`);
      if (patchedMediaIds.has(entry.mediaId)) issues.push(`${at} also appears in mediaPatches`);
      newMediaIds.add(entry.mediaId);
    }
  }

  const newAssetRequirements = raw.newAssetRequirements;
  if (!Array.isArray(newAssetRequirements)) {
    issues.push("newAssetRequirements must be a list");
  } else {
    const seen = new Set<string>();
    for (const [index, entry] of newAssetRequirements.entries()) {
      const at = `newAssetRequirements[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(`${at} is not an object`);
        continue;
      }
      for (const field of extraFields(entry, ASSET_FIELDS)) issues.push(`${at} has an unexpected field "${field}"`);
      const mediaId = entry.mediaId;
      if (typeof mediaId !== "string" || !newMediaIds.has(mediaId)) issues.push(`${at} names no new photograph in the plan`);
      else seen.add(mediaId);
      if (typeof entry.contentHash !== "string" || !CONTENT_HASH.test(entry.contentHash)) issues.push(`${at} has an invalid contentHash`);
      if (
        typeof entry.relativePath !== "string" ||
        entry.relativePath.length === 0 ||
        entry.relativePath.startsWith("/") ||
        entry.relativePath.split("/").includes("..")
      ) {
        issues.push(`${at} has an unsafe relativePath`);
      }
      for (const dimension of ["width", "height"] as const) {
        const value = entry[dimension];
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_PUBLIC_DELIVERY_DIMENSION) {
          issues.push(`${at} has an invalid ${dimension}`);
        }
      }
    }
    if (seen.size !== newMediaIds.size) issues.push("every new photograph needs exactly one asset requirement");
  }

  const placementDeletions = raw.placementDeletions;
  if (!Array.isArray(placementDeletions)) {
    issues.push("placementDeletions must be a list");
  } else {
    for (const [index, entry] of placementDeletions.entries()) {
      const at = `placementDeletions[${index}]`;
      if (
        !isPlainObject(entry) ||
        typeof entry._id !== "string" ||
        entry._id.length === 0 ||
        typeof entry.galleryId !== "string" ||
        !galleryIds.has(entry.galleryId)
      ) {
        issues.push(`${at} is malformed or names an unknown gallery`);
      }
    }
  }

  return issues.length > 0 ? { plan: undefined, issues } : { plan: raw as unknown as RallyConversionPlan, issues };
}

/** The digest recomputed from the plan's content, for comparison with the approved one. */
export function recomputeConversionPlanDigest(plan: RallyConversionPlan): string {
  const { conversionDigest: _digest, ...rest } = plan;
  void _digest;
  return conversionDigest(rest);
}

// ---------------------------------------------------------------------------
// Reconciliation: what a fresh read says remains to do
// ---------------------------------------------------------------------------

export type CurrentMediaState = {
  readonly _id: string;
  readonly mediaId: string;
  readonly captureSequence?: {
    readonly galleryContentId?: string | null;
    readonly sequence?: number | null;
    readonly sectionId?: string | null;
  } | null;
};

export type CurrentGalleryState = {
  readonly _id: string;
  readonly language: string;
  readonly orderingRule?: string | null;
  /** Ids of `galleryPlacement` documents currently referencing this gallery. */
  readonly placementIds: readonly string[];
};

/** What a fresh, raw-perspective read of the target dataset found, just before writing. */
export type RallyConversionSnapshot = {
  readonly galleries: readonly CurrentGalleryState[];
  readonly media: readonly CurrentMediaState[];
  /** Ids among the plan's own documents that have an unpublished draft or release copy. */
  readonly unpublishedCopyIds: readonly string[];
};

export type RallyConversionWork = {
  /** Media patches (existing photographs) not yet applied. */
  readonly mediaPatchesRemaining: readonly RallyMediaPatch[];
  /** New photographs not yet created. */
  readonly newMediaRemaining: readonly PlannedDocument[];
  /** Placement ids still present, grouped by the gallery they belong to. */
  readonly deletionsRemainingByGallery: ReadonlyMap<string, readonly string[]>;
  /**
   * Ids of gallery documents whose `orderingRule` is not yet `capture-sequence`
   * and therefore still needs the switch — regardless of whether this run's
   * own deletions are what will finally empty them. `buildGalleryDeletionAndSwitchBatches`
   * decides, from this membership alone, whether to reserve room in the last
   * deletion batch for the switch.
   */
  readonly galleriesToSwitch: ReadonlySet<string>;
};

/**
 * Decides what is left to do, from a plan and a fresh snapshot — never from
 * the plan's own baked-in expectations, which can be stale. Everything
 * already matching the plan is treated as done; anything the plan did not
 * expect is a blocking conflict.
 */
export function reconcileRallyConversion(
  plan: RallyConversionPlan,
  snapshot: RallyConversionSnapshot,
): { readonly work: RallyConversionWork; readonly conflicts: readonly string[] } {
  const conflicts: string[] = [];
  const mediaById = new Map(snapshot.media.map((media) => [media.mediaId, media]));

  if (snapshot.unpublishedCopyIds.length > 0) {
    conflicts.push(
      `${snapshot.unpublishedCopyIds.length} document(s) this plan touches have an unpublished draft or release in Studio — publish or discard them first (${snapshot.unpublishedCopyIds.slice(0, 3).join(", ")}${snapshot.unpublishedCopyIds.length > 3 ? ", …" : ""})`,
    );
  }

  const mediaPatchesRemaining: RallyMediaPatch[] = [];
  for (const patch of plan.mediaPatches) {
    const current = mediaById.get(patch.mediaId);
    if (current === undefined) {
      conflicts.push(`${patch.mediaId} no longer exists in the dataset`);
      continue;
    }
    const currentCapture = current.captureSequence;
    const matchesPlan =
      currentCapture !== null &&
      currentCapture !== undefined &&
      currentCapture.galleryContentId === patch.captureSequence.galleryContentId &&
      currentCapture.sequence === patch.captureSequence.sequence &&
      currentCapture.sectionId === patch.captureSequence.sectionId;
    if (matchesPlan) continue; // already applied by an earlier, interrupted run
    if (
      currentCapture !== null &&
      currentCapture !== undefined &&
      currentCapture.galleryContentId !== undefined &&
      currentCapture.galleryContentId !== null &&
      currentCapture.galleryContentId !== plan.contentId
    ) {
      conflicts.push(`${patch.mediaId} now belongs to a different capture-sequence gallery (${currentCapture.galleryContentId})`);
      continue;
    }
    mediaPatchesRemaining.push(patch);
  }

  const newMediaRemaining = plan.newMediaDocuments.filter((document) => {
    const mediaId = document.mediaId as string;
    const current = mediaById.get(mediaId);
    if (current === undefined) return true; // not created yet
    const currentCapture = current.captureSequence;
    const matchesPlan =
      currentCapture !== null &&
      currentCapture !== undefined &&
      currentCapture.galleryContentId === (document.captureSequence as { galleryContentId: string }).galleryContentId &&
      currentCapture.sequence === (document.captureSequence as { sequence: number }).sequence;
    if (matchesPlan) return false; // already created by an earlier run
    conflicts.push(`${mediaId} already exists but does not match the planned photograph`);
    return false;
  });

  const galleryById = new Map(snapshot.galleries.map((gallery) => [gallery._id, gallery]));
  const plannedDeletionsByGallery = new Map<string, string[]>();
  for (const deletion of plan.placementDeletions) {
    const list = plannedDeletionsByGallery.get(deletion.galleryId) ?? [];
    list.push(deletion._id);
    plannedDeletionsByGallery.set(deletion.galleryId, list);
  }

  const deletionsRemainingByGallery = new Map<string, readonly string[]>();
  const galleriesToSwitch = new Set<string>();
  for (const planned of plan.galleries) {
    const current = galleryById.get(planned._id);
    if (current === undefined) {
      conflicts.push(`${planned._id} no longer exists in the dataset`);
      continue;
    }
    const alreadySwitched = current.orderingRule === CAPTURE_SEQUENCE_ORDERING_RULE;
    if (!alreadySwitched && current.orderingRule !== "manual") {
      conflicts.push(`${planned._id} is now ${current.orderingRule ?? "unordered"}, neither manual nor capture-sequence — the conversion no longer applies`);
      continue;
    }

    const plannedIds = new Set(plannedDeletionsByGallery.get(planned._id) ?? []);
    const stillPresent = current.placementIds.filter((id) => plannedIds.has(id));
    const unexpected = current.placementIds.filter((id) => !plannedIds.has(id));
    if (unexpected.length > 0) {
      conflicts.push(
        `${planned._id} has ${unexpected.length} placement(s) this plan did not expect — content was added after planning (${unexpected.slice(0, 3).join(", ")}${unexpected.length > 3 ? ", …" : ""})`,
      );
      continue;
    }
    if (stillPresent.length > 0) deletionsRemainingByGallery.set(planned._id, stillPresent);
    if (!alreadySwitched) galleriesToSwitch.add(planned._id);
  }

  return {
    work: { mediaPatchesRemaining, newMediaRemaining, deletionsRemainingByGallery, galleriesToSwitch },
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CONVERSION_MUTATION_BATCH_SIZE = 100;

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * Media patches and new media, as ordinary batches — safe in any order and
 * invisible to a still-`manual` gallery's public read, so no atomicity is
 * needed here.
 */
export function buildMediaWaves(
  work: RallyConversionWork,
  assetIdByMediaId: ReadonlyMap<string, string>,
): { readonly newMediaBatches: readonly (readonly SeedMutation[])[]; readonly patchBatches: readonly (readonly SeedMutation[])[] } {
  const newMedia: SeedMutation[] = work.newMediaRemaining.map((document) => {
    const mediaId = document.mediaId as string;
    const assetId = assetIdByMediaId.get(mediaId);
    if (assetId === undefined) throw new Error(`no uploaded asset for new photograph ${mediaId}`);
    return {
      createIfNotExists: {
        ...document,
        image: { _type: "image", asset: { _type: "reference", _ref: assetId } },
      },
    };
  });
  const patches: SeedMutation[] = work.mediaPatchesRemaining.map((patch) => ({
    patch: {
      id: patch._id,
      set: {
        captureSequence: patch.captureSequence,
        ...(patch.caption === undefined ? {} : { caption: patch.caption }),
      },
    },
  }));
  return {
    newMediaBatches: chunk(newMedia, CONVERSION_MUTATION_BATCH_SIZE),
    patchBatches: chunk(patches, CONVERSION_MUTATION_BATCH_SIZE),
  };
}

/**
 * One gallery's remaining placement deletions, as ordinary batches capped at
 * `CONVERSION_MUTATION_BATCH_SIZE` **total mutations per call**, plus — only
 * in the final batch — the `orderingRule` patch to `capture-sequence`, when
 * `needsSwitch` says this gallery still wants one. That is what stops a
 * request boundary from ever leaving placements referencing a
 * capture-sequence gallery: the switch is never sent except in the same
 * request as the deletion of the last placement.
 *
 * When a switch will be appended, deletions are chunked one short of the cap
 * so the combined batch — deletions plus the one switch mutation — still
 * fits in a single mutation call; `write-rally-conversion.mts` must send each
 * returned batch as exactly one call and never let a generic batching helper
 * re-split it, or this guarantee is void.
 *
 * A gallery already at zero remaining placements that still needs its switch
 * gets one batch holding only that switch.
 */
export function buildGalleryDeletionAndSwitchBatches(
  galleryId: string,
  remainingPlacementIds: readonly string[],
  needsSwitch: boolean,
): readonly (readonly SeedMutation[])[] {
  const deletionBatches = chunk(
    remainingPlacementIds.map((id): SeedMutation => ({ delete: { id } })),
    needsSwitch ? CONVERSION_MUTATION_BATCH_SIZE - 1 : CONVERSION_MUTATION_BATCH_SIZE,
  );
  if (!needsSwitch) return deletionBatches;

  const switchMutation: SeedMutation = {
    patch: { id: galleryId, set: { orderingRule: CAPTURE_SEQUENCE_ORDERING_RULE } },
  };
  if (deletionBatches.length === 0) return [[switchMutation]];
  const lastIndex = deletionBatches.length - 1;
  return deletionBatches.map((batch, index) => (index === lastIndex ? [...batch, switchMutation] : batch));
}

// ---------------------------------------------------------------------------
// Read-back
// ---------------------------------------------------------------------------

export function evaluateConversionReadBack(
  plan: RallyConversionPlan,
  readBack: {
    readonly galleries: readonly { readonly _id: string; readonly orderingRule?: string | null }[];
    readonly remainingPlacementCount: number;
    readonly memberMediaCount: number;
  },
): readonly string[] {
  const issues: string[] = [];
  for (const planned of plan.galleries) {
    const found = readBack.galleries.find((gallery) => gallery._id === planned._id);
    if (found === undefined) issues.push(`${planned._id} was not found after the write`);
    else if (found.orderingRule !== CAPTURE_SEQUENCE_ORDERING_RULE) {
      issues.push(`${planned._id} is not ordered by capture sequence after the write`);
    }
  }
  if (readBack.remainingPlacementCount !== 0) {
    issues.push(`${readBack.remainingPlacementCount} placement(s) still reference this gallery after the write`);
  }
  const expected = plan.mediaPatches.length + plan.newMediaDocuments.length;
  if (readBack.memberMediaCount !== expected) {
    issues.push(`the gallery has ${readBack.memberMediaCount} photograph(s) after the write, the plan has ${expected}`);
  }
  return issues;
}

export { publishedIdOf };
