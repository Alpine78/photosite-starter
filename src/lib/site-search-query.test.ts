import { describe, expect, it } from "vitest";

import {
  SEARCH_MAX_QUERY_CHARACTERS,
  SEARCH_MAX_TOKENS,
  foldSearchText,
  highlightSegments,
  parseSearchQuery,
  readSearchRequest,
  scoreSearchFields,
} from "@/lib/site-search-query";

describe("foldSearchText", () => {
  it("compares by base letter, ignoring case and diacritics", () => {
    expect(foldSearchText("Grönholm")).toBe("gronholm");
    expect(foldSearchText("ÄÖÅ")).toBe("aoa");
    // A decomposed spelling folds the same as the precomposed one.
    expect(foldSearchText("ö")).toBe("o");
  });
});

describe("parseSearchQuery", () => {
  it("lowercases, folds, and splits into distinct tokens", () => {
    expect(parseSearchQuery("  Rally   FINLAND rally ").tokens).toEqual([
      "rally",
      "finland",
    ]);
    expect(parseSearchQuery("  Rally   FINLAND ").text).toBe("Rally FINLAND");
  });

  it("treats query syntax as separators, never as operators", () => {
    expect(parseSearchQuery('"rally*" -finland').tokens).toEqual([
      "rally",
      "finland",
    ]);
  });

  it("yields no tokens for input that has no usable word", () => {
    for (const raw of ["", "   ", "*", '""', "-", "a", "- * ?", "!!"]) {
      expect(parseSearchQuery(raw).tokens).toEqual([]);
    }
  });

  it("drops one-character tokens but keeps the rest", () => {
    expect(parseSearchQuery("a rally b").tokens).toEqual(["rally"]);
  });

  it("is total: a non-string is an empty query", () => {
    for (const raw of [undefined, null, 5, {}, ["rally"]]) {
      expect(parseSearchQuery(raw)).toEqual({ text: "", tokens: [] });
    }
  });

  it("bounds the accepted length by code point, never splitting a pair", () => {
    const long = "ab ".repeat(100);
    expect(Array.from(parseSearchQuery(long).text).length).toBeLessThanOrEqual(
      SEARCH_MAX_QUERY_CHARACTERS,
    );
    const emoji = "😀".repeat(SEARCH_MAX_QUERY_CHARACTERS + 5);
    expect(Array.from(parseSearchQuery(emoji).text)).toHaveLength(
      SEARCH_MAX_QUERY_CHARACTERS,
    );
  });

  it("uses at most the first eight tokens", () => {
    const tokens = parseSearchQuery(
      "aa bb cc dd ee ff gg hh ii jj",
    ).tokens;
    expect(tokens).toHaveLength(SEARCH_MAX_TOKENS);
    expect(tokens.at(-1)).toBe("hh");
  });
});

describe("scoreSearchFields", () => {
  const fields = {
    title: "Tet Rally Latvia 2024",
    tags: "grönholm peugeot",
    summary: "Notes from the gravel stages.",
  };

  it("matches nothing for an empty token list", () => {
    expect(scoreSearchFields([], fields)).toBeUndefined();
  });

  it("matches by word prefix, not by substring", () => {
    expect(scoreSearchFields(["ral"], fields)).toBe(3);
    expect(scoreSearchFields(["ally"], fields)).toBeUndefined();
  });

  it("requires every token, and each may match a different field", () => {
    // "rally" is in the title (3) and "gravel" only in the summary (1): the
    // cross-field case Sanity's literal-array match cannot express.
    expect(scoreSearchFields(["rally", "gravel"], fields)).toBe(4);
    expect(scoreSearchFields(["rally", "missing"], fields)).toBeUndefined();
  });

  it("folds diacritics on both sides", () => {
    expect(scoreSearchFields(["gronholm"], fields)).toBe(2);
    expect(scoreSearchFields(["grönholm"], { tags: "Gronholm" })).toBeUndefined();
    expect(scoreSearchFields(["gronholm"], { tags: "Gronholm" })).toBe(2);
  });

  it("scores a token by the best field it matches, not by repetition", () => {
    expect(
      scoreSearchFields(["rally"], {
        title: "Rally",
        summary: "rally rally rally",
        tags: "rally",
      }),
    ).toBe(3);
  });

  it("ranks a title hit above a tag hit above a lead hit", () => {
    const title = scoreSearchFields(["light"], { title: "Light" });
    const tag = scoreSearchFields(["light"], { tags: "light" });
    const summary = scoreSearchFields(["light"], { summary: "light" });
    expect(title).toBeGreaterThan(tag ?? 0);
    expect(tag).toBeGreaterThan(summary ?? 0);
  });

  it("tolerates records with missing fields", () => {
    expect(scoreSearchFields(["rally"], {})).toBeUndefined();
    expect(scoreSearchFields(["rally"], { title: "Rally" })).toBe(3);
  });
});

