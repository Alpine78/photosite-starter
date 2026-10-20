import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroOverlay } from "../src/components/hero-overlay";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { projectPublicImageMedia } from "../src/lib/media";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { revealContents } from "./support/reading-contents";

const locales = [
  { locale: appUnderTestEnvironment.SITE_LOCALE, prefix: "" },
  { locale: PREFIXED_LOCALE.prefix, prefix: `/${PREFIXED_LOCALE.prefix}` },
];
const codec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);

function contentPath(locale: string, prefix: string, contentId: string) {
  const language = new Intl.Locale(locale).language;
  const tree = buildContentTree(mockContentTreeInputs[language]!);
  const path = getCanonicalContentPath(tree, contentId);
  if (path === null) throw new Error(`[e2e] Missing presentation fixture ${contentId} in ${locale}`);
  const namespace = prefix === "" ? DEFAULT_STORY_NAMESPACE : PREFIXED_LOCALE.storyNamespace;
  return `${prefix}/${namespace}/${path.join("/")}`;
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(`content presentation with JavaScript ${javaScriptEnabled}`, () => {
    test.use({ javaScriptEnabled });

    for (const { locale, prefix } of locales) {
      test(`a sole declared section has no selector on first, filtered and continuation pages in ${locale}`, async ({ page }) => {
        const language = new Intl.Locale(locale).language;
        const labels = getBuiltInLabels(locale);
        const contentId = "content-justified-overlay";
        const result = await getMockGalleryResult(language, contentId, { cursorCodec: codec });
        if (!result || result.sections.length !== 1 || !result.page.hasNextPage) {
          throw new Error("[e2e] Expected one declared section and a paginated result");
        }
        const path = contentPath(locale, prefix, contentId);
        for (const firstPath of [path, `${path}?section=${result.sections[0].slug}`]) {
          await page.goto(firstPath);
          await expect(page.getByRole("navigation", { name: labels.gallery.sectionsNav })).toHaveCount(0);
          await expect(page.getByRole("main").locator("figure img")).toHaveCount(result.items.length);
          const href = await page.getByRole("main").getByRole("link", { name: labels.gallery.showMore }).getAttribute("href");
          expect(href).toBeTruthy();
          await page.goto(href!);
          await expect(page.getByRole("navigation", { name: labels.gallery.sectionsNav })).toHaveCount(0);
          await expect(page.getByRole("main").locator("figure img")).toHaveCount(result.photoCount! - result.items.length);
          expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--gallery-section-height"))).toBe("");
        }
      });

      test(`the authored end-gallery heading and its table-of-contents anchor are reused in ${locale}`, async ({ page }) => {
        const labels = getBuiltInLabels(locale);
        await page.goto(contentPath(locale, prefix, "content-reading-coastal-light"));
        const main = page.getByRole("main");
        const level = new Intl.Locale(locale).language === "fi" ? 2 : 3;
        const heading = main.getByRole("heading", { level, name: labels.article.endGallery, exact: true });
        await expect(main.getByRole("heading", { name: labels.article.endGallery, exact: true })).toHaveCount(1);
        await expect(heading).toHaveCount(1);
        const id = await heading.getAttribute("id");
        expect(id).toBeTruthy();
        const gallery = page.locator("[data-article-end-gallery]");
        await expect(gallery).toHaveAccessibleName(labels.article.endGallery);
        await expect(gallery).toHaveAttribute("aria-labelledby", id!);
        await expect(page.locator("#article-end-gallery")).toHaveCount(1);
        const jump = (await revealContents(page, labels.contentTree.onThisPage)).locator(`a[href="#${id}"]`);
        await jump.click();
        await expect.poll(() => new URL(page.url()).hash).toBe(`#${id}`);
        await expect(heading).toBeInViewport();
        const next = await gallery.getByRole("link", { name: labels.gallery.showMore }).getAttribute("href");
        expect(next).toBeTruthy();
        // Follow the actual server continuation even when JS would append in place.
        await page.goto(next!);
        const continuation = page.getByRole("main");
        // Continuations omit the article body and retain their existing H1
        // and article-title-qualified region name; no authored heading is repeated.
        await expect(continuation.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(continuation.getByRole("heading", { name: labels.article.endGallery, exact: true })).toHaveCount(0);
        await expect(continuation.getByRole("region")).toHaveAccessibleName(new RegExp(`: ${labels.article.endGallery}$`));
        await expect(continuation.locator("img")).toHaveCount(6);
        await continuation.getByRole("link", { name: labels.article.backToArticle }).click();
        await expect(heading).toHaveCount(1);
        await expect(main.getByRole("heading", { name: labels.article.endGallery, exact: true })).toHaveCount(1);
        await expect(page.locator("#article-end-gallery")).toHaveCount(1);
      });
    }
  });
}

// The real shared component and production stylesheet, with geometry controlled
// independently of authored demo copy. A permanent scrollbar gutter reproduces
// the extra black strip even on platforms whose scrollbars normally overlay.
for (const imageHeight of [900, 1200]) {
  for (const viewportHeight of [900, 1800]) {
    test(`hero native frame with a scrollbar gutter: 1600:${imageHeight}, viewport height ${viewportHeight}`, async ({ page }) => {
      await page.setViewportSize({ width: 1800, height: viewportHeight });
      await page.goto("/");
      const src = `/gallery/ab262-frame-${imageHeight}.abcdef123456.webp`;
      const media = projectPublicImageMedia({
        mediaId: "presentation-frame", publiclyRenderable: true,
        rendition: { src, width: 1600, height: imageHeight, version: "abcdef123456", sourceKind: "public-web-derivative" },
        alt: "Synthetic frame", credit: "Synthetic attribution",
      });
      await page.route("**/_next/image?**", async (route) => {
        if (new URL(route.request().url()).searchParams.get("url") !== src) { await route.fallback(); return; }
        await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${imageHeight}"><rect width="100%" height="100%" fill="white"/></svg>` });
      });
      await page.addStyleTag({ content: "html { scrollbar-gutter: stable; }" });
      const markup = renderToStaticMarkup(createElement(HeroOverlay, { media, title: "Synthetic title" }));
      await page.getByRole("main").evaluate((main, html) => { main.innerHTML = html + '<p style="height:1800px">Following content</p>'; }, markup);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator("main > figure").evaluate((figure) => {
        const image = figure.querySelector("img")!;
        const caption = figure.querySelector("figcaption")!;
        const f = figure.getBoundingClientRect();
        const i = image.getBoundingClientRect();
        return { figureBottom: f.bottom, imageBottom: i.bottom, imageWidth: i.width, imageHeight: i.height, captionBottom: caption.getBoundingClientRect().bottom, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(Math.abs(geometry.figureBottom - geometry.imageBottom)).toBeLessThan(1);
      expect(Math.abs(geometry.imageHeight - geometry.imageWidth * imageHeight / 1600)).toBeLessThan(1);
      expect(geometry.captionBottom).toBeLessThanOrEqual(geometry.imageBottom);
      expect(geometry.captionBottom).toBeGreaterThan(geometry.imageBottom - 30);
      expect(geometry.horizontalOverflow).toBe(false);
    });
  }
}
