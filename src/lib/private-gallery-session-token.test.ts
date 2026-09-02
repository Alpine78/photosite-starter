import { describe, expect, it } from "vitest";

import {
  PRIVATE_GALLERY_SESSION_ID_BYTES,
  generateSessionId,
  hashSessionId,
  isCanonicalSessionId,
  readSingleCookie,
} from "@/lib/private-gallery-session-token";

describe("generateSessionId", () => {
  it("mints 256 bits as 43 canonical unpadded-base64url characters", () => {
    expect(PRIVATE_GALLERY_SESSION_ID_BYTES).toBe(32);
    for (let i = 0; i < 50; i += 1) {
      const id = generateSessionId();
      expect(id).toHaveLength(43);
      expect(isCanonicalSessionId(id)).toBe(true);
      expect(Buffer.from(id, "base64url")).toHaveLength(32);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSessionId()));
    expect(seen.size).toBe(200);
  });
});

describe("isCanonicalSessionId", () => {
  it("accepts what the generator produces", () => {
    expect(isCanonicalSessionId(generateSessionId())).toBe(true);
  });

  it.each([
    ["a non-string", 42],
    ["undefined", undefined],
    ["an empty string", ""],
    ["one character short", generateSessionId().slice(0, 42)],
    ["one character long", `${generateSessionId()}A`],
    ["padded base64", `${Buffer.alloc(32, 7).toString("base64")}`],
    ["standard-alphabet base64", Buffer.alloc(32, 255).toString("base64")],
    ["a character outside the alphabet", `${generateSessionId().slice(0, 42)}!`],
  ])("rejects %s", (_label, value) => {
    expect(isCanonicalSessionId(value)).toBe(false);
  });

  it("rejects a non-canonical spelling that decodes to the same 32 bytes", () => {
    // Base64's final character carries spare bits, so several 43-character
    // strings decode to one 32-byte value. Only the re-encoding round trip
    // catches this — the length and the character class both pass.
    const canonical = Buffer.alloc(32, 0).toString("base64url");
    const alias = `${canonical.slice(0, 42)}B`;

    expect(alias).not.toBe(canonical);
    expect(alias).toHaveLength(43);
    expect(Buffer.from(alias, "base64url")).toEqual(
      Buffer.from(canonical, "base64url"),
    );

    expect(isCanonicalSessionId(canonical)).toBe(true);
    expect(isCanonicalSessionId(alias)).toBe(false);
  });
});

describe("hashSessionId", () => {
  it("is a stable unsalted SHA-256 over the identifier", () => {
    const id = generateSessionId();
    expect(hashSessionId(id)).toBe(hashSessionId(id));
    expect(hashSessionId(id)).not.toBe(id);
    // 32 bytes as unpadded base64url.
    expect(hashSessionId(id)).toHaveLength(43);
  });

  it("separates two identifiers", () => {
    expect(hashSessionId(generateSessionId())).not.toBe(
      hashSessionId(generateSessionId()),
    );
  });

  it("refuses to hash a non-canonical identifier", () => {
    // The backstop, not the path a malformed cookie takes: both session models
    // check `isCanonicalSessionId` first and raise their own classified error.
    expect(() => hashSessionId("nope")).toThrow(TypeError);
  });
});

describe("readSingleCookie", () => {
  it("returns none for an absent or empty header", () => {
    expect(readSingleCookie(null, "a")).toEqual({ kind: "none" });
    expect(readSingleCookie(undefined, "a")).toEqual({ kind: "none" });
    expect(readSingleCookie("", "a")).toEqual({ kind: "none" });
    expect(readSingleCookie("other=1", "a")).toEqual({ kind: "none" });
  });

  it("reads one value among others, trimming whitespace", () => {
    expect(readSingleCookie("x=1; wanted=abc ; y=2", "wanted")).toEqual({
      kind: "one",
      value: "abc",
    });
  });

  it("unwraps a quoted value", () => {
    expect(readSingleCookie('wanted="abc"', "wanted")).toEqual({
      kind: "one",
      value: "abc",
    });
  });

  it("reports a duplicate rather than picking a winner", () => {
    expect(readSingleCookie("wanted=one; wanted=two", "wanted")).toEqual({
      kind: "duplicate",
    });
  });

  it("does not match a name by prefix or suffix", () => {
    expect(readSingleCookie("wantedmore=1; prewanted=2", "wanted")).toEqual({
      kind: "none",
    });
  });

  it("skips a segment with no '=' rather than reading it as empty", () => {
    expect(readSingleCookie("flag; wanted=abc", "wanted")).toEqual({
      kind: "one",
      value: "abc",
    });
  });

  it("keeps an empty value distinct from an absent one", () => {
    expect(readSingleCookie("wanted=", "wanted")).toEqual({
      kind: "one",
      value: "",
    });
  });
});
