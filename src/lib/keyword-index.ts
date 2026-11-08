/**
 * The public keyword index (AB#59): vocabulary and public counts for one language, read by
 * the typeahead's bounded endpoint (AB#74) and the browsable index (AB#75). It stays on the
 * server, so aliases, which exist for import matching, never reach a browser wholesale.
 * See `docs/keyword-index.md` for the rules, the budget and the measurements.
 *
 * A count comes from the stored closure, the field a keyword gallery matches, so it cannot
 * disagree with the gallery it links to, even while a re-sync is outstanding.
 */

import "server-only";

import { expandKeywordIds, type PublicKeywordTaxonomy } from "@/lib/media-keywords";

/** Bump when the shape or the meaning of an entry changes. */
export const KEYWORD_INDEX_VERSION = 1;

/** Diacritics stay, because "Mäki" and "Maki" can be different people. The same key as the import. */
export function keywordIndexMatchKey(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export type KeywordIndexEntry = Readonly<{
  keywordId: string;
  title: string;
  /** Match keys, sorted, without repeats. For matching only; never shown. */
  aliasKeys: readonly string[];
  categorySlug: string;
  categoryTitle: string;
  /**
   * Parent chain from the root; excludes the keyword itself. From the live hierarchy, so an ancestor with
   * no eligible photograph has no entry of its own, and a reader must not assume every id here can be looked up.
   */
  ancestorIds: readonly string[];
  /** Eligible media whose stored closure holds this keyword. */
  count: number;
}>;

export type KeywordIndex = Readonly<{
  version: number;
  language: string;
  entries: readonly KeywordIndexEntry[];
}>;

export type KeywordIndexCategory = Readonly<{ title: string; order: number | null }>;

export type KeywordIndexInput = Readonly<{
  language: string;
  taxonomy: PublicKeywordTaxonomy;
  /** Every category a public keyword names, by slug. */
  categories: ReadonlyMap<string, KeywordIndexCategory>;
  aliases: ReadonlyMap<string, readonly string[]>;
  /** The stored `expandedKeywordIds` of each eligible medium. */
  closures: Iterable<readonly string[]>;
}>;

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Counts each medium once per keyword, even if its stored closure repeats an id. */
export function countKeywordMedia(closures: Iterable<readonly string[]>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const closure of closures) {
    for (const keywordId of new Set(closure)) counts.set(keywordId, (counts.get(keywordId) ?? 0) + 1);
  }
  return counts;
}

/**
 * A keyword nothing eligible carries is left out, because its gallery would be empty. A
 * private, merged or retired keyword never reaches the taxonomy, so a stale closure id that
 * names one counts for nothing. During a re-sync an ancestor can therefore lag its child.
 */
export function buildKeywordIndex({ language, taxonomy, categories, aliases, closures }: KeywordIndexInput): KeywordIndex {
  const counts = countKeywordMedia(closures);
  const entries = taxonomy.keywords.flatMap((keyword): KeywordIndexEntry[] => {
    const count = counts.get(keyword.keywordId) ?? 0;
    if (count === 0) return [];
    const category = categories.get(keyword.categorySlug);
    if (category === undefined) throw new TypeError(`keyword "${keyword.keywordId}" names an unknown category`);
    const lineage: string[] = [];
    for (let parent = keyword.parentKeywordId; parent !== null; parent = taxonomy.byId.get(parent)?.parentKeywordId ?? null) {
      lineage.unshift(parent);
    }
    // Validates the chain exactly as the taxonomy does, rather than trusting the walk above.
    expandKeywordIds([keyword.keywordId], taxonomy);
    return [{
      keywordId: keyword.keywordId,
      title: keyword.title,
      aliasKeys: [...new Set((aliases.get(keyword.keywordId) ?? []).map(keywordIndexMatchKey).filter((key) => key !== ""))].sort(compareText),
      categorySlug: keyword.categorySlug,
      categoryTitle: category.title,
      ancestorIds: lineage,
      count,
    }];
  });
  const orderOf = (entry: KeywordIndexEntry) => categories.get(entry.categorySlug)?.order ?? Number.POSITIVE_INFINITY;
  return {
    version: KEYWORD_INDEX_VERSION,
    language,
    entries: [...entries].sort((left, right) =>
      orderOf(left) - orderOf(right) || compareText(left.categorySlug, right.categorySlug) || compareText(left.keywordId, right.keywordId)),
  };
}
