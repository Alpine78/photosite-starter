import { expect, test } from "./support/fixtures";
import { openLightbox } from "./support/lightbox";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { getMockGalleryResult, MOCK_FEATURED_GALLERY_ID } from "../src/lib/mock-gallery";
import { MAX_ITEM_ID_LENGTH } from "../src/lib/gallery-pagination";

const portfolio = (page: import("@playwright/test").Page) => page.locator("#home-portfolio");
const photos = (page: import("@playwright/test").Page) => portfolio(page).locator("[data-item-id]");
const topic = (page: import("@playwright/test").Page, slug: string) =>
  portfolio(page).locator('a[href*="topic=' + slug + '"]');

test("home shows full-frame featured photos, topic counts, and filtered lightbox", async ({
  page,
  externalRequests,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(portfolio(page).getByRole("heading", { name: "Selected photographs" })).toBeVisible();
  await expect(portfolio(page).getByText("Portfolio", { exact: true })).toBeVisible();
  const heading = await portfolio(page).getByRole("heading", { name: "Selected photographs" }).boundingBox();
  const filters = await portfolio(page).getByRole("navigation", { name: "Portfolio topics" }).boundingBox();
  if ((page.viewportSize()?.width ?? 0) >= 900) {
    expect(heading && filters && Math.abs(heading.y - filters.y) < 80).toBe(true);
  }
  await expect(photos(page)).toHaveCount(6);
  await expect(portfolio(page).locator("figcaption").first()).toHaveClass(/sr-only/);
  const all = await getMockGalleryResult(appUnderTestEnvironment.SITE_LOCALE, MOCK_FEATURED_GALLERY_ID);
  expect(await photos(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")))).toEqual(
    all?.items.map((item) => item.itemId),
  );
  await expect(portfolio(page).getByRole("navigation", { name: "Portfolio topics" }).getByRole("link")).toHaveCount(3);
  await expect(topic(page, "landscapes")).toContainText("4");
  await expect(topic(page, "details")).toContainText("2");
  await expect(portfolio(page).getByRole("link", { name: /All.*6/ })).toHaveAttribute("aria-current", "true");

  const first = photos(page).first().locator("img");
  const size = await first.evaluate((image: HTMLImageElement) => ({
    source: Number(image.getAttribute("width")) / Number(image.getAttribute("height")),
    rendered: image.getBoundingClientRect().width / image.getBoundingClientRect().height,
    fit: getComputedStyle(image).objectFit,
  }));
  expect(Math.abs(size.source - size.rendered)).toBeLessThan(0.02);
  expect(size.fit).not.toBe("cover");

  await topic(page, "details").click();
  await expect(page).toHaveURL(/\/\?topic=details/);
  await expect(photos(page)).toHaveCount(2);
  const details = await getMockGalleryResult(appUnderTestEnvironment.SITE_LOCALE, MOCK_FEATURED_GALLERY_ID, { sectionSlug: "details" });
  expect(await photos(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")))).toEqual(
    details?.items.map((item) => item.itemId),
  );
  await expect(topic(page, "details")).toHaveAttribute("aria-current", "true");
  await expect(topic(page, "details")).toHaveClass(/underline/);
  await expect(portfolio(page).getByRole("link", { name: "View all photographs" })).toHaveAttribute("href", /\?section=details$/);

  const dialog = page.getByRole("dialog", { name: "Image viewer" });
  await openLightbox(dialog, () => photos(page).first().click());
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test("an unknown home topic leaves the root usable with the All selection", async ({ page }) => {
  await page.goto("/?topic=retired-topic", { waitUntil: "domcontentloaded" });
  await expect(photos(page)).toHaveCount(6);
  await expect(portfolio(page).getByRole("link", { name: /All.*6/ })).toHaveAttribute("aria-current", "true");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.goto("/?topic=details&topic=landscapes", { waitUntil: "domcontentloaded" });
  await expect(photos(page)).toHaveCount(6);
  await page.goto("/?topic=" + "x".repeat(MAX_ITEM_ID_LENGTH + 1), { waitUntil: "domcontentloaded" });
  await expect(photos(page)).toHaveCount(6);
});

test.describe("home topic links without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("reloads the same home section with only the chosen topic's photos", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(photos(page)).toHaveCount(6);
    const caption = portfolio(page).locator(".gallery-caption-popover").first();
    await photos(page).first().click();
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("Quiet coast");
    await page.keyboard.press("Escape");
    await topic(page, "landscapes").click();
    await expect(page).toHaveURL(/\/\?topic=landscapes/);
    await expect(photos(page)).toHaveCount(4);
    await expect(topic(page, "landscapes")).toHaveAttribute("aria-current", "true");
    await portfolio(page).getByRole("link", { name: /All.*6/ }).click();
    await expect(page).toHaveURL(/\/#home-portfolio$/);
    await expect(photos(page)).toHaveCount(6);
  });
});
