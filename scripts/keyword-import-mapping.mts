/**
 * AB#57 / ADR-0039 decisions 2 and 5: one medium's Lightroom keywords mapped to the
 * controlled vocabulary. Pure, deterministic and write-free; AB#69 writes the result and
 * AB#70 resolves its review items. Nothing is ever created here: a term that does not
 * resolve to exactly one keyword is returned for review.
 *
 * Scripts run on plain Node and cannot import `sanity/schemas`, whose imports have no file
 * extensions. Row validation, `keywordMatchKey` and the closure are therefore pinned copies, and
 * `keyword-import-mapping.test.mts` holds them to `sanity/schemas/keyword-rules.ts`.
 */

export class KeywordImportError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`[keyword-import] ${code}`);
    this.name = "KeywordImportError";
    this.code = code;
  }
}

/** Diacritics stay, because "Mäki" and "Maki" can be different people. */
export function keywordMatchKey(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** The raw fields of one file, kept separately for audit. A missing field is `null`. */
export type ImportedKeywords = Readonly<{
  dcSubject: readonly string[] | null;
  iptcKeywords: readonly string[] | null;
  hierarchicalSubject: readonly string[] | null;
  weightedFlatSubject: readonly string[] | null;
}>;

export const NO_IMPORTED_KEYWORDS: ImportedKeywords = { dcSubject: null, iptcKeywords: null, hierarchicalSubject: null, weightedFlatSubject: null };

export type KeywordOverrides = Readonly<{ added: readonly string[]; removed: readonly string[] }>;

export type KeywordReviewReason =
  /** No keyword holds this term. */
  | "unmatched"
  /** No keyword holds this term, in a file that has paths. It is often a Lightroom synonym, but nothing proves that. */
  | "unmatched-beside-paths"
  /** The term resolves to more than one keyword. */
  | "ambiguous"
  /** The leaf exists, but no keyword with that name has this path. */
  | "path-mismatch"
  /** A path with an empty component. It is not repaired, because that would change its structure. */
  | "malformed-path";

export type KeywordReviewItem = Readonly<{
  reason: KeywordReviewReason;
  key: string;
  /** Every raw form that led here, for the reviewer. */
  terms: readonly string[];
  /** Keywords the reviewer can choose from. */
  candidates: readonly string[];
  /** The top-level term of a path with at least two levels proposes a category (decision 5). */
  proposedCategoryTerm: string | null;
}>;

export type ConsumedTerm = Readonly<{
  key: string;
  terms: readonly string[];
  /** Exactly one explains the term: the keyword it is covered by, or the unresolved path that retains it. */
  coveredByKeyword: string | null;
  coveredByReviewPath: string | null;
}>;

export type KeywordImportProposal = Readonly<{
  raw: ImportedKeywords;
  /** `keywordId`s the import itself resolved to, before overrides. */
  mapped: readonly string[];
  review: readonly KeywordReviewItem[];
  consumed: readonly ConsumedTerm[];
  /** Canonicalized through merge chains. A retired keyword stays here as a dormant decision. */
  overrides: KeywordOverrides;
  /** Document ids for the medium's `keywords`. */
  keywords: readonly string[];
  /** Document ids for the private record's `internalKeywords`. */
  internalKeywords: readonly string[];
  expandedKeywordIds: readonly string[];
}>;

type Row = Readonly<{
  documentId: string;
  keywordId: string;
  parentRef: string | null;
  mergedIntoRef: string | null;
  status: "active" | "merged" | "retired";
  visibility: "public" | "internal";
  /** Titles and aliases. */
  names: ReadonlySet<string>;
}>;

const stringList = (value: unknown): readonly string[] | undefined =>
  value === null || value === undefined ? [] : Array.isArray(value) && [...value].every((entry) => typeof entry === "string") ? value : undefined;
const refOf = (value: unknown): string | null | undefined =>
  value === null || value === undefined ? null : typeof value === "string" && value.length > 0 ? value : undefined;
const KEYWORD_ID_PATTERN = /^(?=.{2,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseRow(raw: unknown): Row {
  const row = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const { _id, keywordId, categoryRef, status, visibility } = row;
  const titles = stringList(row.titles), aliases = stringList(row.aliases);
  const parentRef = refOf(row.parentRef), mergedIntoRef = refOf(row.mergedIntoRef);
  if (typeof _id !== "string" || typeof keywordId !== "string" || !KEYWORD_ID_PATTERN.test(keywordId) ||
      typeof categoryRef !== "string" || titles === undefined || !titles.some((title) => keywordMatchKey(title).length > 0) || aliases === undefined ||
      parentRef === undefined || mergedIntoRef === undefined ||
      (status !== "active" && status !== "merged" && status !== "retired") ||
      (visibility !== "public" && visibility !== "internal") ||
      // Decision 7 fixes visibility by storage path: even a reference to a private document can reveal a name.
      _id.includes(".") !== (visibility === "internal")) {
    throw new KeywordImportError("VOCABULARY_MALFORMED");
  }
  return { documentId: _id, keywordId, parentRef, mergedIntoRef, status, visibility, names: new Set([...titles, ...aliases].map(keywordMatchKey)) };
}

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

class Vocabulary {
  readonly #byId: ReadonlyMap<string, Row>;
  /** Match key → rows that claim it. A merge record also claims its own `keywordId`. */
  readonly #claims = new Map<string, Row[]>();

  constructor(published: readonly unknown[]) {
    const rows = published.map(parseRow);
    this.#byId = new Map(rows.map((row) => [row.documentId, row]));
    for (const row of rows) {
      if (this.activeEnd(row) === null) continue;
      const keys = row.status === "merged" ? [...row.names, keywordMatchKey(row.keywordId)] : row.names;
      for (const key of new Set(keys)) this.#claims.set(key, [...(this.#claims.get(key) ?? []), row]);
    }
  }

  row(documentId: string): Row {
    const row = this.#byId.get(documentId);
    if (row === undefined) throw new KeywordImportError("VOCABULARY_REFERENCE_UNKNOWN");
    return row;
  }

  known(documentId: string): Row | undefined {
    return this.#byId.get(documentId);
  }

  /** The end of a merge chain, whatever its status: a retired end is a dormant decision. */
  end(row: Row): Row {
    const visited = new Set<string>();
    let current = row;
    while (current.status === "merged") {
      if (visited.has(current.documentId) || current.mergedIntoRef === null) throw new KeywordImportError("VOCABULARY_MERGE_INVALID");
      visited.add(current.documentId);
      current = this.row(current.mergedIntoRef);
    }
    return current;
  }

  /** A retired keyword, or a chain ending at one, claims no term (ADR-0039 amendment 2026-11-04). */
  activeEnd(row: Row): Row | null {
    if (row.status === "retired") return null;
    const end = this.end(row);
    return end.status === "active" ? end : null;
  }

  claimants(key: string): readonly Row[] {
    return this.#claims.get(key) ?? [];
  }

  /** Whether a row's own parents, from the nearest upwards, are exactly these terms, ending at a root. */
  hasLineage(row: Row, upperKeysFromRoot: readonly string[]): boolean {
    let current = row;
    for (let index = upperKeysFromRoot.length - 1; index >= 0; index--) {
      if (current.parentRef === null) return false;
      const parent = this.#byId.get(current.parentRef);
      if (parent === undefined || !parent.names.has(upperKeysFromRoot[index])) return false;
      current = parent;
    }
    return current.parentRef === null;
  }

  /** The closure from the row upwards, as rows. Throws on anything a public result could not trust. */
  lineage(row: Row): readonly Row[] {
    const visited = new Set<string>(), rows: Row[] = [];
    for (let current: Row | undefined = row; current !== undefined; current = current.parentRef === null ? undefined : this.row(current.parentRef)) {
      if (visited.has(current.documentId)) throw new KeywordImportError("VOCABULARY_PARENT_CYCLE");
      visited.add(current.documentId);
      rows.push(current);
    }
    return rows;
  }
}

type Resolution = Readonly<{ ends: readonly Row[] }>;

function resolveFlat(vocabulary: Vocabulary, key: string): Resolution {
  const ends = new Map<string, Row>();
  for (const row of vocabulary.claimants(key)) {
    const end = vocabulary.activeEnd(row);
    if (end !== null) ends.set(end.documentId, end);
  }
  return { ends: [...ends.values()] };
}

type TermDecisions = ReadonlyMap<string, string> | undefined;

/** A choice only narrows what the vocabulary offers now, so a keyword changed since cannot be forced on a photograph. */
function narrowByDecision(vocabulary: Vocabulary, claimed: readonly Row[], key: string, decisions: TermDecisions): readonly Row[] {
  const decision = decisions?.get(key);
  const row = decision === undefined ? undefined : vocabulary.known(decision);
  const decided = row === undefined ? undefined : claimed.find((end) => end.documentId === vocabulary.end(row).documentId);
  return decided === undefined ? claimed : [decided];
}

type PathComponents = Readonly<{ raw: string; keys: readonly string[]; malformed: boolean }>;

function parsePath(raw: string): PathComponents {
  const keys = raw.split("|").map(keywordMatchKey);
  return { raw, keys, malformed: keys.some((key) => key === "") };
}

/**
 * The source record's own path counts as well as its target's: an old path names a merge
 * record. A one-level path says nothing about the site's hierarchy, because a term without
 * parents in Lightroom may have one here, so it resolves like a flat term.
 */
function resolvePath(vocabulary: Vocabulary, path: PathComponents, decisions: TermDecisions): { ends: readonly Row[]; leafEnds: readonly Row[]; decided?: boolean } {
  if (path.keys.length === 1) {
    const ends = narrowByDecision(vocabulary, resolveFlat(vocabulary, path.keys[0]).ends, path.keys[0], decisions);
    return { ends, leafEnds: ends };
  }
  // An editor's decision about this exact path (AB#70). A whole path can hold a client's or a
  // person's name, so it is kept in the private decisions and never becomes a public alias.
  const decision = decisions?.get(path.keys.join("|"));
  const decidedRow = decision === undefined ? undefined : vocabulary.known(decision);
  const decidedEnd = decidedRow === undefined ? null : vocabulary.activeEnd(decidedRow);
  if (decidedEnd !== null) return { ends: [decidedEnd], leafEnds: [decidedEnd], decided: true };
  const leaf = path.keys[path.keys.length - 1], upper = path.keys.slice(0, -1);
  const matches = new Map<string, Row>(), leafEnds = new Map<string, Row>();
  for (const row of vocabulary.claimants(leaf)) {
    const end = vocabulary.activeEnd(row);
    if (end === null) continue;
    leafEnds.set(end.documentId, end);
    if (vocabulary.hasLineage(row, upper) || vocabulary.hasLineage(end, upper)) matches.set(end.documentId, end);
  }
  return { ends: [...matches.values()], leafEnds: [...leafEnds.values()] };
}

function canonicalOverrides(vocabulary: Vocabulary, overrides: KeywordOverrides): KeywordOverrides {
  const canonical = (ids: readonly string[]) => new Set(ids.map((id) => vocabulary.end(vocabulary.row(id)).documentId));
  const removed = canonical(overrides.removed), added = canonical(overrides.added);
  for (const id of removed) added.delete(id);
  return { added: sorted(added), removed: sorted(removed) };
}

function flatTerms(raw: ImportedKeywords): ReadonlyMap<string, readonly string[]> {
  const terms = new Map<string, string[]>();
  for (const term of [...(raw.dcSubject ?? []), ...(raw.iptcKeywords ?? []), ...(raw.weightedFlatSubject ?? [])]) {
    const key = keywordMatchKey(term);
    if (key !== "") terms.set(key, [...(terms.get(key) ?? []), term]);
  }
  return terms;
}

class ReviewCollector {
  readonly #items = new Map<string, { reason: KeywordReviewReason; key: string; terms: Set<string>; candidates: Set<string>; proposedCategoryTerm: string | null }>();

  add(reason: KeywordReviewReason, key: string, terms: readonly string[], candidates: readonly Row[], proposedCategoryTerm: string | null): void {
    const id = `${reason}\u0000${key}`;
    const item = this.#items.get(id) ?? { reason, key, terms: new Set<string>(), candidates: new Set<string>(), proposedCategoryTerm };
    for (const term of terms) item.terms.add(term);
    for (const candidate of candidates) item.candidates.add(candidate.keywordId);
    this.#items.set(id, item);
  }

  items(): readonly KeywordReviewItem[] {
    return [...this.#items.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, item]) => ({ reason: item.reason, key: item.key, terms: sorted(item.terms), candidates: sorted(item.candidates), proposedCategoryTerm: item.proposedCategoryTerm }));
  }
}

/**
 * The same arguments always give a deep-equal result, so running an import twice writes
 * nothing new. `published` is the keyword graph as `KEYWORD_GRAPH_PROJECTION` reads it.
 */
export function mapImportedKeywords(
  raw: ImportedKeywords,
  published: readonly unknown[],
  overrides: KeywordOverrides,
  /** What the medium holds now. A keyword the site has moved keeps its assignment while its old path goes to review. */
  options: Readonly<{
    currentKeywords?: readonly string[];
    /** An editor's choice for a path, or for a flat term several keywords answer to (AB#70): match key → document id. */
    termDecisions?: ReadonlyMap<string, string>;
  }> = {},
): KeywordImportProposal {
  const vocabulary = new Vocabulary(published);
  const held = new Set((options.currentKeywords ?? []).flatMap((id) => {
    const row = vocabulary.known(id);
    return row === undefined ? [] : [vocabulary.end(row).documentId];
  }));
  const review = new ReviewCollector();
  const mapped = new Map<string, Row>();
  /** Every path component → what explains it, for the flat fields that repeat it. */
  const components = new Map<string, { keyword: Row | null; reviewPath: string | null }>();
  const remember = (key: string, keyword: Row | null, reviewPath: string | null) => {
    const known = components.get(key);
    if (known === undefined || (known.keyword === null && keyword !== null)) components.set(key, { keyword, reviewPath });
  };

  const paths = raw.hierarchicalSubject ?? [];
  const pathForms = new Map<string, string[]>();
  for (const text of paths) {
    const pathKey = parsePath(text).keys.join("|");
    pathForms.set(pathKey, [...(pathForms.get(pathKey) ?? []), text]);
  }
  for (const pathKey of sorted(pathForms.keys())) {
    const rawForms = pathForms.get(pathKey)!, path = parsePath(rawForms[0]);
    const category = path.keys.length >= 2 ? path.raw.split("|")[0].trim() : null;
    if (path.malformed) {
      review.add("malformed-path", pathKey, rawForms, [], null);
    } else {
      const { ends, leafEnds, decided } = resolvePath(vocabulary, path, options.termDecisions);
      if (ends.length === 1) {
        mapped.set(ends[0].documentId, ends[0]);
        // A decision names the leaf only, so the path's other terms still resolve for themselves.
        for (const key of decided === true ? path.keys.slice(-1) : path.keys) remember(key, ends[0], null);
        continue;
      }
      if (ends.length > 1) review.add("ambiguous", pathKey, rawForms, ends, category);
      else {
        review.add(leafEnds.length > 0 ? "path-mismatch" : "unmatched", pathKey, rawForms, leafEnds, category);
        for (const leaf of leafEnds) if (held.has(leaf.documentId)) mapped.set(leaf.documentId, leaf);
      }
    }
    for (const key of path.keys) if (key !== "") remember(key, null, pathKey);
  }

  const consumed: ConsumedTerm[] = [];
  const hasPaths = paths.length > 0;
  // Only what the paths mapped: a flat term must not depend on the order of the other flat terms.
  const leaves = [...mapped.values()];
  const covering = (end: Row) => leaves.find((leaf) => vocabulary.lineage(leaf).some((row) => row.documentId === end.documentId)) ?? null;
  const flat = flatTerms(raw);
  for (const key of sorted(flat.keys())) {
    const terms = flat.get(key)!;
    const component = components.get(key);
    if (component !== undefined) {
      consumed.push({ key, terms: sorted(new Set(terms)), coveredByKeyword: component.keyword?.keywordId ?? null, coveredByReviewPath: component.reviewPath });
      continue;
    }
    const ends = narrowByDecision(vocabulary, resolveFlat(vocabulary, key).ends, key, options.termDecisions);
    const leaf = ends.length === 1 ? covering(ends[0]) : null;
    if (leaf !== null) {
      consumed.push({ key, terms: sorted(new Set(terms)), coveredByKeyword: leaf.keywordId, coveredByReviewPath: null });
    } else if (ends.length === 1) {
      mapped.set(ends[0].documentId, ends[0]);
    } else if (ends.length > 1) {
      review.add("ambiguous", key, terms, ends, null);
    } else {
      review.add(hasPaths ? "unmatched-beside-paths" : "unmatched", key, terms, [], null);
    }
  }

  const canonical = canonicalOverrides(vocabulary, overrides);
  const removed = new Set(canonical.removed);
  const effective = [...new Set([...mapped.keys(), ...canonical.added])]
    .filter((id) => !removed.has(id))
    .map((id) => vocabulary.row(id))
    .filter((row) => row.status === "active");
  const publicRows = effective.filter((row) => row.visibility === "public");
  const expanded = new Set<string>();
  for (const row of publicRows) {
    for (const ancestor of vocabulary.lineage(row)) {
      // Decision 7: a public document never references a private one.
      if (ancestor.visibility !== "public") throw new KeywordImportError("VOCABULARY_PRIVATE_ANCESTOR");
      expanded.add(ancestor.keywordId);
    }
  }
  return {
    raw,
    mapped: sorted([...mapped.values()].map((row) => row.keywordId)),
    review: review.items(),
    consumed,
    overrides: canonical,
    keywords: sorted(publicRows.map((row) => row.documentId)),
    internalKeywords: sorted(effective.filter((row) => row.visibility === "internal").map((row) => row.documentId)),
    expandedKeywordIds: sorted(expanded),
  };
}

const FIELD_NAMES = {
  dcSubject: "XMP-dc:Subject",
  iptcKeywords: "IPTC:Keywords",
  hierarchicalSubject: "XMP-lr:HierarchicalSubject",
  weightedFlatSubject: "XMP-lr:WeightedFlatSubject",
} as const;

/** ExifTool reports a keyword like `2024` as a number. */
function fieldValues(value: unknown): readonly string[] | null {
  if (value === undefined) return null;
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => {
    if (typeof entry === "string") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
    throw new KeywordImportError("FIELD_MALFORMED");
  });
}

/**
 * Reads ExifTool's `-G1` output for one file. A missing field is `null`, and a file with no
 * keywords is a real result. A failed read must throw before reaching this function, because
 * mapping it as "no keywords" would remove every imported keyword on the next write.
 */
export function importedKeywordsFromFields(fields: Readonly<Record<string, unknown>>): ImportedKeywords {
  return {
    dcSubject: fieldValues(fields[FIELD_NAMES.dcSubject]),
    iptcKeywords: fieldValues(fields[FIELD_NAMES.iptcKeywords]),
    hierarchicalSubject: fieldValues(fields[FIELD_NAMES.hierarchicalSubject]),
    weightedFlatSubject: fieldValues(fields[FIELD_NAMES.weightedFlatSubject]),
  };
}
