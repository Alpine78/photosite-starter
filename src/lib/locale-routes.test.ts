import { describe, expect, it } from "vitest";

import { buildContentTree, type ContentTreeInput } from "@/lib/content-tree";
import {
  buildLocaleRouteConfig,
  buildLocalePath,
  buildStoryPath,
  getLocaleRoute,
  listPublishedLocaleVersions,
  resolveLanguageSwitch,
  resolvePrefixedRoute,
  resolveRouteShell,
  type ContentLocation,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";

/**
 * The first production deployment's routing: unprefixed Finnish beneath
 * `/tarinat`, English beneath `/en/stories`.
 */
const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["blog", "portfolio", "services"],
  reservedLocaleRouteSegments: ["services"],
});

/**
 * Two locale versions of one tree. Every category and content identity is
 * shared; every label and slug differs, which is what makes these fixtures a
 * test of identity-based association rather than of path string editing.
 */
const finnishInput: ContentTreeInput = {
  categories: [
    { categoryId: "cat-landscape", parentId: null, slug: "maisemat", label: "Maisemat", order: 0 },
    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "rannikko", label: "Rannikko", order: 0 },
    // Published in Finnish only, beneath a category that exists in both.
    { categoryId: "cat-dunes", parentId: "cat-coastal", slug: "dyynit", label: "Dyynit", order: 1 },
    // Published in Finnish only, at the top level.
    { categoryId: "cat-events", parentId: null, slug: "tapahtumat", label: "Tapahtumat", order: 1 },
  ],
  placements: [
    {
      contentId: "content-coastal-mornings",
      variant: "gallery",
      slug: "rannikon-aamut",
      published: true,
      canonicalCategoryId: "cat-coastal",
    },
    {
      contentId: "content-coastal-evenings",
      variant: "gallery",
      slug: "rannikon-illat",
      published: true,
      canonicalCategoryId: "cat-coastal",
    },
    {
      contentId: "content-dune-light",
      variant: "article",
      slug: "dyynien-valo",
      published: true,
      canonicalCategoryId: "cat-dunes",
    },
    {
      contentId: "content-summer-festival",
      variant: "gallery",
      slug: "kesajuhla",
      published: true,
      canonicalCategoryId: "cat-events",
    },
  ],
};

const englishInput: ContentTreeInput = {
  categories: [
    { categoryId: "cat-landscape", parentId: null, slug: "landscape", label: "Landscape", order: 0 },
    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "coastal", label: "Coastal", order: 0 },
  ],
  placements: [
    {
      contentId: "content-coastal-mornings",
      variant: "gallery",
      slug: "coastal-mornings",
      published: true,
      canonicalCategoryId: "cat-coastal",
    },
  ],
};

const trees: LocalizedContentTrees = new Map([
  ["fi", buildContentTree(finnishInput)],
  ["en", buildContentTree(englishInput)],
]);

const finnishSource = (location: ContentLocation) => ({
  locale: "fi",
  location,
});

