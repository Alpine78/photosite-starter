import { describe, expect, it } from "vitest";
import { buildContentRedirects } from "@/lib/content-redirects";
import { buildContentTree } from "@/lib/content-tree";
import { mockContentPages } from "@/lib/mock-content-pages";
import {
  mockContentRedirectInputs,
  mockContentTreeInputs,
} from "@/lib/mock-content-tree";
import {
  resolveGalleryRequestTargetFromSources,
  type GalleryRequestSources,
} from "@/lib/gallery-request";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "en", prefix: null, storyNamespace: "stories" },
    { locale: "fi", prefix: "fi", storyNamespace: "tarinat" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

const trees = new Map([
  ["en", buildContentTree(mockContentTreeInputs.en)],
  ["fi", buildContentTree(mockContentTreeInputs.fi)],
]);

const redirects = new Map([
  [
    "en",
    buildContentRedirects(trees.get("en")!, mockContentRedirectInputs.en),
  ],
  [
    "fi",
    buildContentRedirects(trees.get("fi")!, mockContentRedirectInputs.fi),
  ],
]);

function sources(
  overrides: Partial<GalleryRequestSources> = {},
): GalleryRequestSources {
  return {
    config,
    trees,
    redirects,
    defaultLocaleRouteExists: async () => false,
    contentPageSource: async (locale, contentId) =>
      mockContentPages[locale]?.get(contentId),
    ...overrides,
  };
}

describe("resolveGalleryRequestTargetFromSources", () => {
  it.each([
    ["/stories/portfolio/large-archive", "en"],
    ["/fi/tarinat/portfolio/suuri-arkisto", "fi"],
  ])("resolves the canonical published gallery %s", async (path, locale) => {
    await expect(
      resolveGalleryRequestTargetFromSources(path, sources()),
    ).resolves.toEqual({ locale, contentId: "content-large-archive" });
  });

  it.each([
    ["a trailing slash", "/stories/portfolio/large-archive/"],
    ["a repeated slash", "/stories/portfolio//large-archive"],
    ["different casing", "/STORIES/portfolio/large-archive"],
    ["a redundant default prefix", "/en/stories/portfolio/large-archive"],
    ["a protocol-relative path", "//stories/portfolio/large-archive"],
  ])("refuses %s rather than normalizing it", async (_case, path) => {
    await expect(
      resolveGalleryRequestTargetFromSources(path, sources()),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["a category", "/stories/portfolio"],
    ["an article", "/stories/technique/shooting-in-low-light"],
    ["an unknown slug", "/stories/portfolio/not-a-gallery"],
  ])("refuses %s, which names no gallery slice", async (_case, path) => {
    await expect(
      resolveGalleryRequestTargetFromSources(path, sources()),
    ).resolves.toBeUndefined();
  });

  it("re-checks the tree's gallery identity against the content source", async () => {
    await expect(
      resolveGalleryRequestTargetFromSources(
        "/stories/portfolio/large-archive",
        sources({ contentPageSource: async () => undefined }),
      ),
    ).resolves.toBeUndefined();
  });
});
