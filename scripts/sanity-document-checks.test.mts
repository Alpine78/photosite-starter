/**
 * Direct coverage for `sanity-document-checks.mts`. Until now this module's
 * behavior was only exercised indirectly through `sanity-seed-fixtures.test.mts`
 * and the migration tooling's own tests, which never happened to feed
 * `isRealCalendarDateTime` anything but its own canonical `.000Z` shape — the
 * gap that let the round-9 finding through undetected.
 */

import { describe, expect, it } from "vitest";

import {
  canonicalCalendarDateTime,
  hasReaderSupportedCalendarYears,
  collectDuplicateIds,
  collectKeyViolations,
  isRealCalendarDate,
  isRealCalendarDateTime,
  referencedId,
} from "./sanity-document-checks.mts";

describe("round-9 review finding: isRealCalendarDateTime accepts every valid ISO-8601 instant spelling, not only Date.toISOString()'s own", () => {
  it("accepts a bare Z with no fractional seconds", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00Z")).toBe(true);
  });

  it("accepts a numeric offset", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00+02:00")).toBe(true);
    expect(isRealCalendarDateTime("2015-06-01T00:00:00-05:30")).toBe(true);
  });

  it("still accepts the canonical toISOString() shape this project's own fixtures already use", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00.000Z")).toBe(true);
    expect(isRealCalendarDateTime(new Date("2015-06-01T00:00:00.000Z").toISOString())).toBe(true);
  });

  it("accepts a non-canonical fractional-second precision", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00.5Z")).toBe(true);
    expect(isRealCalendarDateTime("2015-06-01T00:00:00.123456Z")).toBe(true);
  });

  it("still rejects a calendar date that does not exist — the whole reason this function round-trips at all", () => {
    expect(isRealCalendarDateTime("2026-02-31T00:00:00Z")).toBe(false); // Date.parse would silently roll this to March 3
    expect(isRealCalendarDateTime("2015-13-01T00:00:00Z")).toBe(false);
    expect(isRealCalendarDateTime("2015-06-01T25:00:00Z")).toBe(false);
    expect(isRealCalendarDateTime("2015-06-01T00:60:00Z")).toBe(false);
  });

  it("rejects a datetime with no timezone designator — a naive local time is not an instant", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00")).toBe(false);
  });

  it("rejects a structurally malformed offset", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00+99:99")).toBe(false);
    expect(isRealCalendarDateTime("2015-06-01T00:00:00+2:00")).toBe(false);
  });

  it("rejects a bare date, a non-string, and garbage", () => {
    expect(isRealCalendarDateTime("2015-06-01")).toBe(false);
    expect(isRealCalendarDateTime(undefined)).toBe(false);
    expect(isRealCalendarDateTime(1717200000000)).toBe(false);
    expect(isRealCalendarDateTime("not a date")).toBe(false);
  });
});

describe("round-12 review finding: a fractional second that rounds up to the next whole second is still accepted", () => {
  it("accepts .9999 — the rounding carry that previously made a valid instant look invalid", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:00.9999Z")).toBe(true);
  });

  it("accepts other fractions close to a full second", () => {
    expect(isRealCalendarDateTime("2015-06-01T00:00:59.9999Z")).toBe(true); // also near a minute rollover
    expect(isRealCalendarDateTime("2015-06-01T23:59:59.9999Z")).toBe(true); // also near a day rollover
  });

  it("canonicalizes it the same way native Date parsing does (truncated, not rounded)", () => {
    expect(canonicalCalendarDateTime("2015-06-01T00:00:00.9999Z")).toBe("2015-06-01T00:00:00.999Z");
  });

  it("still rejects an out-of-range hour, minute, or second", () => {
    expect(isRealCalendarDateTime("2015-06-01T25:00:00Z")).toBe(false);
    expect(isRealCalendarDateTime("2015-06-01T00:60:00Z")).toBe(false);
    expect(isRealCalendarDateTime("2015-06-01T00:00:60Z")).toBe(false);
  });
});

