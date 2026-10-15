/**
 * The pure core of the site search (ADR-0033): what a query *is*, which
 * records it matches, how they rank, and which parts of a text to highlight.
 *
 * Nothing here reads a request, the CMS, or the clock, so the dialog (which
 * highlights in the browser), the API route, the no-JavaScript results page, and
 * the mock and Sanity sources all run the identical matcher.
 *
 * Why not Sanity's `match`: a literal array on its left requires every pattern
 * to hit a *single* string, so "rally finland" could miss a page with one word
 * in the title and the other in the lead, and it folds case but not
 * diacritics. The semantics below are the ones a visitor expects instead:
 * **every query token must start some word in some searched field** — AND
 * between tokens, OR between fields.
 *
 * Visitor input is data, never syntax. Wildcards, quotes, and minus signs are
 * word separators like any other punctuation, and a query with no usable token
 * matches nothing (never "everything", which is what an empty `text::query` or
 * a bare `*` does in GROQ).
 */

/** Longest query considered; the remainder is dropped, never an error. */
export const SEARCH_MAX_QUERY_CHARACTERS = 100;
/** Most distinct tokens used; later ones are ignored. */
export const SEARCH_MAX_TOKENS = 8;
/** Shortest token that can narrow a result (single letters match too much). */
export const SEARCH_MIN_TOKEN_CHARACTERS = 2;

/**
 * Weights of the searched fields. A token's contribution is the weight of the
 * best field it matches, so a title hit outranks a lead hit without a page
 * gaining rank for repeating a word.
 */
export const SEARCH_FIELD_WEIGHTS = {
  title: 3,
  tags: 2,
  summary: 1,
} as const;

export type SearchField = keyof typeof SEARCH_FIELD_WEIGHTS;

export type SearchQuery = {
  /** The accepted text: truncated, trimmed, whitespace collapsed. Display only. */
  readonly text: string;
  /** Folded, distinct tokens in input order. Empty means "no search". */
  readonly tokens: readonly string[];
};

/** A piece of text and whether it should be highlighted. */
export type HighlightSegment = {
  readonly text: string;
  readonly match: boolean;
};

const WORD = /[\p{L}\p{N}]+/gu;
const COMBINING_MARKS = /\p{M}+/gu;

function characterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Folds text for comparison only: decomposed, stripped of combining marks, and
 * lowercased — so `Grönholm` and `gronholm` compare equal. Deliberately by base
 * letter: a visitor on an English keyboard types `a` for `ä`, and a catalogue
 * this small makes the occasional extra result cheaper than a missed one.
 * `toLowerCase()` is used without a locale so Turkish dotted/dotless I rules
 * never apply.
 */
export function foldSearchText(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/** The folded words of a text, in order, of any length. */
export function searchWords(text: string): readonly string[] {
  return foldSearchText(text).match(WORD) ?? [];
}

/**
 * Turns whatever a request carried into a bounded query. Never throws: a value
 * that is not a string, or has no usable token, becomes an empty query.
 */
export function parseSearchQuery(raw: unknown): SearchQuery {
  if (typeof raw !== "string") return { text: "", tokens: [] };

  const truncated = Array.from(raw).slice(0, SEARCH_MAX_QUERY_CHARACTERS).join("");
  const text = truncated.normalize("NFC").replace(/\s+/gu, " ").trim();

  const tokens: string[] = [];
  for (const word of searchWords(text)) {
    if (characterCount(word) < SEARCH_MIN_TOKEN_CHARACTERS) continue;
    if (tokens.includes(word)) continue;
    tokens.push(word);
    if (tokens.length === SEARCH_MAX_TOKENS) break;
  }
  return { text, tokens };
}

/** The text of each searched field of one record. A missing field is simply absent. */
export type SearchableFields = Partial<Record<SearchField, string>>;

/**
 * The record's score for a query, or `undefined` when it does not match.
 *
 * A query with no tokens matches nothing. Otherwise every token must be a
 * prefix of at least one word in at least one field, and the score is the sum,
 * over tokens, of the weight of the best field that token matched.
 */
export function scoreSearchFields(
  tokens: readonly string[],
  fields: SearchableFields,
): number | undefined {
  if (tokens.length === 0) return undefined;

  const words = (Object.keys(SEARCH_FIELD_WEIGHTS) as SearchField[]).flatMap(
    (field) => {
      const text = fields[field];
      return text === undefined
        ? []
        : [{ weight: SEARCH_FIELD_WEIGHTS[field], words: searchWords(text) }];
    },
  );

  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of words) {
      if (field.weight > best && field.words.some((word) => word.startsWith(token))) {
        best = field.weight;
      }
    }
    if (best === 0) return undefined;
    score += best;
  }
  return score;
}

/**
 * Splits `text` into plain and highlighted segments. A word is highlighted
 * whole when it starts with any token, so no offset has to survive the
 * diacritic fold. The concatenation of the segments is always `text`
 * normalized to NFC, and the result is made of strings only: callers render
 * them as text nodes, never as markup.
 */
export function highlightSegments(
  text: string,
  tokens: readonly string[],
): readonly HighlightSegment[] {
  const source = text.normalize("NFC");
  if (tokens.length === 0) return source === "" ? [] : [{ text: source, match: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  const push = (piece: string, match: boolean) => {
    if (piece === "") return;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.match === match) {
      segments[segments.length - 1] = { text: last.text + piece, match };
    } else {
      segments.push({ text: piece, match });
    }
  };

  for (const found of source.matchAll(WORD)) {
    const start = found.index;
    const word = found[0];
    push(source.slice(cursor, start), false);
    const folded = foldSearchText(word);
    push(word, tokens.some((token) => folded.startsWith(token)));
    cursor = start + word.length;
  }
  push(source.slice(cursor), false);
  return segments;
}

/** What a request to the search route is asking for (ADR-0033 §1). */
export type SearchRequest =
  /** A non-empty `keywords` selection: ADR-0012's mode. `q` is ignored. */
  | { readonly mode: "keywords"; readonly keywords: readonly string[]; readonly raw: string }
  /** Anything else: text search, or the empty landing state when `q` is unusable. */
  | { readonly mode: "text"; readonly rawQuery: string | undefined };

type RequestParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function firstValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

/**
 * Decides the mode from the query string, once, in the order ADR-0033 §1
 * fixes: `keywords` parsed exactly as ADR-0012 §8 does (first occurrence, split
 * on commas, trimmed, empty elements dropped) wins whenever at least one element
 * remains; otherwise the first `q` is the text query. Repeated parameters beyond
 * the first, and every other parameter, are ignored.
 */
export function readSearchRequest(params: RequestParams): SearchRequest {
  const raw = firstValue(params.keywords);
  const keywords = (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (raw !== undefined && keywords.length > 0) {
    return { mode: "keywords", keywords, raw };
  }
  return { mode: "text", rawQuery: firstValue(params.q) };
}
