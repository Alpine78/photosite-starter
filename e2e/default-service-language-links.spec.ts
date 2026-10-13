import { getBuiltInLabels } from "@/lib/deployment-config";
import { getServices, getServiceLocaleVersions, getServiceListingLocaleVersions } from "@/lib/services";
import { appUnderTestEnvironment, HARNESS_BASE_URL } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

test.use({ javaScriptEnabled: false });

for (const kind of ["listing", "detail"] as const) {
  test(`legacy default service ${kind} exposes exact real counterparts and metadata`, async ({ page }) => {
    const locale = appUnderTestEnvironment.SITE_LOCALE;
    const service = (await getServices()).find((item) => item.parentServiceId === undefined)!;
    const versions = kind === "listing" ? await getServiceListingLocaleVersions() : await getServiceLocaleVersions(service.serviceId);
    const own = versions.find((version) => version.locale === locale)!;
    const counterpart = versions.find((version) => version.locale !== locale)!;
    const path = kind === "listing" ? "/services" : `/services/${service.slug}`;
    await page.goto(path);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${appUnderTestEnvironment.SITE_CANONICAL_BASE_URL}${own.path}`);
    for (const version of versions) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${version.locale}"]`)).toHaveAttribute("href", `${appUnderTestEnvironment.SITE_CANONICAL_BASE_URL}${version.path}`);
    }
    const nav = page.getByRole("main").getByRole("navigation", { name: getBuiltInLabels(locale).contentTree.languages });
    await expect(nav.getByRole("link")).toHaveAttribute("href", counterpart.path);
    await nav.getByRole("link").click();
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}${counterpart.path}`);
    await expect(page.locator("html")).toHaveAttribute("lang", counterpart.locale);
    const back = page.getByRole("main").getByRole("navigation", { name: getBuiltInLabels(counterpart.locale).contentTree.languages }).getByRole("link");
    await expect(back).toHaveAttribute("href", own.path);
    await back.click();
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}${own.path}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  });
}
