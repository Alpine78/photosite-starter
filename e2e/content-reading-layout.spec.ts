import type { Locator, Page } from "@playwright/test";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { openLightbox } from "./support/lightbox";

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
function pathOf(id: string, locale = language) {
  const path = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[locale]), id);
  if (!path) throw new Error("[e2e] A contents fixture needs its canonical path.");
  const root = locale === PREFIXED_LOCALE.prefix
    ? `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` : `/${DEFAULT_STORY_NAMESPACE}`;
  return `${root}/${path.join("/")}`;
}
const article = pathOf("content-choosing-a-telephoto-lens");
const gallery = pathOf("content-polar-night-sessions");
const longArticle = pathOf("content-field-guide");
const contents = (page: Page) => page.getByRole("navigation", { name: labels.contentTree.onThisPage });

async function rootSize(page: Page, baseURL: string | undefined, size: number) {
  if (!baseURL) throw new Error("[e2e] The contents matrix needs the harness origin.");
  const origin = new URL(baseURL).origin;
  await page.route((url) => url.origin === origin, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("</head>",
      `<style>html:root{font-size:${size}px!important}</style></head>`) });
  });
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("[e2e] The real reading region needs visible geometry.");
  return result;
}

async function scrollToReading(page: Page) {
  await expect(page.getByRole("tablist")).toBeVisible();
  const body = await box(page.locator("[data-content-body]"));
  await page.mouse.move(10, 300);
  await page.mouse.wheel(0, Math.ceil(body.y + 180));
  await expect.poll(() => page.locator("[data-content-body]").evaluate((node) => node.getBoundingClientRect().top)).toBeLessThan(0);
}

async function expectFocusInsidePane(page: Page, nav: Locator) {
  await expect.poll(() => nav.evaluate((node) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !node.contains(active)) return false;
    const pane = node.getBoundingClientRect(), link = active.getBoundingClientRect();
    const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-header-offset")) || 0;
    // Include the complete 2px outline plus its 2px offset.
    return link.top - 4 >= Math.max(pane.top, offset) - 1 && link.bottom + 4 <= pane.bottom + 1;
  })).toBe(true);
}

test("wide article and gallery contents remain beside their own reading column", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Desktop geometry uses genuine desktop browser contexts.");
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of [article, gallery]) {
    await page.goto(path, { waitUntil: "load" });
    await expect(contents(page)).toHaveCount(1);
    await expect(contents(page)).toHaveCSS("position", "sticky");
    const nav = await box(contents(page)), body = await box(page.locator("[data-content-body]"));
    expect(nav.x + nav.width).toBeLessThan(body.x);
    expect(body.width).toBeCloseTo(768, 0);
    if (path === article) {
      const intro = await box(page.locator(".content-reading-intro"));
      expect(intro.x + intro.width / 2).toBeCloseTo(640, 0);
      expect(intro.width).toBeCloseTo(body.width, 0);
    }
    await scrollToReading(page);
    await expect.poll(() => contents(page).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-header-offset")) || 0;
      return rect.top >= offset && rect.bottom <= innerHeight;
    })).toBe(true);
    await page.mouse.wheel(0, -80);
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--site-header-offset")))).toBeGreaterThan(0);
    await expect.poll(() => contents(page).evaluate((node) => node.getBoundingClientRect().top >=
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-header-offset")))).toBe(true);
    await contents(page).getByRole("link").last().focus();
    await expectFocusInsidePane(page, contents(page));
    await page.keyboard.press("Enter");
    const href = await contents(page).getByRole("link").last().getAttribute("href");
    await expect(page.locator(href!)).toBeInViewport();
  }
});

for (const width of [390, 768, 1000]) {
  test(`a ${width}px reading container keeps one inline list before the body`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(article, { waitUntil: "load" });
    await expect(contents(page)).toHaveCount(1);
    await expect(contents(page)).toHaveCSS("position", "static");
    const nav = await box(contents(page)), body = await box(page.locator("[data-content-body]"));
    expect(nav.y + nav.height).toBeLessThan(body.y);
    expect(nav.x).toBeCloseTo(body.x, 0);
    expect(body.width).toBeLessThanOrEqual(768);
    expect(body.x).toBeGreaterThanOrEqual(0);
    expect(body.x + body.width).toBeLessThanOrEqual(width);
  });
}

