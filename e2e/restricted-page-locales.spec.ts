import { getBuiltInLabels } from "@/lib/deployment-config";
import { languageName } from "@/lib/language-fallback";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, HARNESS_BASE_URL, PREFIXED_LOCALE } from "./support/harness-environment";

const locales = [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix];
const legacyPath = "/client-gallery/11111111111111111111111111111111";
const proofPath = "/private/IiIiIiIiIiIiIiIiIiIiIg";
const proofCapability = "Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4";
const adminSecret = "development-fixture-administrator-secret-not-for-any-real-deployment";

for (const locale of locales) {
  const labels = getBuiltInLabels(locale);
  test(`admin ${locale} preserves locale through sign-in and sign-out`, async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "The HTTP harness cannot retain its Secure cookie in WebKit; the wire contract remains covered.");
    await page.goto(`/admin?locale=${locale}&return=ignored#unrelated`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { name: labels.privateGalleryAdmin.title, exact: true })).toBeVisible();
    await page.getByLabel(labels.privateGalleryAdmin.secretLabel).fill(adminSecret);
    await page.getByRole("button", { name: labels.privateGalleryAdmin.signIn, exact: true }).click();
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}/admin?locale=${locale}`);
    await expect(page.getByRole("heading", { name: labels.privateGalleryAdmin.signedInHeading, exact: true })).toBeVisible();
    await page.getByRole("button", { name: labels.privateGalleryAdmin.signOut, exact: true }).click();
    await expect(page.getByRole("heading", { name: labels.privateGalleryAdmin.title, exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}/admin?locale=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  });
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
  test(`unauthorized proof ${locale} exposes no language switch or discovery`, async ({ page }) => {
    await page.goto(`${proofPath}?locale=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: labels.privateGallery.title })).toBeVisible();
  });
}

test("authorized proof preserves the clean locale through bootstrap and language switch", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "The HTTP harness cannot retain its Secure cookie in WebKit; the wire contract remains covered.");
  const urls: string[] = []; page.on("request", (request) => urls.push(request.url()));
  await page.goto(`${proofPath}?locale=fi#${proofCapability}`);
  const labels = getBuiltInLabels("fi");
  await expect(page.getByRole("heading", { name: labels.privateGallery.galleryHeading })).toBeVisible();
  await expect(page).toHaveURL(`${HARNESS_BASE_URL}${proofPath}?locale=fi`);
  expect(urls.some((url) => url.includes(proofCapability))).toBe(false);
  const switcher = page.getByRole("navigation", { name: labels.contentTree.languages });
  await expect(switcher.getByRole("link")).toHaveAttribute("href", `${proofPath}?locale=${appUnderTestEnvironment.SITE_LOCALE}`);
  await switcher.getByRole("link").click();
  await expect(page.locator("html")).toHaveAttribute("lang", appUnderTestEnvironment.SITE_LOCALE);
  await expect(page.getByRole("heading", { name: getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).privateGallery.galleryHeading })).toBeVisible();
});

test("language switching warns after an edit and can be cancelled", async ({ page }) => {
  await page.goto("/admin?locale=fi&cursor=discard#discard");
  await page.getByLabel(getBuiltInLabels("fi").privateGalleryAdmin.secretLabel).fill("synthetic-unsaved-value");
  const dialogs: string[] = [];
  page.once("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  const link = page.getByRole("navigation", { name: getBuiltInLabels("fi").contentTree.languages }).getByRole("link");
  await expect(link).toHaveAttribute("href", "/admin?locale=en-GB");
  await link.click();
  await expect(page).toHaveURL(`${HARNESS_BASE_URL}/admin?locale=fi&cursor=discard#discard`);
  expect(dialogs).toEqual([getBuiltInLabels("fi").restrictedLocale.changeWarning]);
});

test.describe("scriptless locale selection", () => {
  test.use({ javaScriptEnabled: false });
  test("admin and retained delivery switch through plain clean document links", async ({ page }) => {
    for (const path of ["/admin", legacyPath]) {
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
    const response = await request.get(`/admin${search}`, { headers: { "x-photosite-restricted-ui-locale": "fi" } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`<html lang="${appUnderTestEnvironment.SITE_LOCALE}"`);
  }
});


for (const locale of locales) {
  test(`authenticated server UI ${locale} preserves language and cookie boundaries`, async ({ request }) => {
    const origin = HARNESS_BASE_URL;
    const login = await request.post("/admin/login", { headers: { origin }, data: { secret: adminSecret } });
    expect(login.status()).toBe(200);
    const adminCookie = login.headers()["set-cookie"].split(";")[0];
    expect(adminCookie).toMatch(/^__Host-pg_admin_session=/);
    const admin = await request.get(`/admin?locale=${locale}`, { headers: { cookie: adminCookie } });
    expect(await admin.text()).toContain(`<html lang="${locale}"`);
    expect(await admin.text()).toContain(getBuiltInLabels(locale).privateGalleryAdmin.signedInHeading);
    const exchange = await request.post(`${proofPath}/exchange`, { headers: { origin }, data: { capability: proofCapability } });
    expect(exchange.status()).toBe(200);
    const galleryCookie = exchange.headers()["set-cookie"].split(";")[0];
    expect(galleryCookie).toMatch(/^__Secure-/);
    const gallery = await request.get(`${proofPath}?locale=${locale}`, { headers: { cookie: galleryCookie } });
    expect(await gallery.text()).toContain(`<html lang="${locale}"`);
    expect(await gallery.text()).toContain(getBuiltInLabels(locale).privateGallery.galleryHeading);
    expect(gallery.headers()["referrer-policy"]).toBe("no-referrer");
    expect(gallery.headers()["cache-control"]).toContain("no-store");
  });
}


for (const locale of locales) {
  test(`legacy failure ${locale} shows generic selected-language copy`, async ({ page }) => {
    const response = await page.goto(`/client-gallery/44444444444444444444444444444444?locale=${locale}`);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { name: getBuiltInLabels(locale).pageError.title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: getBuiltInLabels(locale).pageError.retry, exact: true })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toContain("Synthetic legacy delivery failure");
  });
}

test("an authorized but unsrubbable capability URL has no outgoing language switch", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "The HTTP harness cannot retain its Secure cookie in WebKit.");
  await page.goto(`${proofPath}?locale=fi#${proofCapability}`);
  await expect(page.getByRole("heading", { name: getBuiltInLabels("fi").privateGallery.galleryHeading })).toBeVisible();
  await expect(page.getByRole("navigation", { name: getBuiltInLabels("fi").contentTree.languages })).toBeVisible();
  await page.addInitScript(() => {
    const original = window.history.replaceState.bind(window.history);
    window.history.replaceState = (state, title, url) => {
      // Block fragment removal only; allow the router to preserve its history state.
      if (window.location.hash && url && !String(url).includes("#")) throw new Error("Synthetic scrub failure");
      original(state, title, url);
    };
  });
  // A different query forces a new document, so the init override runs before bootstrap.
  await page.goto(`${proofPath}?locale=fi&scrub-test=1#${proofCapability}`);
  await expect(page.getByRole("heading", { name: getBuiltInLabels("fi").privateGallery.galleryHeading })).toBeVisible();
  await expect(page.getByRole("navigation", { name: getBuiltInLabels("fi").contentTree.languages })).toHaveCount(0);
  expect(await page.evaluate(() => window.location.hash.length > 0)).toBe(true);
});
