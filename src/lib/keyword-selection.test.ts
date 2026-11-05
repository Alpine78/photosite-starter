import { describe, expect, it } from "vitest";

import { getMockKeywordIndex } from "@/lib/mock-keyword-gallery";
import { addKeyword, keywordSelectionHref, MAX_SELECTED_KEYWORDS, removeKeyword, type KeywordSuggestion } from "@/lib/keyword-selection";
import { KEYWORD_SUGGESTION_LIMIT, suggestKeywords } from "@/lib/keyword-suggest";
import type { KeywordIndex, KeywordIndexEntry } from "@/lib/keyword-index";

const suggestion = (keywordId: string, ancestorIds: readonly string[] = []): KeywordSuggestion => ({ keywordId, title: keywordId, categoryTitle: "Subject", ancestorIds, count: 1 });
const entry = (keywordId: string, title: string, overrides: Partial<KeywordIndexEntry> = {}): KeywordIndexEntry => ({
  keywordId, title, aliasKeys: [], categorySlug: "subject", categoryTitle: "Subject", ancestorIds: [], count: 1, ...overrides,
});
const index = (entries: readonly KeywordIndexEntry[]): KeywordIndex => ({ version: 1, language: "en", entries });

describe("the selection", () => {
  it("adds a keyword", () => {
    expect(addKeyword([], suggestion("aa"))).toEqual({ outcome: "added", selected: [suggestion("aa")], replaced: [] });
  });

  it("does not add one twice", () => {
    const selected = [suggestion("aa")];
    expect(addKeyword(selected, suggestion("aa"))).toEqual({ outcome: "already-covered", selected });
  });

  it("does not add an ancestor of something already chosen, because it already matches", () => {
    const selected = [suggestion("leaf", ["root"])];
    expect(addKeyword(selected, suggestion("root"))).toEqual({ outcome: "already-covered", selected });
  });

  it("lets a descendant replace its selected ancestor", () => {
    const root = suggestion("root"), leaf = suggestion("leaf", ["root", "mid"]);
    expect(addKeyword([root], leaf)).toEqual({ outcome: "added", selected: [leaf], replaced: [root] });
  });

  it("does not restore a replaced ancestor when the descendant is removed", () => {
    const added = addKeyword([suggestion("root")], suggestion("leaf", ["root"]));
    expect(removeKeyword(added.selected, "leaf")).toEqual([]);
  });

  it("stops at the limit, but lets a descendant replace its ancestor there", () => {
    const full = ["aa", "bb", "cc", "dd", "ee"].map((id) => suggestion(id));
    expect(full).toHaveLength(MAX_SELECTED_KEYWORDS);
    expect(addKeyword(full, suggestion("ff"))).toEqual({ outcome: "limit-reached", selected: full });
    expect(addKeyword(full, suggestion("leaf", ["aa"]))).toMatchObject({ outcome: "added", replaced: [suggestion("aa")] });
  });

  it("builds the sorted, literal-comma address", () => {
    expect(keywordSelectionHref("/haku", [suggestion("water"), suggestion("coast")])).toBe("/haku?keywords=coast,water");
  });
});

describe("suggestions", () => {
  it("keeps matching as the visitor types on past one word, and treats a hyphen as a word break", () => {
    const words = index([entry("lake", "Upper Lake Saimaa"), entry("area", "Etelä-Karjala"), entry("tide", "Sea", { aliasKeys: ["the spring tide"] })]);
    expect(suggestKeywords(words, "lake sa").map((item) => item.keywordId)).toEqual(["lake"]);
    expect(suggestKeywords(words, "karj").map((item) => item.keywordId)).toEqual(["area"]);
    expect(suggestKeywords(words, "spring ti").map((item) => item.keywordId)).toEqual(["tide"]);
    expect(suggestKeywords(words, "ake sa")).toEqual([]);
  });

  it("needs two characters after normalization, and refuses a very long term", () => {
    const words = index([entry("alpha", "Alpha")]);
    expect(suggestKeywords(words, "a")).toEqual([]);
    expect(suggestKeywords(words, "  a  ")).toEqual([]);
    expect(suggestKeywords(words, "al")).toHaveLength(1);
    expect(suggestKeywords(words, "a".repeat(101))).toEqual([]);
  });

  it("ranks the title's start, a word in the title, then aliases, then by count", () => {
    const words = index([
      entry("alias-word", "Omega", { aliasKeys: ["the spring"] }),
      entry("alias-start", "Sigma", { aliasKeys: ["spring"] }),
      entry("word", "Early Spring"),
      entry("start-few", "Spring Few", { count: 1 }),
      entry("start-many", "Spring Many", { count: 9 }),
    ]);
    expect(suggestKeywords(words, "spr").map((item) => item.keywordId)).toEqual(["start-many", "start-few", "word", "alias-start", "alias-word"]);
  });

  it("matches case and spacing away, and keeps diacritics distinct", () => {
    const words = index([entry("maki", "Maki"), entry("maeki", "Mäki")]);
    expect(suggestKeywords(words, "MÄK").map((item) => item.keywordId)).toEqual(["maeki"]);
    expect(suggestKeywords(words, "mäk").map((item) => item.keywordId)).toEqual(["maeki"]);
    expect(suggestKeywords(words, "mak").map((item) => item.keywordId)).toEqual(["maki"]);
  });

  it("matches a keyword by its alias without returning the alias", () => {
    const [found] = suggestKeywords(getMockKeywordIndex("en"), "seash");
    expect(found.keywordId).toBe("coast");
    expect(JSON.stringify(found)).not.toMatch(/seashore|shoreline/i);
    expect(Object.keys(found).sort()).toEqual(["ancestorIds", "categoryTitle", "count", "keywordId", "title"]);
  });

  it("stays bounded, in a stable order", () => {
    const words = index(Array.from({ length: 50 }, (_, position) => entry(`kw-${String(position).padStart(2, "0")}`, "Same")));
    const found = suggestKeywords(words, "same");
    expect(found).toHaveLength(KEYWORD_SUGGESTION_LIMIT);
    expect(found.map((item) => item.keywordId)).toEqual(Array.from({ length: KEYWORD_SUGGESTION_LIMIT }, (_, position) => `kw-${String(position).padStart(2, "0")}`));
  });
});
