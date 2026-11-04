/**
 * The public keyword index as a browsable tree (AB#75): categories, each holding its
 * keywords as a hierarchy. Pure. A keyword whose parent has no entry of its own, which
 * happens while a re-sync is outstanding, sits under its nearest listed ancestor rather
 * than disappearing.
 */

import "server-only";

import type { KeywordIndex, KeywordIndexEntry } from "@/lib/keyword-index";

export type KeywordBrowserNode = Readonly<{
  entry: KeywordIndexEntry;
  children: readonly KeywordBrowserNode[];
}>;

export type KeywordBrowserCategory = Readonly<{
  slug: string;
  title: string;
  roots: readonly KeywordBrowserNode[];
}>;

/** Categories keep the index's order; keywords read alphabetically in the page's language. */
export function buildKeywordBrowserTree(index: KeywordIndex): readonly KeywordBrowserCategory[] {
  const collator = new Intl.Collator(index.language);
  const listed = new Set(index.entries.map((entry) => entry.keywordId));
  const childrenOf = new Map<string | null, KeywordIndexEntry[]>();
  for (const entry of index.entries) {
    const parent = [...entry.ancestorIds].reverse().find((ancestorId) => listed.has(ancestorId)) ?? null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), entry]);
  }
  const nodes = (entries: readonly KeywordIndexEntry[]): readonly KeywordBrowserNode[] =>
    [...entries]
      .sort((left, right) => collator.compare(left.title, right.title) || (left.keywordId < right.keywordId ? -1 : 1))
      .map((entry) => ({ entry, children: nodes(childrenOf.get(entry.keywordId) ?? []) }));

  const categories = new Map<string, { title: string; roots: KeywordIndexEntry[] }>();
  for (const entry of index.entries) {
    const category = categories.get(entry.categorySlug) ?? { title: entry.categoryTitle, roots: [] };
    if ((childrenOf.get(null) ?? []).includes(entry)) category.roots.push(entry);
    categories.set(entry.categorySlug, category);
  }
  return [...categories.entries()]
    .filter(([, category]) => category.roots.length > 0)
    .map(([slug, category]) => ({ slug, title: category.title, roots: nodes(category.roots) }));
}
