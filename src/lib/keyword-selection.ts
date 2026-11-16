/**
 * A visitor's keyword selection in the browser (AB#74). Pure and client-safe. It only helps
 * the visitor build a good address: the server canonicalizes and validates whatever arrives,
 * so nothing here can bypass ADR-0012's rules or any visibility policy.
 */

export const MAX_SELECTED_KEYWORDS = 5;

export type KeywordSuggestion = Readonly<{
  keywordId: string;
  title: string;
  categoryTitle: string;
  /** From the root; excludes the keyword itself. */
  ancestorIds: readonly string[];
  count: number;
}>;

export type KeywordAddition =
  | Readonly<{ outcome: "added"; selected: readonly KeywordSuggestion[]; replaced: readonly KeywordSuggestion[] }>
  /** Already chosen, or an ancestor of something chosen, which already matches through it. */
  | Readonly<{ outcome: "already-covered"; selected: readonly KeywordSuggestion[] }>
  | Readonly<{ outcome: "limit-reached"; selected: readonly KeywordSuggestion[] }>;

/**
 * A descendant replaces its selected ancestor, because under AND the ancestor adds nothing.
 * The replaced ancestor is forgotten, so removing the descendant later does not restore it.
 */
export function addKeyword(selected: readonly KeywordSuggestion[], next: KeywordSuggestion): KeywordAddition {
  if (selected.some((entry) => entry.keywordId === next.keywordId || entry.ancestorIds.includes(next.keywordId))) {
    return { outcome: "already-covered", selected };
  }
  const replaced = selected.filter((entry) => next.ancestorIds.includes(entry.keywordId));
  const kept = selected.filter((entry) => !next.ancestorIds.includes(entry.keywordId));
  if (kept.length >= MAX_SELECTED_KEYWORDS) return { outcome: "limit-reached", selected };
  return { outcome: "added", selected: [...kept, next], replaced };
}

export function removeKeyword(selected: readonly KeywordSuggestion[], keywordId: string): readonly KeywordSuggestion[] {
  return selected.filter((entry) => entry.keywordId !== keywordId);
}

/** The sorted, literal-comma form a canonical address holds (ADR-0012 §3 and §8). */
export function keywordSelectionHref(searchPath: string, selected: readonly KeywordSuggestion[]): string {
  const ids = selected.map((entry) => entry.keywordId).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${searchPath}?keywords=${ids.join(",")}`;
}
