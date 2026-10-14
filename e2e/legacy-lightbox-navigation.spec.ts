import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;
const path = "/client-gallery/11111111111111111111111111111111";

test("opening controls cannot navigate a still-hidden neighbouring holder", async ({ page }) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      // Keep the placeholder decode behind the library's 250 ms fallback.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    };
  });
  await page.goto(path);
  const previews = page.getByRole("main").locator("[data-item-id]");
  const expectedAlts = await previews.locator("img").evaluateAll((images) => images.map((image) => (image as HTMLImageElement).alt));
  await previews.first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "attached" });
  const next = dialog.getByRole("button", { name: labels.next, exact: true, includeHidden: true });
  // Native activation during the opening phase used to rotate a holder whose
  // display:none survived the transition, leaving a permanently blank slide.
  await expect(next).toBeDisabled();
  await next.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(dialog.getByText("1" + labels.indexSeparator + "2", { exact: true })).toBeVisible();
  await expect(next).toBeEnabled();
  await next.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[1]);
  await dialog.getByRole("button", { name: labels.previous, exact: true }).click();
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[0]);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[1]);
});

test("loaded retained images stay attached through a delayed decode and finite navigation", async ({ page }) => {
  await page.addInitScript(() => {
    // PhotoSwipe's Safari path waits for decode even on the active slide.
    // Exercise that legitimate unattached state in both engines.
    Object.defineProperty(navigator, "vendor", { configurable: true, get: () => "Apple Computer, Inc." });
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      await new Promise((resolve) => setTimeout(resolve, 250));
    };
  });
  await page.goto(path);
  const previews = page.getByRole("main").locator("[data-item-id]");
  const expectedAlts = await previews.locator("img").evaluateAll((images) => images.map((image) => (image as HTMLImageElement).alt));
  const dialog = page.getByRole("dialog");
  await openLightbox(dialog, () => previews.first().click());
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[0]);
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("2" + labels.indexSeparator + "2", { exact: true })).toBeVisible();
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[1]);
  await expect.poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: labels.next, exact: true, includeHidden: true })).toBeDisabled();
  await dialog.getByRole("button", { name: labels.previous, exact: true }).click();
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[0]);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(expectedAlts[1]);
});
