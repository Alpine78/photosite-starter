import { describe, expect, it, vi } from "vitest";
import { buildContentRedirects } from "@/lib/content-redirects";
import { buildContentTree } from "@/lib/content-tree";
import { mockContentPages } from "@/lib/mock-content-pages";
import { mockContentRedirectInputs, mockContentTreeInputs } from "@/lib/mock-content-tree";
import {
  resolveGalleryReturn,
  resolveNotFoundReturn,
  type NotFoundReturnSources,
} from "@/lib/not-found-return";
import {
  buildLocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

const trees: LocalizedContentTrees = new Map([
  ["fi", buildContentTree(mockContentTreeInputs.fi)],
  ["en", buildContentTree(mockContentTreeInputs.en)],
]);

const redirects = new Map([
  [
    "fi",
    buildContentRedirects(trees.get("fi")!, mockContentRedirectInputs.fi),
  ],
  [
    "en",
    buildContentRedirects(trees.get("en")!, mockContentRedirectInputs.en),
  ],
]);

const contentPageSource: NotFoundReturnSources["contentPageSource"] = async (
  locale,
  contentId,
) => mockContentPages[locale]?.get(contentId);

const galleryPageSource: NotFoundReturnSources["galleryPageSource"] = async () => ({
  items: [],
  page: { size: 24, hasNextPage: false, endCursor: null },
  sections: [],
});

function sources(
  overrides: Partial<NotFoundReturnSources> = {},
): NotFoundReturnSources {
  return {
    config,
    trees,
    redirects,
    defaultLocaleRouteExists: async () => false,
    contentPageSource,
    galleryPageSource,
    ...overrides,
  };
}

describe("resolveGalleryReturn", () => {
  it("names a published gallery's parameter-free first page", () => {
    expect(
      resolveGalleryReturn(
        config,
        {
          kind: "story",
          locale: "en",
          route: {
            kind: "content",
            contentId: "content-large-archive",
            variant: "gallery",
          },
        },
        trees,
      ),
    ).toEqual({
      href: "/en/stories/portfolio/large-archive",
      locale: "en",
    });
  });

  it("names it in the locale whose route space was refused", () => {
    // The boundary has no `params`, so the locale this returns is the only
    // thing that can decide which language the link is labelled in.
    expect(
      resolveGalleryReturn(
        config,
        {
          kind: "story",
          locale: "fi",
          route: {
            kind: "content",
            contentId: "content-large-archive",
            variant: "gallery",
          },
        },
        trees,
      ),
    ).toEqual({
      href: "/tarinat/portfolio/suuri-arkisto",
      locale: "fi",
    });
  });

  it("offers nothing for an address that resolves to nothing", () => {
    // The whole point of resolving rather than trimming the query off the
    // refused path: a guessed destination would lead from one 404 to another.
    expect(
      resolveGalleryReturn(config, { kind: "not-found" }, trees),
    ).toBeUndefined();
  });

  it("offers nothing for a path that redirects rather than 404s", () => {
    expect(
      resolveGalleryReturn(
        config,
        { kind: "redirect", location: "/tarinat/maisemat" },
        trees,
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      "an article",
      {
        kind: "content",
        contentId: "content-shooting-in-low-light",
        variant: "article",
      },
    ],
    ["a category", { kind: "category", categoryId: "cat-portfolio" }],
    ["the story root", { kind: "story-root" }],
  ])("offers nothing for %s, which issues no cursor", (_case, route) => {
    // A gallery is the only route whose *resolvable* path can 404, because it
    // is the only one that issues a continuation token. Anywhere else the link
    // would either never be reached or point at a page that answers fine.
    expect(
      resolveGalleryReturn(
        config,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { kind: "story", locale: "en", route: route as any },
        trees,
      ),
    ).toBeUndefined();
  });

  it("offers nothing when the locale publishes no tree", () => {
    expect(
      resolveGalleryReturn(
        config,
        {
          kind: "story",
          locale: "en",
          route: {
            kind: "content",
            contentId: "content-large-archive",
            variant: "gallery",
          },
        },
        new Map(),
      ),
    ).toBeUndefined();
  });
});

describe("resolveNotFoundReturn", () => {
  it("follows one canonical redirect to identify the refused gallery", async () => {
    await expect(
      resolveNotFoundReturn(
        "/EN/STORIES/PORTFOLIO/LARGE-ARCHIVE/",
        sources(),
      ),
    ).resolves.toEqual({
      href: "/en/stories/portfolio/large-archive",
      locale: "en",
    });
  });

  it("offers nothing when the tree's gallery content page is not served", async () => {
    const readGallery = vi.fn(galleryPageSource);

    await expect(
      resolveNotFoundReturn(
        "/en/stories/portfolio/large-archive",
        sources({
          contentPageSource: async () => undefined,
          galleryPageSource: readGallery,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(readGallery).not.toHaveBeenCalled();
  });

  it("offers nothing when the gallery's parameter-free first page is not served", async () => {
    await expect(
      resolveNotFoundReturn(
        "/en/stories/portfolio/large-archive",
        sources({ galleryPageSource: async () => undefined }),
      ),
    ).resolves.toBeUndefined();
  });

  it("offers nothing for an unknown cursor-bearing address", async () => {
    await expect(
      resolveNotFoundReturn(
        "/en/stories/portfolio/no-such-gallery",
        sources(),
      ),
    ).resolves.toBeUndefined();
  });
});
