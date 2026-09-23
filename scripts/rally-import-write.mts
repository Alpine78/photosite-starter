/**
 * AB#168: the pure decisions of the rally import write step (ADR-0022 §6).
 *
 * `write-rally-import.mts` owns every read and write; this module decides:
 *
 * - whether a plan file is exactly the shape `rally-import-plan.mts` emits
 *   (an API write bypasses every Studio rule, so a hand-edited plan is refused
 *   rather than trusted);
 * - whether the target dataset lets the plan be written, from a snapshot the IO
 *   half reads (`evaluateRallyPreflight`);
 * - which mutations to send (`buildRallyWriteMutations`): new documents are
 *   created, and a rerun updates **only** what the plan owns — a photograph's
 *   `captureSequence` and `image`, a gallery's missing sections and missing
 *   cover — so alt text, captions, credits, flags, titles, and section intros
 *   an owner has since edited in Studio survive. Nothing is ever deleted;
 * - whether the read-back after the write agrees with the plan.
 */

import {
  CAPTURE_SEQUENCE_ORDERING_RULE,
  galleryDocumentId,
  IDENTITY_PATTERN,
  LANGUAGE_SUBTAG,
  mediaDocumentId,
  PENDING_ASSET_PREFIX,
  PENDING_CATEGORY_PREFIX,
  RALLY_IMPORT_PLAN_VERSION,
  rallyPlanDigest,
  type PlannedDocument,
  type RallyImportPlan,
} from "./rally-import-plan.mts";
import type { SeedMutation } from "./sanity-seed-http.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "./sanity-seed-fixtures.mts";

const CONTENT_HASH = /^[0-9a-f]{64}$/u;

