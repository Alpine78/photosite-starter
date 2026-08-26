import { describe, expect, it } from "vitest";

import {
  chunkContentIds,
  encodedContentIdsBytes,
  isRecord,
  MAX_CONTENT_IDS_BYTES,
  readString,
  selectLocalizedText,
  toLanguageSubtag,
} from "@/lib/sanity-values";

describe("toLanguageSubtag", () => {
  it("reduces a full BCP 47 locale to its language subtag", () => {
    expect(toLanguageSubtag("en-GB")).toBe("en");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(toLanguageSubtag("not a locale")).toBe("not a locale");
  });
});

describe("isRecord", () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ["text", false],
    [42, false],
  ])("classifies %o as %s", (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe("readString", () => {
  it("trims and returns a non-empty string", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("treats whitespace-only or non-string input as absent", () => {
    expect(readString("   ")).toBeUndefined();
    expect(readString(42)).toBeUndefined();
    expect(readString(undefined)).toBeUndefined();
  });
});

describe("selectLocalizedText", () => {
  it("selects the entry matching the requested language", () => {
    expect(
      selectLocalizedText(
        [
          { language: "en", value: "Hello" },
          { language: "fi", value: "Hei" },
        ],
        "fi",
      ),
    ).toBe("Hei");
  });

  it("returns undefined when no entry matches or the input is malformed", () => {
    expect(selectLocalizedText([{ language: "en", value: "Hello" }], "fi")).toBeUndefined();
    expect(selectLocalizedText("not an array", "en")).toBeUndefined();
  });
});

describe("chunkContentIds", () => {
  const noopOversized = (id: string): never => {
    throw new Error(`unexpectedly oversized: ${id}`);
  };

  it("keeps ids that fit under the budget in one chunk", () => {
    expect(chunkContentIds(["a", "b", "c"], 1024, noopOversized)).toEqual([
      ["a", "b", "c"],
    ]);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunkContentIds([], 1024, noopOversized)).toEqual([]);
  });

  it("splits into more than one chunk once the budget is exceeded", () => {
    const budget = encodedContentIdsBytes(["a", "b"]);
    expect(chunkContentIds(["a", "b", "c"], budget, noopOversized)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("calls the caller-supplied handler for an id too large to fit any chunk by itself", () => {
    const hugeId = "x".repeat(2000);
    let reportedId: string | undefined;

    expect(() =>
      chunkContentIds([hugeId], 100, (id) => {
        reportedId = id;
        throw new RangeError("oversized");
      }),
    ).toThrow(RangeError);
    expect(reportedId).toBe(hugeId);
  });

  it("stays within the exact byte budget every real request measures", () => {
    const contentIds = Array.from(
      { length: 400 },
      (_, index) => `content-${"x".repeat(40)}-${index}`,
    );
    const chunks = chunkContentIds(contentIds, MAX_CONTENT_IDS_BYTES, noopOversized);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(encodedContentIdsBytes(chunk)).toBeLessThanOrEqual(MAX_CONTENT_IDS_BYTES);
    }
    expect(chunks.flat()).toEqual(contentIds);
  });
});