describe("buildLocaleRouteConfig", () => {
  it("gives the default locale the unprefixed route space", () => {
    expect(config.defaultLocale).toBe("fi");
    expect(getLocaleRoute(config, "fi")).toMatchObject({
      prefix: null,
      basePath: "",
      storyNamespace: "tarinat",
      isDefault: true,
    });
  });

  it("gives every other locale its configured prefix", () => {
    expect(getLocaleRoute(config, "en")).toMatchObject({
      prefix: "en",
      basePath: "/en",
      storyNamespace: "stories",
      isDefault: false,
    });
  });

  it("reserves the default locale's own language subtag for normalization", () => {
    expect(config.redundantDefaultPrefix).toBe("fi");
  });

  it("lists the default locale first", () => {
    expect(config.locales.map((route) => route.locale)).toEqual(["fi", "en"]);
  });

  it("normalizes locale tags to their canonical casing", () => {
    const normalized = buildLocaleRouteConfig({
      locales: [{ locale: "en-gb", prefix: null, storyNamespace: "stories" }],
      reservedRootSegments: [],
      reservedLocaleRouteSegments: [],
    });

    expect(normalized.defaultLocale).toBe("en-GB");
    expect(getLocaleRoute(normalized, "EN-GB")?.locale).toBe("en-GB");
  });

  it("supports a single-locale deployment", () => {
    const single = buildLocaleRouteConfig({
      locales: [{ locale: "fi", prefix: null, storyNamespace: "tarinat" }],
      reservedRootSegments: [],
      reservedLocaleRouteSegments: [],
    });

    expect(single.locales).toHaveLength(1);
    expect(buildStoryPath(single, "fi", ["maisemat"])).toBe("/tarinat/maisemat");
  });

  it.each([
    {
      name: "no configured locale",
      locales: [],
      reserved: [],
      message: "at least one locale",
    },
    {
      name: "an invalid locale tag",
      locales: [{ locale: "not a locale", prefix: null, storyNamespace: "stories" }],
      reserved: [],
      message: 'invalid locale "not a locale"',
    },
    {
      name: "the same locale twice",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "fi", prefix: "fi-alt", storyNamespace: "tarinat" },
      ],
      reserved: [],
      message: 'locale "fi" is configured more than once',
    },
    {
      name: "no unprefixed default locale",
      locales: [{ locale: "en", prefix: "en", storyNamespace: "stories" }],
      reserved: [],
      message: "exactly one locale must be configured without a prefix",
    },
    {
      name: "two unprefixed locales",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en", prefix: null, storyNamespace: "stories" },
      ],
      reserved: [],
      message: "both omit a prefix",
    },
    {
      name: "one prefix claimed twice",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en-GB", prefix: "eng", storyNamespace: "stories" },
        { locale: "en-US", prefix: "eng", storyNamespace: "stories" },
      ],
      reserved: [],
      message: 'locale prefix "eng" is claimed by more than one locale',
    },
    {
      name: "an uppercase prefix",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en", prefix: "EN", storyNamespace: "stories" },
      ],
      reserved: [],
      message: 'invalid locale prefix "EN"',
    },
    {
      name: "an invalid story namespace",
      locales: [{ locale: "fi", prefix: null, storyNamespace: "Tarinat" }],
      reserved: [],
      message: 'invalid story namespace "Tarinat"',
    },
    {
      name: "a prefix an application route already owns",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en", prefix: "blog", storyNamespace: "stories" },
      ],
      reserved: ["blog"],
      message: 'locale prefix "blog" collides with a root route',
    },
    {
      name: "a default namespace an application route already owns",
      locales: [{ locale: "fi", prefix: null, storyNamespace: "blog" }],
      reserved: ["blog"],
      message: 'story namespace "blog" of default locale "fi" collides',
    },
    {
      name: "a prefix equal to the default locale's namespace",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en", prefix: "tarinat", storyNamespace: "stories" },
      ],
      reserved: [],
      message: "collides with the default locale's story namespace",
    },
    {
      name: "a prefix equal to the redundant default-locale prefix",
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "fi-SE", prefix: "fi", storyNamespace: "berattelser" },
      ],
      reserved: [],
      message: "collides with the redundant default-locale prefix",
    },
    {
      name: "a redundant default-locale prefix an application route owns",
      locales: [{ locale: "fi", prefix: null, storyNamespace: "tarinat" }],
      reserved: ["fi"],
      message: 'redundant default-locale prefix "fi" collides with a root route',
    },
    {
      name: "a default namespace equal to the redundant default-locale prefix",
      locales: [{ locale: "fi", prefix: null, storyNamespace: "fi" }],
      reserved: [],
      message:
        'redundant default-locale prefix "fi" collides with the default locale\'s story namespace',
    },
  ])("rejects $name", ({ locales, reserved, message }) => {
    expect(() =>
      buildLocaleRouteConfig({
        locales,
        reservedRootSegments: reserved,
        reservedLocaleRouteSegments: [],
      }),
    ).toThrow(message);
  });

  it("rejects a story namespace that collides inside a prefixed locale", () => {
    expect(() =>
      buildLocaleRouteConfig({
        locales: [
          { locale: "fi", prefix: null, storyNamespace: "tarinat" },
          { locale: "en", prefix: "en", storyNamespace: "services" },
        ],
        reservedRootSegments: ["gallery", "services"],
        reservedLocaleRouteSegments: ["services"],
      }),
    ).toThrow(
      'story namespace "services" for locale "en" collides with a localized static route',
    );
  });

  it("does not reserve a root-only asset inside a prefixed locale", () => {
    const withRootOnlyNamespace = buildLocaleRouteConfig({
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en", prefix: "en", storyNamespace: "gallery" },
      ],
      reservedRootSegments: ["gallery"],
      reservedLocaleRouteSegments: [],
    });

    expect(buildStoryPath(withRootOnlyNamespace, "en")).toBe("/en/gallery");
  });

  it("still reserves a root-only asset against the default namespace", () => {
    expect(() =>
      buildLocaleRouteConfig({
        locales: [
          { locale: "fi", prefix: null, storyNamespace: "gallery" },
          { locale: "en", prefix: "en", storyNamespace: "stories" },
        ],
        reservedRootSegments: ["gallery"],
        reservedLocaleRouteSegments: [],
      }),
    ).toThrow(
      'story namespace "gallery" of default locale "fi" collides with a root route',
    );
  });

  it("rejects a locale without a concrete language subtag", () => {
    expect(() =>
      buildLocaleRouteConfig({
        locales: [{ locale: "und", prefix: null, storyNamespace: "stories" }],
        reservedRootSegments: [],
        reservedLocaleRouteSegments: [],
      }),
    ).toThrow("expected a BCP 47 locale tag with a concrete language subtag");
  });
});

