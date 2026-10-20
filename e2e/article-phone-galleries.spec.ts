import type { Locator } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { DEFAULT_GALLERY_PRESENTATION } from "../src/lib/gallery-presentation";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]!), "content-reading-coastal-light");
if (parts === null) throw new Error("[e2e] The phone gallery fixture needs its canonical path.");
const article = `/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`;

/** Rendered width, and how far the rendered ratio is from the image's own. */
async function measure(image: Locator) {
  // The enhanced gallery may replace its server-rendered images while hydrating.
  await expect(async () => {
    await image.scrollIntoViewIfNeeded({ timeout: 1000 });
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }).toPass();
  return image.evaluate((node) => {
    const img = node as HTMLImageElement, box = img.getBoundingClientRect();
    return { left: box.left, width: box.width, ratioError: Math.abs(box.width / box.height - img.naturalWidth / img.naturalHeight),
      viewport: document.documentElement.clientWidth, maxHeight: innerHeight * 0.8 };
  });
}

// AB#373: on a portrait phone each image is its own row, edge to edge at its
// native ratio; only a tall portrait stays within 80% of the viewport height.
test("a portrait phone shows an article's justified galleries one image per row, edge to edge", async ({ page }) => {
  test.skip(DEFAULT_GALLERY_PRESENTATION.layout !== "justified", "The single-column rule belongs to the justified layout.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(article, { waitUntil: "load" });
  const groups = [page.locator("[data-mini-gallery] img"), page.locator("[data-article-end-gallery] li img")];
  for (const images of groups) {
    await expect(images.first()).toBeAttached();
    for (const image of (await images.all()).slice(0, 3)) {
      const box = await measure(image);
      expect(box.ratioError).toBeLessThan(0.02);
      expect(box.left).toBeGreaterThanOrEqual(-0.5);
      const height = (await image.boundingBox())!.height;
      expect(height).toBeLessThanOrEqual(box.maxHeight + 1);
      // Full width, unless a tall portrait reached its viewport-height bound.
      if (Math.abs(height - box.maxHeight) > 2) expect(box.width).toBeCloseTo(box.viewport, 0);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
