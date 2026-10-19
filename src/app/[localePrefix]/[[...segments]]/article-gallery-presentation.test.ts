import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { buildContentTree } from "@/lib/content-tree";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { loadDeploymentConfig } from "@/lib/deployment-config";

const settings = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
const content = vi.hoisted(() => ({ getContentTrees: vi.fn(), getContentRedirects: vi.fn(), getContentPage: vi.fn(), getAdjacentContent: vi.fn() }));
const gallery = vi.hoisted(() => ({ getArticleEndGalleryPage: vi.fn() }));
const deployment = vi.hoisted(() => ({ getDeploymentConfig: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/site-settings", () => settings);
vi.mock("@/lib/content", () => content);
vi.mock("@/lib/article-end-gallery", () => gallery);
vi.mock("@/lib/deployment-config", async (original) => ({ ...await original<typeof import("@/lib/deployment-config")>(), ...deployment }));

import Page, { generateMetadata } from "./page";
import { UnknownGallerySectionError } from "@/lib/gallery-sections";
import { ContentArticle } from "@/components/content-article";
import { ArticleEndGalleryContinuation } from "@/components/article-end-gallery";

function findProps(node: ReactNode, type: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map((child) => findProps(child, type)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node.props;
  return findProps(node.props.children, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  deployment.getDeploymentConfig.mockReturnValue({
    ...loadDeploymentConfig({ SITE_CONTENT_SOURCE: "mock", SITE_DEPLOYMENT_STAGE: "development", SITE_LOCALE: "en", SITE_LOCALE_ROUTES: "en||stories", SITE_CANONICAL_BASE_URL: "https://example.test", SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp", SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536", SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024" }),
    localeRoutes: buildLocaleRouteConfig({ locales: [{ locale: "en", prefix: null, storyNamespace: "stories" }], reservedRootSegments: [], reservedLocaleRouteSegments: [] }),
  });
  const tree = buildContentTree({ categories: [], placements: [{ contentId: "article", variant: "article", slug: "article", published: true, canonicalAtStoryRoot: true, canonicalCategoryId: null }] });
  content.getContentTrees.mockResolvedValue(new Map([["en", tree]]));
  content.getContentRedirects.mockResolvedValue([]);
  content.getContentPage.mockResolvedValue({ contentId: "article", variant: "article", title: "A story", publishedAt: "2026-01-01T00:00:00Z", body: [], endGalleryId: "end-gallery" });
  content.getAdjacentContent.mockResolvedValue({});
  gallery.getArticleEndGalleryPage.mockResolvedValue({ items: [], page: { hasNextPage: false, endCursor: null } });
});

describe("article end-gallery route presentation", () => {
  it.each([undefined, "selected-cursor"])("uses not-found for a stale catalog on first/continued pages and metadata (%s)", async cursor => {
    settings.getSiteSettings.mockResolvedValue({ photographerName: "Example" });
    content.getContentPage.mockResolvedValue({ contentId: "article", variant: "article", title: "A story", publishedAt: "2026-01-01T00:00:00Z", body: [], endGalleryId: "end-gallery", endGallerySectionHeading: "Image themes", endGallerySections: [{ sectionId: "stable-one", slug: "soft-light", label: "Soft light", order: 0 }] });
    gallery.getArticleEndGalleryPage.mockRejectedValue(new UnknownGallerySectionError("stable-one"));
    const props = { params: Promise.resolve({ localePrefix: "stories", segments: ["article"] }), searchParams: Promise.resolve({ section: "soft-light", ...(cursor === undefined ? {} : { cursor }) }) };
    await expect(generateMetadata(props)).resolves.toEqual({});
    await expect(Page(props)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
  for (const galleryLayout of ["grid", "masonry", "justified"] as const) {
    it(`keeps the authored ${galleryLayout}/overlay setting on first and direct continuation pages`, async () => {
      settings.getSiteSettings.mockResolvedValue({ photographerName: "Example", galleryLayout, galleryCaptionPlacement: "overlay" });
      const params = Promise.resolve({ localePrefix: "stories", segments: ["article"] });
      const first = await Page({ params, searchParams: Promise.resolve({}) });
      expect(findProps(first, ContentArticle)?.endGallery).toMatchObject({ presentation: { layout: galleryLayout, captionPlacement: "overlay" } });
      const continued = await Page({ params, searchParams: Promise.resolve({ cursor: "valid-cursor" }) });
      expect(findProps(continued, ArticleEndGalleryContinuation)?.presentation).toEqual({ layout: galleryLayout, captionPlacement: "overlay" });
      expect(gallery.getArticleEndGalleryPage).toHaveBeenLastCalledWith("en", "article", "end-gallery", "valid-cursor");
    });
  }
  it("uses justified/below for both routes when the site has no presentation fields", async () => {
    settings.getSiteSettings.mockResolvedValue({ photographerName: "Example" });
    const params = Promise.resolve({ localePrefix: "stories", segments: ["article"] });
    const first = await Page({ params, searchParams: Promise.resolve({}) });
    const continued = await Page({ params, searchParams: Promise.resolve({ cursor: "valid-cursor" }) });
    expect(findProps(first, ContentArticle)?.endGallery).toMatchObject({ presentation: { layout: "justified", captionPlacement: "below" } });
    expect(findProps(continued, ArticleEndGalleryContinuation)?.presentation).toEqual({ layout: "justified", captionPlacement: "below" });
  });
});
