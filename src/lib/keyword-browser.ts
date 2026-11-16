/**
 * The public keyword index as a browsable tree (AB#75): categories, each holding its
 * keywords as a hierarchy. Pure. A keyword whose parent has no entry of its own, which
 * happens while a re-sync is outstanding, sits under its nearest listed ancestor rather
 * than disappearing. Nesting stays inside a category: the schema lets a parent be in
 * another one, and following it would file the keyword under the wrong heading.
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
  const byId = new Map(index.entries.map((entry) => [entry.keywordId, entry]));
  const childrenOf = new Map<string, KeywordIndexEntry[]>();
  const categories = new Map<string, { title: string; roots: KeywordIndexEntry[] }>();
  for (const entry of index.entries) {
    const category = categories.get(entry.categorySlug) ?? { title: entry.categoryTitle, roots: [] };
    categories.set(entry.categorySlug, category);
    const parent = [...entry.ancestorIds].reverse().find((ancestorId) => byId.get(ancestorId)?.categorySlug === entry.categorySlug);
    if (parent === undefined) category.roots.push(entry);
    else {
      const siblings = childrenOf.get(parent);
      if (siblings === undefined) childrenOf.set(parent, [entry]);
      else siblings.push(entry);
    }
  }
  const nodes = (entries: readonly KeywordIndexEntry[]): readonly KeywordBrowserNode[] =>
    [...entries]
      .sort((left, right) => collator.compare(left.title, right.title) || (left.keywordId < right.keywordId ? -1 : 1))
      .map((entry) => ({ entry, children: nodes(childrenOf.get(entry.keywordId) ?? []) }));

  return [...categories.entries()]
    .map(([slug, category]) => ({ slug, title: category.title, roots: nodes(category.roots) }));
}
