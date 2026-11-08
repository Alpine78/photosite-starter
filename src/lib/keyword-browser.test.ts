import { describe, expect, it } from "vitest";

import { buildKeywordBrowserTree } from "@/lib/keyword-browser";
import type { KeywordIndex, KeywordIndexEntry } from "@/lib/keyword-index";
import { getMockKeywordIndex } from "@/lib/mock-keyword-gallery";

const entry = (keywordId: string, ancestorIds: readonly string[] = [], categorySlug = "subject", title = keywordId): KeywordIndexEntry => ({
  keywordId, title, aliasKeys: [], categorySlug, categoryTitle: categorySlug.toUpperCase(), ancestorIds, count: 1,
});
const index = (entries: readonly KeywordIndexEntry[], language = "en"): KeywordIndex => ({ version: 1, language, entries });
const shape = (categories: ReturnType<typeof buildKeywordBrowserTree>) => categories.map((category) => ({
  slug: category.slug,
  roots: category.roots.map(function node(item): unknown {
    return item.children.length === 0 ? item.entry.keywordId : { [item.entry.keywordId]: item.children.map(node) };
  }),
}));

describe("the keyword browser tree", () => {
  it("groups by category, keeping the index's order, and nests by ancestry", () => {
    const tree = buildKeywordBrowserTree(index([
      entry("harbour", [], "place"), entry("root"), entry("child", ["root"]), entry("leaf", ["root", "child"]),
    ]));
    expect(shape(tree)).toEqual([
      { slug: "place", roots: ["harbour"] },
      { slug: "subject", roots: [{ root: [{ child: ["leaf"] }] }] },
    ]);
    expect(tree[0].title).toBe("PLACE");
  });

  it("reads alphabetically in the page's language", () => {
    const entries = [entry("a", [], "subject", "Ääni"), entry("b", [], "subject", "Zeta"), entry("c", [], "subject", "Alfa")];
    expect(buildKeywordBrowserTree(index(entries, "fi"))[0].roots.map((node) => node.entry.title)).toEqual(["Alfa", "Zeta", "Ääni"]);
    expect(buildKeywordBrowserTree(index(entries, "en"))[0].roots.map((node) => node.entry.title)).toEqual(["Ääni", "Alfa", "Zeta"]);
  });

  it("keeps a keyword whose parent has no entry, under its nearest listed ancestor", () => {
    expect(shape(buildKeywordBrowserTree(index([entry("root"), entry("leaf", ["root", "gone"])])))).toEqual([{ slug: "subject", roots: [{ root: ["leaf"] }] }]);
    expect(shape(buildKeywordBrowserTree(index([entry("leaf", ["gone-root", "gone"])])))).toEqual([{ slug: "subject", roots: ["leaf"] }]);
  });

  it("gives an empty index no categories", () => {
    expect(buildKeywordBrowserTree(index([]))).toEqual([]);
  });

  it("keeps a keyword under its own category when its parent is in another, so that category does not vanish", () => {
    const tree = buildKeywordBrowserTree(index([entry("root", [], "subject"), entry("child", ["root"], "place")]));
    expect(shape(tree)).toEqual([{ slug: "subject", roots: ["root"] }, { slug: "place", roots: ["child"] }]);
  });

  it("nests under the nearest ancestor in the same category, past one in another", () => {
    const tree = buildKeywordBrowserTree(index([entry("root", [], "subject"), entry("middle", ["root"], "place"), entry("leaf", ["root", "middle"], "subject")]));
    expect(shape(tree)).toEqual([{ slug: "subject", roots: [{ root: ["leaf"] }] }, { slug: "place", roots: ["middle"] }]);
  });

  it("shows the mock vocabulary's hierarchy", () => {
    const subject = buildKeywordBrowserTree(getMockKeywordIndex("en")).find((category) => category.slug === "subject");
    const nature = subject?.roots.find((node) => node.entry.keywordId === "nature");
    expect(nature?.children.map((node) => node.entry.keywordId)).toEqual(["trees", "water"]);
    expect(nature?.entry.count).toBe(4);
  });
});
