import { describe, expect, it } from "vitest";

import {
  MAX_STRICT_SANITY_JSON_DEPTH,
  MAX_STRICT_SANITY_JSON_NODES,
  parseSanityJsonWithoutDuplicates,
} from "@/lib/sanity-json";

describe("bounded Sanity JSON without duplicate keys", () => {
  it.each([
    "null", "true", "false", "0", "-0", "-1.25e+3", "1e400",
    '"text"', '"\\uD83D\\uDE00"', '"escaped \\\" \\\\ \\/"',
    "[]", "{}", '{"a":1,"b":[true,null,{"a":2}]}',
    ' \t\n\r {"a": [], "b": {"c": false}} \n',
    '{"__proto__":{"value":1},"constructor":2}',
  ])("preserves native parsing for valid JSON %j", (source) => {
    expect(parseSanityJsonWithoutDuplicates(source)).toEqual(JSON.parse(source));
  });

  it.each([
    "", "undefined", "NaN", "01", "+1", "1.", "1e", "truefalse",
    '"unterminated', '"\\x00"', '"newline\n"', "[1,]", "[1,,2]", "{a:1}",
    '{"a":1,}', '{"a" 1}', '{"a":}', "null trailing", "/*comment*/null",
    "\u00a0null", "\ufeffnull", '{"a":1}\u2028', "[", "{",
  ])("rejects native-invalid JSON with a static error %j", (source) => {
    expect(() => JSON.parse(source)).toThrow();
    expect(() => parseSanityJsonWithoutDuplicates(source)).toThrow(new TypeError("Invalid bounded content JSON"));
  });

  it.each([
    '{"a":1,"a":2}', '{"a":1,"\\u0061":2}',
    '{"/":1,"\\/":2}', '{"😀":1,"\\ud83d\\ude00":2}',
    '{"__proto__":1,"__proto__":2}',
    '{"result":[{"a":1,"a":2}]}',
    '{"outer":{"escaped\\\"key":1,"escaped\\u0022key":2}}',
  ])("rejects nested and escape-equivalent duplicate keys %j", (source) => {
    expect(() => JSON.parse(source)).not.toThrow();
    expect(() => parseSanityJsonWithoutDuplicates(source)).toThrow("Invalid bounded content JSON");
  });

  it("keeps prototype-shaped names as ordinary own data", () => {
    const parsed = parseSanityJsonWithoutDuplicates('{"__proto__":{"polluted":true}}') as object;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("bounds recursion before descending beyond the accepted depth", () => {
    const nested = (depth: number) => "[".repeat(depth) + "0" + "]".repeat(depth);
    expect(parseSanityJsonWithoutDuplicates(nested(MAX_STRICT_SANITY_JSON_DEPTH))).toEqual(JSON.parse(nested(MAX_STRICT_SANITY_JSON_DEPTH)));
    expect(() => parseSanityJsonWithoutDuplicates(nested(MAX_STRICT_SANITY_JSON_DEPTH + 1))).toThrow("Invalid bounded content JSON");
  });

  it("counts container/value nodes and rejects excess within the byte bound", () => {
    expect((parseSanityJsonWithoutDuplicates("[" + Array(MAX_STRICT_SANITY_JSON_NODES - 1).fill("0").join(",") + "]") as unknown[]).length).toBe(MAX_STRICT_SANITY_JSON_NODES - 1);
    expect(() => parseSanityJsonWithoutDuplicates("[" + Array(MAX_STRICT_SANITY_JSON_NODES).fill("0").join(",") + "]")).toThrow("Invalid bounded content JSON");
    expect(() => parseSanityJsonWithoutDuplicates('"' + "x".repeat(1024 * 1024) + '"')).toThrow("Invalid bounded content JSON");
  });
});
