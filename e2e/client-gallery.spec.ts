import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

const route = `/client-gallery/${"6".repeat(32)}`;
const finiteRoute = `/client-gallery/${"b".repeat(32)}`;
const fixtureDeadline = "2100-01-02T03:04:05.123Z";
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
    await expect(page.locator("main time")).toHaveCount(0);
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
  test(`whole delivery ZIP ${locale} downloads one complete native package`, async ({ page, externalRequests }) => {
    const response = await page.goto(`/client-gallery/${"d".repeat(32)}?locale=${locale}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    const link = page.getByRole("link", { name: labels.legacyGallery.download });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("download", "photographs.zip");
    await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("photographs.zip");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(bytes.subarray(-22, -18).toString("hex")).toBe("504b0506");
    expect(bytes.readUInt16LE(bytes.length - 12)).toBe(1);
    expect(bytes.toString("latin1")).toContain("image-0001.jpg");
    expect(externalRequests).toEqual([]);
  });
  test(`finite unlisted delivery ${locale} shows its exact UTC cutoff`, async ({ page, externalRequests }) => {
    await page.goto(`${finiteRoute}?locale=${locale}`);
    const time = page.locator("main time");
    await expect(time).toHaveCount(1); await expect(time).toHaveAttribute("datetime", fixtureDeadline);
    const date = finnish ? "2. tammikuuta 2100 klo 03.04.05,123" : "2 January 2100 at 03:04:05.123";
    await expect(time).toHaveText(date); await expect(page.getByText(labels.clientGallery.deadline.replace("{date}", date), { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("img")).toHaveCount(2);
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
    test("keeps the finite cutoff visible without a client timer", async ({ page, externalRequests }) => {
      await page.goto(`${finiteRoute}?locale=${locale}`);
      await expect(page.locator("main time")).toHaveAttribute("datetime", fixtureDeadline);
      await expect(page.locator("main time")).toBeVisible(); expect(externalRequests).toEqual([]);
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