describe("path composition", () => {
  it("omits the prefix on default-locale routes", () => {
    expect(buildLocalePath(config, "fi")).toBe("/");
    expect(buildLocalePath(config, "fi", ["services"])).toBe("/services");
    expect(buildStoryPath(config, "fi")).toBe("/tarinat");
    expect(buildStoryPath(config, "fi", ["maisemat", "rannikko"])).toBe(
      "/tarinat/maisemat/rannikko",
    );
  });

  it("prefixes every non-default locale route", () => {
    expect(buildLocalePath(config, "en")).toBe("/en");
    expect(buildLocalePath(config, "en", ["services"])).toBe("/en/services");
    expect(buildStoryPath(config, "en")).toBe("/en/stories");
    expect(buildStoryPath(config, "en", ["landscape", "coastal"])).toBe(
      "/en/stories/landscape/coastal",
    );
  });

  it("refuses to compose a path for an unconfigured locale", () => {
    expect(() => buildStoryPath(config, "sv", ["landskap"])).toThrow(
      'locale "sv" is not configured',
    );
  });
});

describe("resolvePrefixedRoute", () => {
  it("resolves a configured prefix to its locale and remaining segments", () => {
    expect(resolvePrefixedRoute(config, "en", ["stories", "landscape"])).toEqual({
      kind: "localized",
      locale: "en",
      segments: ["stories", "landscape"],
    });
  });

  it("maps a redundant default-locale prefix to the unprefixed path", () => {
    expect(resolvePrefixedRoute(config, "fi", ["tarinat", "maisemat"])).toEqual({
      kind: "redundant-default-prefix",
      canonicalPath: "/tarinat/maisemat",
    });
    expect(resolvePrefixedRoute(config, "fi")).toEqual({
      kind: "redundant-default-prefix",
      canonicalPath: "/",
    });
  });

  it("leaves a default-locale route to the default locale", () => {
    expect(resolvePrefixedRoute(config, "services", ["weddings"])).toEqual({
      kind: "not-a-locale",
    });
  });

  it("matches prefixes exactly rather than guessing at casing", () => {
    expect(resolvePrefixedRoute(config, "FI", ["tarinat"])).toEqual({
      kind: "not-a-locale",
    });
    expect(resolvePrefixedRoute(config, "EN", ["stories"])).toEqual({
      kind: "not-a-locale",
    });
  });
});

describe("resolveRouteShell", () => {
  it("uses a configured prefixed locale for its own document shell", () => {
    expect(resolveRouteShell(config, "en")).toEqual({
      locale: "en",
      isDefaultSpace: false,
    });
  });

  it("uses the unprefixed space for normalization, the namespace, and unknown paths", () => {
    for (const prefix of ["fi", "tarinat", "sv"]) {
      expect(resolveRouteShell(config, prefix)).toEqual({
        locale: "fi",
        isDefaultSpace: true,
      });
    }
  });
});

describe("listPublishedLocaleVersions", () => {
  it("names every published version, default locale first", () => {
    expect(
      listPublishedLocaleVersions(config, trees, {
        kind: "content",
        contentId: "content-coastal-mornings",
      }),
    ).toEqual([
      { locale: "fi", path: "/tarinat/maisemat/rannikko/rannikon-aamut" },
      { locale: "en", path: "/en/stories/landscape/coastal/coastal-mornings" },
    ]);
  });

  it("names only the locales that really publish the content", () => {
    expect(
      listPublishedLocaleVersions(config, trees, {
        kind: "content",
        contentId: "content-coastal-evenings",
      }),
    ).toEqual([
      { locale: "fi", path: "/tarinat/maisemat/rannikko/rannikon-illat" },
    ]);
  });

  it("names a category's public versions", () => {
    expect(
      listPublishedLocaleVersions(config, trees, {
        kind: "category",
        categoryId: "cat-coastal",
      }),
    ).toEqual([
      { locale: "fi", path: "/tarinat/maisemat/rannikko" },
      { locale: "en", path: "/en/stories/landscape/coastal" },
    ]);
  });

  it("names no version of an identity no locale publishes", () => {
    expect(
      listPublishedLocaleVersions(config, trees, {
        kind: "content",
        contentId: "content-that-does-not-exist",
      }),
    ).toEqual([]);
  });
});

