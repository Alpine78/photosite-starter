import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

// Existing complete local images repeat; this does not simulate 256 CDN files.
const route = `/client-gallery/${"c".repeat(32)}`;
for (const locale of [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix]) {
  const labels = getBuiltInLabels(locale);
  test(`maximum unlisted gallery ${locale} keeps occurrence focus and stops at the last frame`, async ({ page, externalRequests }) => {
    expect((await page.goto(`${route}?locale=${locale}`))?.status()).toBe(200);
    const main = page.getByRole("main"), images = main.getByRole("img"), buttons = main.getByRole("button");
    await expect(images).toHaveCount(256); await expect(buttons).toHaveCount(256);
    for (const index of [0, 128, 255]) {
      const image = images.nth(index); await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      await expect(image).toHaveAttribute("loading", "lazy"); await expect(image).toHaveAttribute("src", /^\/gallery\//);
      expect(await image.evaluate((node: HTMLImageElement) => Math.abs(node.width / node.height - node.naturalWidth / node.naturalHeight))).toBeLessThan(0.01);
      expect(await image.evaluate((node: HTMLImageElement) => node.width <= node.naturalWidth)).toBe(true);
    }
    const dialog = page.getByRole("dialog"), middle = buttons.nth(128), afterMiddle = buttons.nth(129);
    const middleAlt = await images.nth(128).getAttribute("alt"), nextAlt = await images.nth(129).getAttribute("alt");
    await middle.focus(); await openLightbox(dialog, () => page.keyboard.press("Enter"));
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(middleAlt);
    await page.keyboard.press("ArrowRight"); await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(nextAlt);
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(afterMiddle).toBeFocused();

    const last = buttons.nth(255), lastAlt = await images.nth(255).getAttribute("alt");
    await last.focus(); await openLightbox(dialog, () => page.keyboard.press("Enter"));
    const next = dialog.getByRole("button", { name: labels.lightbox.next, exact: true, includeHidden: true });
    await expect(next).toBeDisabled(); await page.keyboard.press("ArrowRight"); await expect(next).toBeDisabled();
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(lastAlt);
    await expect(dialog.getByRole("link", { name: labels.lightbox.enquire, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(last).toBeFocused();
    await expect(main.getByRole("link", { name: labels.legacyGallery.download })).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });
  test.describe(`maximum unlisted gallery ${locale} without JavaScript`, () => {
    test.use({ javaScriptEnabled: false });
    test("retains the complete bounded image list", async ({ page, externalRequests }) => {
      expect((await page.goto(`${route}?locale=${locale}`))?.status()).toBe(200);
      await expect(page.getByRole("main").getByRole("img")).toHaveCount(256);
      await expect(page.getByRole("main").getByRole("img").last()).toHaveAttribute("loading", "lazy");
      expect(externalRequests).toEqual([]);
    });
  });
}
