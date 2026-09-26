import type { Page } from "@playwright/test";

import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { CONTACT_PATH } from "../src/lib/site-navigation";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The language choice lives in the site menu (AB#173). The page resolves its
 * other-language versions from the content's identity (ADR-0003 decision 7)
 * and publishes them to the header once it mounts. Its own in-page switch
 * stays as the fallback, hidden only after the menu has rendered the links.
 *
 * Pages are chosen from the fixture data the harness serves: one article
 * published in both languages, one published only in the default language
 * (whose switch opens a nearer page and says so).
 */

const defaultLanguage = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const otherLanguage = new Intl.Locale(PREFIXED_LOCALE.prefix).language;
const tree = buildContentTree(mockContentTreeInputs[defaultLanguage]!);
const otherTree = buildContentTree(mockContentTreeInputs[otherLanguage]!);

function articlePath(contentId: string): string | null {
  const segments = getCanonicalContentPath(tree, contentId);
  return segments === null ? null : `/${DEFAULT_STORY_NAMESPACE}/${segments.join("/")}`;
}

function findArticle(translated: boolean): string {
  for (const [contentId, page] of mockContentPages[defaultLanguage] ?? []) {
    if (page.variant !== "article" || articlePath(contentId) === null) continue;
    const inOther = getCanonicalContentPath(otherTree, contentId) !== null;
    if (inOther === translated) return articlePath(contentId)!;
  }
  throw new Error(`[e2e] no ${translated ? "translated" : "untranslated"} article in the fixtures`);
}

const TRANSLATED = findArticle(true);
const UNTRANSLATED = findArticle(false);

function menuLanguageLink(page: Page) {
  // The bar and the compact panel both render it; only one layout is displayed.
  return page.getByRole("banner").locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]:visible`);
}

function pageLanguageLink(page: Page) {
  return page.getByRole("main").locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]`);
}

async function openCompactMenu(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  await page.locator('button[aria-controls="mobile-nav"]').click();
}

test("the menu carries the page's other language and the in-page switch steps aside", async ({ page, isMobile }) => {
  await page.goto(TRANSLATED);
  await openCompactMenu(page, isMobile);

  const link = menuLanguageLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("lang", PREFIXED_LOCALE.prefix);
  await expect(pageLanguageLink(page)).toBeHidden();

  const href = await link.getAttribute("href");
  expect(href).toBe(await pageLanguageLink(page).getAttribute("href"));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator("html")).toHaveAttribute("lang", new RegExp(`^${PREFIXED_LOCALE.prefix}`));
});

test("a nearer-page fallback says so visibly in the menu", async ({ page, isMobile }) => {
  await page.goto(UNTRANSLATED);
  await openCompactMenu(page, isMobile);

  const link = menuLanguageLink(page);
  await expect(link).toBeVisible();
  const noteId = await link.getAttribute("aria-describedby");
  expect(noteId).toBeTruthy();
  await expect(page.locator(`[id="${noteId}"]`)).toBeVisible();
  await expect(page.locator(`[id="${noteId}"]`)).toHaveText(/\S/);
});

test("navigating to a page without other languages clears the menu entry", async ({ page, isMobile }) => {
  await page.goto(TRANSLATED);
  await openCompactMenu(page, isMobile);
  await expect(menuLanguageLink(page)).toBeVisible();

  await page.getByRole("banner").locator(`a[href="${CONTACT_PATH}"]:visible`).click();
  await expect(page).toHaveURL(new RegExp(`${CONTACT_PATH}$`));
  await expect(
    page.getByRole("banner").locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]`),
  ).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-language-menu");
});

test("while scripts are still loading the in-page switch stays usable", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(TRANSLATED, { waitUntil: "domcontentloaded" });
  await expect(pageLanguageLink(page)).toBeVisible();
  await expect(
    page.getByRole("banner").locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]`),
  ).toHaveCount(0);
  release();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the in-page switch is the language choice", async ({ page }) => {
    await page.goto(TRANSLATED);
    await expect(pageLanguageLink(page)).toBeVisible();
    await expect(
      page.getByRole("banner").locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]`),
    ).toHaveCount(0);
  });
});
