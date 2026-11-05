/**
 * AB#69 / ADR-0039 decisions 2 and 3: what one keyword sync should change, per medium. Pure.
 * `keyword-sync.mts` performs the reads and writes.
 *
 * A medium is identified by its `mediaId`, never by a filename or CDN URL, and no file or
 * asset is touched. The plan is derived from current data, so running it again finds nothing
 * left to do. That is what makes a partial run resumable: whatever was written is skipped.
 */

import { createHash } from "node:crypto";

import {
  importedKeywordsFromFields,
  KeywordImportError,
  mapImportedKeywords,
  NO_IMPORTED_KEYWORDS,
  type ImportedKeywords,
  type KeywordReviewItem,
} from "./keyword-import-mapping.mts";
import type { SeedMutation } from "./sanity-seed-http.mts";

export const KEYWORD_RECORD_TYPE = "keywordRecord";
export const KEYWORD_TAXONOMY_STATE_ID = "keywordTaxonomyState";

export class KeywordSyncError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`[keyword-sync] ${code}`);
    this.name = "KeywordSyncError";
    this.code = code;
  }
}

export const keywordRecordId = (mediaId: string): string => `${KEYWORD_RECORD_TYPE}.${mediaId}`;

type Reference = Readonly<{ _ref?: unknown }>;

/** The published medium and, when one exists, its draft: publishing a stale draft would undo the sync. */
export type KeywordSyncMedia = Readonly<{
  _id: string;
  _rev: string;
  mediaId: string;
  keywords?: readonly Reference[] | null;
  expandedKeywordIds?: readonly string[] | null;
  dynamicallyDiscoverable?: boolean | null;
  draft?: Readonly<{ _id: string; _rev: string; keywords?: readonly Reference[] | null; expandedKeywordIds?: readonly string[] | null }> | null;
  /** A Content Release holds a version of it, which would undo the sync when released. */
  hasVersion?: boolean;
}>;

export type KeywordSyncRecord = Readonly<{
  _id: string;
  _rev: string;
  importedKeywords?: Readonly<{ raw?: ImportedKeywords; importedAt?: string }> | null;
  keywordOverrides?: Readonly<{ added?: readonly Reference[] | null; removed?: readonly Reference[] | null }> | null;
  internalKeywords?: readonly Reference[] | null;
  reviewItems?: readonly KeywordReviewItem[] | null;
}>;

export type KeywordSyncInput = Readonly<{
  /** The keyword graph as `KEYWORD_GRAPH_PROJECTION` reads it. */
  vocabulary: readonly unknown[];
  media: readonly KeywordSyncMedia[];
  records: readonly KeywordSyncRecord[];
  /** `mediaId` → ExifTool `-G1` fields. Without an entry a medium re-maps its stored import. */
  imports?: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Opt the imported media in to keyword galleries. An explicit owner choice per run. */
  setDiscoverable?: boolean;
  now: string;
}>;

export type KeywordSyncEntry =
  | Readonly<{ mediaId: string; status: "unchanged"; review: readonly KeywordReviewItem[] }>
  | Readonly<{ mediaId: string; status: "update"; mutations: readonly SeedMutation[]; review: readonly KeywordReviewItem[] }>
  | Readonly<{ mediaId: string; status: "failed"; code: string }>;

export type KeywordSyncPlan = Readonly<{
  entries: readonly KeywordSyncEntry[];
  /** Imports naming no medium. Never guessed from a filename, only reported. */
  unmatchedImports: readonly string[];
  /** Over the mutations and their revision guards, so an approval names exactly one state of the data. */
  digest: string;
}>;

/** A malformed removal dropped here would quietly bring a keyword back, so it fails the medium. */
function refIds(references: readonly Reference[] | null | undefined): readonly string[] {
  if (references === undefined || references === null) return [];
  if (!Array.isArray(references)) throw new KeywordImportError("RECORD_MALFORMED");
  return references.map((reference: unknown) => {
    const ref = (reference as Reference | null)?._ref;
    if (typeof ref !== "string" || ref === "") throw new KeywordImportError("RECORD_MALFORMED");
    return ref;
  });
}

