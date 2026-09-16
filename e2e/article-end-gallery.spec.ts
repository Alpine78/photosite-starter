import { test, expect } from "./support/fixtures";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { openLightbox } from "./support/lightbox";

const locale = appUnderTestEnvironment.SITE_LOCALE;
const tree = buildContentTree(mockContentTreeInputs[new Intl.Locale(locale).language]);
const path = `/${DEFAULT_STORY_NAMESPACE}/${getCanonicalContentPath(tree, "content-reading-coastal-light")!.join("/")}`;
const labels = getBuiltInLabels(locale);

test("end gallery loads only on request, retries and preserves its own sequence", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/article-gallery?**", async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: "{}" });
    else await route.continue();
  });
  await page.goto(path);
  const gallery = page.locator('section[aria-labelledby="article-end-gallery"]');
  const triggers = gallery.locator("button[data-item-id]");
  await expect(triggers).toHaveCount(24);
  await expect(page.locator("[data-mini-gallery]")).toHaveCount(2);
  expect(requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dimensions = await gallery.locator("img").first().evaluate((image) => ({ width: image.getAttribute("width"), height: image.getAttribute("height"), fit: getComputedStyle(image).objectFit }));
  expect(Number(dimensions.width)).toBeGreaterThan(0);
  expect(Number(dimensions.height)).toBeGreaterThan(0);
  expect(dimensions.fit).not.toBe("cover");
  const more = gallery.getByRole("link", { name: labels.gallery.showMore });
  await more.click();
  await expect(gallery.getByText(labels.gallery.loadFailed)).toBeVisible();
  await gallery.getByRole("link", { name: labels.gallery.retry }).click();
  await expect(triggers).toHaveCount(30);
  await expect(gallery.getByText(labels.gallery.allLoaded)).toBeFocused();
  expect(requests).toBe(2);
  expect(page.url()).not.toContain("cursor=");
  const dialog = page.getByRole("dialog", { name: labels.lightbox.viewer });
  await openLightbox(dialog, () => triggers.first().click());
  await expect(dialog.getByText(`1${labels.lightbox.indexSeparator}30`, { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(`2${labels.lightbox.indexSeparator}30`, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(triggers.nth(1)).toBeFocused();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("the real next link serves only the remaining slice with first-page canonical", async ({ page }) => {
    await page.goto(path);
    const gallery = page.locator('section[aria-labelledby="article-end-gallery"]');
    await expect(gallery.locator("img")).toHaveCount(24);
    await gallery.getByRole("link", { name: labels.gallery.showMore }).click();
    await expect(page.getByRole("main").locator("img")).toHaveCount(6);
    await expect(page.locator("[data-mini-gallery]")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
    await expect(page.locator('link[hreflang]')).toHaveCount(0);
    await page.getByRole("link", { name: labels.article.backToArticle }).click();
    await expect(page.locator("[data-mini-gallery]")).toHaveCount(2);
  });
});

test("invalid and repeated cursors never redirect to a normalized article", async ({ request }) => {
  for (const suffix of ["?cursor=bad", "?cursor=bad&cursor=bad"]) {
    const response = await request.get(`${path.toUpperCase()}${suffix}`, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers().location).toBeUndefined();
  }
});

test("the open end-gallery viewer retries a failed continuation without losing its slide", async ({ page }) => {
  let fail = true;
  await page.route("**/api/article-gallery?**", async (route) => {
    if (fail) { fail = false; await route.fulfill({ status: 503, body: "{}" }); }
    else await route.continue();
  });
  await page.goto(path);
  const triggers = page.locator('section[aria-labelledby="article-end-gallery"] button[data-item-id]');
  await expect(triggers).toHaveCount(24);
  const dialog = page.getByRole("dialog", { name: labels.lightbox.viewer });
  await openLightbox(dialog, async () => { await triggers.nth(23).focus(); await page.keyboard.press("Enter"); });
  await expect(dialog.getByText(`24${labels.lightbox.indexSeparator}24`, { exact: true })).toBeVisible();
  await expect(dialog.getByText(labels.gallery.loadFailed)).toBeVisible();
  await dialog.getByRole("button", { name: labels.gallery.retry }).click();
  await expect(dialog.getByText(`24${labels.lightbox.indexSeparator}30`, { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(`25${labels.lightbox.indexSeparator}30`, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(triggers.nth(24)).toBeFocused();
});
