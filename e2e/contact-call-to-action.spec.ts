import { expect, test } from "./support/fixtures";
import { getHomeContent } from "../src/lib/home-content";
import { getServicesContactCallToAction, getSiteSettings } from "../src/lib/site-settings";
import { PREFIXED_LOCALE } from "./support/harness-environment";

/** AB#177: each page uses its own authored copy and reaches the contact page. */
test.use({ javaScriptEnabled: false });

test("home and services contact bands lead to contact without JavaScript", async ({ page, externalRequests }) => {
  const home = await getHomeContent();
  const settings = await getSiteSettings();
  expect(home.contactCallToAction).toBeDefined();
  expect(settings.servicesContactCallToAction).toBeDefined();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const homeBand = page.getByRole("region", { name: home.contactCallToAction!.heading });
  await expect(homeBand).toContainText(home.contactCallToAction!.text);
  await expect(homeBand.getByRole("link")).toHaveAttribute("href", "/contact");
  await homeBand.getByRole("link").click();
  await expect(page).toHaveURL(/\/contact$/);

  await page.goto("/services", { waitUntil: "domcontentloaded" });
  const servicesBand = page.getByRole("region", { name: settings.servicesContactCallToAction!.heading });
  await expect(servicesBand).toContainText(settings.servicesContactCallToAction!.text);
  await expect(servicesBand.getByRole("link")).toHaveAttribute("href", "/contact");
  await servicesBand.getByRole("link").click();
  await expect(page).toHaveURL(/\/contact$/);
  const prefixedPath = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.serviceNamespace}`;
  const prefixedCopy = await getServicesContactCallToAction(`${PREFIXED_LOCALE.prefix}-FI`);
  expect(prefixedCopy).toBeDefined();
  await page.goto(prefixedPath, { waitUntil: "domcontentloaded" });
  const prefixedBand = page.getByRole("region", { name: prefixedCopy!.heading });
  await expect(prefixedBand).toContainText(prefixedCopy!.text);
  await expect(prefixedBand.getByRole("link")).toHaveAttribute("href", "/contact");
  await prefixedBand.getByRole("link").click();
  await expect(page).toHaveURL(/\/contact$/);
  expect(externalRequests).toEqual([]);
});
