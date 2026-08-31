import { describe, expect, it } from "vitest";

import { MAX_ITEM_ID_LENGTH } from "@/lib/gallery-pagination";
import {
  isPublicIdentity,
  MAX_PUBLIC_IDENTITY_LENGTH,
  PUBLIC_IDENTITY_PATTERN,
} from "@/lib/public-identity";

describe("public identity grammar", () => {
  it("keeps its length ceiling equal to the shared item-id bound", () => {
    expect(MAX_PUBLIC_IDENTITY_LENGTH).toBe(MAX_ITEM_ID_LENGTH);
  });

  it.each([
    "coastal-landscape",
    "selected-work-coastal-landscape",
    "a",
    "a1",
    "1a-2b-3c",
  ])("accepts %j", (value) => {
    expect(isPublicIdentity(value)).toBe(true);
    expect(PUBLIC_IDENTITY_PATTERN.test(value)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["-leading", "leading hyphen"],
    ["trailing-", "trailing hyphen"],
    ["double--hyphen", "doubled hyphen"],
    ["Upper", "uppercase"],
    ["under_score", "underscore"],
    ["has space", "whitespace"],
    ["dot.separated", "dot"],
    ["a".repeat(MAX_PUBLIC_IDENTITY_LENGTH + 1), "over the length ceiling"],
  ])("rejects %j (%s)", (value) => {
    expect(isPublicIdentity(value)).toBe(false);
  });

  it("accepts exactly at the length ceiling", () => {
    expect(isPublicIdentity("a".repeat(MAX_PUBLIC_IDENTITY_LENGTH))).toBe(true);
  });
});
