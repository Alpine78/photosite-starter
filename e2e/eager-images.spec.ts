import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * AB#383: the first images a page shows load eagerly, everything after them
 * stays lazy. Read after hydration, because the lightbox enhancement replaces
 * each gallery image's wrapper, and after an in-place append, because appended
 * items must never join the eager set.
 */

const EAGER_GALLERY_PAGE_ITEMS = 4;
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const cursorCodec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);

/** A gallery page whose grid is its first picture and whose first page is not its last. */
async function bareGallery(): Promise<{ readonly path: string; readonly pageSize: number }> {
  const tree = buildContentTree(mockContentTreeInputs[language]);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery" || page.body.length > 0 || page.cover !== undefined) continue;
    const path = getCanonicalContentPath(tree, contentId);
    const result = await getMockGalleryResult(language, contentId, { cursorCodec });
    if (path !== null && result?.page.hasNextPage && result.items.length > EAGER_GALLERY_PAGE_ITEMS) {
      return { path: `/${DEFAULT_STORY_NAMESPACE}/${path.join("/")}`, pageSize: result.page.size };
    }
  }
  throw new Error("[e2e] No paginated gallery without a hero or body in the mock data.");
}

const loadingOf = (images: import("@playwright/test").Locator) =>
  images.evaluateAll((elements) => elements.map((element) => element.getAttribute("loading")));

test("a gallery page loads its first images eagerly and every later or appended one lazily", async ({ page }) => {
  const gallery = await bareGallery();
  await page.goto(gallery.path, { waitUntil: "load" });
  const images = page.getByRole("main").locator("[data-item-id] img");
  await expect(images).toHaveCount(gallery.pageSize);
  // Hydrated: the enhanced trigger is a button, not the server's passive wrapper.
  await expect(page.getByRole("main").locator("button[data-item-id]").first()).toBeVisible();
  const expected = Array.from({ length: gallery.pageSize },
    (_, index) => index < EAGER_GALLERY_PAGE_ITEMS ? "eager" : "lazy");
  expect(await loadingOf(images)).toEqual(expected);

  await page.getByRole("main").getByRole("link", { name: labels.gallery.showMore }).click();
  // An append adds its whole slice in one render, however short the last page is.
  await expect.poll(() => images.count()).toBeGreaterThan(gallery.pageSize);
  const afterAppend = await loadingOf(images);
  expect(afterAppend.slice(0, gallery.pageSize)).toEqual(expected);
  expect(new Set(afterAppend.slice(gallery.pageSize))).toEqual(new Set(["lazy"]));
});

test("a gallery continuation page loads every image lazily", async ({ page }) => {
  const gallery = await bareGallery();
  await page.goto(gallery.path, { waitUntil: "load" });
  const next = page.getByRole("main").locator("a[rel='next']");
  const href = await next.getAttribute("href");
  expect(href).not.toBeNull();
  await page.goto(href!, { waitUntil: "load" });
  const images = page.getByRole("main").locator("[data-item-id] img");
  await expect(images.first()).toBeAttached();
  expect(new Set(await loadingOf(images))).toEqual(new Set(["lazy"]));
});

for (const listing of [
  { path: "/services", firstRow: 3 },
  { path: `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.serviceNamespace}`, firstRow: 2 },
]) {
  test(`${listing.path} loads its first row of covers eagerly and later ones lazily`, async ({ page }) => {
    await page.goto(listing.path, { waitUntil: "load" });
    // Only the listing's own cards: other lists in the page (navigation) would shift the index.
    const list = page.getByRole("main").locator("ul")
      .filter({ has: page.locator(`a[href^="${listing.path}/"]`) }).first();
    // Per card, not per image: a card without a cover still takes a grid cell.
    const cards = await list.locator(":scope > li").evaluateAll((items) =>
      items.map((item) => item.querySelector("img")?.getAttribute("loading") ?? null));
    expect(cards.length).toBeGreaterThan(listing.firstRow);
    cards.forEach((loading, index) => {
      if (loading !== null) expect(loading).toBe(index < listing.firstRow ? "eager" : "lazy");
    });
    expect(cards.slice(0, listing.firstRow)).toContain("eager");
    expect(cards.slice(listing.firstRow)).toContain("lazy");
  });
}

test("the home introduction portrait loads eagerly without an explicit preload", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  const portrait = page.locator('section[aria-labelledby="photographer-introduction-heading"] img');
  await expect(portrait).toHaveAttribute("loading", "eager");
  await expect(portrait).not.toHaveAttribute("fetchpriority", "high");
});
