import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const rootRequire = createRequire(import.meta.url);
const micromatchRequire = createRequire(rootRequire.resolve("micromatch"));
const braces = micromatchRequire("braces") as {
  (input: string, options?: { expand?: boolean }): string[];
};

describe("patched braces dependency used by micromatch", () => {
  it("keeps ordinary compilation and expansion behavior", () => {
    expect(braces("a/{b,c}")).toEqual(["a/(b|c)"]);
    expect(braces("a/{b,c}", { expand: true })).toEqual(["a/b", "a/c"]);
  });

  it("rejects deep brace patterns before recursive compilation", () => {
    const pattern = `${"{".repeat(1_000)}x${"}".repeat(1_000)}`;

    expect(() => braces(pattern)).toThrow(/nesting depth exceeds maximum/);
    expect(() => braces(pattern, { expand: true })).toThrow(
      /nesting depth exceeds maximum/,
    );
  });

  it("bounds nested parenthesis groups handled by the same recursive walkers", () => {
    const pattern = `${"(".repeat(1_000)}x${")".repeat(1_000)}`;

    expect(() => braces(pattern)).toThrow(/nesting depth exceeds maximum/);
  });
});
