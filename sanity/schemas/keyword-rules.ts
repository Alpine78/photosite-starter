/**
 * The keyword taxonomy's governance rules (ADR-0039 decisions 1, 4 and 5). Pure:
 * every question here is answered from values passed in, so the Studio validator
 * and the publication action ask exactly the same questions.
 *
 * ## Term ownership
 *
 * A title or alias belongs to the keyword it resolves to: an active keyword owns
 * its own terms, and a merge record's terms belong to the active keyword its chain
 * ends at. Two documents collide only when they hold one term in one category and
 * resolve to different keywords, so a source and its merge target may overlap. A
 * retired keyword, or a merge record whose chain no longer ends at an active
 * keyword, claims no term, though its `keywordId` stays reserved forever.
 * A title or alias may equal another keyword's `keywordId` only across categories:
 * public URLs resolve ids alone, so a name in another category cannot capture one.
 *
 * A merge is one-way: media and overrides are canonicalized to the target by the
 * re-sync, and a reversed merge could not reconstruct them, so a published merge
 * record cannot return to active, retire or point somewhere else.
 */

import type { SchemaValidationResult } from "./schema-types";
import { publishedIdOf } from "./validation";

export const KEYWORD_TYPE_NAME = "keyword";
export const KEYWORD_CATEGORY_TYPE_NAME = "keywordCategory";
export const KEYWORD_TAXONOMY_STATE_TYPE_NAME = "keywordTaxonomyState";
export const KEYWORD_TAXONOMY_STATE_ID = "keywordTaxonomyState";