/** A CMS object has no key order, so comparing what was read with what would be written has to ignore it. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "object" && entry !== null && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
    : entry));
}

const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...new Set(left)].sort(), b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const keyOf = (id: string): string => createHash("sha256").update(id).digest("hex").slice(0, 12);
const keywordRefs = (ids: readonly string[]) => ids.map((id) => ({ _key: keyOf(id), _type: "reference", _ref: id }));
/** Weak, because a private record must not stop an editor deleting a never-published keyword. */
const weakRefs = (ids: readonly string[]) => ids.map((id) => ({ _key: keyOf(id), _type: "reference", _ref: id, _weak: true }));

/** Optional reads on a string or a list find nothing, which would look like an empty field. */
function assertContainer(value: unknown): void {
  if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value))) throw new KeywordImportError("RECORD_MALFORMED");
}

/** Stored data is untrusted like any other CMS read. */
function storedRaw(record: KeywordSyncRecord | undefined): ImportedKeywords {
  assertContainer(record?.importedKeywords);
  const raw = record?.importedKeywords?.raw;
  if (raw === undefined || raw === null) return NO_IMPORTED_KEYWORDS;
  const field = (value: unknown): readonly string[] | null => {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
    throw new KeywordImportError("RECORD_MALFORMED");
  };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new KeywordImportError("RECORD_MALFORMED");
  return {
    dcSubject: field(raw.dcSubject), iptcKeywords: field(raw.iptcKeywords),
    hierarchicalSubject: field(raw.hierarchicalSubject), weightedFlatSubject: field(raw.weightedFlatSubject),
  };
}

function planMedium(input: KeywordSyncInput, medium: KeywordSyncMedia, record: KeywordSyncRecord | undefined): KeywordSyncEntry {
  if (medium.hasVersion === true) throw new KeywordImportError("RELEASE_VERSION_EXISTS");
  // Only this tool writes keywords. Without its record they have no known source, and
  // deriving from nothing would silently remove them.
  if (record === undefined && (refIds(medium.keywords).length > 0 || refIds(medium.draft?.keywords).length > 0)) throw new KeywordImportError("KEYWORDS_WITHOUT_RECORD");
  assertContainer(record?.keywordOverrides);
  const fields = input.imports?.get(medium.mediaId);
  // ADR-0039 decision 5: mapping a failed read as "no keywords" would remove every imported keyword.
  if (fields !== undefined && Object.keys(fields).some((name) => /(?:^|:)Error$/u.test(name))) throw new KeywordImportError("IMPORT_UNREADABLE");
  const raw = fields === undefined ? storedRaw(record) : importedKeywordsFromFields(fields);
  const proposal = mapImportedKeywords(raw, input.vocabulary, {
    added: refIds(record?.keywordOverrides?.added),
    removed: refIds(record?.keywordOverrides?.removed),
  }, { currentKeywords: [...refIds(medium.keywords), ...refIds(record?.internalKeywords)] });

  // Only an explicit opt-in writes this. Otherwise each document keeps its own, because a draft may differ on purpose.
  const optIn = fields !== undefined && input.setDiscoverable === true;
  const keywordsDiffer = (document: Readonly<{ keywords?: readonly Reference[] | null; expandedKeywordIds?: readonly string[] | null }>) =>
    !sameSet(refIds(document.keywords), proposal.keywords) ||
    !sameSet(Array.isArray(document.expandedKeywordIds) ? document.expandedKeywordIds : [], proposal.expandedKeywordIds);
  const mediaChanged = keywordsDiffer(medium) || (optIn && medium.dynamicallyDiscoverable !== true);
  // On its own, because a draft can be stale while the published document is right, and publishing it would bring the old keywords back.
  const draftChanged = medium.draft != null && (mediaChanged || keywordsDiffer(medium.draft));

  const rawChanged = canonicalJson(record?.importedKeywords?.raw ?? NO_IMPORTED_KEYWORDS) !== canonicalJson(raw);
  const recordChanged = rawChanged ||
    !sameSet(refIds(record?.keywordOverrides?.added), proposal.overrides.added) ||
    !sameSet(refIds(record?.keywordOverrides?.removed), proposal.overrides.removed) ||
    !sameSet(refIds(record?.internalKeywords), proposal.internalKeywords) ||
    canonicalJson(record?.reviewItems ?? []) !== canonicalJson(proposal.review);

  // Nothing to say about a medium no import has ever touched, and no reason to create a record for it.
  const hasContent = record !== undefined || fields !== undefined;
  if (!mediaChanged && !draftChanged && (!recordChanged || !hasContent)) return { mediaId: medium.mediaId, status: "unchanged", review: proposal.review };

  const set = {
    keywords: keywordRefs(proposal.keywords),
    expandedKeywordIds: proposal.expandedKeywordIds,
    ...(optIn ? { dynamicallyDiscoverable: true } : {}),
  };
  const mutations: SeedMutation[] = [];
  if (mediaChanged) mutations.push({ patch: { id: medium._id, ifRevisionID: medium._rev, set } });
  if (draftChanged) mutations.push({ patch: { id: medium.draft!._id, ifRevisionID: medium.draft!._rev, set } });
  // The keywords come from the record's overrides, so an editor changing them since must stop this.
  if ((mediaChanged || draftChanged) && !recordChanged && record !== undefined) mutations.push({ patch: { id: record._id, ifRevisionID: record._rev, set: { mediaId: medium.mediaId } } });
  if (recordChanged && hasContent) {
    const fieldsToSet = {
      importedKeywords: { raw, importedAt: rawChanged ? input.now : record?.importedKeywords?.importedAt ?? input.now },
      keywordOverrides: { added: weakRefs(proposal.overrides.added), removed: weakRefs(proposal.overrides.removed) },
      internalKeywords: weakRefs(proposal.internalKeywords),
      reviewItems: proposal.review,
    };
    mutations.push(record === undefined
      ? { create: { _id: keywordRecordId(medium.mediaId), _type: KEYWORD_RECORD_TYPE, mediaId: medium.mediaId, ...fieldsToSet } }
      : { patch: { id: record._id, ifRevisionID: record._rev, set: fieldsToSet } });
  }
  return { mediaId: medium.mediaId, status: "update", mutations, review: proposal.review };
}

