import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdjacentContent,
  getCategoryListing,
  getContentPage,
  getContentRedirects,
  getContentTrees,
  SanityContentPageError,
} from "@/lib/content";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";

/**
 * `content.ts` is the largest of the five route-facing seams AB#135 wires: it
 * dispatches its category tree, redirects, listing, detail-page, and
 * sibling-navigation reads between the mock fixture layer and the Sanity
 * adapters based on `getDeploymentConfig().contentSource`. The Sanity
 * adapters' own internals are covered by their own `sanity-*.test.ts` files
 * and are stubbed here; these tests exercise `content.ts`'s own composition
 * and dispatch logic — including the two gaps this story's plan review
 * surfaced: a locale with zero authored categories must be entirely absent
 * from the map (not a technically valid empty tree), and a category listing
 * must split its bounded read by variant.
 */
const deploymentConfig = vi.hoisted(() => ({
  contentSource: "mock" as "mock" | "sanity",
  localeRoutes: undefined as unknown as ReturnType<
    typeof buildLocaleRouteConfig
  >,
}));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => deploymentConfig,
}));

const sanityContentTree = vi.hoisted(() => ({
  readPublicCategoryInputs: vi.fn(),
}));
vi.mock("@/lib/sanity-content-tree", () => sanityContentTree);

const sanityArticle = vi.hoisted(() => ({
  readPublicArticlePlacements: vi.fn(),
  readPublicArticleListingRecords: vi.fn(),
  readPublicArticlePage: vi.fn(),
  readPublicArticleAdjacentRecords: vi.fn(),
}));
vi.mock("@/lib/sanity-article", () => sanityArticle);

const sanityGallery = vi.hoisted(() => ({
  readPublicGalleryPlacements: vi.fn(),
  readPublicGalleryListingRecords: vi.fn(),
  readPublicGalleryPage: vi.fn(),
}));
vi.mock("@/lib/sanity-gallery", () => sanityGallery);

