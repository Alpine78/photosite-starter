import { createHash, createHmac } from "node:crypto";

type Document = Readonly<Record<string, unknown>>;
type MutableDocument = Record<string, unknown>;

export class LocalizedDraftPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalizedDraftPlanError";
  }
}

const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z]{2,3}$/;
const TEXT_FIELDS = new Set([
  "title", "summary", "author", "text", "attribution", "caption", "label",
  "firstLabel", "secondLabel", "altOverride", "captionOverride", "headers",
  "cells", "items", "href",
]);

function record(value: unknown): value is Document {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LocalizedDraftPlanError(`Source is missing ${field}.`);
  }
  return value;
}

function publishedId(id: string): string {
  return id.startsWith("drafts.") ? id.slice(7) : id;
}

function deterministicId(kind: string, contentId: string, language: string, item = ""): string {
  const hash = createHash("sha256").update(JSON.stringify([kind, contentId, language, item])).digest("hex");
  return `localized-${kind}-${hash}`;
}

function cloneDocument(source: Document): MutableDocument {
  const copy = structuredClone(source) as MutableDocument;
  for (const key of Object.keys(copy)) {
    if (key.startsWith("_") && key !== "_type") delete copy[key];
  }
  return copy;
}

/** Source text remains in place as an editing base. Every copied field is tracked until an editor reviews it. */
function textPaths(value: unknown, prefix: string, paths: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => textPaths(entry, `${prefix}[${index}]`, paths));
    return;
  }
  if (!record(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("_") || key === "videoId" || key === "sectionId" || key === "placementId" || key === "pollId") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (TEXT_FIELDS.has(key) && typeof child === "string" && child.trim()) paths.push(path);
    else if ((key === "headers" || key === "cells" || key === "items") && Array.isArray(child) && child.every((item) => typeof item === "string")) {
      child.forEach((item, index) => { if (item.trim()) paths.push(`${path}[${index}]`); });
    } else if (Array.isArray(child) || record(child)) textPaths(child, path, paths);
  }
}

function categoryHasLanguage(category: Document, language: string): boolean {
  return ["slug", "label"].every((field) =>
    Array.isArray(category[field]) && category[field].some((entry: unknown) =>
      record(entry) && entry.language === language && typeof entry.value === "string" && entry.value.trim().length > 0,
    ),
  );
}

/** Raw Content Lake reads include release copies; only draft/published source placements belong in a new draft. */
export function selectCurrentPlacementVersions(rows: readonly Document[]): readonly Document[] {
  const selected = new Map<string, Document>();
  for (const row of rows) {
    const id = requiredString(row._id, "placement _id");
    if (id.startsWith("versions.")) continue;
    const identity = publishedId(id);
    if (!selected.has(identity) || id.startsWith("drafts.")) selected.set(identity, row);
  }
  return [...selected.values()];
}

export type LocalizedDraftPlan = {
  readonly draft: MutableDocument;
  readonly placementDrafts: readonly MutableDocument[];
  readonly reviewPaths: readonly string[];
  readonly notices: readonly string[];
};

