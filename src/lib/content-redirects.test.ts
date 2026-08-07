import { describe, expect, it } from "vitest";

import {
  buildContentRedirects,
  ContentRedirectValidationError,
  resolveContentRedirect,
  type ContentRedirectInput,
} from "@/lib/content-redirects";
import { buildContentTree } from "@/lib/content-tree";
import {
  mockContentRedirectInputs,
  mockContentTreeInputs,
} from "@/lib/mock-content-tree";

const english = buildContentTree(mockContentTreeInputs.en);

function build(entries: readonly ContentRedirectInput[]) {
  return buildContentRedirects(english, entries);
}

function issueCodes(entries: readonly ContentRedirectInput[]) {
  try {
    build(entries);
  } catch (error) {
    if (error instanceof ContentRedirectValidationError) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
  return [];
}

describe("buildContentRedirects", () => {
  it("maps a renamed category's previous path to its current one", () => {
    const redirects = build([
      { kind: "category", id: "cat-events", previousPath: ["happenings"] },
    ]);

    expect(resolveContentRedirect(redirects, ["happenings"])).toEqual([
      "events",
    ]);
  });

  it("maps a moved category, whose slug stayed and ancestry changed", () => {
    const redirects = build([
      { kind: "category", id: "cat-coastal", previousPath: ["coastal"] },
    ]);

    expect(resolveContentRedirect(redirects, ["coastal"])).toEqual([
      "landscape",
      "coastal",
    ]);
  });

  it("maps content history to the canonical detail path", () => {
    const redirects = build([
      {
        kind: "content",
        id: "content-coastal-mornings",
        previousPath: ["events", "old-coastal-mornings"],
      },
    ]);

    expect(
      resolveContentRedirect(redirects, ["events", "old-coastal-mornings"]),
    ).toEqual(["landscape", "coastal", "coastal-mornings"]);
  });

  it("flattens a chain: every previous path resolves directly to the current one", () => {
    const redirects = build([
      { kind: "category", id: "cat-events", previousPath: ["happenings"] },
      { kind: "category", id: "cat-events", previousPath: ["what-is-on"] },
    ]);

    // No value is also a key, so no request can traverse two hops.
    for (const [, target] of redirects) {
      expect(redirects.has(target.join("/"))).toBe(false);
    }
    expect(resolveContentRedirect(redirects, ["happenings"])).toEqual([
      "events",
    ]);
    expect(resolveContentRedirect(redirects, ["what-is-on"])).toEqual([
      "events",
    ]);
  });

  it("keeps no redirect for an identity that left publication", () => {
    // An empty leaf is not public, so its history has no target. ADR-0003
    // answers an unpublished page with a 404 rather than an invented successor.
    expect(
      build([
        { kind: "category", id: "cat-archive", previousPath: ["old-archive"] },
      ]).size,
    ).toBe(0);
    expect(
      build([
        {
          kind: "content",
          id: "content-unplaced-draft",
          previousPath: ["drafts", "unplaced-draft"],
        },
      ]).size,
    ).toBe(0);
  });

  it("drops history that already names the current path", () => {
    expect(
      build([
        { kind: "category", id: "cat-events", previousPath: ["events"] },
      ]).size,
    ).toBe(0);
  });

  it("rejects a previous path the current tree still serves", () => {
    expect(
      issueCodes([
        { kind: "category", id: "cat-events", previousPath: ["landscape"] },
      ]),
    ).toEqual(["live-path-reused"]);
  });

  it("rejects one previous path recorded against two identities", () => {
    expect(
      issueCodes([
        { kind: "category", id: "cat-events", previousPath: ["happenings"] },
        { kind: "category", id: "cat-coastal", previousPath: ["happenings"] },
      ]),
    ).toEqual(["conflicting-previous-path"]);
  });

  it("accepts the same previous path recorded twice for one identity", () => {
    expect(
      build([
        { kind: "category", id: "cat-events", previousPath: ["happenings"] },
        { kind: "category", id: "cat-events", previousPath: ["happenings"] },
      ]).size,
    ).toBe(1);
  });

  it.each([
    [[] as string[], "empty-previous-path"],
    [["Happenings"], "invalid-previous-path"],
    [["what is on"], "invalid-previous-path"],
  ])("rejects the previous path %j", (previousPath, code) => {
    expect(
      issueCodes([{ kind: "category", id: "cat-events", previousPath }]),
    ).toEqual([code]);
  });

  it("validates the shipped mock history against its own tree", () => {
    expect(() =>
      buildContentRedirects(english, mockContentRedirectInputs.en),
    ).not.toThrow();
    expect(() =>
      buildContentRedirects(
        buildContentTree(mockContentTreeInputs.fi),
        mockContentRedirectInputs.fi,
      ),
    ).not.toThrow();
  });
});

describe("resolveContentRedirect", () => {
  it("returns null for a path with no recorded history", () => {
    const redirects = build(mockContentRedirectInputs.en);

    expect(resolveContentRedirect(redirects, ["nothing-here"])).toBeNull();
    expect(resolveContentRedirect(redirects, [])).toBeNull();
    expect(resolveContentRedirect(undefined, ["happenings"])).toBeNull();
  });
});
