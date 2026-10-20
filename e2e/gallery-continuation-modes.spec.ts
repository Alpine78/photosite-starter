import type { Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { AUTOMATIC_CONTINUATION_PAGE_LIMIT } from "../src/lib/gallery-presentation";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * AB#374: the authored continuation mode. The mock site settings keep the
 * button, so these two fixtures carry per-gallery overrides; the code default
 * (endless) is pinned by the presentation unit tests.
 */
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).gallery;
const PAGE_SIZE = 24;
const GALLERY_SIZE = 120;

function pathOf(contentId: string): string {
  const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]!), contentId);
  if (parts === null) throw new Error(`[e2e] ${contentId} needs a canonical path.`);
  return `/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`;
}

const endless = pathOf("content-endless-archive");
const automatic = pathOf("content-automatic-archive");
const items = (page: Page) => page.getByRole("main").locator("[data-item-id]");
const continuation = (page: Page) => page.getByRole("main").locator("a[rel='next']");

/** Brings the end of the grid into view, as a reader scrolling down would. */
async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

/** Waits for hydration: before it, every mode shows the real link. */
async function hydrated(page: Page) {
  await expect(continuation(page)).toBeHidden();
}

test("endless loading appends every page while scrolling and never shows the button", async ({ page }) => {
  await page.goto(endless, { waitUntil: "load" });
  await expect(items(page)).toHaveCount(PAGE_SIZE);
  await hydrated(page);
  await expect(continuation(page)).toHaveAttribute("href", /cursor=/);
  await expect(page.getByRole("link", { name: labels.showMore })).toHaveCount(0);
  await expect(async () => {
    await scrollToEnd(page);
    await expect(items(page)).toHaveCount(GALLERY_SIZE, { timeout: 1000 });
  }).toPass();
  await expect(page.getByText(labels.allLoaded, { exact: true })).toBeVisible();
  await expect(continuation(page)).toHaveCount(0);
  const ids = await items(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")));
  expect(new Set(ids).size).toBe(GALLERY_SIZE);
  // An automatic append never moves focus.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("automatic-then-button stops at its page limit and then offers the button", async ({ page }) => {
  const limit = PAGE_SIZE * AUTOMATIC_CONTINUATION_PAGE_LIMIT;
  await page.goto(automatic, { waitUntil: "load" });
  await hydrated(page);
  await expect(async () => {
    await scrollToEnd(page);
    await expect(items(page)).toHaveCount(limit, { timeout: 1000 });
  }).toPass();
  const button = page.getByRole("link", { name: labels.showMore });
  await expect(button).toBeVisible();
  await scrollToEnd(page);
  await page.waitForTimeout(500);
  await expect(items(page)).toHaveCount(limit);
  await button.click();
  await expect(items(page)).toHaveCount(limit + PAGE_SIZE);
  await expect(button).toBeFocused();
  await scrollToEnd(page);
  await page.waitForTimeout(500);
  await expect(items(page)).toHaveCount(limit + PAGE_SIZE);
});

test("a failed automatic load offers a retry without repeating the request", async ({ page }) => {
  let requests = 0;
  let fail = true;
  await page.route("**/api/gallery**", async (route) => {
    requests += 1;
    if (fail) await route.abort("failed");
    else await route.fallback();
  });
  await page.goto(endless, { waitUntil: "load" });
  await hydrated(page);
  await scrollToEnd(page);
  const retry = page.getByRole("link", { name: labels.retry });
  await expect(retry).toBeVisible();
  await expect(page.getByText(labels.loadFailed, { exact: true })).toBeVisible();
  for (let index = 0; index < 3; index += 1) {
    await page.evaluate(() => window.scrollBy(0, -200));
    await scrollToEnd(page);
  }
  await page.waitForTimeout(500);
  expect(requests).toBe(1);
  await expect(items(page)).toHaveCount(PAGE_SIZE);

  // A retry that fails again keeps the keyboard on the usable retry link.
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => requests).toBe(2);
  await expect(retry).toBeVisible();
  await expect(retry).toBeFocused();

  fail = false;
  await retry.click();
  await expect.poll(() => items(page).count()).toBeGreaterThan(PAGE_SIZE);
  // Scrolling takes over again once the retry succeeds.
  await expect(continuation(page)).toBeHidden();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("every mode keeps the working continuation link", async ({ page }) => {
    for (const path of [endless, automatic]) {
      await page.goto(path, { waitUntil: "load" });
      const link = page.getByRole("link", { name: labels.showMore });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/cursor=/);
      await expect(items(page)).toHaveCount(PAGE_SIZE);
    }
  });
});
