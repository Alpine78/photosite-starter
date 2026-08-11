import { describe, expect, it } from "vitest";
import { buildContentTree, type ContentTreeInput } from "@/lib/content-tree";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import {
  buildCategoryNavigation,
  buildSiteNavigation,
  MAX_NAVIGATION_CATEGORY_DEPTH,
  resolveNavigationItemState,
  toAriaCurrent,
  type SiteNavigationItem,
} from "@/lib/site-navigation";

/**
 * A bilingual deployment: the default locale owns the unprefixed routes, the
 * other lives beneath its prefix. Both are exercised, because a menu that
 * composed the locale base only for the default space would lead a visitor out
 * of the language they are reading.
 */
const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["contact", "portfolio", "services"],
  reservedLocaleRouteSegments: ["services"],
});

/**
 * Three top-level categories, one of them an empty leaf, and a branch running
 * deeper than the menu shows. That is enough to state every rule the projection
 * has: publicity, sibling order, and the depth bound.
 */
const treeInput: ContentTreeInput = {
  categories: [
    { categoryId: "cat-landscape", parentId: null, slug: "landscape", label: "Landscape", order: 0 },
    { categoryId: "cat-travel", parentId: null, slug: "travel", label: "Travel", order: 1 },
    // No content and no public descendant: out of the public tree entirely.
    { categoryId: "cat-archive", parentId: null, slug: "archive", label: "Archive", order: 2 },
    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "coastal", label: "Coastal", order: 0 },
    { categoryId: "cat-europe", parentId: "cat-travel", slug: "europe", label: "Europe", order: 0 },
    { categoryId: "cat-nordics", parentId: "cat-europe", slug: "nordics", label: "Nordics", order: 0 },
  ],
  placements: [
    {
      contentId: "content-coastal",
      variant: "article",
      slug: "coastal-light",
      published: true,
      canonicalCategoryId: "cat-coastal",
    },
    {
      contentId: "content-nordics",
      variant: "article",
      slug: "polar-night",
      published: true,
      canonicalCategoryId: "cat-nordics",
    },
  ],
};

const tree = buildContentTree(treeInput);

const staticLinks = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Stories", href: "/tarinat" },
  { label: "Contact", href: "/contact" },
];

function build(overrides: Partial<Parameters<typeof buildSiteNavigation>[0]> = {}) {
  return buildSiteNavigation({
    staticLinks,
    config,
    locale: "fi",
    tree,
    storyLabel: "Tarinat",
    ...overrides,
  });
}

const hrefs = (items: readonly SiteNavigationItem[]) =>
  items.map((item) => item.href);

const findByHref = (items: readonly SiteNavigationItem[], href: string) => {
  const item = items.find((candidate) => candidate.href === href);
  expect(item, `expected a navigation item for ${href}`).toBeDefined();
  return item as SiteNavigationItem;
};

describe("buildSiteNavigation", () => {
  it("keeps the configured static links in their authored order", () => {
    expect(hrefs(build())).toEqual([
      "/",
      "/services",
      "/portfolio",
      "/tarinat",
      "/contact",
    ]);
  });

  it("replaces a configured story link with the tree-driven section", () => {
    const section = findByHref(build(), "/tarinat");

    // The configured entry named the section and chose its place; it did not
    // survive as a link of its own, so no two entries own that route space.
    expect(section.label).toBe("Stories");
    expect(hrefs(build()).filter((href) => href === "/tarinat")).toHaveLength(1);
    expect(section.children.length).toBeGreaterThan(0);
  });

  it("appends the section when no configured link marks its place", () => {
    const items = build({
      staticLinks: [{ label: "Home", href: "/" }],
      storyLabel: "Tarinat",
    });

    expect(hrefs(items)).toEqual(["/", "/tarinat"]);
    expect(items[1].label).toBe("Tarinat");
  });

  it("drops every configured link inside the story namespace", () => {
    const items = build({
      staticLinks: [
        { label: "Home", href: "/" },
        { label: "Stories", href: "/tarinat" },
        // A hand-maintained restatement of the tree, which ADR-0003 rules out.
        { label: "Landscape", href: "/tarinat/landscape" },
        { label: "Contact", href: "/contact" },
      ],
    });

    expect(hrefs(items)).toEqual(["/", "/tarinat", "/contact"]);
  });

  it("ignores a second configured link to the same static route", () => {
    const items = build({
      staticLinks: [
        { label: "Services", href: "/services" },
        { label: "Our services", href: "/services/" },
      ],
    });

    expect(hrefs(items)).toEqual(["/services", "/tarinat"]);
    expect(items[0].label).toBe("Services");
  });

  it("omits the section when the locale publishes no tree", () => {
    expect(hrefs(build({ tree: undefined }))).toEqual([
      "/",
      "/services",
      "/portfolio",
      "/contact",
    ]);
  });

  it("omits the section when the tree has nothing public to show", () => {
    // The story root does not resolve for such a tree, so an entry pointing at
    // it would be a 404 in the chrome of every page.
    const empty = buildContentTree({
      categories: [
        { categoryId: "cat-archive", parentId: null, slug: "archive", label: "Archive", order: 0 },
      ],
      placements: [],
    });

    expect(hrefs(build({ tree: empty }))).not.toContain("/tarinat");
  });

  it("composes category paths in the locale's own route space", () => {
    const section = findByHref(
      build({ locale: "en", staticLinks: [], storyLabel: "Stories" }),
      "/en/stories",
    );

    expect(hrefs(section.children)).toEqual([
      "/en/stories/landscape",
      "/en/stories/travel",
    ]);
  });

  it("exposes nothing beyond the label and the route of each entry", () => {
    // A menu that carried a cover, a summary, or a listing row would load
    // content on every page of the site to render itself.
    const seen = new Set<string>();
    const walk = (items: readonly SiteNavigationItem[]) => {
      for (const item of items) {
        for (const key of Object.keys(item)) seen.add(key);
        walk(item.children);
      }
    };
    walk(build());

    expect([...seen].sort()).toEqual(["children", "href", "key", "label"]);
  });

  it("keys entries by an identity a rename does not change", () => {
    const section = findByHref(build(), "/tarinat");

    expect(section.children.map((child) => child.key)).toEqual([
      "cat-landscape",
      "cat-travel",
    ]);
  });
});