describe("round-11 review finding: canonicalCalendarDateTime resolves every accepted spelling to what the real production adapter requires", () => {
  it("resolves a numeric offset to its correct absolute UTC moment, not the written wall-clock digits", () => {
    // 02:00 at UTC+2 is midnight UTC — a naive "treat the digits as UTC"
    // canonicalization would have produced the wrong instant entirely.
    expect(canonicalCalendarDateTime("2015-06-01T02:00:00+02:00")).toBe("2015-06-01T00:00:00.000Z");
    expect(canonicalCalendarDateTime("2015-06-01T00:00:00-05:00")).toBe("2015-06-01T05:00:00.000Z");
  });

  it("pads a bare Z with no fractional seconds to exactly three digits", () => {
    expect(canonicalCalendarDateTime("2015-06-01T00:00:00Z")).toBe("2015-06-01T00:00:00.000Z");
  });

  it("truncates excess fractional-second precision to three digits", () => {
    expect(canonicalCalendarDateTime("2015-06-01T00:00:00.123456Z")).toBe("2015-06-01T00:00:00.123Z");
  });

  it("leaves the already-canonical shape unchanged", () => {
    expect(canonicalCalendarDateTime("2015-06-01T00:00:00.000Z")).toBe("2015-06-01T00:00:00.000Z");
  });

  it("every accepted output matches the real adapter's own pattern (src/lib/sanity-article.ts#ISO_DATE_OR_DATETIME)", () => {
    const REAL_ADAPTER_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z)?$/u;
    for (const input of [
      "2015-06-01T00:00:00Z",
      "2015-06-01T00:00:00+02:00",
      "2015-06-01T00:00:00.5Z",
      "2015-06-01T00:00:00.000Z",
    ]) {
      const canonical = canonicalCalendarDateTime(input);
      expect(canonical, input).toBeDefined();
      expect(REAL_ADAPTER_PATTERN.test(canonical!), `${input} -> ${canonical}`).toBe(true);
    }
  });

  it("returns undefined for anything isRealCalendarDateTime itself rejects", () => {
    expect(canonicalCalendarDateTime("2026-02-31T00:00:00Z")).toBeUndefined();
    expect(canonicalCalendarDateTime("not a date")).toBeUndefined();
    expect(canonicalCalendarDateTime(undefined)).toBeUndefined();
  });
});

describe("isRealCalendarDate", () => {
  it("accepts a real calendar date", () => {
    expect(isRealCalendarDate("2015-06-01")).toBe(true);
  });

  it("rejects a date that does not exist and anything not shaped like YYYY-MM-DD", () => {
    expect(isRealCalendarDate("2026-02-31")).toBe(false);
    expect(isRealCalendarDate("2015-06-01T00:00:00Z")).toBe(false);
    expect(isRealCalendarDate("not a date")).toBe(false);
  });
});

describe("referencedId", () => {
  it("reads a Sanity reference's target id", () => {
    expect(referencedId({ _type: "reference", _ref: "abc" })).toBe("abc");
  });

  it("returns undefined for anything that is not a reference", () => {
    expect(referencedId("abc")).toBeUndefined();
    expect(referencedId(undefined)).toBeUndefined();
    expect(referencedId({})).toBeUndefined();
    expect(referencedId(null)).toBeUndefined();
  });
});

describe("collectDuplicateIds", () => {
  it("reports every id claimed by more than one document, sorted", () => {
    const documents = [{ _id: "b" }, { _id: "a" }, { _id: "b" }, { _id: "c" }, { _id: "a" }];
    expect(collectDuplicateIds(documents)).toEqual(["a", "b"]);
  });

  it("reports nothing for a unique set", () => {
    expect(collectDuplicateIds([{ _id: "a" }, { _id: "b" }])).toEqual([]);
  });
});

