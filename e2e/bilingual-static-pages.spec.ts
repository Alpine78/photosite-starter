import { getBuiltInLabels, getDeploymentConfig } from "../src/lib/deployment-config";
import { getHomeContent } from "../src/lib/home-content";
import { getServices } from "../src/lib/services";
import { getSiteSettings } from "../src/lib/site-settings";
import { buildStaticPagePath } from "../src/lib/static-page-routes";
import { expect, test } from "./support/fixtures";
import { openHeaderNavigation } from "./support/public-page";

for (const route of getDeploymentConfig().localeRoutes.locales) {
  const config = getDeploymentConfig().localeRoutes;
  const homePath = buildStaticPagePath(config, route.locale, "home");
  const contactPath = buildStaticPagePath(config, route.locale, "contact");
  const labels = getBuiltInLabels(route.locale);

  test(`home and contact retain the selected locale (${route.locale})`, async ({ page }) => {
    await page.goto(homePath, { waitUntil: "domcontentloaded" });
    const settings = await getSiteSettings(route.locale);
    const home = await getHomeContent(route.locale);
    await expect(page.locator("html")).toHaveAttribute("lang", route.locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(settings.siteName);
    await expect(page.getByRole("heading", { name: home.photographerIntroduction!.heading })).toBeVisible();
    await expect(page.getByRole("main").locator(`a[href="${contactPath}"]`).first()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new URL(homePath, getDeploymentConfig().canonicalBaseUrl).toString().replace(/\/$/, ""));
    await page.getByRole("main").locator(`a[href="${contactPath}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${contactPath}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(labels.pages.contact);
    await openHeaderNavigation(page);
    await expect(page.getByRole("banner").locator(`a[href="${contactPath}"]:visible`)).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("contentinfo").locator(`a[href="${contactPath}"]`)).toHaveCount(1);
    await page.getByRole("main").locator("summary").click();
    await expect(page.getByRole("main")).toContainText(settings.contact.privacyNotice.collected);
    for (const version of config.locales) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${version.locale}"]`)).toHaveAttribute("href", new URL(buildStaticPagePath(config, version.locale, "contact"), getDeploymentConfig().canonicalBaseUrl).toString().replace(/\/$/, ""));
    }
    await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute("href", new URL("/contact", getDeploymentConfig().canonicalBaseUrl).toString().replace(/\/$/, ""));
  });

  test(`localized service choices submit through the fixed contact endpoint (${route.locale})`, async ({ page }) => {
    const services = await getServices(route.locale);
    const ownerIds = new Set((await getServices()).map((service) => service.serviceId));
    const service = services.find((entry) => ownerIds.has(entry.serviceId))!;
    await page.goto(`${contactPath}?service=${encodeURIComponent(service.serviceId)}`);
    const main = page.getByRole("main");
    const submit = main.getByRole("button", { name: labels.contact.submit, exact: true });
    await expect(submit).toBeEnabled();
    await expect(main.getByRole("combobox", { name: labels.contact.subjectLabel })).toHaveValue(service.serviceId);
    await expect(main.getByRole("option", { name: service.name, exact: true })).toBeAttached();
    await main.locator('[name="name"]').fill("Synthetic Visitor");
    await main.locator('[name="email"]').fill("visitor@example.test");
    await main.locator('[name="message"]').fill("A synthetic bilingual contact journey.");
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/contact" && response.request().method() === "POST");
    await submit.click();
    expect((await response).ok()).toBe(true);
    await expect(main.getByRole("status")).toContainText(labels.contact.successTitle);
  });

  test(`a catalog refresh retains the page's localized service names (${route.locale})`, async ({ page }) => {
    const service = (await getServices(route.locale))[0];
    await page.goto(`${contactPath}?service=${encodeURIComponent(service.serviceId)}`);
    const main = page.getByRole("main");
    const submit = main.getByRole("button", {name:labels.contact.submit,exact:true});
    await expect(submit).toBeEnabled();
    await page.route("**/api/contact", (route) => route.fulfill({status:422,contentType:"application/json",body:JSON.stringify({issues:[{field:"subject",code:"invalid-subject"}],services:[{serviceId:service.serviceId,name:"Owner catalog name"}]})}));
    await main.locator('[name="name"]').fill("Synthetic Visitor");
    await main.locator('[name="email"]').fill("visitor@example.test");
    await main.locator('[name="message"]').fill("A synthetic catalog refresh.");
    await submit.click();
    await expect(main.getByRole("alert")).toBeVisible();
    await expect(main.getByRole("combobox", {name:labels.contact.subjectLabel}).locator("option:checked")).toHaveText(service.name);
  });
}

test.describe("static language navigation without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const kind of ["home", "contact"] as const) {
    test(`${kind} opens the equivalent page in both directions`, async ({ page }) => {
      const config = getDeploymentConfig().localeRoutes;
      const [first, second] = config.locales;
      await page.goto(buildStaticPagePath(config, first.locale, kind));
      await page.getByRole("main").locator(`a[hreflang="${second.locale}"]`).click();
      await expect(page.locator("html")).toHaveAttribute("lang", second.locale);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new URL(buildStaticPagePath(config, second.locale, kind), getDeploymentConfig().canonicalBaseUrl).toString().replace(/\/$/, ""));
      await page.getByRole("main").locator(`a[hreflang="${first.locale}"]`).click();
      await expect(page.locator("html")).toHaveAttribute("lang", first.locale);
    });
  }
});

test("static routes normalize real pages and retain the normal unknown-path response", async ({ request }) => {
  const config = getDeploymentConfig().localeRoutes;
  const other = config.locales.find((route) => !route.isDefault)!;
  const canonical = buildStaticPagePath(config, other.locale, "contact");
  const normalized = await request.get(`/${other.prefix!.toUpperCase()}/Contact?service=portrait-sessions`, { maxRedirects: 0 });
  expect(normalized.status()).toBe(308);
  expect(normalized.headers().location).toBe(`${canonical}?service=portrait-sessions`);
  const home = await request.get(other.basePath, { headers: { "accept-language": config.defaultLocale }, maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect((await request.get("/", {headers:{"accept-language":other.locale},maxRedirects:0})).status()).toBe(200);
  const alias = await request.get(`/${config.redundantDefaultPrefix.toUpperCase()}/Contact?service=portrait-sessions`, {maxRedirects:0});
  expect(alias.status()).toBe(308);
  expect(alias.headers().location).toBe("/contact?service=portrait-sessions");
  expect((await request.get(`${other.basePath}/contact/missing`)).status()).toBe(404);
});
