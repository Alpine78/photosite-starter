import { describe, expect, it } from "vitest";

import {
  getCategoryTrail,
  listStoryRootVersions,
  resolveStoryRoute,
  toCategoryLink,
} from "@/lib/content-routes";
import { buildContentTree, type ContentTree } from "@/lib/content-tree";
import {
  buildLocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { mockContentTreeInputs } from "@/lib/mock-content-tree";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

const english = buildContentTree(mockContentTreeInputs.en);
const finnish = buildContentTree(mockContentTreeInputs.fi);

/** Structure without published content: valid, but nothing to show. */
const unpublished: ContentTree = buildContentTree({
  categories: [
    {
      categoryId: "cat-draft",
      parentId: null,
      slug: "draft",
      label: "Draft",
      order: 0,
    },
  ],
  placements: [],
});

describe("resolveStoryRoute", () => {
  it("resolves the namespace itself as the content-tree root", () => {
    expect(resolveStoryRoute(english, [])).toEqual({ kind: "story-root" });
  });

  it("does not publish a root with nothing beneath it", () => {
    expect(resolveStoryRoute(unpublished, [])).toBeNull();
  });

  it("walks a category path to its deepest branch", () => {
    expect(
      resolveStoryRoute(english, ["travel", "europe", "nordics", "winter"]),
    ).toEqual({ kind: "category", categoryId: "cat-winter" });
  });

  it("resolves a category that is public only through a secondary listing", () => {
    expect(resolveStoryRoute(english, ["events"])).toEqual({
      kind: "category",
      categoryId: "cat-events",
    });
  });

  it("does not resolve an empty leaf, which owns no public route", () => {
    expect(resolveStoryRoute(english, ["archive"])).toBeNull();
  });

  it("does not resolve a canonical content slug as a category", () => {
    expect(
      resolveStoryRoute(english, ["landscape", "coastal", "coastal-mornings"]),
    ).toBeNull();
  });

  it("does not resolve a slug from another locale's tree", () => {
    expect(resolveStoryRoute(english, ["maisemat"])).toBeNull();
    expect(resolveStoryRoute(finnish, ["landscape"])).toBeNull();
  });

  it("does not accept a descendant slug at the wrong level", () => {
    expect(resolveStoryRoute(english, ["coastal"])).toBeNull();
    expect(resolveStoryRoute(english, ["landscape", "europe"])).toBeNull();
  });
});

describe("getCategoryTrail", () => {
  it("returns canonical ancestry with each step's own path", () => {
    expect(getCategoryTrail(english, "cat-nordics")).toEqual([
      { categoryId: "cat-travel", label: "Travel", path: ["travel"] },
      { categoryId: "cat-europe", label: "Europe", path: ["travel", "europe"] },
      {
        categoryId: "cat-nordics",
        label: "Nordics",
        path: ["travel", "europe", "nordics"],
      },
    ]);
  });

  it("returns one step for a top-level category", () => {
    expect(getCategoryTrail(english, "cat-landscape")).toEqual([
      { categoryId: "cat-landscape", label: "Landscape", path: ["landscape"] },
    ]);
  });

  it("follows canonical ancestry, not the locale's spelling of it", () => {
    expect(getCategoryTrail(finnish, "cat-coastal").map((s) => s.path)).toEqual(
      [["maisemat"], ["maisemat", "rannikko"]],
    );
  });
});

describe("toCategoryLink", () => {
  it("carries the label and canonical path of a category", () => {
    const category = english.categories.get("cat-coastal");
    expect(category).toBeDefined();
    expect(toCategoryLink(english, category!)).toEqual({
      categoryId: "cat-coastal",
      label: "Coastal",
      path: ["landscape", "coastal"],
    });
  });
});

describe("listStoryRootVersions", () => {
  it("names every locale publishing a tree, default locale first", () => {
    const trees: LocalizedContentTrees = new Map([
      ["fi", finnish],
      ["en", english],
    ]);

    expect(listStoryRootVersions(config, trees)).toEqual([
      { locale: "fi", path: "/tarinat" },
      { locale: "en", path: "/en/stories" },
    ]);
  });

  it("omits a locale whose content is still being authored", () => {
    const trees: LocalizedContentTrees = new Map([["en", english]]);

    expect(listStoryRootVersions(config, trees)).toEqual([
      { locale: "en", path: "/en/stories" },
    ]);
  });

  it("omits a locale whose tree has nothing public to show", () => {
    const trees: LocalizedContentTrees = new Map([
      ["fi", unpublished],
      ["en", english],
    ]);

    expect(listStoryRootVersions(config, trees)).toEqual([
      { locale: "en", path: "/en/stories" },
    ]);
  });
});
