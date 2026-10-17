import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentBody } from "@/components/content-body";
import { ContentArticle } from "@/components/content-article";
import type { ContentBlock, ArticleContentPage } from "@/lib/content-page";
import { getBuiltInLabels } from "@/lib/deployment-config";
import type { LightboxSlide } from "@/lib/lightbox-slides";
import { mockImages } from "@/lib/mock-media";

const viewers = vi.hoisted(() => [] as {
  slides: readonly LightboxSlide[];
  enquiryBasePath?: string;
  continuation?: unknown;
}[]);
vi.mock("@/components/gallery-lightbox", () => ({
  GalleryLightbox: ({ children, ...props }: { children: ReactNode; slides: readonly LightboxSlide[] }) => {
    viewers.push(props);
    return children;
  },
  GalleryLightboxTrigger: () => { throw new Error("Server figures must remain plain images"); },
}));

const labels = getBuiltInLabels("en-GB");
const first: ContentBlock = { type: "media", key: "first-occurrence", media: mockImages.forestStream, caption: "First placement" };
const repeated: ContentBlock = { type: "media", key: "repeated-occurrence", media: mockImages.forestStream, caption: "Second placement" };
const mini: ContentBlock = { type: "mini-gallery", items: [{ media: mockImages.lichenStones }, { media: mockImages.forestStream }] };
beforeEach(() => { viewers.length = 0; });

describe("article loose-image viewer boundaries", () => {
  it("isolates repeated photographs by occurrence while retaining the mini-gallery's own sequence", () => {
    const html = renderToStaticMarkup(createElement(ContentBody, { blocks: [first, mini, repeated], labels, standaloneImages: true }));
    expect(viewers.map(viewer => viewer.slides.map(slide => slide.itemId))).toEqual([
      ["first-occurrence"], ["mini-image-0", "mini-image-1"], ["repeated-occurrence"],
    ]);
    expect(viewers[0].slides[0].mediaId).toBe(viewers[2].slides[0].mediaId);
    expect(viewers[0].slides[0].caption).toBe("First placement");
    expect(viewers[2].slides[0].caption).toBe("Second placement");
    expect(html).not.toContain("data-item-id");
    expect(html).not.toContain("<button");
    expect(html.match(/<figure/g)).toHaveLength(4);
  });

  it("keeps gallery-body photographs in one source-ordered sequence across a mini-gallery", () => {
    renderToStaticMarkup(createElement(ContentBody, { blocks: [first, mini, repeated], labels }));
    expect(viewers.map(viewer => viewer.slides.map(slide => slide.itemId))).toEqual([
      ["first-occurrence", "repeated-occurrence"], ["mini-image-0", "mini-image-1"],
    ]);
  });

  it("does not serialize archive/provider fields or add enquiries or continuation", () => {
    const tainted = { ...mockImages.forestStream, archiveLocator: "PRIVATE-ARCHIVE", masterUrl: "PRIVATE-MASTER", providerId: "PRIVATE-PROVIDER" };
    renderToStaticMarkup(createElement(ContentBody, { blocks: [{ type: "media", media: tainted }], labels, standaloneImages: true }));
    expect(viewers).toHaveLength(1);
    expect(viewers[0].slides).toHaveLength(1);
    expect(viewers[0].slides[0]).toMatchObject({ width: tainted.rendition.width, height: tainted.rendition.height });
    expect(JSON.stringify(viewers)).not.toMatch(/PRIVATE-|archiveLocator|masterUrl|providerId/);
    expect(viewers[0].enquiryBasePath).toBeUndefined();
    expect(viewers[0].continuation).toBeUndefined();
  });

  it("creates no viewer for empty or video-only bodies", () => {
    for (const standaloneImages of [false, true]) {
      renderToStaticMarkup(createElement(ContentBody, { blocks: [], labels, standaloneImages }));
      renderToStaticMarkup(createElement(ContentBody, { blocks: [{ type: "media", media: { type: "video", mediaId: "clip", src: "https://example.test/clip.mp4", title: "Clip", width: 1920, height: 1080 } }], labels, standaloneImages }));
    }
    expect(viewers).toEqual([]);
  });

  it("the real article caller selects isolation, leaves its cover static and preserves authored links", () => {
    const page: ArticleContentPage = {
      variant: "article", contentId: "article", title: "Article",
      publishedAt: "2020-01-01", eventDate: "2020-01-01", cover: mockImages.lichenStones,
      body: [first, { type: "paragraph", text: "Link", spans: [{ text: "Link", href: "https://example.test/reference" }] }, repeated],
    };
    const html = renderToStaticMarkup(createElement(ContentArticle, { page, locale: "en-GB", authorName: "Author", breadcrumbs: [], languages: [], labels }));
    expect(viewers.map(viewer => viewer.slides.map(slide => slide.itemId))).toEqual([["first-occurrence"], ["repeated-occurrence"]]);
    expect(html).toContain('href="https://example.test/reference"');
    expect(html).not.toContain("data-item-id");
    expect(html).toContain(mockImages.lichenStones.alt);
  });
});
