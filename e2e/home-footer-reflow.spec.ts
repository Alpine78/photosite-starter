import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";
import { expect, test } from "./support/fixtures";
import { PREFIXED_LOCALE } from "./support/harness-environment";
import { expectImageDelivered } from "./support/public-page";

const homes = [{ locale: "default", path: "/" }, { locale: "prefixed", path: `/${PREFIXED_LOCALE.prefix}` }];

/** Apply the visitor's text size before parsing, including subsequent route loads. */
async function rootTextSize(page: Page, baseURL: string, size: number) {
  const origin = new URL(baseURL).origin;
  await page.route((url) => url.origin === origin, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace("</head>",
      `<style>html:root{font-size:${size}px!important}</style></head>`);
    await route.fulfill({ response, body });
  });
}

async function settledText(page: Page, size: number) {
  // Poll from the test runner: scriptless pages do not run animation callbacks.
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${size}px`);
}

/** Check visible text, including anonymous text nodes, without treating sr-only copy as painted text. */
async function expectReflow(page: Page, selector = "main, footer") {
  const regions = await page.locator(selector).evaluateAll((roots) => roots.map((root) => {
    const viewport = document.documentElement.clientWidth;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const overflowingText: { text: string; left: number; right: number }[] = [];
    let node: Node | null;
    let visibleTextNodes = 0;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || node.parentElement?.closest("script, style, .sr-only, [hidden]")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length > 0) visibleTextNodes++;
      for (const rect of rects) {
        if (rect.left < -1 || rect.right > viewport + 1) {
          overflowingText.push({ text: node.textContent.trim().slice(0, 100), left: rect.left, right: rect.right });
        }
      }
    }
    return { region: root.tagName, viewport, scrollWidth: root.scrollWidth, visibleTextNodes, overflowingText };
  }));
  expect(regions.length).toBe(selector === "footer" ? 1 : 2);
  for (const region of regions) {
    expect(region.visibleTextNodes, region.region).toBeGreaterThan(0);
    expect(region.scrollWidth, `${region.region} own overflow`).toBeLessThanOrEqual(region.viewport + 1);
    expect(region.overflowingText, `${region.region} painted text`).toEqual([]);
  }
}

async function expectUsefulTextBox(element: Locator) {
  await expect(element).toBeVisible();
  const size = await element.evaluate((node) => ({ width: node.getBoundingClientRect().width,
    font: Number.parseFloat(getComputedStyle(node).fontSize) }));
  // A zero-width or single-character column must not pass the viewport checks.
  expect(size.width).toBeGreaterThanOrEqual(size.font * 2);
}

async function expectNativeFrame(image: Locator) {
  await image.scrollIntoViewIfNeeded();
  await expectImageDelivered(image);
  const geometry = await image.evaluate((node: HTMLImageElement) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, ratio: node.naturalWidth / node.naturalHeight,
      viewport: document.documentElement.clientWidth, left: rect.left, right: rect.right,
      fit: getComputedStyle(node).objectFit };
  });
  expect(Math.abs(geometry.height - geometry.width / geometry.ratio)).toBeLessThanOrEqual(1);
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.fit).not.toBe("cover");
}

test.use({ reducedMotion: "reduce" });

for (const home of homes) {
  for (const width of [320, 390, 768, 1280]) {
    for (const size of [16, 32]) {
      test(`${home.locale} home and footer fit at ${width}px with ${size}px root text`, async ({ page, baseURL, request }) => {
        await page.setViewportSize({ width, height: 900 });
        await rootTextSize(page, baseURL!, size);
        await page.goto(home.path, { waitUntil: "domcontentloaded" });
        await settledText(page, size);
        await expectUsefulTextBox(page.locator("#home-portfolio-heading"));
        const introduction = page.locator('section[aria-labelledby="photographer-introduction-heading"]');
        await expectUsefulTextBox(introduction.locator("#photographer-introduction-heading"));
        await expectUsefulTextBox(introduction.locator("dl > div").first());
        const footer = page.getByRole("contentinfo");
        await expectUsefulTextBox(footer.locator(":scope > div > :first-child p"));
        await expect(page.getByRole("main").locator(`a[href$="/${PREFIXED_LOCALE.serviceNamespace}"], a[href="/services"]`).first()).toHaveAccessibleName(/\S/);
        await expectReflow(page);
        if (width === 320 && size === 32) {
          await expectNativeFrame(page.getByRole("main").locator("img").first());
          await expectNativeFrame(footer.locator("img").filter({ visible: true }).first());
        }
        if (width === 768 || width === 1280) {
          const portrait = introduction.locator("img").first();
          await expectNativeFrame(portrait);
          const source = await portrait.evaluate((image: HTMLImageElement) => ({
            url: image.currentSrc,
            intrinsic: Number(image.getAttribute("width")),
            rendered: image.getBoundingClientRect().width,
          }));
          // Decode the delivered bytes: a nominal optimizer w parameter alone is not proof.
          const response = await request.get(source.url);
          expect(response.ok()).toBe(true);
          const delivered = await sharp(await response.body()).metadata();
          expect(delivered.width ?? 0).toBeGreaterThanOrEqual(Math.ceil(source.rendered));
          expect(delivered.width ?? Infinity).toBeLessThanOrEqual(source.intrinsic);
        }
      });
    }
  }
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? "enhanced footer" : "scriptless footer", () => {
    test.use({ javaScriptEnabled });
    for (const home of homes) {
      test(`${home.locale} footer remains readable and keyboard navigation reaches another page`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await rootTextSize(page, baseURL!, 32);
        await page.goto(home.path, { waitUntil: "domcontentloaded" });
        await settledText(page, 32);
        await expectReflow(page);
        const link = page.getByRole("contentinfo").getByRole("navigation").getByRole("link").first();
        const destination = new URL((await link.getAttribute("href"))!, page.url()).href;
        await link.focus();
        await expect(link).toBeFocused();
        await expect(link).toBeInViewport();
        await link.press("Enter");
        await expect(page).toHaveURL(destination);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await settledText(page, 32);
        await expectReflow(page, "footer");
      });
    }
  });
}