for (const width of [320, 390, 1280]) {
  test(`enlarged text at ${width}px falls back inline when the two columns no longer fit`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await rootSize(page, baseURL, 32);
    await page.goto(article, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
    await expect(contents(page)).toHaveCSS("position", "static");
    const nav = await box(contents(page)), body = await box(page.locator("[data-content-body]"));
    expect(nav.y + nav.height).toBeLessThan(body.y);
    expect(nav.x).toBeGreaterThanOrEqual(0);
    expect(nav.x + nav.width).toBeLessThanOrEqual(width);
    expect(body.x).toBeGreaterThanOrEqual(0);
    expect(body.x + body.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test("an overflowing contents pane exposes its last and first links by native Tab navigation", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Native desktop Tab traversal is tested in both desktop engines.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(longArticle, { waitUntil: "load" });
  const nav = contents(page), links = nav.getByRole("link");
  await expect(nav).toHaveCSS("position", "sticky");
  const body = await box(page.locator("[data-content-body]"));
  await page.mouse.move(10, 300);
  await page.mouse.wheel(0, Math.ceil(body.y + 180));
  await expect.poll(() => page.locator("[data-content-body]").evaluate((node) => node.getBoundingClientRect().top)).toBeLessThan(0);
  expect(await nav.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  const count = await links.count();
  await links.first().focus();
  await expectFocusInsidePane(page, nav);
  for (let index = 1; index < count; index++) {
    await page.keyboard.press("Tab");
    await expect(links.nth(index)).toBeFocused();
    await expectFocusInsidePane(page, nav);
  }
  expect(await nav.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  for (let index = count - 2; index >= 0; index--) await page.keyboard.press("Shift+Tab");
  await expect(links.first()).toBeFocused();
  await expectFocusInsidePane(page, nav);
});

test("a very short desktop viewport leaves the whole contents list in page flow", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "This is the short desktop window fallback.");
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto(article, { waitUntil: "load" });
  await expect(contents(page)).toHaveCSS("position", "static");
  expect(await contents(page).evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  const last = contents(page).getByRole("link").last();
  await last.focus();
  await expect(last).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator((await last.getAttribute("href"))!)).toBeInViewport();
});

test("an enlarged flowing header leaves short-window contents and its target reachable", async ({ page, baseURL }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "The desktop short-window flow fallback is the relevant boundary.");
  await page.setViewportSize({ width: 2560, height: 320 });
  await rootSize(page, baseURL, 32);
  await page.goto(article, { waitUntil: "load" });
  await expect(page.getByRole("banner")).toHaveAttribute("data-header-flow", "");
  await expect(contents(page)).toHaveCSS("position", "static");
  const last = contents(page).getByRole("link").last();
  await last.focus();
  await expect(last).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator((await last.getAttribute("href"))!)).toBeInViewport();
});

test("the body viewer still occupies the viewport outside the contents container", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "The new wide container is the relevant fixed-position boundary.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(article, { waitUntil: "load" });
  const trigger = page.locator("[data-content-body]").getByRole("button").filter({ has: page.getByRole("img") }).first();
  await expect(trigger).toBeVisible();
  await openLightbox(page.getByRole("dialog"), () => trigger.click());
  const viewer = await box(page.getByRole("dialog"));
  expect(viewer).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const locale of [language, PREFIXED_LOCALE.prefix]) {
  test(`the ${locale} article and gallery retain their one localized contents landmark`, async ({ page }) => {
    const localeLabels = getBuiltInLabels(locale);
    for (const id of ["content-understanding-exposure-triangle", "content-coastal-mornings"]) {
      await page.goto(pathOf(id, locale), { waitUntil: "load" });
      const nav = page.getByRole("navigation", { name: localeLabels.contentTree.onThisPage });
      await expect(nav).toHaveCount(1);
      expect(await nav.getByRole("link").count()).toBeGreaterThan(0);
    }
  });
}

test.describe("native contents without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("the static desktop contents fallback reaches the same full editorial body", async ({ page }, info) => {
    test.skip(Boolean(info.project.use.isMobile), "The desktop scriptless fallback uses native anchors.");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(article, { waitUntil: "load" });
    const id = await page.locator("[data-content-body] h4").first().getAttribute("id");
    await expect(contents(page)).toHaveCSS("position", "static");
    await contents(page).locator(`a[href='#${id}']`).click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
    expect(new URL(page.url()).hash).toBe(`#${id}`);
  });
});
