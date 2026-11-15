import { getBuiltInLabels } from "@/lib/deployment-config";
import { languageName } from "@/lib/language-fallback";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, HARNESS_BASE_URL, PREFIXED_LOCALE } from "./support/harness-environment";

const locales = [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix];
const legacyPath = "/client-gallery/11111111111111111111111111111111";

for (const locale of locales) {
  const labels = getBuiltInLabels(locale);
  test(`legacy ${locale} retains exact source image and ZIP bytes`, async ({ page, request }) => {
    const before = await request.get(legacyPath);
    const after = await page.goto(`${legacyPath}?locale=${locale}`);
    expect(after?.status()).toBe(before.status());
    expect(after?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(after?.headers()["cache-control"]).toContain("no-store");
    expect(after?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const notice = page.getByRole("region", { name: labels.legacyGallery.noticeTitle });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(labels.legacyGallery.publicAccessNotice);
    await expect(notice).toContainText(labels.legacyGallery.fileRetentionNotice);
    await expect(page.getByRole("link", { name: labels.legacyGallery.download })).toBeVisible();
    const beforeHTML = await before.text();
    const images = await page.getByRole("main").getByRole("img").evaluateAll((nodes) => nodes.map((node) => ({ src: (node as HTMLImageElement).getAttribute("src"), alt: (node as HTMLImageElement).alt })));
    for (const image of images) {
      expect(beforeHTML).toContain(`src="${image.src}"`);
      expect(beforeHTML).toContain(`alt="${image.alt}"`);
      const a = await request.get(image.src!); const b = await request.get(image.src!);
      expect((await a.body()).equals(await b.body())).toBe(true);
    }
    const zip = await page.getByRole("link", { name: labels.legacyGallery.download }).getAttribute("href");
    expect(beforeHTML).toContain(`href="${zip}"`);
    const a = await request.get(zip!); const b = await request.get(zip!);
    expect((await a.body()).equals(await b.body())).toBe(true);
    expect((await a.body()).length).toBe(179);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  });
}

test.describe("scriptless locale selection", () => {
  test.use({ javaScriptEnabled: false });
  test("retained delivery switches through plain clean document links", async ({ page }) => {
    for (const path of [legacyPath]) {
      await page.goto(`${path}?locale=fi&extra=discard`);
      const link = page.getByRole("navigation", { name: getBuiltInLabels("fi").contentTree.languages }).getByRole("link", { name: languageName("en-GB") });
      await link.click();
      await expect(page).toHaveURL(`${HARNESS_BASE_URL}${path}?locale=en-GB`);
      await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
      await page.goBack();
      await expect(page.locator("html")).toHaveAttribute("lang", "fi");
    }
  });
});

test("spoofed locale headers and repeated/unsupported queries cannot override the default", async ({ request }) => {
  for (const search of ["", "?locale=en", "?locale=fi&locale=fi", "?locale=FI", `?locale=${"a".repeat(129)}`]) {
    const response = await request.get(`${legacyPath}${search}`, { headers: { "x-photosite-restricted-ui-locale": "fi" } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`<html lang="${appUnderTestEnvironment.SITE_LOCALE}"`);
  }
});


for (const locale of locales) {
  test(`legacy failure ${locale} shows generic selected-language copy`, async ({ page }) => {
    const response = await page.goto(`/client-gallery/44444444444444444444444444444444?locale=${locale}`);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { name: getBuiltInLabels(locale).pageError.title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: getBuiltInLabels(locale).pageError.retry, exact: true })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toContain("Synthetic legacy delivery failure");
  });
}