describe("collectKeyViolations", () => {
  it("accepts a well-keyed array of objects", () => {
    const violations: string[] = [];
    collectKeyViolations("doc", { items: [{ _key: "a", value: 1 }, { _key: "b", value: 2 }] }, violations);
    expect(violations).toEqual([]);
  });

  it("reports a missing key and a duplicate key", () => {
    const violations: string[] = [];
    collectKeyViolations("doc", { items: [{ value: 1 }, { _key: "a", value: 2 }, { _key: "a", value: 3 }] }, violations);
    expect(violations.some((v) => v.includes("missing a non-empty _key"))).toBe(true);
    expect(violations.some((v) => v.includes('duplicate _key "a"'))).toBe(true);
  });

  it("walks nested arrays inside keyed items", () => {
    const violations: string[] = [];
    collectKeyViolations(
      "doc",
      { items: [{ _key: "a", nested: [{ value: 1 }] }] },
      violations,
    );
    expect(violations.some((v) => v.includes("missing a non-empty _key"))).toBe(true);
  });
});

describe("object keys in mixed arrays", () => {
  function violations(value: unknown) {
    const result: string[] = []; collectKeyViolations("doc", value, result); return result;
  }
  it("checks missing and duplicate keys across primitive siblings in index order", () => {
    expect(violations({ items: [1, {}, { _key: "a" }, "a", null, { _key: "a" }, { _key: "" }] })).toEqual([
      "doc.items: array item is missing a non-empty _key",
      'doc.items: duplicate _key "a"',
      "doc.items: array item is missing a non-empty _key",
    ]);
  });
  it("walks nested arrays with independent key namespaces", () => {
    expect(violations({ items: [{ _key: "a", child: [null, { _key: "a" }] }, [null, {}, { _key: "a" }, { _key: "a" }]] })).toEqual([
      "doc.items[1]: array item is missing a non-empty _key",
      'doc.items[1]: duplicate _key "a"',
    ]);
  });
  it.each(["", 1, null, { toString: 1 }])("uses an index path for a malformed key: %j", (key) => {
    expect(violations({ items: [{ _key: key, child: [{}] }] })).toEqual([
      "doc.items: array item is missing a non-empty _key",
      "doc.items[0].child: array item is missing a non-empty _key",
    ]);
  });
  it.each([[], [null], [1, "text", false, null], [null, { _key: "a" }, [null, { _key: "a" }]]].map(items => ({ items })))
    ("accepts containers and valid keys without treating primitives as objects: %j", ({ items }) => {
      expect(violations({ items })).toEqual([]);
    });
});

describe("four-digit early calendar years and reader bounds", () => {
  it.each(["0000-01-01", "0000-02-29", "0004-02-29", "0099-06-01", "0100-01-01", "2000-02-29"])
    ("accepts the real calendar date %s without a 1900 remap", (date) => {
      expect(isRealCalendarDate(date)).toBe(true);
      expect(isRealCalendarDateTime(`${date}T00:00:00Z`)).toBe(true);
    });
  it.each(["0001-02-29", "0099-02-29", "0100-02-29", "1900-02-29", "0000-00-01", "0099-01-00"])
    ("refuses invalid early dates: %s", (date) => expect(isRealCalendarDate(date)).toBe(false));
  it.each(["0000-01-01T00:00:00Z", "0004-02-29T00:00:00Z", "0099-06-01T00:00:00Z", "0100-01-01T00:00:00+01:00", "9999-12-31T23:00:00-05:00"])
    ("keeps real instants outside the reader's UTC-year range out of plans: %s", (value) => {
      expect(isRealCalendarDateTime(value)).toBe(true);
      expect(canonicalCalendarDateTime(value)).toBeUndefined();
    });
  it.each([
    { value: "0099-12-31T23:00:00-01:00", expected: "0100-01-01T00:00:00.000Z" },
    { value: "0100-01-01T00:00:00Z", expected: "0100-01-01T00:00:00.000Z" },
    { value: "9999-12-31T23:59:59.999Z", expected: "9999-12-31T23:59:59.999Z" },
  ])("canonicalizes reader-compatible boundary instants: $value", ({ value, expected }) => {
    expect(canonicalCalendarDateTime(value)).toBe(expected);
  });
});

it("guards written early years even when an offset normalizes into the supported range", () => {
  expect(hasReaderSupportedCalendarYears("0099-12-31T23:00:00-01:00")).toBe(false);
  expect(hasReaderSupportedCalendarYears("0100-01-01T00:00:00+01:00")).toBe(false);
  expect(hasReaderSupportedCalendarYears("0100-01-01T00:00:00Z")).toBe(true);
});
