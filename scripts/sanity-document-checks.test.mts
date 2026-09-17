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
