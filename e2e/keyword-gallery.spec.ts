import { getBuiltInLabels } from "../src/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { openLightbox } from "./support/lightbox";
import {
  DEFAULT_SEARCH_NAMESPACE,
  PREFIXED_LOCALE,
  REDUNDANT_DEFAULT_PREFIX,
  appUnderTestEnvironment,
} from "./support/harness-environment";

/**
 * The keyword gallery (ADR-0012, AB#71) against the production build. Keyword ids and their
 * order come from the project's own neutral mock vocabulary, not a deployment's content.
 */

const SEARCH_PATH = `/${DEFAULT_SEARCH_NAMESPACE}`;
const gallery = (keywords: string, cursor?: string) => `${SEARCH_PATH}?keywords=${keywords}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
const defaultLocale = appUnderTestEnvironment.SITE_LOCALE;
const labels = getBuiltInLabels(defaultLocale).search;

test.describe("keyword gallery", () => {
  test("a canonical address renders the selection on the server and says what it means", async ({ page }) => {
    const response = await page.goto(gallery("coast,water"));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(labels.keywordTitle.split("{names}")[0]);
    await expect(page.getByText(labels.keywordSummary)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /keywords=coast,water$/);
  });

  for (const [name, spelling] of [
    ["reordered", "water,coast"],
    ["with a repeat", "coast,water,water"],
    ["with a redundant ancestor", "coast,water,nature"],
    ["with a merged id", "seaside,water"],
  ] as const) {
    test(`a selection ${name} redirects permanently to one canonical address`, async ({ request }) => {
      const response = await request.get(gallery(spelling), { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toMatch(/keywords=coast,water$/);
    });
  }

  test("casing and a trailing slash collapse in one redirect after validation", async ({ request }) => {
    for (const path of [`${SEARCH_PATH.toUpperCase()}?keywords=water,coast`, `${SEARCH_PATH}/?keywords=coast,water`, `/${REDUNDANT_DEFAULT_PREFIX}${SEARCH_PATH}?keywords=water,coast`]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(308);
      expect(new URL(response.headers().location, "http://x").pathname + new URL(response.headers().location, "http://x").search, path).toBe(gallery("coast,water"));
    }
  });

  test("an invalid selection or cursor answers 404 in every spelling, and is never redirected", async ({ request }) => {
    const refused = [
      gallery("unknown"),
      gallery("Coast"),
      gallery("archive,autumn,coast,forest,trees,water"),
      gallery("coast", "not-a-cursor"),
      `${SEARCH_PATH}?keywords=coast&cursor=a&cursor=a`,
      `${SEARCH_PATH}?keywords=coast&cursor=`,
      `${SEARCH_PATH}/?keywords=coast&cursor=not-a-cursor`,
      `${SEARCH_PATH.toUpperCase()}?keywords=unknown`,
      `/${REDUNDANT_DEFAULT_PREFIX}${SEARCH_PATH}?keywords=unknown`,
    ];
    for (const path of refused) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).toContain("noindex");
    }
  });

  test("a selection nothing matches is a real page that says so", async ({ page }) => {
    expect((await page.goto(gallery("autumn,coast")))?.status()).toBe(200);
    await expect(page.getByText(labels.keywordNoResults)).toBeVisible();
    await expect(page.getByRole("list", { name: /./ }).getByRole("button")).toHaveCount(0);
  });

  test("an empty selection stays the search landing state", async ({ page }) => {
    expect((await page.goto(`${SEARCH_PATH}?keywords=,%20,`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: labels.title })).toBeVisible();
  });

  test("the keyboard opens a photograph, and the page shows only one bounded page of them", async ({ page }) => {
    await page.goto(gallery("archive"));
    const tiles = page.getByRole("button", { name: /./ }).filter({ has: page.locator("img") });
    await expect(tiles).toHaveCount(24);
    const viewer = page.getByRole("dialog");
    await openLightbox(viewer, async () => {
      await tiles.first().focus();
      await page.keyboard.press("Enter");
    });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(tiles.first()).toBeFocused();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the keyword browser is plain links", async ({ page }) => {
      await page.goto(SEARCH_PATH);
      const link = page.getByRole("region", { name: labels.keywordBrowseHeading }).getByRole("link").first();
      await expect(link).toHaveAttribute("href", /\?keywords=/);
    });

    test("the continuation is a real link, with the selection before the cursor, and offers a way back", async ({ page }) => {
      await page.goto(gallery("archive"));
      const next = page.locator('a[rel="next"]');
      const href = await next.getAttribute("href");
      expect(href).toMatch(/^[^?]+\?keywords=archive&cursor=/);
      expect((await page.goto(href!))?.status()).toBe(200);
      await expect(page.getByRole("link", { name: labels.keywordBackToStart })).toHaveAttribute("href", gallery("archive"));
    });
  });

  test("back and forward restore the selection after moving to another one", async ({ page }) => {
    await page.goto(gallery("coast"));
    const heading = page.getByRole("heading", { level: 1 });
    const first = await heading.textContent();
    await page.goto(gallery("archive"));
    const second = await heading.textContent();
    expect(second).not.toBe(first);
    await page.goBack();
    await expect(heading).toHaveText(first!);
    await page.goForward();
    await expect(heading).toHaveText(second!);
  });

  test("the search landing state browses the vocabulary by keyboard, down to a gallery", async ({ page }) => {
    await page.goto(SEARCH_PATH);
    const browser = page.getByRole("region", { name: labels.keywordBrowseHeading });
    await expect(browser).toBeVisible();
    await expect(browser.getByRole("heading", { level: 3 }).first()).toBeVisible();
    const link = browser.getByRole("link").first();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/\?keywords=[a-z0-9-]+$/);
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${href!.replace("?", "\\?")}$`));
    await expect(page.getByText(labels.keywordSummary)).toBeVisible();
  });

  test("a parent's count matches the photographs its gallery can reach", async ({ page }) => {
    await page.goto(SEARCH_PATH);
    const nature = page.getByRole("listitem").filter({ has: page.locator('a[href$="keywords=nature"]') });
    await expect(nature.first()).toContainText("4");
    await page.goto(gallery("nature"));
    await expect(page.getByRole("button", { name: /./ }).filter({ has: page.locator("img") })).toHaveCount(4);
  });

  test("a results page does not repeat the browser", async ({ page }) => {
    await page.goto(`${SEARCH_PATH}?q=zzzzzzzz`);
    await expect(page.getByRole("region", { name: labels.keywordBrowseHeading })).toHaveCount(0);
  });

  test("the language links keep the selection and drop the cursor", async ({ page }) => {
    await page.goto(gallery("archive"));
    await page.goto((await page.locator('a[rel="next"]').getAttribute("href"))!);
    const links = page.locator(`a[href^="/${PREFIXED_LOCALE.prefix}"][href*="keywords=archive"]`);
    await expect(links.first()).toBeAttached();
    for (const href of await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")))) {
      expect(href).not.toContain("cursor=");
    }
  });

  test("the continuation endpoint accepts only the grid's own canonical address", async ({ request }) => {
    const refused = [
      `/api/keyword-gallery?path=${encodeURIComponent(gallery("water,coast"))}&cursor=x`,
      `/api/keyword-gallery?path=${encodeURIComponent(gallery("archive"))}`,
      `/api/keyword-gallery?path=${encodeURIComponent("//example.com?keywords=archive")}&cursor=x`,
      `/api/keyword-gallery?path=${encodeURIComponent(`${gallery("archive")}&q=x`)}&cursor=x`,
      `/api/keyword-gallery?path=${encodeURIComponent(gallery("archive"))}&cursor=x&extra=1`,
    ];
    for (const url of refused) expect([400, 404], url).toContain((await request.get(url)).status());
  });
});