describe("highlightSegments", () => {
  it("highlights whole words that start with a token and keeps the rest", () => {
    expect(highlightSegments("Tet Rally Latvia 2024", ["ral"])).toEqual([
      { text: "Tet ", match: false },
      { text: "Rally", match: true },
      { text: " Latvia 2024", match: false },
    ]);
  });

  it("matches through the diacritic fold and keeps the original spelling", () => {
    expect(highlightSegments("Grönholm wins", ["gron"])).toEqual([
      { text: "Grönholm", match: true },
      { text: " wins", match: false },
    ]);
  });

  it("round-trips the text and never introduces markup", () => {
    const text = '<b>Rally</b> & "co"';
    const segments = highlightSegments(text, ["rally"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.find((segment) => segment.match)?.text).toBe("Rally");
  });

  it("returns one plain segment when there is nothing to highlight", () => {
    expect(highlightSegments("Rally", [])).toEqual([
      { text: "Rally", match: false },
    ]);
    expect(highlightSegments("", ["rally"])).toEqual([]);
  });
});

describe("readSearchRequest", () => {
  it("is text mode for a plain query, whatever else is present", () => {
    expect(readSearchRequest({ q: "rally" })).toEqual({ mode: "text", rawQuery: "rally" });
    expect(readSearchRequest({ q: "rally", cursor: "x", section: "y" })).toEqual({
      mode: "text",
      rawQuery: "rally",
    });
    expect(readSearchRequest({})).toEqual({ mode: "text", rawQuery: undefined });
  });

  it("uses the first occurrence of a repeated parameter", () => {
    expect(readSearchRequest({ q: ["first", "second"] })).toEqual({
      mode: "text",
      rawQuery: "first",
    });
    expect(readSearchRequest({ keywords: ["a,b", "c"] })).toEqual({
      mode: "keywords",
      keywords: ["a", "b"],
      raw: "a,b",
    });
  });

  it("lets a non-empty keywords selection win over q", () => {
    expect(readSearchRequest({ keywords: "unknown", q: "coastal" })).toEqual({
      mode: "keywords",
      keywords: ["unknown"],
      raw: "unknown",
    });
  });

  it("trims keyword tokens and drops empty elements", () => {
    expect(readSearchRequest({ keywords: " a , ,b,," })).toMatchObject({
      mode: "keywords",
      keywords: ["a", "b"],
    });
  });

  it("falls back to text mode when keywords reduce to nothing", () => {
    for (const keywords of ["", " ", ",", " , ,, ", []]) {
      expect(readSearchRequest({ keywords, q: "coastal" })).toEqual({
        mode: "text",
        rawQuery: "coastal",
      });
    }
    // The first occurrence decides, even when a later one is non-empty.
    expect(readSearchRequest({ keywords: ["", "late"], q: "coastal" })).toEqual({
      mode: "text",
      rawQuery: "coastal",
    });
  });
});
