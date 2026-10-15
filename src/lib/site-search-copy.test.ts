import { describe, expect, it } from "vitest";

import { getBuiltInLabels } from "@/lib/deployment-config";
import {
  narrowSearchText,
  noResultsText,
  resultCountText,
  showAllText,
} from "@/lib/site-search-copy";

describe("site-search copy", () => {
  const en = getBuiltInLabels("en-GB").search;
  const fi = getBuiltInLabels("fi").search;

  it("chooses the singular or plural string by count", () => {
    expect(resultCountText(en, 1)).toBe("1 result");
    expect(resultCountText(en, 0)).toBe("0 results");
    expect(resultCountText(fi, 1)).toBe("1 tulos");
    expect(resultCountText(fi, 12)).toBe("12 tulosta");
  });

  it("inserts the query literally, never as a replacement pattern", () => {
    expect(noResultsText(en, "rally")).toBe("No results for “rally”.");
    expect(noResultsText(en, "$& $1 $$")).toBe("No results for “$& $1 $$”.");
    expect(showAllText(fi, "ralli")).toBe("Näytä kaikki tulokset haulle ”ralli”");
  });

  it("reports how many a capped group showed", () => {
    expect(narrowSearchText(en, 50)).toContain("first 50");
    expect(narrowSearchText(fi, 50)).toContain("50 ensimmäistä");
  });

  it("gives every placeholder a value in both languages", () => {
    for (const labels of [en, fi]) {
      expect(resultCountText(labels, 2)).not.toContain("{");
      expect(noResultsText(labels, "x")).not.toContain("{");
      expect(showAllText(labels, "x")).not.toContain("{");
      expect(narrowSearchText(labels, 3)).not.toContain("{");
    }
  });
});
