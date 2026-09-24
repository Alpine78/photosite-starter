/**
 * AB#169: the pure half of converting an existing placement-based rally
 * gallery into a capture-sequence gallery (ADR-0022 §7).
 *
 * Inputs, all gathered by `plan-rally-conversion.mts`:
 *
 * - the owner's renamed copy of the gallery's files plus its `rally.json`,
 *   scanned exactly as `plan:rally` scans a new rally;
 * - the local import artifacts, which say which content hash each existing
 *   `mediaId` was made from — Sanity stores no file name, so this is the only
 *   honest way back from a Production photograph to its file (§7.1);
 * - a read-only snapshot of the published gallery: its language documents,
 *   their placements, and where else those photographs are placed.
 *
 * The output is a reviewable plan — media patches that set only
 * `captureSequence`, a rule switch per language, the placements the write step
 * will delete, and any new photographs the owner explicitly allowed — plus a
 * deviation report of every photograph whose relative position changes (§7.5).
 * Nothing here writes; the write step is a separate story.
 */

import { createHash } from "node:crypto";

import {
  buildRallyImportPlan,
  canonicalJson,
  type PlannedDocument,
  type RallyAssetRequirement,
  type RallyFileRefusal,
  type RallyManifest,
  type ScannedFile,
} from "./rally-import-plan.mts";

export const RALLY_CONVERSION_PLAN_VERSION = "rally-conversion-plan-v1";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type ProductionPlacement = {
  readonly _id: string;
  readonly placementId: string;
  readonly order: number;
  readonly sectionId?: string | null;
  readonly visible?: boolean | null;
  readonly pinned?: boolean | null;
  readonly altOverride?: unknown;
  readonly captionOverride?: unknown;
  readonly mediaDocumentId: string;
  readonly mediaId: string;
  /** The media document's current `captureSequence.galleryContentId`, if any. */
  readonly mediaCaptureGallery?: string | null;
  /** The media document's own localized alt text and caption. */
  readonly mediaAlt?: readonly LocalizedEntry[] | null;
  readonly mediaCaption?: readonly LocalizedEntry[] | null;
};

export type LocalizedEntry = {
  readonly _key?: string | null;
  readonly language?: string | null;
  readonly value?: string | null;
};

export type ProductionGallery = {
  readonly _id: string;
  readonly language: string;
  readonly orderingRule?: string | null;
  readonly sections: readonly {
    readonly sectionId: string;
    readonly slug: string;
    readonly label: string;
  }[];
  readonly placements: readonly ProductionPlacement[];
};

export type ProductionSnapshot = {
  readonly galleries: readonly ProductionGallery[];
  /** Placements of this gallery's photographs in *other* galleries. */
  readonly placementsElsewhere: readonly {
    readonly mediaId: string;
    readonly galleryContentId: string;
  }[];
};