/** ADR-0039 decision 1: fits five ids in ADR-0012's 256-character cursor scope. */
export const KEYWORD_ID_PATTERN = /^(?=.{2,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const KEYWORD_ID_MAX_LENGTH = 40;
export const MAX_KEYWORD_DEPTH = 6;
export const KEYWORD_STATUSES = ["active", "merged", "retired"] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

/** The projection every graph check reads; `$type` is the keyword type name. */
export const KEYWORD_GRAPH_PROJECTION = `{
  _id,
  keywordId,
  "categoryRef": category._ref,
  "parentRef": parent._ref,
  "titles": title[].value,
  aliases,
  status,
  visibility,
  "mergedIntoRef": mergedInto._ref
}`;
export const KEYWORD_GRAPH_QUERY = `*[_type == $type]${KEYWORD_GRAPH_PROJECTION}`;

/** Diacritics stay, because "Mäki" and "Maki" can be different people. */
export function keywordMatchKey(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** The id Studio proposes from a title. A collision is the editor's to resolve. */
export function proposeKeywordId(title: string): string | undefined {
  const proposal = keywordMatchKey(title)
    .replace(/[äå]/gu, "a")
    .replace(/ö/gu, "o")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, KEYWORD_ID_MAX_LENGTH)
    .replace(/-+$/u, "");
  return KEYWORD_ID_PATTERN.test(proposal) ? proposal : undefined;
}

/** A dot in the published id puts a document on a private path (ADR-0039 decision 7). */
export function isPrivateKeywordPath(id: string): boolean {
  return publishedIdOf(id).includes(".");
}

type KeywordRow = Readonly<{
  documentId: string;
  keywordId: string;
  categoryRef: string;
  parentRef: string | null;
  titleKeys: readonly string[];
  aliasKeys: readonly string[];
  status: KeywordStatus;
  visibility: string;
  mergedIntoRef: string | null;
}>;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reference(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.length > 0 ? publishedIdOf(value) : undefined;
}

function keys(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return undefined;
  const found: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    const key = keywordMatchKey(entry);
    if (key.length > 0) found.push(key);
  }
  return found;
}

function parseRow(raw: Readonly<Record<string, unknown>>): KeywordRow | undefined {
  const { _id, keywordId, categoryRef, status, visibility } = raw;
  const parentRef = reference(raw.parentRef), mergedIntoRef = reference(raw.mergedIntoRef);
  const titleKeys = keys(raw.titles), aliasKeys = keys(raw.aliases);
  if (
    typeof _id !== "string" || typeof keywordId !== "string" || !KEYWORD_ID_PATTERN.test(keywordId) ||
    typeof categoryRef !== "string" || parentRef === undefined || mergedIntoRef === undefined ||
    titleKeys === undefined || titleKeys.length === 0 || aliasKeys === undefined ||
    !KEYWORD_STATUSES.some((candidate) => candidate === status) || typeof visibility !== "string"
  ) return undefined;
  return {
    documentId: publishedIdOf(_id), keywordId, categoryRef: publishedIdOf(categoryRef), parentRef, titleKeys, aliasKeys,
    status: status as KeywordStatus, visibility, mergedIntoRef,
  };
}

/** The graph projection's shape, from a whole document being edited. */
function projectDocument(document: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const ref = (value: unknown) => (record(value) ? value._ref : value);
  const title = document.title;
  return {
    _id: document._id,
    keywordId: document.keywordId,
    categoryRef: ref(document.category),
    parentRef: ref(document.parent),
    titles: Array.isArray(title) ? title.map((entry: unknown) => (record(entry) ? entry.value : entry)) : title,
    aliases: document.aliases,
    status: document.status,
    visibility: document.visibility,
    mergedIntoRef: ref(document.mergedInto),
  };
}

/** Just what a published version binds, read leniently so a draft can repair a malformed one. */
type PublishedBinding = Readonly<{ keywordId: unknown; status: unknown; mergedIntoRef: string | null }>;

function graphOf(published: unknown, current: Readonly<Record<string, unknown>>) {
  if (!Array.isArray(published) || !published.every(record)) return "The content store returned a malformed keyword list.";
  const candidate = parseRow(projectDocument(current));
  if (candidate === undefined) return "Complete the keyword's identifier, title, category, status and visibility.";
  const rows: KeywordRow[] = [];
  let previous: PublishedBinding | undefined;
  for (const raw of published) {
    if (typeof raw._id === "string" && publishedIdOf(raw._id) === candidate.documentId) {
      previous = { keywordId: raw.keywordId, status: raw.status, mergedIntoRef: reference(raw.mergedIntoRef) ?? null };
      continue;
    }
    const row = parseRow(raw);
    if (row === undefined) return "A published keyword is malformed. Repair it before publishing another keyword.";
    rows.push(row);
  }
  const prospective = [...rows, candidate]
    .sort((a, b) => (a.keywordId < b.keywordId ? -1 : a.keywordId > b.keywordId ? 1 : 0));
  return { previous, candidate, prospective, byId: new Map(prospective.map((row) => [row.documentId, row])) };
}

function validateIdentityAndStatus(current: KeywordRow, previous: PublishedBinding | undefined): string | undefined {
  const expected = isPrivateKeywordPath(current.documentId) ? "internal" : "public";
  if (current.visibility !== expected) {
    return `This keyword's visibility must be "${expected}": it is fixed by where the document is stored.`;
  }
  if (typeof previous?.keywordId === "string" && previous.keywordId !== current.keywordId) {
    return `This keyword was published as "${previous.keywordId}". Changing a keyword ID breaks public URLs and cursors — create a new keyword instead.`;
  }
  if ((current.status === "merged") !== (current.mergedIntoRef !== null)) {
    return "A merged keyword needs a merge target, and only a merged keyword may have one.";
  }
  if (previous?.status === "merged" && (current.status !== "merged" || current.mergedIntoRef !== previous.mergedIntoRef)) {
    return "A published merge cannot be reversed or pointed elsewhere: its media may already belong to the target.";
  }
  return undefined;
}

function validateReferences(
  current: KeywordRow,
  previous: PublishedBinding | undefined,
  byId: ReadonlyMap<string, KeywordRow>,
): string | undefined {
  const isPublic = !isPrivateKeywordPath(current.documentId);
  if (isPrivateKeywordPath(current.categoryRef)) return "A keyword's category must be an ordinary public document.";
  if (current.parentRef !== null) {
    if (current.parentRef === current.documentId) return "A keyword cannot be its own parent.";
    if (isPublic && isPrivateKeywordPath(current.parentRef)) return "A public keyword cannot have an internal parent.";
    const parent = byId.get(current.parentRef);
    if (parent === undefined) return "The parent keyword must be published first.";
    if (current.status === "active" && parent.status !== "active") return "An active keyword needs an active parent.";
  }
  if (current.mergedIntoRef !== null) {
    if (current.mergedIntoRef === current.documentId) return "A keyword cannot be merged into itself.";
    if (isPublic && isPrivateKeywordPath(current.mergedIntoRef)) return "A public keyword cannot be merged into an internal keyword.";
    const target = byId.get(current.mergedIntoRef);
    if (target === undefined) return "The merge target must be a published keyword.";
    if (previous?.mergedIntoRef !== current.mergedIntoRef && target.status !== "active") return "The merge target must be an active keyword.";
  }
  return undefined;
}

function resolveOwner(row: KeywordRow, byId: ReadonlyMap<string, KeywordRow>): string | null {
  const visited = new Set<string>();
  let current: KeywordRow | undefined = row;
  while (current !== undefined && !visited.has(current.documentId)) {
    if (current.status === "active") return current.documentId;
    if (current.status !== "merged" || current.mergedIntoRef === null) return null;
    visited.add(current.documentId);
    current = byId.get(current.mergedIntoRef);
  }
  return null;
}

function validateStructure(rows: readonly KeywordRow[], byId: ReadonlyMap<string, KeywordRow>): string | undefined {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.keywordId)) return `More than one keyword document uses keyword ID "${row.keywordId}".`;
    ids.add(row.keywordId);
    let depth = 1;
    const visited = new Set([row.documentId]);
    for (let next = row.parentRef; next !== null; depth += 1) {
      if (visited.has(next)) return `Keyword "${row.keywordId}" belongs to a parent cycle.`;
      visited.add(next);
      const parent = byId.get(next);
      if (parent === undefined) break;
      next = parent.parentRef;
    }
    if (depth > MAX_KEYWORD_DEPTH) return `Keyword "${row.keywordId}" is deeper than the ${MAX_KEYWORD_DEPTH}-level limit.`;
  }
  for (const row of rows) {
    const visited = new Set<string>();
    for (let next: KeywordRow | undefined = row; next?.mergedIntoRef != null; next = byId.get(next.mergedIntoRef)) {
      if (visited.has(next.documentId)) return `Keyword "${row.keywordId}" belongs to a merge cycle.`;
      visited.add(next.documentId);
    }
    if (row.status === "active" && row.parentRef !== null && byId.get(row.parentRef)?.status !== "active" && byId.has(row.parentRef)) {
      return `Keyword "${byId.get(row.parentRef)!.keywordId}" still has active child "${row.keywordId}". Re-parent it first.`;
    }
  }
  return undefined;
}

