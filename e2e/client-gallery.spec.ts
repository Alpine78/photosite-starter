import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

const route = `/client-gallery/${"6".repeat(32)}`;
for (const locale of [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix]) {
  const labels = getBuiltInLabels(locale), finnish = locale === "fi";
  test(`new unlisted delivery ${locale} uses full frames, keyboard viewing and no delivery ZIP`, async ({ page, externalRequests }) => {
    const response = await page.goto(`${route}?locale=${locale}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(finnish ? "Piilotettu toimitus" : "Unlisted delivery");
    const notice = page.getByRole("region", { name: labels.clientGallery.noticeTitle });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(labels.clientGallery.publicAccessNotice);
    await expect(notice).toContainText(labels.clientGallery.fileRetentionNotice);
    await expect(notice).not.toContainText(labels.legacyGallery.fileRetentionNotice);
    await expect(page.getByRole("link", { name: labels.legacyGallery.download })).toHaveCount(0);
    const images = page.getByRole("main").getByRole("img"); await expect(images).toHaveCount(2);
    for (const image of await images.all()) {
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      await expect(image).toHaveAttribute("loading", "lazy"); await expect(image).not.toHaveAttribute("src", /_next\/image/);
      expect(await image.evaluate((node: HTMLImageElement) => Math.abs(node.width / node.height - node.naturalWidth / node.naturalHeight))).toBeLessThan(0.01);
      expect(await image.evaluate((node: HTMLImageElement) => node.width <= node.naturalWidth)).toBe(true);
    }
    const opener = page.getByRole("main").getByRole("button").first(), dialog = page.getByRole("dialog");
    await opener.focus(); await openLightbox(dialog, () => page.keyboard.press("Enter"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(finnish ? "Geometrinen muotokuva" : "Geometric portrait");
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    // The shared viewer returns to the last viewed photograph, also after navigation.
    await expect(page.getByRole("main").getByRole("button").nth(1)).toBeFocused();
    const html = await page.content();
    for (const internal of ["clientDeliveryGallery", "restricted\"", "SANITY_READ_TOKEN", "PRIVATE_GALLERY_S3"]) expect(html).not.toContain(internal);
    expect(externalRequests).toEqual([]);
  });
  test.describe(`unlisted delivery ${locale} without JavaScript`, () => {
    test.use({ javaScriptEnabled: false });
    test("keeps complete images and authored heading visible", async ({ page, externalRequests }) => {
      const response = await page.goto(`${route}?locale=${locale}`);
      expect(response?.status()).toBe(200); await expect(page.getByRole("main").getByRole("img")).toHaveCount(2);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(finnish ? "Piilotettu toimitus" : "Unlisted delivery");
      expect(externalRequests).toEqual([]);
    });
  });
}
test("unknown new handles stay unavailable with reserved-page headers", async ({ request }) => {
  for (const digit of ["7", "8", "0"]) {
    const response = await request.get(`/client-gallery/${digit.repeat(32)}`);
    expect(response.status()).toBe(404); expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow"); expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  }
});
test("new provider failures stay errors rather than mock or empty galleries", async ({ request }) => {
  const response = await request.get(`/client-gallery/${"9".repeat(32)}`);
  expect(response.status()).toBe(500); expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(await response.text()).not.toContain("synthetic-read-credential");
});
