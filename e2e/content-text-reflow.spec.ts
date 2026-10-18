import type { Locator, Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { expectImageDelivered } from "./support/public-page";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";

const languages = [new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language, PREFIXED_LOCALE.prefix];
function content(language: string, id: string) {
  const tree = buildContentTree(mockContentTreeInputs[language]);
  const segments = getCanonicalContentPath(tree, id);
  const page = mockContentPages[language].get(id);
  if (!segments || !page) throw new Error(`Missing synthetic content ${language}/${id}`);
  const root = language === PREFIXED_LOCALE.prefix
    ? `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` : `/${DEFAULT_STORY_NAMESPACE}`;
  return { path: `${root}/${segments.join("/")}`, page, labels: getBuiltInLabels(language) };
}

async function textSize(page: Page, baseURL: string, size: number) {
  const origin = new URL(baseURL).origin;
  await page.route((url) => url.origin === origin, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace("</head>", `<style>html:root{font-size:${size}px!important}</style></head>`);
    await route.fulfill({ response, body });
  });
}

async function readableText(page: Page, breadcrumb: string, size: number) {
  // Runner-side polling also works when page scripts are disabled.
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${size}px`);
  const result = await page.getByRole("main").evaluate((main, breadcrumbLabel) => {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const failures: { text: string; left: number; right: number; cellLeft: number; cellRight: number }[] = [];
    let visible = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || parent.closest("script,style,table,.sr-only,[hidden],[aria-hidden=true]")) continue;
      // Existing breadcrumb truncation and tables' own scroll regions have
      // separate contracts. Ordinary prose, captions and adjacent links do not.
      if (parent.closest("nav")?.getAttribute("aria-label") === breadcrumbLabel) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) continue;
      visible++;
      let cell = parent;
      while (cell !== main && ["inline", "contents"].includes(getComputedStyle(cell).display)) cell = cell.parentElement!;
      const box = cell.getBoundingClientRect();
      const css = getComputedStyle(cell);
      const left = box.left + Number.parseFloat(css.borderLeftWidth) + Number.parseFloat(css.paddingLeft);
      const right = box.right - Number.parseFloat(css.borderRightWidth) - Number.parseFloat(css.paddingRight);
      for (const rect of rects) {
        if (rect.left < left - 1 || rect.right > right + 1 || rect.left < -1 || rect.right > innerWidth + 1) {
          failures.push({ text: node.textContent.trim().slice(0, 100), left: rect.left, right: rect.right, cellLeft: left, cellRight: right });
        }
      }
    }
    return { visible, failures, pageOverflow: document.documentElement.scrollWidth - innerWidth };
  }, breadcrumb);
  expect(result.visible).toBeGreaterThan(0);
  expect(result.failures, "painted text must fit its own cell, without hiding or shrinking").toEqual([]);
  expect(result.pageOverflow, "ordinary text must not make the page scroll sideways").toBeLessThanOrEqual(1);
}

async function nativeFrame(image: Locator) {
  await image.scrollIntoViewIfNeeded();
  await expectImageDelivered(image);
  const frame = await image.evaluate((node: HTMLImageElement) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, ratio: node.naturalWidth / node.naturalHeight,
      fit: getComputedStyle(node).objectFit, intrinsicWidth: Number(node.getAttribute("width")),
      intrinsicHeight: Number(node.getAttribute("height")) };
  });
  expect(frame.intrinsicWidth).toBeGreaterThan(0);
  expect(frame.intrinsicHeight).toBeGreaterThan(0);
  expect(frame.width).toBeGreaterThan(0);
  expect(Math.abs(frame.height - frame.width / frame.ratio)).toBeLessThanOrEqual(1);
  expect(frame.fit).not.toBe("cover");
}

for (const language of languages) {
  const ids = ["content-awaiting-selection", "content-reading-coastal-light", "content-coastal-mornings"];
  for (const width of [320, 390, 768, 1280]) {
    for (const size of [16, 32]) {
      test(`${language} story text fits its column at ${width}px and ${size}px root`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 900 });
        await textSize(page, baseURL!, size);
        for (const id of ids) {
          const fixture = content(language, id);
          expect((await page.goto(fixture.path))?.status()).toBe(200);
          await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(fixture.page.title);
          const paragraph = fixture.page.body.find((block) => block.type === "paragraph" && block.spans === undefined);
          if (paragraph?.type === "paragraph") {
            await expect(page.locator("[data-content-body] > p").filter({ hasText: paragraph.text }).first()).toHaveText(paragraph.text);
          }
          await readableText(page, fixture.labels.navigation.breadcrumb, size);
          if (size === 32 && width === 320 && id === "content-reading-coastal-light") {
            await nativeFrame(page.getByRole("main").locator("img").first());
            await nativeFrame(page.locator("[data-content-body] figure img").first());
            const adjacent = page.getByRole("navigation", { name: fixture.labels.navigation.adjacentContent });
            await expect(adjacent.getByRole("link").first()).toHaveAccessibleName(/\S/);
          }
        }
      });
    }
  }
}

test("an article without a cover keeps its complete heading and normal text scale", async ({ page, baseURL }) => {
  const fixture = content(languages[0], "content-packing-for-a-photo-trip");
  expect(fixture.page.cover).toBeUndefined();
  await textSize(page, baseURL!, 32);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture.path);
    const heading = page.getByRole("main").getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(fixture.page.title);
    expect(await heading.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(64);
    await readableText(page, fixture.labels.navigation.breadcrumb, 32);
  }
});

test("long article text and poll results fit while a wide table keeps its own overflow", async ({ page, baseURL }) => {
  const language = languages[0];
  const fixture = content(language, "content-choosing-a-telephoto-lens");
  await page.setViewportSize({ width: 320, height: 900 });
  await textSize(page, baseURL!, 32);
  await page.goto(fixture.path);
  await readableText(page, fixture.labels.navigation.breadcrumb, 32);
  const table = page.locator("main table").first();
  const region = table.locator("..");
  expect(await region.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeGreaterThan(0);
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  await expect(region).not.toBeFocused();
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? "enhanced story reflow" : "scriptless story reflow", () => {
    test.use({ javaScriptEnabled });
    for (const language of languages) {
      test(`${language} enlarged adjacent link remains keyboard-operable`, async ({ page, baseURL }) => {
        const fixture = content(language, "content-reading-coastal-light");
        await page.setViewportSize({ width: 320, height: 900 });
        await textSize(page, baseURL!, 32);
        await page.goto(fixture.path);
        await readableText(page, fixture.labels.navigation.breadcrumb, 32);
        const link = page.getByRole("navigation", { name: fixture.labels.navigation.adjacentContent }).getByRole("link").first();
        const destination = new URL((await link.getAttribute("href"))!, page.url()).href;
        await link.focus();
        await expect(link).toBeFocused();
        await expect(link).toBeInViewport();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(destination);
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveCount(1);
      });

      test(`${language} whole-gallery continuation heading stays readable`, async ({ page, baseURL }) => {
        const fixture = content(language, "content-reading-coastal-light");
        await page.setViewportSize({ width: 320, height: 900 });
        await textSize(page, baseURL!, 32);
        await page.goto(fixture.path);
        const more = page.locator("[data-article-end-gallery]").getByRole("link", { name: fixture.labels.gallery.showMore });
        const href = await more.getAttribute("href");
        expect(href).toContain("cursor=");
        // A shared continuation URL is a full-page entry even after hydration.
        await page.goto(href!);
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(`${fixture.page.title} — ${fixture.labels.gallery.continued}`);
        await readableText(page, fixture.labels.navigation.breadcrumb, 32);
        await nativeFrame(page.getByRole("main").locator("img").first());
      });
    }
  });
}
