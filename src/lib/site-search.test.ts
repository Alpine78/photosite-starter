import { describe, expect, it } from "vitest";

import { buildContentTree } from "@/lib/content-tree";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { mockImages } from "@/lib/mock-media";
import { buildServiceRoutes } from "@/lib/service-routes";
import type { Service } from "@/lib/services";
import {
  SITE_SEARCH_DIALOG_LIMIT,
  buildSiteSearchResponse,
} from "@/lib/site-search";
import type { SiteSearchStoryRecord } from "@/lib/site-search-index";
import { parseSearchQuery } from "@/lib/site-search-query";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat", serviceNamespace: "palvelut", searchNamespace: "haku" },
    { locale: "en", prefix: "en", storyNamespace: "stories", serviceNamespace: "services", searchNamespace: "search" },
  ],
  reservedRootSegments: [],
  reservedLocaleRouteSegments: [],
});

const tree = buildContentTree({
  categories: [
    { categoryId: "cat-rally", parentId: null, slug: "ralli", label: "Ralli", order: 0 },
  ],
  placements: [
    { contentId: "story-latvia", variant: "gallery", slug: "latvia-2024", published: true, canonicalCategoryId: "cat-rally" },
    { contentId: "story-finland", variant: "gallery", slug: "suomi-2023", published: true, canonicalCategoryId: "cat-rally" },
    { contentId: "story-root-article", variant: "article", slug: "kamerat", published: true, canonicalAtStoryRoot: true, canonicalCategoryId: null },
    { contentId: "story-unpublished", variant: "article", slug: "piilossa", published: false, canonicalCategoryId: "cat-rally" },
  ],
});

function story(
  contentId: string,
  title: string,
  extra: Partial<SiteSearchStoryRecord> = {},
): SiteSearchStoryRecord {
  return { contentId, title, eventDate: "2024-07-30", tags: [], ...extra };
}

const stories: readonly SiteSearchStoryRecord[] = [
  story("story-latvia", "Tet Rally Latvia 2024", { tags: ["rally", "gravel"], cover: mockImages.coastalLandscape }),
  story("story-finland", "Secto Rally Finland 2023", { eventDate: "2023-08-07", summary: "Gravel stages at night." }),
  story("story-root-article", "Camera notes", { summary: "Choosing a rally lens." }),
  // A candidate record with no placement in the tree at all.
  story("story-unplaced", "Rally draft"),
  story("story-unpublished", "Rally secret"),
  story("story-not-in-feed", "Rally ghost"),
];

function service(overrides: Partial<Service> & Pick<Service, "serviceId" | "slug" | "name">): Service {
  return {
    language: "fi",
    shortDescription: "",
    description: [],
    ...overrides,
  };
}

const services = buildServiceRoutes(
  [
    service({ serviceId: "motorsport", slug: "moottoriurheilu", name: "Moottoriurheilukuvaus", shortDescription: "Rallit ja ratakilpailut", coverMedia: mockImages.coastalLandscape }),
    service({ serviceId: "wedding", slug: "haat", name: "Hääkuvaus", shortDescription: "Rally of memories" }),
    service({ serviceId: "hidden", slug: "piilotettu", name: "Rally hidden package", hideFromListing: true }),
    service({ serviceId: "child", slug: "paketti", name: "Rally package", parentServiceId: "motorsport" }),
  ],
  "fi",
);

function search(raw: string, overrides: Partial<Parameters<typeof buildSiteSearchResponse>[0]> = {}) {
  return buildSiteSearchResponse({
    query: parseSearchQuery(raw),
    config,
    locale: "fi",
    stories,
    tree,
    services,
    limit: SITE_SEARCH_DIALOG_LIMIT,
    ...overrides,
  });
}