export function planLocalizedDraft(input: {
  readonly source: Document;
  readonly targetLanguage: string;
  readonly configuredLanguages: readonly string[];
  readonly existingVersions: readonly Document[];
  readonly placements: readonly Document[];
  readonly categories: readonly Document[];
  readonly media: readonly Document[];
}): LocalizedDraftPlan {
  const { source, targetLanguage, configuredLanguages, existingVersions, placements, categories, media } = input;
  const type = requiredString(source._type, "_type");
  if (type !== "article" && type !== "gallery") throw new LocalizedDraftPlanError("Only articles and galleries can be localized.");
  const contentId = requiredString(source.contentId, "contentId");
  const sourceLanguage = requiredString(source.language, "language");
  const sourceId = requiredString(source._id, "_id");
  const sourceReview = source.localizationReview;
  if (source.localizedFrom !== undefined &&
      (!record(sourceReview) || !Array.isArray(sourceReview.pendingFields) || sourceReview.pendingFields.length > 0)) {
    throw new LocalizedDraftPlanError("Finish the source language's localization review before creating another language from it.");
  }

  if (!CONTENT_ID.test(contentId) || !LANGUAGE.test(sourceLanguage) || !LANGUAGE.test(targetLanguage)) {
    throw new LocalizedDraftPlanError("Content ID or language has an invalid shape.");
  }
  if (!configuredLanguages.includes(sourceLanguage) || !configuredLanguages.includes(targetLanguage) || targetLanguage === sourceLanguage) {
    throw new LocalizedDraftPlanError("Choose a different configured target language.");
  }
  if (existingVersions.some((version) => version.contentId === contentId && version.language === targetLanguage)) {
    throw new LocalizedDraftPlanError(`A ${targetLanguage} version already exists, as a draft or published document.`);
  }
  if (existingVersions.some((version) => version.contentId === contentId && version._type !== type)) {
    throw new LocalizedDraftPlanError("The content ID is also used by another content variant.");
  }
  const draftId = `drafts.${deterministicId(type, contentId, targetLanguage)}`;
  const draft = cloneDocument(source);
  draft._id = draftId;
  draft.language = targetLanguage;
  // A copied slug is useful as source text but cannot be a finished target URL.
  // The review guard in the Studio schema blocks publication until it is reviewed.
  const reviewPaths: string[] = [];
  textPaths(draft, "", reviewPaths);
  if (typeof draft.slug === "string" && draft.slug) reviewPaths.push("slug");
  if (type === "gallery" && Array.isArray(draft.sections)) {
    draft.sections.forEach((section, index) => {
      if (record(section) && typeof section.slug === "string" && section.slug) reviewPaths.push(`sections[${index}].slug`);
    });
  }
  const notices: string[] = [];
  const canonicalRef = record(draft.canonicalCategory) ? draft.canonicalCategory._ref : undefined;
  if (typeof canonicalRef === "string") {
    const category = categories.find((item) => publishedId(String(item._id)) === publishedId(canonicalRef));
    if (!category || !categoryHasLanguage(category, targetLanguage)) {
      notices.push(`Canonical category ${canonicalRef} lacks a published ${targetLanguage} label and slug. Localize it before publishing.`);
    }
  }
  const secondary = Array.isArray(draft.secondaryCategories) ? draft.secondaryCategories : [];
  secondary.forEach((ref) => {
    if (!record(ref) || typeof ref._ref !== "string") return;
    const category = categories.find((item) => publishedId(String(item._id)) === publishedId(ref._ref as string));
    if (!category || !categoryHasLanguage(category, targetLanguage)) {
      notices.push(`Secondary category ${ref._ref} lacks a published ${targetLanguage} label and slug.`);
    }
  });
  const body = Array.isArray(draft.body) ? draft.body : [];
  if (body.some((block) => record(block) && block._type === "contentPollBlock")) {
    throw new LocalizedDraftPlanError("A poll belongs to one language and cannot be reused. Create a target-language poll and replace its reference first.");
  }
  const orderingRule = draft.orderingRule;
  if (type === "gallery" && orderingRule === "capture-sequence" && placements.length > 0) {
    throw new LocalizedDraftPlanError("Capture-sequence galleries cannot have placement documents.");
  }
  if (type === "gallery" && orderingRule !== "capture-sequence" && orderingRule !== "manual" && orderingRule !== "seeded-random") {
    throw new LocalizedDraftPlanError("Unknown gallery ordering rule.");
  }
  if (type === "article" && placements.length > 0 && !source.endGalleryId) {
    throw new LocalizedDraftPlanError("Article end-gallery placements require an end-gallery ID on the source.");
  }
  const seenPlacementIds = new Set<string>();
  const pageReviewPaths = [...reviewPaths];
  const placementDrafts = placements.map((sourcePlacement) => {
    const placementType = type === "gallery" ? "galleryPlacement" : "articleEndGalleryPlacement";
    const refField = type === "gallery" ? "gallery" : "article";
    if (sourcePlacement._type !== placementType || !record(sourcePlacement[refField]) ||
        publishedId(String((sourcePlacement[refField] as Document)._ref)) !== publishedId(sourceId)) {
      throw new LocalizedDraftPlanError("A placement does not belong to the selected source version.");
    }
    const placementId = requiredString(sourcePlacement.placementId, "placementId");
    if (seenPlacementIds.has(placementId)) throw new LocalizedDraftPlanError(`Duplicate source placement ID ${placementId}.`);
    seenPlacementIds.add(placementId);
    const next = cloneDocument(sourcePlacement);
    next._id = `drafts.${deterministicId(placementType, contentId, targetLanguage, placementId)}`;
    next[refField] = { _type: "reference", _ref: publishedId(draftId) };
    const localPaths: string[] = [];
    textPaths(next, "", localPaths);
    next.localizedFrom = sourceLanguage;
    next.localizationReview = { _type: "localizationReview", sourceLanguage, pendingFields: localPaths };
    reviewPaths.push(...localPaths.map((path) => `placements[${placementId}].${path}`));
    return next;
  });
  if (type === "gallery" && orderingRule === "seeded-random") {
    const seed = requiredString(draft.orderingSeed, "orderingSeed");
    for (const placement of placementDrafts) {
      const expected = placement.pinned === true ? undefined
        : createHmac("sha256", seed).update(String(placement.placementId), "utf8").digest("hex");
      if (placement.shuffledOrder !== expected || placement.shuffledOrderSeed !== (expected ? seed : undefined)) {
        throw new LocalizedDraftPlanError(`Placement ${placement.placementId} has a stale shuffled order; recompute the source before copying.`);
      }
    }
  }
  // Shared media owns default alt/caption; placement overrides are copied and tracked separately.
  const mediaRefs = new Set<string>();
  function collectMedia(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(collectMedia); return; }
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (["media", "cover", "first", "second"].includes(key) && record(child) && typeof child._ref === "string") {
        mediaRefs.add(publishedId(child._ref));
      } else if (key !== "localizationReview") collectMedia(child);
    }
  }
  collectMedia(draft);
  placementDrafts.forEach(collectMedia);
  if (type === "gallery" && orderingRule === "capture-sequence") {
    for (const item of media) if (typeof item._id === "string") mediaRefs.add(publishedId(item._id));
  }
  for (const ref of mediaRefs) {
    const item = media.find((entry) => publishedId(String(entry._id)) === ref);
    if (!item) { notices.push(`Media ${ref} is missing; its target-language text ownership cannot be checked.`); continue; }
    for (const field of ["alt", "caption"]) {
      const sourceHasText = Array.isArray(item[field]) && item[field].some((entry: unknown) => record(entry) && entry.language === sourceLanguage);
      const targetHasText = Array.isArray(item[field]) && item[field].some((entry: unknown) => record(entry) && entry.language === targetLanguage);
      if (sourceHasText && !targetHasText) notices.push(`Shared media ${ref} needs a ${targetLanguage} ${field} entry; this action does not clone media.`);
    }
  }
  const uniquePaths = [...new Set(reviewPaths)].sort();
  draft.localizedFrom = sourceLanguage;
  draft.localizationReview = { _type: "localizationReview", sourceLanguage, pendingFields: [...new Set(pageReviewPaths)].sort(), notices };
  return { draft, placementDrafts, reviewPaths: uniquePaths, notices };
}