describe("resolveLanguageSwitch", () => {
  it("opens the target locale's own version of the same content", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({
          kind: "content",
          contentId: "content-coastal-mornings",
        }),
        "en",
      ),
    ).toEqual({
      kind: "exact",
      locale: "en",
      path: "/en/stories/landscape/coastal/coastal-mornings",
    });
  });

  it("opens the target locale's own version of the same category", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({ kind: "category", categoryId: "cat-coastal" }),
        "en",
      ),
    ).toEqual({
      kind: "exact",
      locale: "en",
      path: "/en/stories/landscape/coastal",
    });
  });

  it("falls back to the canonical parent category when the content is untranslated", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({
          kind: "content",
          contentId: "content-coastal-evenings",
        }),
        "en",
      ),
    ).toEqual({
      kind: "parent-category",
      locale: "en",
      path: "/en/stories/landscape/coastal",
    });
  });

  it("falls back one level up from an untranslated category", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({ kind: "category", categoryId: "cat-dunes" }),
        "en",
      ),
    ).toEqual({
      kind: "parent-category",
      locale: "en",
      path: "/en/stories/landscape/coastal",
    });
  });

  it("falls back to the story root when the parent has no target-locale version", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({
          kind: "content",
          contentId: "content-summer-festival",
        }),
        "en",
      ),
    ).toEqual({ kind: "story-root", locale: "en", path: "/en/stories" });
  });

  it("falls back to the story root from an untranslated top-level category", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({ kind: "category", categoryId: "cat-events" }),
        "en",
      ),
    ).toEqual({ kind: "story-root", locale: "en", path: "/en/stories" });
  });

  it("falls back to the story root when the target locale has no tree yet", () => {
    const finnishOnly: LocalizedContentTrees = new Map([
      ["fi", buildContentTree(finnishInput)],
    ]);

    expect(
      resolveLanguageSwitch(
        config,
        finnishOnly,
        finnishSource({
          kind: "content",
          contentId: "content-coastal-mornings",
        }),
        "en",
      ),
    ).toEqual({ kind: "story-root", locale: "en", path: "/en/stories" });
  });

  it("switches back to the unprefixed default locale by identity", () => {
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        {
          locale: "en",
          location: {
            kind: "content",
            contentId: "content-coastal-mornings",
          },
        },
        "fi",
      ),
    ).toEqual({
      kind: "exact",
      locale: "fi",
      path: "/tarinat/maisemat/rannikko/rannikon-aamut",
    });
  });

  it("reports an unknown locale instead of guessing a route space", () => {
    const source = finnishSource({
      kind: "content",
      contentId: "content-coastal-mornings",
    });

    expect(resolveLanguageSwitch(config, trees, source, "sv")).toEqual({
      kind: "unknown-locale",
    });
    expect(resolveLanguageSwitch(config, trees, source, "not a locale")).toEqual(
      { kind: "unknown-locale" },
    );
    expect(
      resolveLanguageSwitch(
        config,
        trees,
        { locale: "sv", location: source.location },
        "en",
      ),
    ).toEqual({ kind: "unknown-locale" });
  });

  it("returns parameter-free paths, dropping section and cursor state", () => {
    const targets = [
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({
          kind: "content",
          contentId: "content-coastal-mornings",
        }),
        "en",
      ),
      resolveLanguageSwitch(
        config,
        trees,
        finnishSource({
          kind: "content",
          contentId: "content-coastal-evenings",
        }),
        "en",
      ),
    ];

    for (const target of targets) {
      // A resolution carries a locale and a canonical path and nothing else:
      // the source locale's section and cursor state has no meaning in another
      // language's result set.
      expect(Object.keys(target).sort()).toEqual(["kind", "locale", "path"]);
      expect("path" in target && target.path).not.toContain("?");
    }
  });
});
