import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { buildContentTree } from "@/lib/content-tree";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { loadDeploymentConfig } from "@/lib/deployment-config";

const settings = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
const content = vi.hoisted(() => ({ getContentTrees: vi.fn(), getContentRedirects: vi.fn(), getContentPage: vi.fn(), getAdjacentContent: vi.fn() }));
const gallery = vi.hoisted(() => ({ getArticleEndGalleryPage: vi.fn() }));
const curated = vi.hoisted(() => ({ getGalleryPage: vi.fn() }));
const deployment = vi.hoisted(() => ({ getDeploymentConfig: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/site-settings", () => settings);
vi.mock("@/lib/content", () => content);
vi.mock("@/lib/article-end-gallery", () => gallery);
vi.mock("@/lib/gallery", async (original) => ({ ...await original<typeof import("@/lib/gallery")>(), ...curated }));
vi.mock("@/lib/deployment-config", async (original) => ({ ...await original<typeof import("@/lib/deployment-config")>(), ...deployment }));

import Page from "./page";
import { ContentArticle } from "@/components/content-article";
import { ContentGallery } from "@/components/content-gallery";
import { ContentBody } from "@/components/content-body";

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
  content.getContentRedirects.mockResolvedValue([]);
  content.getAdjacentContent.mockResolvedValue({});
  curated.getGalleryPage.mockResolvedValue({ items: [], sections: [], page: { hasNextPage: false, endCursor: null } });
});

function serve(variant: "article" | "gallery", galleryLayout?: "grid" | "masonry" | "justified") {
  const tree = buildContentTree({ categories: [], placements: [{ contentId: "page", variant, slug: "page", published: true, canonicalAtStoryRoot: true, canonicalCategoryId: null }] });
  content.getContentTrees.mockResolvedValue(new Map([["en", tree]]));
  content.getContentPage.mockResolvedValue({ contentId: "page", variant, title: "A page", publishedAt: "2026-01-01T00:00:00Z", body: [{ type: "paragraph", text: "A body" }], ...(galleryLayout === undefined ? {} : { galleryLayout }) });
  return Page({ params: Promise.resolve({ localePrefix: "stories", segments: ["page"] }), searchParams: Promise.resolve({}) });
}

describe("body mini-gallery layout from the actual content route", () => {
  for (const galleryLayout of ["grid", "masonry", "justified"] as const) {
    it(`passes site ${galleryLayout} into article bodies without an end gallery`, async () => {
      settings.getSiteSettings.mockResolvedValue({ photographerName: "Example", galleryLayout });
      const rendered = await serve("article");
      const props = findProps(rendered, ContentArticle)!;
      const body = findProps(ContentArticle(props as Parameters<typeof ContentArticle>[0]), ContentBody);
      expect(body?.miniGalleryLayout).toBe(galleryLayout);
      expect(gallery.getArticleEndGalleryPage).not.toHaveBeenCalled();
    });
    it(`keeps the gallery's explicit ${galleryLayout} override in its body`, async () => {
      settings.getSiteSettings.mockResolvedValue({ photographerName: "Example", galleryLayout: galleryLayout === "justified" ? "grid" : "justified" });
      const rendered = await serve("gallery", galleryLayout);
      const props = findProps(rendered, ContentGallery)!;
      const body = findProps(ContentGallery(props as Parameters<typeof ContentGallery>[0]), ContentBody);
      expect(body?.miniGalleryLayout).toBe(galleryLayout);
    });
  }
});
