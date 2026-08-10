import { describe, expect, it } from "vitest";

import {
  getCategoryTrail,
  getStoryRoutePath,
  getStoryRouteTrail,
  listStoryRootVersions,
  resolveStoryRoute,
  toCategoryLink,
  toContentLocation,
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

  it("resolves a canonical content slug beneath its category", () => {
    expect(
      resolveStoryRoute(english, ["travel", "packing-for-a-photo-trip"]),
    ).toEqual({
      kind: "content",
      contentId: "content-packing-for-a-photo-trip",
    });
  });

  it("does not resolve a variant this application has no route for", () => {
    // A gallery's canonical path stays outside the route space until AB#104
    // renders it. Resolving it would also earn it the casing and
    // redundant-prefix redirects, pointing them at a page that cannot render.
    expect(
      english.placements.get("content-coastal-mornings")?.variant,
    ).toBe("gallery");
    expect(
      resolveStoryRoute(english, ["landscape", "coastal", "coastal-mornings"]),
    ).toBeNull();
  });

  it("resolves a content slug in the locale that publishes that version", () => {
    expect(
      resolveStoryRoute(finnish, ["tekniikka", "valotuskolmio-kaytannossa"]),
    ).toEqual({
      kind: "content",
      contentId: "content-understanding-exposure-triangle",
    });
    // The English slug of the same page is not a Finnish path.
    expect(
      resolveStoryRoute(finnish, [
        "tekniikka",
        "understanding-exposure-triangle",
      ]),
    ).toBeNull();
  });

  it("does not resolve content beneath a category it is only listed in", () => {
    // `content-packing-for-a-photo-trip` is canonically placed in Travel and
    // listed in Behind the scenes. Only the canonical placement owns a route.
    expect(
      resolveStoryRoute(english, ["travel", "packing-for-a-photo-trip"]),
    ).toEqual({
      kind: "content",
      contentId: "content-packing-for-a-photo-trip",
    });
    expect(
      resolveStoryRoute(english, [
        "behind-the-scenes",
        "packing-for-a-photo-trip",
      ]),
    ).toBeNull();
  });

  it("does not resolve unpublished or unplaced content", () => {
    expect(resolveStoryRoute(english, ["unplaced-draft"])).toBeNull();
    expect(resolveStoryRoute(english, ["travel", "unplaced-draft"])).toBeNull();
  });

  it("does not resolve a content slug at the story root", () => {
    // A canonical placement is always a category, so no page sits directly
    // beneath the namespace.
    expect(resolveStoryRoute(english, ["coastal-mornings"])).toBeNull();
  });

  it("does not resolve a path continuing past a content page", () => {
    expect(
      resolveStoryRoute(english, ["travel", "packing-for-a-photo-trip", "more"]),
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

describe("getStoryRoutePath", () => {
  it("gives the story root no segments of its own", () => {
    expect(getStoryRoutePath(english, { kind: "story-root" })).toEqual([]);
  });

  it("returns a category's canonical path", () => {
    expect(
      getStoryRoutePath(english, {
        kind: "category",
        categoryId: "cat-coastal",
      }),
    ).toEqual(["landscape", "coastal"]);
  });

  it("returns a page's canonical detail path", () => {
    expect(
      getStoryRoutePath(english, {
        kind: "content",
        contentId: "content-choosing-a-telephoto-lens",
      }),
    ).toEqual(["gear", "choosing-a-telephoto-lens"]);
  });
});

describe("getStoryRouteTrail", () => {
  it("stops at a content page's canonical category", () => {
    expect(
      getStoryRouteTrail(english, {
        kind: "content",
        contentId: "content-coastal-mornings",
      }).map((step) => step.categoryId),
    ).toEqual(["cat-landscape", "cat-coastal"]);
  });

  it("follows canonical ancestry, not a secondary listing", () => {
    // Listed in Behind the scenes as well, but Travel owns the placement.
    expect(
      getStoryRouteTrail(english, {
        kind: "content",
        contentId: "content-packing-for-a-photo-trip",
      }).map((step) => step.categoryId),
    ).toEqual(["cat-travel"]);
  });

  it("gives the story root no trail", () => {
    expect(getStoryRouteTrail(english, { kind: "story-root" })).toEqual([]);
  });
});

describe("toContentLocation", () => {
  it("names the stable identity a language switch resolves by", () => {
    expect(
      toContentLocation({ kind: "content", contentId: "content-x" }),
    ).toEqual({ kind: "content", contentId: "content-x" });
    expect(
      toContentLocation({ kind: "category", categoryId: "cat-x" }),
    ).toEqual({ kind: "category", categoryId: "cat-x" });
  });

  it("gives the story root none, because it is the namespace itself", () => {
    expect(toContentLocation({ kind: "story-root" })).toBeNull();
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