/** A vocabulary fault stops the whole plan; a fault in one medium's own data stops only that medium. */
export function planKeywordSync(input: KeywordSyncInput): KeywordSyncPlan {
  mapImportedKeywords(NO_IMPORTED_KEYWORDS, input.vocabulary, { added: [], removed: [] });
  const records = new Map(input.records.map((record) => [record._id, record]));
  const claims = new Map<string, number>();
  for (const medium of input.media) claims.set(medium.mediaId, (claims.get(medium.mediaId) ?? 0) + 1);
  const entries = input.media.map((medium): KeywordSyncEntry => {
    // Every claimant, because no order makes one of them the right one to write.
    if (claims.get(medium.mediaId)! > 1) return { mediaId: medium.mediaId, status: "failed", code: "MEDIA_ID_REPEATED" };
    try {
      return planMedium(input, medium, records.get(keywordRecordId(medium.mediaId)));
    } catch (error) {
      if (error instanceof KeywordImportError) return { mediaId: medium.mediaId, status: "failed", code: error.code };
      throw error;
    }
  });
  const known = new Set(input.media.map((medium) => medium.mediaId));
  const planned = entries.flatMap((entry) => (entry.status === "update" ? entry.mutations : []));
  return {
    entries,
    unmatchedImports: [...(input.imports?.keys() ?? [])].filter((mediaId) => !known.has(mediaId)).sort(),
    // Today's clock is not part of what is approved: it differs between the dry run and the write.
    digest: createHash("sha256").update(JSON.stringify(planned, (key, value) => (key === "importedAt" && value === input.now ? "<now>" : value))).digest("hex"),
  };
}

export type KeywordSyncSummary = Readonly<{
  media: number;
  unchanged: number;
  update: number;
  failed: number;
  unmatchedImports: number;
  reviewItems: number;
}>;

/** Counts only: a review item can hold anything a photographer typed. */
export function summarizeKeywordSync(plan: KeywordSyncPlan): KeywordSyncSummary {
  const count = (status: KeywordSyncEntry["status"]) => plan.entries.filter((entry) => entry.status === status).length;
  return {
    media: plan.entries.length,
    unchanged: count("unchanged"),
    update: count("update"),
    failed: count("failed"),
    unmatchedImports: plan.unmatchedImports.length,
    reviewItems: plan.entries.reduce((total, entry) => total + (entry.status === "failed" ? 0 : entry.review.length), 0),
  };
}