describe("buildSiteSearchResponse", () => {
  it("returns nothing for a query with no usable token", () => {
    for (const raw of ["", "a", "*", "-", "  "]) {
      const response = search(raw);
      expect(response.stories).toEqual({ hits: [], total: 0 });
      expect(response.services).toEqual({ hits: [], total: 0 });
    }
  });

  it("finds only stories the public tree gives a canonical route, linking to it", () => {
    const { stories: group } = search("rally");
    expect(group.hits.map((hit) => hit.id)).toEqual([
      // Title and tag hit outranks title-only, which outranks a lead-only hit.
      "story-latvia",
      "story-finland",
      "story-root-article",
    ]);
    expect(group.total).toBe(3);
    expect(group.hits.map((hit) => hit.href)).toEqual([
      "/tarinat/ralli/latvia-2024",
      "/tarinat/ralli/suomi-2023",
      "/tarinat/kamerat",
    ]);
  });

  it("builds the locale's own route, not another locale's", () => {
    const response = search("rally", { locale: "en" });
    expect(response.stories.hits[0]?.href).toBe("/en/stories/ralli/latvia-2024");
    expect(response.services.hits[0]?.href.startsWith("/en/services/")).toBe(true);
  });

  it("returns no stories when the locale publishes no tree", () => {
    const response = search("rally", { tree: undefined });
    expect(response.stories).toEqual({ hits: [], total: 0 });
    expect(response.services.total).toBeGreaterThan(0);
  });

  it("requires every token, across different fields", () => {
    // "rally" is a title word and "night" only in the lead of one story.
    expect(search("rally night").stories.hits.map((hit) => hit.id)).toEqual([
      "story-finland",
    ]);
    expect(search("rally nothing").stories.total).toBe(0);
  });

  it("matches by word prefix and through diacritics", () => {
    expect(search("moottori").services.hits.map((hit) => hit.id)).toEqual([
      "motorsport",
    ]);
    // `Hääkuvaus` folds to `haakuvaus`, so the base-letter spelling finds it.
    for (const raw of ["haakuvaus", "haakuv", "hääkuvaus", "HÄÄK"]) {
      expect(search(raw).services.hits.map((hit) => hit.id)).toEqual(["wedding"]);
    }
    // A token is a prefix of a word, never a substring inside one.
    expect(search("kuvaus").services.total).toBe(0);
  });

  it("omits a service hidden from listings but keeps its nested sibling", () => {
    const ids = search("rally", { limit: 50 }).services.hits.map((hit) => hit.id);
    expect(ids).not.toContain("hidden");
    expect(ids).toContain("child");
    const child = search("rally", { limit: 50 }).services.hits.find((hit) => hit.id === "child");
    expect(child?.href).toBe("/palvelut/moottoriurheilu/paketti");
  });

  it("caps each group but reports the exact total", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      story(`story-${index}`, `Rally ${index}`),
    );
    const manyTree = buildContentTree({
      categories: [],
      placements: many.map((record) => ({
        contentId: record.contentId,
        variant: "article" as const,
        slug: record.contentId,
        published: true,
        canonicalAtStoryRoot: true,
        canonicalCategoryId: null,
      })),
    });
    const response = search("rally", { stories: many, tree: manyTree, limit: 5 });
    expect(response.stories.hits).toHaveLength(5);
    expect(response.stories.total).toBe(12);
  });

  it("orders equal scores by newer event date, then contentId", () => {
    const same = [
      story("b-story", "Rally B", { eventDate: "2024-01-01" }),
      story("a-story", "Rally A", { eventDate: "2024-01-01" }),
      story("c-story", "Rally C", { eventDate: "2025-01-01" }),
    ];
    const sameTree = buildContentTree({
      categories: [],
      placements: same.map((record) => ({
        contentId: record.contentId,
        variant: "article" as const,
        slug: record.contentId,
        published: true,
        canonicalAtStoryRoot: true,
        canonicalCategoryId: null,
      })),
    });
    expect(
      search("rally", { stories: same, tree: sameTree }).stories.hits.map((hit) => hit.id),
    ).toEqual(["c-story", "a-story", "b-story"]);
  });

  it("carries a thumbnail as the public derivative with its true dimensions only", () => {
    const hit = search("latvia").stories.hits[0];
    expect(hit?.thumbnail).toEqual({
      src: mockImages.coastalLandscape.rendition.src,
      width: mockImages.coastalLandscape.rendition.width,
      height: mockImages.coastalLandscape.rendition.height,
    });
    // Nothing but what a row shows: no media identity, caption, or credit.
    expect(Object.keys(hit ?? {}).sort()).toEqual([
      "eventDate",
      "href",
      "id",
      "kind",
      "thumbnail",
      "title",
    ]);
    expect(search("moottori").services.hits[0]?.thumbnail).toBeDefined();
    expect(search("hääkuvaus").services.hits[0]?.thumbnail).toBeUndefined();
  });
});