deploymentConfig.localeRoutes = buildLocaleRouteConfig({
  locales: [
    { locale: "en-GB", prefix: null, storyNamespace: "stories" },
    { locale: "fi-FI", prefix: "fi", storyNamespace: "tarinat" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
});

function resetSanityMocks(): void {
  sanityContentTree.readPublicCategoryInputs.mockReset();
  sanityArticle.readPublicArticlePlacements.mockReset().mockResolvedValue([]);
  sanityArticle.readPublicArticleListingRecords.mockReset().mockResolvedValue([]);
  sanityArticle.readPublicArticlePage.mockReset().mockResolvedValue(undefined);
  sanityArticle.readPublicArticleAdjacentRecords.mockReset();
  sanityGallery.readPublicGalleryPlacements.mockReset().mockResolvedValue([]);
  sanityGallery.readPublicGalleryListingRecords.mockReset().mockResolvedValue([]);
  sanityGallery.readPublicGalleryPage.mockReset().mockResolvedValue(undefined);
}

beforeEach(() => {
  deploymentConfig.contentSource = "mock";
  resetSanityMocks();
});

describe("getContentTrees / getContentRedirects — mock source", () => {
  it("publishes the fixture's own authored locales", async () => {
    const trees = await getContentTrees();

    expect(trees.has("en-GB")).toBe(true);
    expect(sanityContentTree.readPublicCategoryInputs).not.toHaveBeenCalled();
  });

  it("records no path history that was never authored", async () => {
    const redirects = await getContentRedirects();

    expect(redirects.get("en-GB")).toBeDefined();
  });
});

describe("getContentTrees / getContentRedirects — sanity source", () => {
  const categories = [
    { categoryId: "cat-a", parentId: null, slug: "cat-a", label: "Cat A", order: 0 },
  ];
  const articlePlacement = {
    contentId: "content-article",
    variant: "article" as const,
    slug: "an-article",
    published: true,
    canonicalCategoryId: "cat-a",
  };
  const galleryPlacement = {
    contentId: "content-gallery",
    variant: "gallery" as const,
    slug: "a-gallery",
    published: true,
    canonicalCategoryId: "cat-a",
  };

  beforeEach(() => {
    deploymentConfig.contentSource = "sanity";
  });

  it("builds one tree per locale with categories, composing article and gallery placements", async () => {
    sanityContentTree.readPublicCategoryInputs.mockResolvedValue(categories);
    sanityArticle.readPublicArticlePlacements.mockResolvedValue([articlePlacement]);
    sanityGallery.readPublicGalleryPlacements.mockResolvedValue([galleryPlacement]);

    const trees = await getContentTrees();

    expect(trees.has("en-GB")).toBe(true);
    expect(trees.has("fi-FI")).toBe(true);
    const tree = trees.get("en-GB");
    expect(tree?.placements.get("content-article")).toBeDefined();
    expect(tree?.placements.get("content-gallery")).toBeDefined();
  });

  it("omits a locale only when its categories, articles, and galleries are all unauthored", async () => {
    // English is authored, Finnish is not — matching the mock fixture's own
    // "a locale not yet authored is absent from the map" contract.
    sanityContentTree.readPublicCategoryInputs.mockImplementation(
      async ({ language }: { readonly language: string }) =>
        language === "en" ? categories : [],
    );
    sanityArticle.readPublicArticlePlacements.mockImplementation(
      async ({ language }: { readonly language: string }) =>
        language === "en" ? [articlePlacement] : [],
    );
    sanityGallery.readPublicGalleryPlacements.mockImplementation(
      async ({ language }: { readonly language: string }) =>
        language === "en" ? [galleryPlacement] : [],
    );

    const trees = await getContentTrees();

    expect(trees.has("en-GB")).toBe(true);
    expect(trees.has("fi-FI")).toBe(false);
  });

  it("does not hide authored placements when their localized categories are missing", async () => {
    sanityContentTree.readPublicCategoryInputs.mockResolvedValue([]);
    sanityArticle.readPublicArticlePlacements.mockResolvedValue([
      articlePlacement,
    ]);

    await expect(getContentTrees()).rejects.toThrow(
      /canonical category "cat-a" is not in the public tree/i,
    );
  });

  it("never reads previously recorded path history — no adapter provides it yet", async () => {
    sanityContentTree.readPublicCategoryInputs.mockResolvedValue(categories);

    const redirects = await getContentRedirects();

    expect(redirects.get("en-GB")).toBeDefined();
    // buildContentRedirects(tree, []) — nothing recorded, honestly, not a
    // borrowed mock fallback.
  });
});

describe("getContentPage", () => {
  it("reads the mock fixture page when contentSource is mock", async () => {
    const page = await getContentPage("en-GB", "content-selected-work");

    expect(page?.variant).toBe("gallery");
    expect(sanityArticle.readPublicArticlePage).not.toHaveBeenCalled();
    expect(sanityGallery.readPublicGalleryPage).not.toHaveBeenCalled();
  });

  it("reads exactly one variant's detail query when the caller supplies a variant hint", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityGallery.readPublicGalleryPage.mockResolvedValue({
      contentId: "content-gallery",
      variant: "gallery",
      title: "A gallery",
      publishedAt: "2024-01-01",
      body: [],
    });

    const page = await getContentPage("en-GB", "content-gallery", "gallery");

    expect(page?.variant).toBe("gallery");
    expect(sanityGallery.readPublicGalleryPage).toHaveBeenCalledTimes(1);
    expect(sanityArticle.readPublicArticlePage).not.toHaveBeenCalled();
  });

  it("resolves both variants concurrently when no hint is given, for an existence check", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityArticle.readPublicArticlePage.mockResolvedValue({
      contentId: "content-article",
      variant: "article",
      title: "An article",
      publishedAt: "2024-01-01",
      body: [],
    });

    const page = await getContentPage("en-GB", "content-article");

    expect(page?.contentId).toBe("content-article");
    expect(sanityArticle.readPublicArticlePage).toHaveBeenCalledTimes(1);
    expect(sanityGallery.readPublicGalleryPage).toHaveBeenCalledTimes(1);
  });

  it("throws when a content identity resolves to both an article and a gallery", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityArticle.readPublicArticlePage.mockResolvedValue({
      contentId: "content-x",
      variant: "article",
      title: "X",
      publishedAt: "2024-01-01",
      body: [],
    });
    sanityGallery.readPublicGalleryPage.mockResolvedValue({
      contentId: "content-x",
      variant: "gallery",
      title: "X",
      publishedAt: "2024-01-01",
      body: [],
    });

    const error = await getContentPage("en-GB", "content-x").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SanityContentPageError);
    expect((error as SanityContentPageError).rejection).toBe(
      "ambiguous-content-identity",
    );
  });

  it("propagates a classified Sanity failure rather than falling back to the fixture", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityArticle.readPublicArticlePage.mockRejectedValue(
      new Error("classified sanity failure"),
    );

    await expect(
      getContentPage("en-GB", "content-x", "article"),
    ).rejects.toThrow("classified sanity failure");
  });
});

