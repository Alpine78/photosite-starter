import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { selectionFragment, selectionKeyFromHash } from "@/lib/proof-selection-link";

const key = randomBytes(32).toString("base64url");
describe("selection key in the link fragment", () => {
  it("reads exactly one canonical key", () => {
    expect(selectionKeyFromHash(`#select=${key}`)).toBe(key);
    expect(selectionFragment(`#select=${key}`)).toBe(`#select=${key}`);
  });

  it.each(["", "#", `select=${key}`, `#select=${key}&select=${key}`, "#select=short", `#select=${key.slice(0, 42)}B`, `#select=${key}x`, `#other=${key}`, `#${"x".repeat(300)}`])(
    "refuses %j", (hash) => {
      expect(selectionKeyFromHash(hash)).toBeUndefined();
      expect(selectionFragment(hash)).toBe("");
    });
});
