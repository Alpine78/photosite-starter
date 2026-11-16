/**
 * Keywords on the shared public medium (ADR-0002, ADR-0039, AB#68).
 *
 * A medium has one effective keyword set however many galleries place it, so the set is
 * keyed by `mediaId` and never reaches a placement. `ImageMedia` and `VideoMedia` stay free
 * of keywords on purpose: they travel to the browser through the grid and the lightbox,
 * which need none of this. A query reads this model on the server and returns media.
 *
 * Public matching reads only the stored closure, `expandedKeywordIds` (ADR-0039 decision 3).
 * It may lag behind the hierarchy until a re-sync has run, which the taxonomy version in a
 * cursor already detects, so nothing here recomputes it or rejects it as stale.
 *
 * This holds active, public keywords only. Resolving a merged keyword's old id belongs to
 * the query (AB#58), which reads the merge records itself.
 */

import "server-only";

export const MAX_KEYWORD_DEPTH = 6;
const KEYWORD_ID_PATTERN = /^(?=.{2,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isKeywordId(value: unknown): value is string {
  return typeof value === "string" && KEYWORD_ID_PATTERN.test(value);
}

export type PublicKeyword = Readonly<{
  keywordId: string;
  title: string;
  /** A category is configurable content; its slug is not an identity guarantee. */
  categorySlug: string;
  parentKeywordId: string | null;
}>;

export type PublicKeywordTaxonomy = Readonly<{
  keywords: readonly PublicKeyword[];
  byId: ReadonlyMap<string, PublicKeyword>;
}>;

export type MediaKeywords = Readonly<{
  mediaId: string;
  keywordIds: readonly string[];
  expandedKeywordIds: readonly string[];
}>;

export type MediaKeywordIndex = ReadonlyMap<string, MediaKeywords>;

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Walks from a keyword to its root, so an invalid hierarchy fails here rather than in a result. */
function pathToRoot(keyword: PublicKeyword, byId: ReadonlyMap<string, PublicKeyword>): readonly PublicKeyword[] {
  const path = [keyword];
  for (let parentId = keyword.parentKeywordId; parentId !== null;) {
    const parent = byId.get(parentId);
    if (parent === undefined) throw new TypeError(`keyword "${keyword.keywordId}" has an unknown parent`);
    if (path.includes(parent)) throw new TypeError(`keyword "${keyword.keywordId}" belongs to a parent cycle`);
    path.push(parent);
    if (path.length > MAX_KEYWORD_DEPTH) throw new TypeError(`keyword "${keyword.keywordId}" is deeper than ${MAX_KEYWORD_DEPTH} levels`);
    parentId = parent.parentKeywordId;
  }
  return path;
}

export function buildPublicKeywordTaxonomy(keywords: readonly PublicKeyword[]): PublicKeywordTaxonomy {
  const byId = new Map<string, PublicKeyword>();
  for (const keyword of keywords) {
    if (!isKeywordId(keyword.keywordId)) throw new TypeError("a keyword has an invalid id");
    if (keyword.title.trim().length === 0) throw new TypeError(`keyword "${keyword.keywordId}" has no title`);
    if (byId.has(keyword.keywordId)) throw new TypeError(`keyword id "${keyword.keywordId}" is repeated`);
    byId.set(keyword.keywordId, keyword);
  }
  for (const keyword of keywords) pathToRoot(keyword, byId);
  return { keywords, byId };
}

/** A keyword and its ancestors. For building fixtures and validating them, not for matching. */
export function expandKeywordIds(keywordIds: readonly string[], taxonomy: PublicKeywordTaxonomy): readonly string[] {
  return sortedUnique(keywordIds.flatMap((keywordId) => {
    const keyword = taxonomy.byId.get(keywordId);
    if (keyword === undefined) throw new TypeError(`unknown keyword "${keywordId}"`);
    return pathToRoot(keyword, taxonomy.byId).map((entry) => entry.keywordId);
  }));
}

/** One assignment per medium: a repeat could otherwise give one photograph two keyword sets. */
export function buildMediaKeywordIndex(assignments: readonly MediaKeywords[]): MediaKeywordIndex {
  const index = new Map<string, MediaKeywords>();
  for (const assignment of assignments) {
    if (index.has(assignment.mediaId)) throw new TypeError(`media "${assignment.mediaId}" has two keyword assignments`);
    index.set(assignment.mediaId, assignment);
  }
  return index;
}

/** A medium nobody has tagged yet simply has no keywords. */
export function keywordsOfMedia(index: MediaKeywordIndex, mediaId: string): MediaKeywords {
  return index.get(mediaId) ?? { mediaId, keywordIds: [], expandedKeywordIds: [] };
}

/** Global AND, as ADR-0012 §4 defines it. Selecting a parent matches its descendants through the closure. */
export function mediaMatchesAllKeywords(media: MediaKeywords, selectedKeywordIds: readonly string[]): boolean {
  return selectedKeywordIds.every((keywordId) => media.expandedKeywordIds.includes(keywordId));
}