/** One `assetRequirements` entry from an import artifact. */
export type ArtifactAsset = {
  readonly mediaId: string;
  readonly contentHash: string;
  readonly sourceLocator: string;
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type RallyMediaPatch = {
  readonly _id: string;
  readonly mediaId: string;
  readonly captureSequence: {
    readonly galleryContentId: string;
    readonly sequence: number;
    readonly sectionId: string;
  };
  /**
   * The media's whole localized caption array, present only when a placement
   * caption moves onto the photograph (the placement that held it is deleted).
   */
  readonly caption?: readonly {
    readonly _key: string;
    readonly _type: "localizedText";
    readonly language: string;
    readonly value: string;
  }[];
};

export type RallyConversionPlan = {
  readonly version: typeof RALLY_CONVERSION_PLAN_VERSION;
  readonly contentId: string;
  readonly galleries: readonly { readonly _id: string; readonly language: string }[];
  readonly mediaPatches: readonly RallyMediaPatch[];
  /** Photographs the owner allowed to be added (`--allow-new-photographs`). */
  readonly newMediaDocuments: readonly PlannedDocument[];
  readonly newAssetRequirements: readonly RallyAssetRequirement[];
  readonly placementDeletions: readonly { readonly _id: string; readonly galleryId: string }[];
  readonly acceptedRemovedDuplicates: boolean;
  readonly conversionDigest: string;
};

export type RallyDeviation = {
  readonly mediaId: string;
  readonly file?: string;
  readonly currentPositions: readonly number[];
  readonly newPosition?: number;
  readonly currentSections: readonly string[];
  readonly newSection?: string;
  readonly reason: "moved" | "duplicate-removed" | "section-changed" | "added";
};

export type RallyConversionResult = {
  readonly plan: RallyConversionPlan | undefined;
  readonly refusals: readonly RallyFileRefusal[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly deviations: readonly RallyDeviation[];
  readonly reusedElsewhere: readonly { readonly mediaId: string; readonly galleries: readonly string[] }[];
  readonly counts: {
    readonly photographs: number;
    readonly existing: number;
    readonly added: number;
    readonly placementsDeleted: number;
    readonly moved: number;
    readonly captionsMoved: number;
    readonly redundantAltOverrides: number;
  };
};

/** One line per kind of problem, with a count and a few examples, instead of one per placement. */
function summarize(kind: string, subjects: readonly string[]): string | undefined {
  if (subjects.length === 0) return undefined;
  const examples = subjects.slice(0, 3).join(", ");
  return `${kind}: ${subjects.length} (${examples}${subjects.length > 3 ? ", …" : ""})`;
}

function textIn(entries: readonly LocalizedEntry[] | null | undefined, language: string): string | undefined {
  const value = (entries ?? []).find((entry) => entry.language === language)?.value;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function conversionDigest(value: Omit<RallyConversionPlan, "conversionDigest">): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * The positions (in current order) of a longest subsequence already in the new
 * order; every photograph outside it is one the owner will see move. Minimal,
 * so one photograph moved to the end is reported once rather than as every
 * photograph after it shifting by one.
 */
export function stayingInPlace(currentOrderOfNewIndices: readonly number[]): ReadonlySet<number> {
  const tails: number[] = [];
  const tailIndex: number[] = [];
  const previous = new Array<number>(currentOrderOfNewIndices.length).fill(-1);
  currentOrderOfNewIndices.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((tails[middle] as number) < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
    tailIndex[low] = index;
    previous[index] = low > 0 ? (tailIndex[low - 1] as number) : -1;
  });
  const keep = new Set<number>();
  let cursor = tails.length > 0 ? (tailIndex[tails.length - 1] as number) : -1;
  while (cursor !== -1) {
    keep.add(cursor);
    cursor = previous[cursor] as number;
  }
  return keep;
}

/**
 * Builds the conversion plan for one gallery, or explains why it cannot be
 * made. Every blocker is reported at once.
 */
export function buildRallyConversionPlan(input: {
  readonly manifest: RallyManifest;
  readonly files: readonly ScannedFile[];
  readonly artifacts: readonly ArtifactAsset[];
  readonly production: ProductionSnapshot;
  readonly acceptInterleavedSections: boolean;
  readonly acceptRemovedDuplicates: boolean;
  readonly allowNewPhotographs: boolean;
  readonly now: Date;
  readonly mintMediaId: (contentId: string) => string;
}): RallyConversionResult {
  const { manifest, production } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const contentId = manifest.contentId;

  // --- the published gallery ---
  const galleriesByLanguage = new Map(production.galleries.map((gallery) => [gallery.language, gallery]));
  for (const language of manifest.languages) {
    if (!galleriesByLanguage.has(language)) blockers.push(`the published gallery has no ${language} version`);
  }
  for (const gallery of production.galleries) {
    if (!manifest.languages.includes(gallery.language)) {
      blockers.push(`the published gallery has a ${gallery.language} version that rally.json does not describe`);
    }
    if (gallery.orderingRule !== "manual") {
      blockers.push(
        `the ${gallery.language} gallery is ${gallery.orderingRule ?? "unordered"}, not manual — only a manually ordered gallery is converted`,
      );
    }
  }
  const reference = galleriesByLanguage.get(manifest.languages[0] as string);

  // Per-occurrence data a capture-sequence gallery cannot hold. An alt override
  // equal to the photograph's own alt text in that language is redundant and
  // simply goes with its placement; a caption override moves onto the
  // photograph when the photograph has no caption of its own in that language,
  // or the same one. Anything else would be lost, so it blocks.
  const allPlacements = production.galleries.flatMap((gallery) =>
    gallery.placements.map((placement) => ({ gallery, placement })),
  );
  const hidden: string[] = [];
  const pinned: string[] = [];
  const otherCapture: string[] = [];
  for (const { gallery, placement } of allPlacements) {
    const at = `${placement.placementId} (${gallery.language})`;
    if (placement.visible !== true) hidden.push(at);
    if (placement.pinned === true) pinned.push(at);
    if (
      placement.mediaCaptureGallery !== undefined &&
      placement.mediaCaptureGallery !== null &&
      placement.mediaCaptureGallery !== contentId
    ) {
      otherCapture.push(`${placement.mediaId} → ${placement.mediaCaptureGallery}`);
    }
  }
  for (const line of [
    summarize("hidden placements, which a capture-sequence gallery cannot keep", hidden),
    summarize("pinned placements, which a capture-sequence gallery cannot keep", pinned),
    summarize("photographs already in another capture-sequence gallery", [...new Set(otherCapture)]),
  ]) {
    if (line !== undefined) blockers.push(line);
  }

  // FI and EN must agree on each photograph's sections.
  const sectionsByLanguage = new Map<string, Map<string, string[]>>();
  for (const { gallery, placement } of allPlacements) {
    const perMedia = sectionsByLanguage.get(gallery.language) ?? new Map<string, string[]>();
    sectionsByLanguage.set(gallery.language, perMedia);
    perMedia.set(placement.mediaId, [...(perMedia.get(placement.mediaId) ?? []), placement.sectionId ?? ""].toSorted());
  }
  const referenceSections = sectionsByLanguage.get(reference?.language ?? "") ?? new Map<string, string[]>();
  for (const [language, perMedia] of sectionsByLanguage) {
    for (const [mediaId, sections] of perMedia) {
      if ((referenceSections.get(mediaId) ?? []).join(",") !== sections.join(",")) {
        blockers.push(`${mediaId} sits in different sections in the ${language} gallery than in the ${reference?.language} one`);
      }
    }
  }

  // Sections: rally.json keys must name existing section ids, whose slugs are kept.
  for (const section of manifest.sections) {
    for (const gallery of production.galleries) {
      const existing = gallery.sections.find((candidate) => candidate.sectionId === section.sectionId);
      if (existing === undefined) {
        blockers.push(
          `rally.json section "${section.key}" maps to section id "${section.sectionId}", which the ${gallery.language} gallery does not have — name the existing sectionId`,
        );
      } else if (existing.slug !== section.slug) {
        blockers.push(
          `section "${section.key}" would change its ${gallery.language} address from ?section=${existing.slug} to ?section=${section.slug} — set its slug to "${existing.slug}"`,
        );
      }
    }
  }

  // --- the folder, matched to existing identities by content hash ---
  const galleryMediaIds = new Set(allPlacements.map(({ placement }) => placement.mediaId));
  const hashByMediaId = new Map<string, string>();
  const locatorByMediaId = new Map<string, string>();
  for (const artifact of input.artifacts) {
    if (!galleryMediaIds.has(artifact.mediaId)) continue;
    const known = hashByMediaId.get(artifact.mediaId);
    if (known !== undefined && known !== artifact.contentHash) {
      blockers.push(`the import artifacts disagree about which file ${artifact.mediaId} was made from`);
      continue;
    }
    hashByMediaId.set(artifact.mediaId, artifact.contentHash);
    locatorByMediaId.set(artifact.mediaId, artifact.sourceLocator);
  }
  for (const mediaId of galleryMediaIds) {
    if (!hashByMediaId.has(mediaId)) {
      blockers.push(`${mediaId} has no source file in the import artifacts, so its file cannot be recognized`);
    }
  }
  const byContentHash: Record<string, string> = {};
  for (const [mediaId, hash] of hashByMediaId) byContentHash[hash] = mediaId;

  const imported = buildRallyImportPlan({
    manifest,
    files: input.files,
    identities: { version: 1, byContentHash },
    now: input.now,
    acceptInterleavedSections: input.acceptInterleavedSections,
    mintMediaId: input.mintMediaId,
  });
  blockers.push(...imported.problems);
  warnings.push(...imported.warnings);

  const plannedMedia = (imported.plan?.documents ?? []).filter((document) => document._type === "media");
  const plannedMediaIds = new Set(plannedMedia.map((document) => document.mediaId as string));
  for (const mediaId of galleryMediaIds) {
    if (imported.plan !== undefined && !plannedMediaIds.has(mediaId)) {
      blockers.push(
        `${mediaId} (${locatorByMediaId.get(mediaId) ?? "unknown file"}) is in the published gallery but its file is not in the folder`,
      );
    }
  }
  const added = plannedMedia.filter((document) => !galleryMediaIds.has(document.mediaId as string));
  if (added.length > 0 && !input.allowNewPhotographs) {
    blockers.push(
      `${added.length} file(s) match no photograph of the published gallery — a conversion does not add photographs unless you pass --allow-new-photographs`,
    );
  }

  // Duplicates: the same photograph placed twice in one language.
  const referencePlacements = (reference?.placements ?? []).toSorted((a, b) => a.order - b.order);
  const occurrences = new Map<string, ProductionPlacement[]>();
  for (const placement of referencePlacements) {
    occurrences.set(placement.mediaId, [...(occurrences.get(placement.mediaId) ?? []), placement]);
  }
  const duplicated = [...occurrences.entries()].filter(([, list]) => list.length > 1);
  if (duplicated.length > 0 && !input.acceptRemovedDuplicates) {
    blockers.push(
      `${duplicated.length} photograph(s) are placed twice in the gallery and will appear once — review the deviation report and rerun with --accept-removed-duplicates`,
    );
  }

  // Photographs placed in other galleries: allowed, reported.
  const elsewhere = new Map<string, Set<string>>();
  for (const entry of production.placementsElsewhere) {
    if (entry.galleryContentId === contentId) continue;
    const set = elsewhere.get(entry.mediaId) ?? new Set<string>();
    set.add(entry.galleryContentId);
    elsewhere.set(entry.mediaId, set);
  }
  const reusedElsewhere = [...elsewhere.entries()].map(([mediaId, galleries]) => ({
    mediaId,
    galleries: [...galleries].toSorted(),
  }));

  // --- deviations: what the owner will see change ---
  const deviations: RallyDeviation[] = [];
  const newOrder = plannedMedia.map((document) => document.mediaId as string);
  const newIndex = new Map(newOrder.map((mediaId, index) => [mediaId, index]));
  const sectionOf = new Map(
    plannedMedia.map((document) => [
      document.mediaId as string,
      (document.captureSequence as { sectionId: string }).sectionId,
    ]),
  );
  // A placement of a photograph that lands in another section (the owner's
  // folder decides, and a photograph belongs to one section) is a removed
  // duplicate: its own overrides go with it. Every other placement's alt text and
  // caption must survive, so a differing one blocks.
  const differingAlt: string[] = [];
  const conflictingCaption: string[] = [];
  let redundantAltOverrides = 0;
  const movedCaptions = new Map<string, Map<string, string>>();
  for (const { gallery, placement } of allPlacements) {
    const at = `${placement.placementId} (${gallery.language})`;
    const landsIn = sectionOf.get(placement.mediaId);
    const removedDuplicate =
      landsIn !== undefined &&
      landsIn !== (placement.sectionId ?? "") &&
      gallery.placements.some(
        (other) => other.mediaId === placement.mediaId && (other.sectionId ?? "") === landsIn,
      );
    if (removedDuplicate) continue;
    if (placement.altOverride !== undefined && placement.altOverride !== null) {
      if (placement.altOverride === textIn(placement.mediaAlt, gallery.language)) redundantAltOverrides += 1;
      else differingAlt.push(at);
    }
    if (placement.captionOverride !== undefined && placement.captionOverride !== null) {
      const own = textIn(placement.mediaCaption, gallery.language);
      const caption = placement.captionOverride;
      const already = movedCaptions.get(placement.mediaId)?.get(gallery.language);
      if (typeof caption !== "string" || caption.trim().length === 0) conflictingCaption.push(at);
      else if (own !== undefined && own !== caption) conflictingCaption.push(at);
      else if (already !== undefined && already !== caption) conflictingCaption.push(at);
      else if (own === undefined) {
        const perLanguage = movedCaptions.get(placement.mediaId) ?? new Map<string, string>();
        perLanguage.set(gallery.language, caption);
        movedCaptions.set(placement.mediaId, perLanguage);
      }
    }
  }
  for (const line of [
    summarize("placements whose own alt text differs from the photograph's", differingAlt),
    summarize("placement captions that conflict with the photograph's own caption", conflictingCaption),
  ]) {
    if (line !== undefined) blockers.push(line);
  }

  const fileOf = new Map(
    (imported.plan?.assetRequirements ?? []).map((asset) => [asset.mediaId, asset.relativePath]),
  );
  const firstOccurrence = [...occurrences.values()]
    .map((list) => list[0] as ProductionPlacement)
    .toSorted((a, b) => a.order - b.order)
    .filter((placement) => newIndex.has(placement.mediaId));
  const staying = stayingInPlace(firstOccurrence.map((placement) => newIndex.get(placement.mediaId) as number));
  let moved = 0;
  firstOccurrence.forEach((placement, index) => {
    const list = occurrences.get(placement.mediaId) ?? [];
    const currentSections = [...new Set(list.map((entry) => entry.sectionId ?? ""))];
    const newSection = sectionOf.get(placement.mediaId);
    const base = {
      mediaId: placement.mediaId,
      ...(fileOf.get(placement.mediaId) === undefined ? {} : { file: fileOf.get(placement.mediaId) as string }),
      currentPositions: list.map((entry) => referencePlacements.indexOf(entry) + 1),
      newPosition: (newIndex.get(placement.mediaId) as number) + 1,
      currentSections,
      ...(newSection === undefined ? {} : { newSection }),
    };
    if (list.length > 1) deviations.push({ ...base, reason: "duplicate-removed" });
    else if (newSection !== undefined && !currentSections.includes(newSection)) {
      deviations.push({ ...base, reason: "section-changed" });
    } else if (!staying.has(index)) {
      deviations.push({ ...base, reason: "moved" });
      moved += 1;
    }
  });
  for (const document of added) {
    const mediaId = document.mediaId as string;
    deviations.push({
      mediaId,
      ...(fileOf.get(mediaId) === undefined ? {} : { file: fileOf.get(mediaId) as string }),
      currentPositions: [],
      newPosition: (newIndex.get(mediaId) as number) + 1,
      currentSections: [],
      ...(sectionOf.get(mediaId) === undefined ? {} : { newSection: sectionOf.get(mediaId) as string }),
      reason: "added",
    });
  }

  // Declared sections nobody will populate become empty.
  const usedSections = new Set(sectionOf.values());
  for (const section of reference?.sections ?? []) {
    if (!usedSections.has(section.sectionId)) {
      warnings.push(`section "${section.label}" (${section.sectionId}) will have no photographs after the conversion`);
    }
  }

  const placementDeletions = production.galleries.flatMap((gallery) =>
    gallery.placements.map((placement) => ({ _id: placement._id, galleryId: gallery._id })),
  );
  let captionsMoved = 0;
  for (const perLanguage of movedCaptions.values()) captionsMoved += perLanguage.size;
  const counts = {
    photographs: plannedMedia.length,
    existing: plannedMedia.length - added.length,
    added: added.length,
    placementsDeleted: placementDeletions.length,
    moved,
    captionsMoved,
    redundantAltOverrides,
  };

  if (imported.refusals.length > 0 || blockers.length > 0 || imported.plan === undefined) {
    return {
      plan: undefined,
      refusals: imported.refusals,
      blockers,
      warnings,
      deviations,
      reusedElsewhere,
      counts,
    };
  }

  const placementOfMedia = new Map(allPlacements.map(({ placement }) => [placement.mediaId, placement]));
  const mediaPatches: RallyMediaPatch[] = plannedMedia
    .filter((document) => galleryMediaIds.has(document.mediaId as string))
    .map((document) => {
      const mediaId = document.mediaId as string;
      const placement = placementOfMedia.get(mediaId) as ProductionPlacement;
      const moving = movedCaptions.get(mediaId);
      const caption =
        moving === undefined
          ? undefined
          : [
              ...(placement.mediaCaption ?? [])
                .filter((entry) => typeof entry.language === "string" && typeof entry.value === "string")
                .map((entry) => ({
                  _key: entry._key ?? `caption-${entry.language as string}`,
                  _type: "localizedText" as const,
                  language: entry.language as string,
                  value: entry.value as string,
                })),
              ...[...moving.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([language, value]) => ({
                _key: `caption-${language}`,
                _type: "localizedText" as const,
                language,
                value,
              })),
            ];
      return {
        _id: placement.mediaDocumentId,
        mediaId,
        captureSequence: document.captureSequence as RallyMediaPatch["captureSequence"],
        ...(caption === undefined ? {} : { caption }),
      };
    });
  const addedIds = new Set(added.map((document) => document.mediaId as string));
  const withoutDigest: Omit<RallyConversionPlan, "conversionDigest"> = {
    version: RALLY_CONVERSION_PLAN_VERSION,
    contentId,
    galleries: production.galleries
      .map((gallery) => ({ _id: gallery._id, language: gallery.language }))
      .toSorted((a, b) => a.language.localeCompare(b.language)),
    mediaPatches,
    newMediaDocuments: added,
    newAssetRequirements: imported.plan.assetRequirements.filter((asset) => addedIds.has(asset.mediaId)),
    placementDeletions: placementDeletions.toSorted((a, b) => a._id.localeCompare(b._id)),
    acceptedRemovedDuplicates: duplicated.length > 0,
  };

  return {
    plan: { ...withoutDigest, conversionDigest: conversionDigest(withoutDigest) },
    refusals: [],
    blockers,
    warnings,
    deviations,
    reusedElsewhere,
    counts,
  };
}