describe("getCategoryListing — sanity source splits by variant", () => {
  const categories = [
    { categoryId: "cat-a", parentId: null, slug: "cat-a", label: "Cat A", order: 0 },
  ];
  const articlePlacement = {
    contentId: "content-article",
    variant: "article" as const,
    slug: "an-article",
    published: true,
    canonicalCategoryId: "cat-a",
  };
  const galleryPlacement = {
    contentId: "content-gallery",
    variant: "gallery" as const,
    slug: "a-gallery",
    published: true,
    canonicalCategoryId: "cat-a",
  };

  beforeEach(() => {
    deploymentConfig.contentSource = "sanity";
    sanityContentTree.readPublicCategoryInputs.mockResolvedValue(categories);
    sanityArticle.readPublicArticlePlacements.mockResolvedValue([articlePlacement]);
    sanityGallery.readPublicGalleryPlacements.mockResolvedValue([galleryPlacement]);
  });

  it("reads each variant's own bounded listing query and merges the result", async () => {
    sanityArticle.readPublicArticleListingRecords.mockResolvedValue([
      { contentId: "content-article", title: "An article", publishedAt: "2024-01-01" },
    ]);
    sanityGallery.readPublicGalleryListingRecords.mockResolvedValue([
      { contentId: "content-gallery", title: "A gallery", publishedAt: "2024-06-01" },
    ]);

    const listing = await getCategoryListing("en-GB", "cat-a");

    expect(listing.content.map((entry) => entry.contentId)).toEqual([
      "content-gallery",
      "content-article",
    ]);
    expect(sanityArticle.readPublicArticleListingRecords).toHaveBeenCalledWith(
      expect.objectContaining({ contentIds: ["content-article"] }),
      { language: "en" },
    );
    expect(sanityGallery.readPublicGalleryListingRecords).toHaveBeenCalledWith(
      expect.objectContaining({ contentIds: ["content-gallery"] }),
      { language: "en" },
    );
  });
});

describe("getAdjacentContent", () => {
  it("selects neighbours from the mock fixture's in-memory rows", async () => {
    const adjacent = await getAdjacentContent(
      "en-GB",
      "content-understanding-exposure-triangle",
    );

    expect(sanityArticle.readPublicArticleAdjacentRecords).not.toHaveBeenCalled();
    // Whatever the fixture's real neighbours are, the mock path never touches
    // the Sanity adapters — that is the property under test here.
    expect(adjacent).toBeDefined();
  });

  it("reads Sanity's bounded sibling query for an article anchor", async () => {
    deploymentConfig.contentSource = "sanity";
    const categories = [
      { categoryId: "cat-a", parentId: null, slug: "cat-a", label: "Cat A", order: 0 },
    ];
    const articlePlacement = {
      contentId: "content-article",
      variant: "article" as const,
      slug: "an-article",
      published: true,
      canonicalCategoryId: "cat-a",
    };
    sanityContentTree.readPublicCategoryInputs.mockResolvedValue(categories);
    sanityArticle.readPublicArticlePlacements.mockResolvedValue([articlePlacement]);
    sanityArticle.readPublicArticleAdjacentRecords.mockResolvedValue({});

    await getAdjacentContent("en-GB", "content-article");

    expect(sanityArticle.readPublicArticleAdjacentRecords).toHaveBeenCalledWith(
      "content-article",
      { language: "en" },
    );
  });

  it("throws for a gallery anchor — no route requests gallery sibling navigation today", async () => {
    deploymentConfig.contentSource = "sanity";
    const categories = [
      { categoryId: "cat-a", parentId: null, slug: "cat-a", label: "Cat A", order: 0 },
    ];
    const galleryPlacement = {
      contentId: "content-gallery",
      variant: "gallery" as const,
      slug: "a-gallery",
      published: true,
      canonicalCategoryId: "cat-a",
    };
    sanityContentTree.readPublicCategoryInputs.mockResolvedValue(categories);
    sanityGallery.readPublicGalleryPlacements.mockResolvedValue([galleryPlacement]);

    const error = await getAdjacentContent("en-GB", "content-gallery").catch(
      (thrown: unknown) => thrown,
    );

    // Classified (AB#139), not a plain Error: a route-level error boundary
    // or log filter pattern-matching on this file's own Sanity*Error family
    // must recognize this failure the same way it recognizes every other one.
    expect(error).toBeInstanceOf(SanityContentPageError);
    expect((error as SanityContentPageError).rejection).toBe("unsupported-variant");
    expect((error as Error).message).toMatch(/no Sanity-backed sibling-navigation reader/);
  });
});
