import type { Locator, Page } from "@playwright/test";

import { getBuiltInLabels } from "../src/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import {
  DEFAULT_SEARCH_NAMESPACE,
  PREFIXED_LOCALE,
  appUnderTestEnvironment,
} from "./support/harness-environment";
import { openLightbox } from "./support/lightbox";

/**
 * The dynamic archive-discovery journey as a whole (AB#90): continuing a keyword gallery
 * across the grid and the lightbox, restoring it, and refusing what it should. Its routing
 * and selector half is in `keyword-gallery.spec.ts`. Keyword ids and media ids come from the
 * project's own neutral mock data; a stale cursor needs changing data, so it is covered in
 * `src/lib/keyword-gallery.test.ts`.
 */

const SEARCH_PATH = `/${DEFAULT_SEARCH_NAMESPACE}`;
const ARCHIVE = `${SEARCH_PATH}?keywords=archive`;
const PAGE_SIZE = 24;
const ARCHIVE_SIZE = 30;
/** `keyword-gallery-page.tsx`. */
const EAGER_ITEMS = 4;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);

const gridItems = (page: Page) => page.getByRole("main").locator("[data-item-id]");
const itemIds = (page: Page) => gridItems(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id") ?? ""));
/**
 * Waits for the grid to show these photographs. A history navigation can replace the document
 * while it is being read, which throws rather than failing an assertion, and only `toPass` retries that.
 */
const expectItems = (page: Page, expected: readonly string[]) => expect(async () => {
  expect(await itemIds(page)).toEqual(expected);
}).toPass();
const nextHref = async (page: Page) => (await page.locator('a[rel="next"]').getAttribute("href"))!;
const expectedArchive = Array.from({ length: ARCHIVE_SIZE }, (_, index) => `archive-${String(index + 1).padStart(2, "0")}`);

/** Before hydration the control is a plain link that leaves the page. The header sets this once it has hydrated. */
const hydrated = (page: Page) => expect(page.locator("html")).toHaveAttribute("data-language-menu", "");

async function continueInPlace(page: Page) {
  await hydrated(page);
  await page.getByRole("link", { name: labels.gallery.showMore }).click();
}

const expectViewerPosition = (dialog: Locator, position: number, total: number) =>
  expect(dialog.getByText(`${position}${labels.lightbox.indexSeparator}${total}`, { exact: true })).toBeVisible();

test.describe("continuing a keyword gallery", () => {
  test("the first page is one bounded page, and the rest of the archive is not in it", async ({ page, request }) => {
    const html = await (await request.get(ARCHIVE)).text();
    expect(html).toContain(expectedArchive[PAGE_SIZE - 1]);
    expect(html).not.toContain(expectedArchive[PAGE_SIZE]);
    await page.goto(ARCHIVE, { waitUntil: "load" });
    expect(await itemIds(page)).toEqual(expectedArchive.slice(0, PAGE_SIZE));
  });

  test("only the first screen of photographs loads eagerly, and none on a continuation page", async ({ page }) => {
    const notLazy = (target: Page) => target.getByRole("main").locator('[data-item-id] img:not([loading="lazy"])');
    await page.goto(ARCHIVE, { waitUntil: "load" });
    await expect(gridItems(page)).toHaveCount(PAGE_SIZE);
    expect(await notLazy(page).count()).toBeLessThanOrEqual(EAGER_ITEMS);
    await page.goto(await nextHref(page), { waitUntil: "load" });
    await expect(gridItems(page)).toHaveCount(ARCHIVE_SIZE - PAGE_SIZE);
    await expect(notLazy(page)).toHaveCount(0);
  });

  test("the next page arrives in place, in order, with no repeat or gap", async ({ page }) => {
    await page.goto(ARCHIVE, { waitUntil: "load" });
    await expect(gridItems(page)).toHaveCount(PAGE_SIZE);
    await continueInPlace(page);
    await expect(gridItems(page)).toHaveCount(ARCHIVE_SIZE);
    expect(await itemIds(page)).toEqual(expectedArchive);
    await expect(page).toHaveURL(new RegExp(`${ARCHIVE.replace("?", "\\?")}$`));
    // The address stayed on the first page, so that is what a reload restores.
    await page.reload({ waitUntil: "load" });
    await expectItems(page, expectedArchive.slice(0, PAGE_SIZE));
  });

  test("an open viewer continues past the last loaded photograph", async ({ page }) => {
    await page.goto(ARCHIVE, { waitUntil: "load" });
    await expect(gridItems(page)).toHaveCount(PAGE_SIZE);
    await hydrated(page);
    const dialog = page.getByRole("dialog");
    const last = gridItems(page).nth(PAGE_SIZE - 1);
    await openLightbox(dialog, async () => {
      await last.focus();
      await page.keyboard.press("Enter");
    });
    await expect(gridItems(page)).toHaveCount(ARCHIVE_SIZE);
    // The grid updates first and the viewer takes the new slides after it, so wait for its own count.
    await expectViewerPosition(dialog, PAGE_SIZE, ARCHIVE_SIZE);
    await page.keyboard.press("ArrowRight");
    await expectViewerPosition(dialog, PAGE_SIZE + 1, ARCHIVE_SIZE);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`[data-item-id="${expectedArchive[PAGE_SIZE]}"]`)).toBeFocused();
    expect(await itemIds(page)).toEqual(expectedArchive);
  });
});