describe("buildCategoryNavigation", () => {
  const categories = buildCategoryNavigation({ tree, config, locale: "fi" });

  it("lists public top-level categories in sibling order", () => {
    expect(categories.map((category) => category.label)).toEqual([
      "Landscape",
      "Travel",
    ]);
  });

  it("leaves a category with nothing public to show out of the menu", () => {
    expect(hrefs(categories)).not.toContain("/tarinat/archive");
  });

  it("carries the second level and stops there", () => {
    expect(MAX_NAVIGATION_CATEGORY_DEPTH).toBe(2);

    const travel = findByHref(categories, "/tarinat/travel");
    expect(hrefs(travel.children)).toEqual(["/tarinat/travel/europe"]);
    // Depth 3 is reached from the branch landing page above it, not the menu.
    expect(travel.children[0].children).toEqual([]);
  });

  it("honors a narrower configured depth", () => {
    const shallow = buildCategoryNavigation({
      tree,
      config,
      locale: "fi",
      maxCategoryDepth: 1,
    });

    expect(hrefs(shallow)).toEqual(["/tarinat/landscape", "/tarinat/travel"]);
    expect(shallow.every((category) => category.children.length === 0)).toBe(true);
  });

  it("rejects a depth the tree cannot have", () => {
    for (const maxCategoryDepth of [0, 6, 1.5]) {
      expect(() =>
        buildCategoryNavigation({ tree, config, locale: "fi", maxCategoryDepth }),
      ).toThrow(RangeError);
    }
  });
});

describe("resolveNavigationItemState", () => {
  it("marks the page the visitor is on", () => {
    expect(resolveNavigationItemState("/services", "/services")).toBe("current");
    expect(resolveNavigationItemState("/services", "/services/")).toBe("current");
    expect(resolveNavigationItemState("/", "/")).toBe("current");
  });

  it("marks a branch that contains the current page", () => {
    expect(resolveNavigationItemState("/tarinat", "/tarinat/travel/europe")).toBe(
      "ancestor",
    );
    expect(resolveNavigationItemState("/services", "/services/weddings")).toBe(
      "ancestor",
    );
  });

  it("compares whole path segments", () => {
    expect(
      resolveNavigationItemState("/services", "/services-for-agencies"),
    ).toBe("elsewhere");
    expect(resolveNavigationItemState("/tarinat", "/tarinatar")).toBe(
      "elsewhere",
    );
  });

  it("never makes the site root an ancestor of everything", () => {
    expect(resolveNavigationItemState("/", "/services")).toBe("elsewhere");
  });
});

describe("toAriaCurrent", () => {
  it("distinguishes the current page from the branch holding it", () => {
    expect(toAriaCurrent("current")).toBe("page");
    expect(toAriaCurrent("ancestor")).toBe("location");
    expect(toAriaCurrent("elsewhere")).toBeUndefined();
  });
});
