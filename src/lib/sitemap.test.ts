import { describe, expect, it } from "vitest";

import { buildContentTree, type ContentTree } from "@/lib/content-tree";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { mockContentTreeInputs } from "@/lib/mock-content-tree";
import {
  buildSitemapPaths,
  SitemapPathCollisionError,
} from "@/lib/sitemap";

const localeRoutes = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
    // Configured, but not yet published: exercises the "absent tree" guard.
    { locale: "sv", prefix: "sv", storyNamespace: "berattelser" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

const finnish = buildContentTree(mockContentTreeInputs.fi);
const english = buildContentTree(mockContentTreeInputs.en);
const trees = new Map<string, ContentTree>([
  ["fi", finnish],
  ["en", english],
]);

const services = [{ slug: "portraits" }, { slug: "weddings" }];

describe("buildSitemapPaths", () => {
  it("includes the static pages exactly once", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    expect(paths).toContain("/");
    expect(paths).toContain("/contact");
    expect(paths).toContain("/services");
  });

  it("includes every service detail path", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services });

    expect(paths).toContain("/services/portraits");
    expect(paths).toContain("/services/weddings");
  });

  it("includes the story root and every public category/content path, per locale", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    expect(paths).toContain("/tarinat");
    expect(paths).toContain("/en/stories");
    expect(paths).toContain("/tarinat/maisemat/rannikko/rannikon-aamut");
    expect(paths).toContain("/en/stories/landscape/coastal/coastal-mornings");
  });

  it("omits a configured locale that publishes no content tree yet", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    expect(paths.some((path) => path.startsWith("/sv"))).toBe(false);
  });

  it("omits the story root for a locale whose tree has no public category yet", () => {
    const emptyTree = buildContentTree({
      categories: [
        { categoryId: "cat-draft", parentId: null, slug: "draft", label: "Draft", order: 0 },
      ],
      placements: [],
    });
    const withEmptyLocale = new Map(trees).set("sv", emptyTree);
    const config = buildLocaleRouteConfig({
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en", prefix: "en", storyNamespace: "stories" },
        { locale: "sv", prefix: "sv", storyNamespace: "berattelser" },
      ],
      reservedRootSegments: ["services"],
      reservedLocaleRouteSegments: ["services"],
    });

    const paths = buildSitemapPaths({
      localeRoutes: config,
      trees: withEmptyLocale,
      services: [],
    });

    // resolveStoryRoute 404s this exact state, so no /sv path may appear.
    expect(paths.some((path) => path.startsWith("/sv"))).toBe(false);
  });

  it("omits an unpublished, unplaced draft", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    expect(
      paths.some((path) => path.endsWith("/unplaced-draft")),
    ).toBe(false);
  });

  it("omits a private, empty category branch", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    expect(paths.some((path) => path.includes("/archive"))).toBe(false);
    expect(paths.some((path) => path.includes("/arkisto"))).toBe(false);
  });

  it("lists a secondary-only category once, but never as an extra content route", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    // cat-events is public only through content-coastal-mornings's secondary
    // placement; it owns a category listing path but not a duplicate content
    // path for that page.
    expect(paths).toContain("/tarinat/tapahtumat");
    expect(paths).toContain("/en/stories/events");
    expect(
      paths.filter((path) => path.endsWith("/coastal-mornings")),
    ).toHaveLength(1);
    expect(
      paths.filter((path) => path.endsWith("/rannikon-aamut")),
    ).toHaveLength(1);
  });

  it("never contains a cursor or section query string", () => {
    const paths = buildSitemapPaths({ localeRoutes, trees, services: [] });

    for (const path of paths) {
      expect(path).not.toContain("?cursor=");
      expect(path).not.toContain("?section=");
      expect(path).not.toContain("?");
    }
  });

  it("never reaches the private client-gallery namespace (ADR-0014 §6)", () => {
    // `buildSitemapPaths` reads only the static pages, the services, and the
    // per-locale public content tree — it has no input that could name the
    // private prefix. The prefix is also a reserved root segment
    // (`deployment-config.ts`), so no locale prefix or story namespace can be
    // it. This is regression documentation of an isolation that holds by
    // construction, for every possible configured prefix.
    const paths = buildSitemapPaths({ localeRoutes, trees, services });

    for (const prefix of ["private", "clients", "kundgalleri"]) {
      expect(paths).not.toContain(`/${prefix}`);
      expect(paths.some((path) => path.startsWith(`/${prefix}/`))).toBe(false);
    }
  });

  it("returns a deterministically sorted, duplicate-free list", () => {
    const first = buildSitemapPaths({ localeRoutes, trees, services });
    const second = buildSitemapPaths({ localeRoutes, trees, services });

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual([...first].sort());
  });

  it("throws when two inputs generate the same path", () => {
    const duplicated = [{ slug: "weddings" }, { slug: "weddings" }];

    expect(() =>
      buildSitemapPaths({ localeRoutes, trees, services: duplicated }),
    ).toThrow(SitemapPathCollisionError);
  });
});
