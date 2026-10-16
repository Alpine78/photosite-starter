import {
  LocalizedDraftPlanError, selectCurrentPlacementVersions,
  type LocalizedDraftInput, type LocalizedDraftPlan,
} from "../sanity/localized-draft-plan";
import { planBrowserLocalizedDraft } from "./localized-draft-crypto";

type Document = Readonly<Record<string, unknown>>;
export type DraftActionCode = "source" | "changed" | "exists" | "bounds" | "permission" | "unavailable" | "conflict" | "crypto" | "review" | "poll";
export class DraftActionError extends Error {
  constructor(readonly code: DraftActionCode) { super(code); }
}
export interface LocalizedDraftPort {
  fetch(query: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  create(documents: readonly Record<string, unknown>[]): Promise<void>;
}
export const VERSION_LIMIT = 64;
export const PLACEMENT_LIMIT = 1000;
const MEDIA_LIMIT = 2000;
export const MUTATION_BYTES_LIMIT = 3_500_000;
const idOf = (id: string) => id.startsWith("drafts.") ? id.slice(7) : id;
const isDocument = (value: unknown): value is Document => !!value && typeof value === "object" && !Array.isArray(value);

/** Stable comparison of saved authored fields plus identity/revision, excluding transient system metadata. */
export function documentSnapshot(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!isDocument(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().filter((key) => item[key] !== undefined).map((key) => [key, normalize(item[key])]));
  };
  if (!isDocument(value)) return "null";
  return JSON.stringify(normalize(Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("_") || ["_id", "_type", "_rev"].includes(key)))));
}
function rows(value: unknown, limit: number): Document[] {
  if (!Array.isArray(value) || value.length > limit || !value.every(isDocument)) throw new DraftActionError("bounds");
  if (new TextEncoder().encode(JSON.stringify(value)).length > MUTATION_BYTES_LIMIT) throw new DraftActionError("bounds");
  return [...value].sort((a, b) => String(a._id).localeCompare(String(b._id)));
}
function assertSource(source: Document) {
  if (!["article", "gallery"].includes(String(source._type)) ||
      typeof source._id !== "string" || (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/.test(source._id) || source._id.startsWith("versions.")) ||
      typeof source._rev !== "string" || !source._rev ||
      typeof source.contentId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.contentId) ||
      typeof source.language !== "string" || !/^[a-z]{2,3}$/.test(source.language)) throw new DraftActionError("source");
}
export function actionFailure(error: unknown): DraftActionError {
  if (error instanceof DraftActionError) return error;
  if (error instanceof LocalizedDraftPlanError) {
    if (error.message.includes("already exists")) return new DraftActionError("exists");
    if (error.message.includes("poll belongs")) return new DraftActionError("poll");
    return new DraftActionError("review");
  }
  if (error instanceof Error && error.message === "crypto-unavailable") return new DraftActionError("crypto");
  const status = isDocument(error) ? error.statusCode : undefined;
  return new DraftActionError(status === 409 ? "conflict" : status === 401 || status === 403 ? "permission" : "unavailable");
}
export async function loadLocalizedDraftSource(port: LocalizedDraftPort, editorSource: Document, signal: AbortSignal) {
  assertSource(editorSource);
  const versions = rows(await port.fetch(
    '*[_type in ["article", "gallery"] && contentId == $contentId][0...65]',
    { contentId: editorSource.contentId }, signal,
  ), VERSION_LIMIT);
  const id = idOf(String(editorSource._id));
  const source = versions.find((row) => row._id === `drafts.${id}`) ?? versions.find((row) => row._id === id);
  if (!source || documentSnapshot(source) !== documentSnapshot(editorSource)) throw new DraftActionError("changed");
  assertSource(source);
  return { source, versions };
}
function refs(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { value.forEach((entry) => refs(entry, found)); return found; }
  if (!isDocument(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    if (["media", "cover", "first", "second"].includes(key) && isDocument(child) && typeof child._ref === "string") found.add(idOf(child._ref));
    else if (isDocument(child) || Array.isArray(child)) refs(child, found);
  }
  return found;
}
export type PreparedLocalizedDraft = { plan: LocalizedDraftPlan; signature: string; sourceSnapshot: string };
export async function prepareLocalizedDraft(
  port: LocalizedDraftPort, editorSource: Document, targetLanguage: string,
  languages: readonly string[], signal: AbortSignal,
): Promise<PreparedLocalizedDraft> {
  try {
    if (!languages.includes(targetLanguage) || targetLanguage === editorSource.language) throw new DraftActionError("source");
    const { source, versions } = await loadLocalizedDraftSource(port, editorSource, signal);
    if (versions.some((row) => row.language === targetLanguage)) throw new DraftActionError("exists");
    const gallery = source._type === "gallery";
    const sourceId = idOf(String(source._id));
    const placementRows = rows(await port.fetch(
      `*[_type == $type && ${gallery ? "gallery" : "article"}._ref in $ids][0...1001]`,
      { type: gallery ? "galleryPlacement" : "articleEndGalleryPlacement", ids: [sourceId, `drafts.${sourceId}`] }, signal,
    ), PLACEMENT_LIMIT);
    const placements = selectCurrentPlacementVersions(placementRows);
    const categoryIds = new Set<string>();
    for (const ref of [source.canonicalCategory, ...(Array.isArray(source.secondaryCategories) ? source.secondaryCategories : [])]) {
      if (isDocument(ref) && typeof ref._ref === "string") categoryIds.add(idOf(ref._ref));
    }
    if (categoryIds.size > 32) throw new DraftActionError("bounds");
    const categories = categoryIds.size ? rows(await port.fetch(
      '*[_type == "category" && _id in $ids]{_id, slug, label}[0...33]', { ids: [...categoryIds] }, signal,
    ), 32) : [];
    const mediaIds = [...refs(source, refs(placements))];
    if (mediaIds.length > MEDIA_LIMIT) throw new DraftActionError("bounds");
    const capture = gallery && source.orderingRule === "capture-sequence";
    const media = capture || mediaIds.length ? rows(await port.fetch(
      capture
        ? '*[_type == "media" && (_id in $ids || captureSequence.galleryContentId == $contentId)]{_id, alt, caption}[0...2001]'
        : '*[_type == "media" && _id in $ids]{_id, alt, caption}[0...2001]',
      { ids: mediaIds, contentId: source.contentId }, signal,
    ), MEDIA_LIMIT) : [];
    const input: LocalizedDraftInput = { source, targetLanguage, configuredLanguages: languages, existingVersions: versions, placements, categories, media };
    const plan = await planBrowserLocalizedDraft(input);
    if (new TextEncoder().encode(JSON.stringify({ mutations: [plan.draft, ...plan.placementDrafts].map((create) => ({ create })) })).length > MUTATION_BYTES_LIMIT) throw new DraftActionError("bounds");
    return { plan, signature: documentSnapshot(input), sourceSnapshot: documentSnapshot(source) };
  } catch (error) { throw actionFailure(error); }
}

/** Explicit create only: fresh saved inputs must still equal the preview; never patch a source. */
export async function createPreparedLocalizedDraft(
  port: LocalizedDraftPort, prepared: PreparedLocalizedDraft, editorSource: Document,
  targetLanguage: string, languages: readonly string[], signal: AbortSignal,
): Promise<void> {
  try {
    const fresh = await prepareLocalizedDraft(port, editorSource, targetLanguage, languages, signal);
    if (signal.aborted || fresh.signature !== prepared.signature) throw new DraftActionError("changed");
    await port.create([fresh.plan.draft, ...fresh.plan.placementDrafts]);
  } catch (error) { throw actionFailure(error); }
}
