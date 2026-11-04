/**
 * Turning a `?keywords=` value into a canonical selection (ADR-0012 §3 and §8, with its
 * 2026-10-22 amendment). Pure: what it decides comes from one snapshot of the vocabulary,
 * the same snapshot whose version goes into the cursor, so a collapse can never be bound
 * to a newer hierarchy than the one it was computed from.
 *
 * Only `keywordId`s are URL tokens. A merged id resolves to its target, because a merge is
 * one-way (ADR-0039) and the old address should keep working. An alias or a title is simply
 * unknown here: they are unique per category, so a bare token could not resolve them.
 */

import "server-only";

import { expandKeywordIds, type PublicKeywordTaxonomy } from "@/lib/media-keywords";

export const MAX_SELECTED_KEYWORDS = 5;
/** A low multiple of the bound: collapsing only shrinks a list, so more than this buys nothing. */
export const MAX_RAW_KEYWORD_TOKENS = 15;

export type KeywordVocabularySnapshot = Readonly<{
  taxonomyVersion: number;
  taxonomy: PublicKeywordTaxonomy;
  /** `keywordId` of a public merge record → the `keywordId` it points at. */
  mergedInto: ReadonlyMap<string, string>;
}>;

export type KeywordSelection =
  /** Nothing selected: a normal landing state, not a failure. */
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "over-limit" }>
  | Readonly<{ state: "unknown-keyword" }>
  | Readonly<{
      state: "selection";
      canonicalIds: readonly string[];
      /** The value a canonical URL carries. A route redirects once when the request's differs. */
      canonicalParam: string;
      redirect: boolean;
    }>;

/** Parsing drops empty elements, which is why `redirect` compares the raw value afterwards. */
export function parseKeywordTokens(raw: string | null | undefined): readonly string[] {
  return (raw ?? "").split(",").map((token) => token.trim()).filter((token) => token.length > 0);
}

/** `undefined` for a token nothing public answers to. Corrupt merge data raises instead. */
function resolveToken(token: string, snapshot: KeywordVocabularySnapshot): string | undefined {
  const visited = new Set<string>();
  let current = token;
  while (!snapshot.taxonomy.byId.has(current)) {
    const next = snapshot.mergedInto.get(current);
    if (next === undefined) {
      // The token itself is unknown, or a chain ends at a retired or private keyword.
      return undefined;
    }
    if (visited.has(current)) throw new TypeError("the keyword merge records form a cycle");
    visited.add(current);
    current = next;
  }
  return current;
}

export function canonicalizeKeywordSelection(raw: string | null | undefined, snapshot: KeywordVocabularySnapshot): KeywordSelection {
  const tokens = parseKeywordTokens(raw);
  if (tokens.length === 0) return { state: "empty" };
  if (tokens.length > MAX_RAW_KEYWORD_TOKENS) return { state: "over-limit" };

  const resolved = new Set<string>();
  for (const token of tokens) {
    const keywordId = resolveToken(token, snapshot);
    if (keywordId === undefined) return { state: "unknown-keyword" };
    resolved.add(keywordId);
  }

  const redundant = new Set<string>();
  for (const keywordId of resolved) {
    for (const related of expandKeywordIds([keywordId], snapshot.taxonomy)) {
      if (related !== keywordId) redundant.add(related);
    }
  }
  const canonicalIds = [...resolved].filter((keywordId) => !redundant.has(keywordId)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (canonicalIds.length > MAX_SELECTED_KEYWORDS) return { state: "over-limit" };

  const canonicalParam = canonicalIds.join(",");
  return { state: "selection", canonicalIds, canonicalParam, redirect: raw !== canonicalParam };
}
