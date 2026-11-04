/**
 * Bounded keyword suggestions from the server-side index (AB#74). A browser asks for a few
 * and never receives the vocabulary, and an alias is used to match but never returned.
 */

import "server-only";

import { keywordIndexMatchKey, type KeywordIndex, type KeywordIndexEntry } from "@/lib/keyword-index";
import type { KeywordSuggestion } from "@/lib/keyword-selection";

export const KEYWORD_SUGGESTION_LIMIT = 8;
export const KEYWORD_QUERY_MIN_CHARACTERS = 2;
export const KEYWORD_QUERY_MAX_CHARACTERS = 100;

const wordStartsWith = (text: string, key: string): boolean => text.split(" ").some((word) => word.startsWith(key));

/** Lower is better: the title's start, a word in the title, then an alias. `undefined` is no match. */
function rank(entry: KeywordIndexEntry, key: string): number | undefined {
  const title = keywordIndexMatchKey(entry.title);
  if (title.startsWith(key)) return 0;
  if (wordStartsWith(title, key)) return 1;
  if (entry.aliasKeys.some((alias) => alias.startsWith(key))) return 2;
  if (entry.aliasKeys.some((alias) => wordStartsWith(alias, key))) return 3;
  return undefined;
}

/** Characters are counted after normalization, so spacing alone cannot make a query usable. */
export function suggestKeywords(index: KeywordIndex, rawQuery: string, limit = KEYWORD_SUGGESTION_LIMIT): readonly KeywordSuggestion[] {
  const key = keywordIndexMatchKey(rawQuery);
  const length = [...key].length;
  if (length < KEYWORD_QUERY_MIN_CHARACTERS || length > KEYWORD_QUERY_MAX_CHARACTERS) return [];
  const collator = new Intl.Collator(index.language);
  return index.entries
    .flatMap((entry) => {
      const score = rank(entry, key);
      return score === undefined ? [] : [{ entry, score }];
    })
    .sort((left, right) =>
      left.score - right.score || right.entry.count - left.entry.count || collator.compare(left.entry.title, right.entry.title) ||
      (left.entry.keywordId < right.entry.keywordId ? -1 : 1))
    .slice(0, limit)
    .map(({ entry }) => ({
      keywordId: entry.keywordId,
      title: entry.title,
      categoryTitle: entry.categoryTitle,
      ancestorIds: entry.ancestorIds,
      count: entry.count,
    }));
}