test.describe("restoring a keyword gallery", () => {
  test("a continuation address opens its own page directly, reloads to the same place, and offers the way back", async ({ page, request }) => {
    await page.goto(ARCHIVE);
    const href = await nextHref(page);
    expect((await request.get(href)).status()).toBe(200);
    await page.goto(href, { waitUntil: "load" });
    expect(await itemIds(page)).toEqual(expectedArchive.slice(PAGE_SIZE));
    await page.reload({ waitUntil: "load" });
    expect(await itemIds(page)).toEqual(expectedArchive.slice(PAGE_SIZE));
    await hydrated(page);
    // Survives only a client navigation, so this shows the grid was replaced, not the document.
    await page.evaluate(() => { (window as { sameDocument?: boolean }).sameDocument = true; });
    await page.getByRole("link", { name: labels.search.keywordBackToStart }).click();
    await expect(page).toHaveURL(new RegExp(`${ARCHIVE.replace("?", "\\?")}$`));
    await expectItems(page, expectedArchive.slice(0, PAGE_SIZE));
    expect(await page.evaluate(() => (window as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });

  test("back and forward restore each page of a selection", async ({ page }) => {
    await page.goto(ARCHIVE);
    const href = await nextHref(page);
    await page.goto(href, { waitUntil: "load" });
    await page.goBack({ waitUntil: "load" });
    await expectItems(page, expectedArchive.slice(0, PAGE_SIZE));
    await page.goForward({ waitUntil: "load" });
    await expectItems(page, expectedArchive.slice(PAGE_SIZE));
  });

  test("the browser leads to each selection, showing only its photographs", async ({ page }) => {
    await page.goto(SEARCH_PATH);
    await page.getByRole("region", { name: labels.search.keywordBrowseHeading }).locator('a[href$="keywords=archive"]').click();
    await expectItems(page, expectedArchive.slice(0, PAGE_SIZE));
    await page.goBack();
    await page.getByRole("region", { name: labels.search.keywordBrowseHeading }).locator('a[href$="keywords=forest"]').click();
    await expectItems(page, ["forest-stream"]);
  });
});

test.describe("refusals and isolation", () => {
  test("a tampered, foreign or other-language cursor answers an accessible noindex 404", async ({ page, request }) => {
    await page.goto(ARCHIVE);
    const href = await nextHref(page);
    const cursor = new URL(href, "http://x").searchParams.get("cursor")!;
    const tampered = `${cursor.slice(0, -2)}${cursor.endsWith("AA") ? "BB" : "AA"}`;
    // The same selection answers in the other language without a cursor, so its refusal below is about the cursor.
    const otherLanguage = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.searchNamespace}?keywords=archive`;
    expect((await request.get(otherLanguage, { maxRedirects: 0 })).status()).toBe(200);
    const refused = [
      `${ARCHIVE}&cursor=${encodeURIComponent(tampered)}`,
      `${ARCHIVE}&cursor=not-a-cursor`,
      `${SEARCH_PATH}?keywords=forest&cursor=${encodeURIComponent(cursor)}`,
      `${otherLanguage}&cursor=${encodeURIComponent(cursor)}`,
    ];
    for (const path of refused) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).toContain("noindex");
    }
    await page.goto(refused[0]);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the continuation endpoint refuses the same cursors", async ({ page, request }) => {
    await page.goto(ARCHIVE);
    const cursor = new URL(await nextHref(page), "http://x").searchParams.get("cursor")!;
    const ask = (path: string, token: string) => request.get(`/api/keyword-gallery?path=${encodeURIComponent(path)}&cursor=${encodeURIComponent(token)}`);
    expect((await ask(ARCHIVE, cursor)).status()).toBe(200);
    expect((await ask(ARCHIVE, "not-a-cursor")).status()).toBe(404);
    expect((await ask(`${SEARCH_PATH}?keywords=forest`, cursor)).status()).toBe(404);
    expect((await ask(ARCHIVE, `${cursor.slice(0, -2)}${cursor.endsWith("AA") ? "BB" : "AA"}`)).status()).toBe(404);
    expect((await ask(`/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.searchNamespace}?keywords=archive`, cursor)).status()).toBe(404);
  });

  // The full eligibility rule, with video and private media, is tested in studio/keyword-gallery-archive-contract.test.ts, against the real queries.
  test("opted-out media never appears, in a page or in the HTML", async ({ page, request }) => {
    for (const selection of ["forest", "coast", "archive"]) {
      const html = await (await request.get(`${SEARCH_PATH}?keywords=${selection}`)).text();
      expect(html, selection).not.toContain("lichen-stones");
    }
    await page.goto(`${SEARCH_PATH}?keywords=forest`);
    expect(await itemIds(page)).toEqual(["forest-stream"]);
  });

  test("no provider or import field reaches the page or the continuation endpoint", async ({ page, request }) => {
    const forbidden = /expandedKeywordIds|importedKeywords|keywordOverrides|internalKeywords|archiveLocator|seashore/;
    expect(await (await request.get(`${SEARCH_PATH}?keywords=coast`)).text()).not.toMatch(forbidden);
    await page.goto(ARCHIVE);
    const cursor = new URL(await nextHref(page), "http://x").searchParams.get("cursor")!;
    const answer = await request.get(`/api/keyword-gallery?path=${encodeURIComponent(ARCHIVE)}&cursor=${encodeURIComponent(cursor)}`);
    expect(await answer.text()).not.toMatch(forbidden);
  });
});