/** Exactly the fields the planner emits, per document type. */
const MEDIA_FIELDS = new Set([
  "_id", "_type", "mediaId", "mediaType", "alt", "publiclyRenderable", "captureSequence", "image",
]);
const GALLERY_FIELDS = new Set([
  "_id", "_type", "contentId", "language", "title", "slug", "summary", "publishedAt", "eventDate",
  "canonicalCategory", "orderingRule", "sections", "cover",
]);
const ASSET_FIELDS = new Set(["mediaId", "documentId", "relativePath", "contentHash", "width", "height"]);
const PLAN_FIELDS = new Set([
  "version", "contentId", "languages", "canonicalCategory", "acceptedInterleavedSections",
  "documents", "assetRequirements", "documentsDigest",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReference(value: unknown, ref: string): boolean {
  return (
    isPlainObject(value) &&
    value._type === "reference" &&
    value._ref === ref &&
    Object.keys(value).length === 2
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extraFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

/**
 * Checks that a parsed plan file is a plan this tool can write safely:
 * the planner's own shapes and nothing else, internally consistent, and one
 * asset requirement per photograph. Returns every issue at once.
 */
export function validateRallyPlanContract(raw: unknown): {
  readonly plan: RallyImportPlan | undefined;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  if (!isPlainObject(raw)) return { plan: undefined, issues: ["the plan must be a JSON object"] };
  for (const field of extraFields(raw, PLAN_FIELDS)) issues.push(`the plan has an unknown field "${field}"`);
  if (raw.version !== RALLY_IMPORT_PLAN_VERSION) {
    issues.push(`the plan version must be ${RALLY_IMPORT_PLAN_VERSION}; regenerate it with plan:rally`);
  }
  const contentId = raw.contentId;
  if (typeof contentId !== "string" || !IDENTITY_PATTERN.test(contentId)) issues.push("contentId is invalid");
  const category = raw.canonicalCategory;
  if (typeof category !== "string" || !IDENTITY_PATTERN.test(category)) issues.push("canonicalCategory is invalid");
  const languages = raw.languages;
  if (
    !Array.isArray(languages) ||
    languages.length === 0 ||
    !languages.every((language) => typeof language === "string" && LANGUAGE_SUBTAG.test(language)) ||
    new Set(languages).size !== languages.length
  ) {
    issues.push("languages must be a non-empty list of distinct language subtags");
  }
  if (typeof raw.acceptedInterleavedSections !== "boolean") {
    issues.push("acceptedInterleavedSections must be a boolean");
  }
  if (!Array.isArray(raw.documents) || !Array.isArray(raw.assetRequirements)) {
    issues.push("documents and assetRequirements must be lists");
  }
  if (issues.length > 0) return { plan: undefined, issues };

  const documents = raw.documents as unknown[];
  const assets = raw.assetRequirements as unknown[];
  const planLanguages = languages as string[];
  const media: Record<string, unknown>[] = [];
  const galleries: Record<string, unknown>[] = [];
  const ids = new Set<string>();

  documents.forEach((document, index) => {
    const at = `documents[${index}]`;
    if (!isPlainObject(document) || typeof document._id !== "string") {
      issues.push(`${at} is not a document`);
      return;
    }
    if (ids.has(document._id)) issues.push(`${at} repeats the id ${document._id}`);
    ids.add(document._id);
    if (document._type === "media") media.push(document);
    else if (document._type === "gallery") galleries.push(document);
    else issues.push(`${at} has an unexpected type`);
  });

  const mediaIds = new Set<string>();
  const sequences = new Set<number>();
  const sectionIdsUsed = new Set<string>();
  for (const document of media) {
    const at = `media ${document._id as string}`;
    for (const field of extraFields(document, MEDIA_FIELDS)) issues.push(`${at} has an unexpected field "${field}"`);
    const mediaId = document.mediaId;
    if (typeof mediaId !== "string" || !IDENTITY_PATTERN.test(mediaId)) {
      issues.push(`${at} has an invalid mediaId`);
      continue;
    }
    if (document._id !== mediaDocumentId(mediaId)) issues.push(`${at} does not use its planned id`);
    if (mediaIds.has(mediaId)) issues.push(`${at} repeats mediaId ${mediaId}`);
    mediaIds.add(mediaId);
    if (document.mediaType !== "image" || document.publiclyRenderable !== true) {
      issues.push(`${at} must be a publicly renderable image`);
    }
    if (!isReference(isPlainObject(document.image) ? document.image.asset : undefined, `${PENDING_ASSET_PREFIX}${mediaId}`)
      || !isPlainObject(document.image) || document.image._type !== "image" || Object.keys(document.image).length !== 2) {
      issues.push(`${at} must reference its own pending asset`);
    }
    const alt = document.alt;
    if (
      !Array.isArray(alt) ||
      alt.length !== planLanguages.length ||
      !planLanguages.every((language) =>
        alt.some(
          (entry) =>
            isPlainObject(entry) &&
            entry._type === "localizedText" &&
            entry._key === `alt-${language}` &&
            entry.language === language &&
            nonEmptyString(entry.value) &&
            Object.keys(entry).length === 4,
        ),
      )
    ) {
      issues.push(`${at} must carry alt text in exactly the plan's languages`);
    }
    const capture = document.captureSequence;
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
      continue;
    }
    if (sequences.has(capture.sequence)) issues.push(`${at} repeats sequence ${capture.sequence}`);
    sequences.add(capture.sequence);
    sectionIdsUsed.add(capture.sectionId);
  }

  if (media.length === 0) issues.push("the plan holds no photographs");
  if (galleries.length !== planLanguages.length) {
    issues.push("the plan must hold exactly one gallery document per language");
  }
  for (const document of galleries) {
    const at = `gallery ${document._id as string}`;
    for (const field of extraFields(document, GALLERY_FIELDS)) issues.push(`${at} has an unexpected field "${field}"`);
    const language = document.language;
    if (typeof language !== "string" || !planLanguages.includes(language)) {
      issues.push(`${at} has a language outside the plan`);
      continue;
    }
    if (document._id !== galleryDocumentId(contentId as string, language)) issues.push(`${at} does not use its planned id`);
    if (document.contentId !== contentId) issues.push(`${at} names another contentId`);
    if (document.orderingRule !== CAPTURE_SEQUENCE_ORDERING_RULE) issues.push(`${at} is not capture-sequence`);
    if (!nonEmptyString(document.title)) issues.push(`${at} has no title`);
    if (typeof document.slug !== "string" || !IDENTITY_PATTERN.test(document.slug)) issues.push(`${at} has an invalid slug`);
    if (typeof document.publishedAt !== "string" || Number.isNaN(Date.parse(document.publishedAt))) {
      issues.push(`${at} has an invalid publishedAt`);
    }
    if (typeof document.eventDate !== "string" || Number.isNaN(Date.parse(document.eventDate))) {
      issues.push(`${at} has an invalid eventDate`);
    }
    if (!isReference(document.canonicalCategory, `${PENDING_CATEGORY_PREFIX}${category as string}`)) {
      issues.push(`${at} must reference the plan's pending category`);
    }
    if (document.cover !== undefined) {
      const ref = isPlainObject(document.cover) ? document.cover._ref : undefined;
      if (typeof ref !== "string" || !isReference(document.cover, ref) || !ids.has(ref) || !ref.startsWith(mediaDocumentId(""))) {
        issues.push(`${at} has a cover that is not one of the plan's photographs`);
      }
    }
    const sections = document.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
      issues.push(`${at} declares no sections`);
      continue;
    }
    const declared = new Set<string>();
    for (const section of sections) {
      if (
        !isPlainObject(section) ||
        typeof section.sectionId !== "string" ||
        !IDENTITY_PATTERN.test(section.sectionId) ||
        section._key !== section.sectionId ||
        typeof section.slug !== "string" ||
        !IDENTITY_PATTERN.test(section.slug) ||
        !nonEmptyString(section.label) ||
        Object.keys(section).length !== 4
      ) {
        issues.push(`${at} has a malformed section`);
        continue;
      }
      declared.add(section.sectionId);
    }
    for (const sectionId of sectionIdsUsed) {
      if (!declared.has(sectionId)) issues.push(`${at} does not declare section ${sectionId}`);
    }
  }

  const assetMediaIds = new Set<string>();
  assets.forEach((asset, index) => {
    const at = `assetRequirements[${index}]`;
    if (!isPlainObject(asset)) {
      issues.push(`${at} is not an object`);
      return;
    }
    for (const field of extraFields(asset, ASSET_FIELDS)) issues.push(`${at} has an unexpected field "${field}"`);
    const mediaId = asset.mediaId;
    if (typeof mediaId !== "string" || !mediaIds.has(mediaId)) {
      issues.push(`${at} names no planned photograph`);
      return;
    }
    if (assetMediaIds.has(mediaId)) issues.push(`${at} repeats ${mediaId}`);
    assetMediaIds.add(mediaId);
    if (asset.documentId !== mediaDocumentId(mediaId)) issues.push(`${at} names the wrong document`);
    if (
      typeof asset.relativePath !== "string" ||
      asset.relativePath.length === 0 ||
      asset.relativePath.startsWith("/") ||
      asset.relativePath.split("/").includes("..")
    ) {
      issues.push(`${at} has an unsafe relativePath`);
    }
    if (typeof asset.contentHash !== "string" || !CONTENT_HASH.test(asset.contentHash)) {
      issues.push(`${at} has an invalid contentHash`);
    }
    for (const dimension of ["width", "height"] as const) {
      const value = asset[dimension];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_PUBLIC_DELIVERY_DIMENSION) {
        issues.push(`${at} has an invalid ${dimension}`);
      }
    }
  });
  if (assetMediaIds.size !== mediaIds.size) issues.push("every photograph needs exactly one asset requirement");

  return issues.length > 0
    ? { plan: undefined, issues }
    : { plan: raw as unknown as RallyImportPlan, issues };
}

/** The digest recomputed from the plan's content, for comparison with the approved one. */
export function recomputeRallyPlanDigest(plan: RallyImportPlan): string {
  return rallyPlanDigest(plan.documents, plan.assetRequirements);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/** The published identity a draft or release id belongs to. */
export function publishedIdOf(id: string): string {
  if (id.startsWith("drafts.")) return id.slice("drafts.".length);
  if (id.startsWith("versions.")) {
    const rest = id.slice("versions.".length);
    const separator = rest.indexOf(".");
    return separator === -1 ? rest : rest.slice(separator + 1);
  }
  return id;
}

export type ExistingDocument = {
  readonly _id: string;
  readonly _type: string;
  readonly contentId?: string | null;
  readonly language?: string | null;
  readonly slug?: string | null;
  readonly categoryRef?: string | null;
  readonly orderingRule?: string | null;
  readonly mediaId?: string | null;
  readonly sections?: readonly Record<string, unknown>[] | null;
  readonly hasCover?: boolean | null;
};

/** What the IO half reads from the target dataset (raw perspective) before a write. */
export type RallyPreflightSnapshot = {
  /** Every document whose id is a planned id, or a draft of one. */
  readonly plannedIdDocuments: readonly ExistingDocument[];
  /** Galleries and articles claiming the plan's `contentId`. */
  readonly contentIdClaims: readonly { readonly _id: string; readonly _type: string }[];
  /** Media claiming one of the plan's `mediaId`s. */
  readonly mediaIdClaims: readonly { readonly _id: string; readonly mediaId: string }[];
  /** Galleries and articles in the same category with one of the planned slugs. */
  readonly routeClaims: readonly { readonly _id: string; readonly language: string; readonly slug: string }[];
  /** Child categories of the canonical category, with their localized slugs. */
  readonly childCategories: readonly {
    readonly _id: string;
    readonly slug?: readonly { readonly language?: string; readonly value?: string }[] | null;
  }[];
  /** `galleryPlacement` documents referencing a planned gallery document. */
  readonly placementCount: number;
  /** Media in the dataset whose `captureSequence` names this gallery. */
  readonly memberMedia: readonly { readonly _id: string; readonly mediaId: string }[];
};

export type RallyPreflightResult = {
  readonly collisions: readonly string[];
  readonly existingMediaDocumentIds: ReadonlySet<string>;
  readonly existingGalleries: ReadonlyMap<string, ExistingDocument>;
};

function galleriesOf(plan: RallyImportPlan): readonly PlannedDocument[] {
  return plan.documents.filter((document) => document._type === "gallery");
}

function mediaOf(plan: RallyImportPlan): readonly PlannedDocument[] {
  return plan.documents.filter((document) => document._type === "media");
}

/**
 * Refuses the whole write on anything an API write would silently get wrong,
 * because Studio's publication rules never run for it.
 */
export function evaluateRallyPreflight(
  plan: RallyImportPlan,
  snapshot: RallyPreflightSnapshot,
  categoryDocumentId: string,
): RallyPreflightResult {
  const collisions: string[] = [];
  const plannedById = new Map(plan.documents.map((document) => [document._id, document]));
  const plannedGalleryIds = new Set(galleriesOf(plan).map((document) => document._id));
  const plannedMediaIdToDocId = new Map(
    mediaOf(plan).map((document) => [document.mediaId as string, document._id]),
  );
  const plannedMediaDocIds = new Set(plannedMediaIdToDocId.values());
  const existingMediaDocumentIds = new Set<string>();
  const existingGalleries = new Map<string, ExistingDocument>();

  for (const existing of snapshot.plannedIdDocuments) {
    const publishedId = publishedIdOf(existing._id);
    const planned = plannedById.get(publishedId);
    if (planned === undefined) continue;
    if (existing._id !== publishedId) continue; // reported once, below
    if (existing._type !== planned._type) {
      collisions.push(`${publishedId} already exists as a ${existing._type} document`);
      continue;
    }
    if (planned._type === "media") {
      if (existing.mediaId !== planned.mediaId) {
        collisions.push(`${publishedId} already exists with a different mediaId`);
        continue;
      }
      existingMediaDocumentIds.add(publishedId);
      continue;
    }
    const frozen: [string, unknown, unknown][] = [
      ["contentId", existing.contentId, planned.contentId],
      ["language", existing.language, planned.language],
      ["slug", existing.slug, planned.slug],
      ["canonical category", existing.categoryRef, categoryDocumentId],
      ["ordering rule", existing.orderingRule, CAPTURE_SEQUENCE_ORDERING_RULE],
    ];
    const changed = frozen.filter(([, before, after]) => before !== after).map(([name]) => name);
    if (changed.length > 0) {
      collisions.push(
        `${publishedId} already exists with a different ${changed.join(", ")} — a published address is not changed by an import`,
      );
      continue;
    }
    existingGalleries.set(publishedId, existing);
  }

  // A draft or a content-release copy of a planned document shows up in the
  // raw-perspective claim queries under its own prefixed id. Writing the
  // published document underneath it would leave Studio holding an edit that
  // silently overwrites the import on its next publish, so it is refused.
  const unpublishedCopies = new Set<string>();
  for (const claim of [
    ...snapshot.contentIdClaims,
    ...snapshot.mediaIdClaims,
    ...snapshot.memberMedia,
    ...snapshot.routeClaims,
  ]) {
    const publishedId = publishedIdOf(claim._id);
    if (claim._id !== publishedId && plannedById.has(publishedId)) unpublishedCopies.add(publishedId);
  }
  for (const existing of snapshot.plannedIdDocuments) {
    const publishedId = publishedIdOf(existing._id);
    if (existing._id !== publishedId && plannedById.has(publishedId)) unpublishedCopies.add(publishedId);
  }
  for (const publishedId of unpublishedCopies) {
    collisions.push(`${publishedId} has an unpublished draft or release in Studio — publish or discard it first`);
  }

  for (const claim of snapshot.contentIdClaims) {
    if (!plannedGalleryIds.has(publishedIdOf(claim._id))) {
      collisions.push(`contentId ${plan.contentId} is already used by ${claim._type} ${claim._id}`);
    }
  }
  for (const claim of snapshot.mediaIdClaims) {
    if (plannedMediaIdToDocId.get(claim.mediaId) !== publishedIdOf(claim._id)) {
      collisions.push(`mediaId ${claim.mediaId} is already used by ${claim._id}`);
    }
  }
  const plannedSlugs = new Map(
    galleriesOf(plan).map((document) => [document.language as string, document.slug as string]),
  );
  for (const claim of snapshot.routeClaims) {
    if (
      plannedSlugs.get(claim.language) === claim.slug &&
      !plannedGalleryIds.has(publishedIdOf(claim._id))
    ) {
      collisions.push(`the ${claim.language} address /${claim.slug} in this category is already used by ${claim._id}`);
    }
  }
  for (const child of snapshot.childCategories) {
    for (const entry of child.slug ?? []) {
      if (entry.language !== undefined && plannedSlugs.get(entry.language) === entry.value) {
        collisions.push(`the ${entry.language} address /${entry.value} in this category is already a subcategory (${child._id})`);
      }
    }
  }
  if (snapshot.placementCount > 0) {
    collisions.push(
      `${snapshot.placementCount} gallery placement(s) reference this gallery — a capture-sequence gallery has none (ADR-0022 §1)`,
    );
  }
  const strangers = snapshot.memberMedia.filter((member) => !plannedMediaDocIds.has(publishedIdOf(member._id)));
  if (strangers.length > 0) {
    collisions.push(
      `${strangers.length} photograph(s) in the dataset belong to this gallery but are not in the plan — the import never deletes, so remove them in Studio or put the files back`,
    );
  }

  return { collisions, existingMediaDocumentIds, existingGalleries };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type RallyWriteMutations = {
  readonly mediaWave: readonly SeedMutation[];
  readonly galleryWave: readonly SeedMutation[];
  readonly summary: {
    readonly mediaCreated: number;
    readonly mediaUpdated: number;
    readonly galleriesCreated: number;
    readonly galleriesUpdated: number;
    readonly sectionsAdded: number;
  };
};

/**
 * Turns the plan into mutations: pending asset and category references are
 * replaced by the real ids, new documents are created with
 * `createIfNotExists`, and existing ones get a `patch.set` of plan-owned
 * fields only. Throws if any pending reference would survive.
 */
export function buildRallyWriteMutations(
  plan: RallyImportPlan,
  context: {
    readonly categoryDocumentId: string;
    readonly assetIdByMediaId: ReadonlyMap<string, string>;
    readonly existingMediaDocumentIds: ReadonlySet<string>;
    readonly existingGalleries: ReadonlyMap<string, ExistingDocument>;
  },
): RallyWriteMutations {
  const mediaWave: SeedMutation[] = [];
  const galleryWave: SeedMutation[] = [];
  let mediaCreated = 0;
  let mediaUpdated = 0;
  let galleriesCreated = 0;
  let galleriesUpdated = 0;
  let sectionsAdded = 0;

  for (const document of mediaOf(plan)) {
    const mediaId = document.mediaId as string;
    const assetId = context.assetIdByMediaId.get(mediaId);
    if (assetId === undefined) throw new Error(`no uploaded asset for ${mediaId}`);
    const image = { _type: "image", asset: { _type: "reference", _ref: assetId } };
    if (context.existingMediaDocumentIds.has(document._id)) {
      mediaWave.push({
        patch: { id: document._id, set: { captureSequence: document.captureSequence, image } },
      });
      mediaUpdated += 1;
    } else {
      mediaWave.push({ createIfNotExists: { ...document, image } });
      mediaCreated += 1;
    }
  }

  for (const document of galleriesOf(plan)) {
    const canonicalCategory = { _type: "reference", _ref: context.categoryDocumentId };
    const existing = context.existingGalleries.get(document._id);
    if (existing === undefined) {
      galleryWave.push({ createIfNotExists: { ...document, canonicalCategory } });
      galleriesCreated += 1;
      continue;
    }
    const existingSections = existing.sections ?? [];
    const existingSectionIds = new Set(existingSections.map((section) => section.sectionId));
    const added = (document.sections as readonly Record<string, unknown>[]).filter(
      (section) => !existingSectionIds.has(section.sectionId),
    );
    const set: Record<string, unknown> = {};
    if (added.length > 0) {
      set.sections = [...existingSections, ...added];
      sectionsAdded += added.length;
    }
    if (existing.hasCover !== true && document.cover !== undefined) set.cover = document.cover;
    if (Object.keys(set).length > 0) {
      galleryWave.push({ patch: { id: document._id, set } });
      galleriesUpdated += 1;
    }
  }

  const pending = JSON.stringify([mediaWave, galleryWave]);
  if (pending.includes(`"${PENDING_ASSET_PREFIX}`) || pending.includes(`"${PENDING_CATEGORY_PREFIX}`)) {
    throw new Error("a pending reference survived substitution — refusing to write");
  }

  return {
    mediaWave,
    galleryWave,
    summary: { mediaCreated, mediaUpdated, galleriesCreated, galleriesUpdated, sectionsAdded },
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Compares the post-write read-back with the plan. Empty means it agrees. */
export function evaluateRallyReadBack(
  plan: RallyImportPlan,
  readBack: {
    readonly galleries: readonly { readonly _id: string; readonly orderingRule?: string | null }[];
    readonly memberMediaCount: number;
  },
): readonly string[] {
  const issues: string[] = [];
  for (const document of galleriesOf(plan)) {
    const found = readBack.galleries.find((gallery) => gallery._id === document._id);
    if (found === undefined) issues.push(`${document._id} was not found after the write`);
    else if (found.orderingRule !== CAPTURE_SEQUENCE_ORDERING_RULE) {
      issues.push(`${document._id} is not ordered by capture sequence after the write`);
    }
  }
  const expected = mediaOf(plan).length;
  if (readBack.memberMediaCount !== expected) {
    issues.push(`the gallery has ${readBack.memberMediaCount} photograph(s) after the write, the plan has ${expected}`);
  }
  return issues;
}