function validateClaims(rows: readonly KeywordRow[], byId: ReadonlyMap<string, KeywordRow>): string | undefined {
  const ownerOf = new Map(rows.map((row) => [row.documentId, resolveOwner(row, byId)]));
  const idHolders = new Map(rows.map((row) => [row.keywordId, row]));
  const claims = new Map<string, { owner: string; keywordId: string }>();
  for (const row of rows) {
    const owner = ownerOf.get(row.documentId) ?? null;
    if (owner === null) continue;
    for (const key of [...row.titleKeys, ...row.aliasKeys]) {
      const holder = idHolders.get(key);
      if (holder !== undefined && holder.documentId !== row.documentId && holder.categoryRef === row.categoryRef && ownerOf.get(holder.documentId) !== owner) {
        return `The name "${key}" on keyword "${row.keywordId}" equals the ID of another keyword in its category.`;
      }
    }
    const terms = row.status === "merged" ? [...row.titleKeys, ...row.aliasKeys, row.keywordId] : [...row.titleKeys, ...row.aliasKeys];
    for (const key of terms) {
      const claim = `${row.categoryRef}\u0000${key}`;
      const existing = claims.get(claim);
      if (existing !== undefined && existing.owner !== owner) {
        return `Keywords "${existing.keywordId}" and "${row.keywordId}" both use the name "${key}" in one category.`;
      }
      claims.set(claim, { owner, keywordId: row.keywordId });
    }
  }
  return undefined;
}

/**
 * Whether publishing `current` over the published keywords leaves a valid taxonomy.
 * Studio asks while editing, and the publication action asks again for the exact
 * document it commits, under the taxonomy state's revision guard.
 */
export function validateProspectiveKeywordGraph(
  published: unknown,
  current: Readonly<Record<string, unknown>>,
): SchemaValidationResult {
  const graph = graphOf(published, current);
  if (typeof graph === "string") return graph;
  const { previous, candidate, prospective, byId } = graph;
  return validateIdentityAndStatus(candidate, previous) ??
    validateReferences(candidate, previous, byId) ??
    validateStructure(prospective, byId) ??
    validateClaims(prospective, byId) ??
    true;
}

/**
 * Decision 3's derived closure: the `keywordId` of every given keyword and every
 * ancestor, sorted so that re-deriving an unchanged medium writes nothing. The
 * import and the re-sync are its callers. An unknown or malformed row is an error,
 * because a partial closure would silently hide photographs from public results.
 */
export function deriveExpandedKeywordIds(keywordDocumentIds: readonly string[], published: readonly unknown[]): readonly string[] {
  const byId = new Map<string, KeywordRow>();
  for (const raw of published) {
    const row = record(raw) ? parseRow(raw) : undefined;
    if (row === undefined) throw new Error("A published keyword is malformed.");
    byId.set(row.documentId, row);
  }
  const expanded = new Set<string>();
  for (const documentId of keywordDocumentIds) {
    const visited = new Set<string>();
    for (let next: string | null = publishedIdOf(documentId); next !== null; next = byId.get(next)!.parentRef) {
      if (!byId.has(next) || visited.has(next)) throw new Error("A keyword's ancestors cannot be resolved.");
      visited.add(next);
      expanded.add(byId.get(next)!.keywordId);
    }
  }
  return [...expanded].sort();
}

export type KeywordPublicationEffects = Readonly<{
  /** Former titles' match keys the next import still has to map (decision 4, rename). */
  retainedAliases: readonly string[];
  /** A parent move, merge, retirement or reactivation changes closures (decision 3). */
  structural: boolean;
}>;

/** What publishing `next` over `previous` requires beyond writing the document itself. */
export function keywordPublicationEffects(
  previous: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>>,
): KeywordPublicationEffects {
  if (previous === undefined) return { retainedAliases: [], structural: false };
  const before = projectDocument(previous), after = projectDocument(next);
  const kept = new Set([...(keys(after.titles) ?? []), ...(keys(after.aliases) ?? [])]);
  const retainedAliases = [...new Set(keys(before.titles) ?? [])].filter((key) => !kept.has(key));
  const ref = (value: unknown) => (typeof value === "string" ? publishedIdOf(value) : null);
  return {
    retainedAliases,
    structural: ref(before.parentRef) !== ref(after.parentRef) || before.status !== after.status,
  };
}
