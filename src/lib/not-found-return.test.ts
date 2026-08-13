import { describe, expect, it } from "vitest";
import { buildContentTree } from "@/lib/content-tree";
import { resolveGalleryReturn } from "@/lib/not-found-return";
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

const trees: LocalizedContentTrees = new Map([
  ["fi", buildContentTree(mockContentTreeInputs.fi)],
  ["en", buildContentTree(mockContentTreeInputs.en)],
]);

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
