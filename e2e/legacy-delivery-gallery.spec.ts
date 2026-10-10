import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE, REDUNDANT_DEFAULT_PREFIX } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

// Deliberately synthetic opaque identities; never source/customer names.
const handle = "11111111111111111111111111111111";
const route = `/client-gallery/${handle}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const hygiene = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

test("legacy delivery has full frames, direct sources, one ZIP and keyboard viewing", async ({ page, externalRequests }) => {
  const response = await page.goto(route);
  expect(response?.status()).toBe(200);
  for (const [name, value] of Object.entries(hygiene)) expect(response?.headers()[name]).toBe(value);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(labels.legacyGallery.title);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const images = page.getByRole("main").getByRole("img");
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    await expect(image).not.toHaveAttribute("src", /_next\/image/);
    await expect(image).not.toHaveAttribute("srcset", /.+/);
    expect(await image.evaluate((node: HTMLImageElement) => Math.abs(node.getBoundingClientRect().width / node.getBoundingClientRect().height - node.naturalWidth / node.naturalHeight))).toBeLessThan(0.01);
    expect(await image.evaluate((node: HTMLImageElement) => node.getBoundingClientRect().width <= node.naturalWidth)).toBe(true);
  }
  await expect(page.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("link", { name: labels.legacyGallery.download })).toHaveAttribute("href", /^\/gallery\/legacy-fixture\.[a-f0-9]{12}\.zip$/);
  const opener = page.getByRole("main").getByRole("button").first();
  await opener.focus(); await openLightbox(page.getByRole("dialog"), () => page.keyboard.press("Enter"));
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await presentedImage(page.getByRole("dialog")))?.alt).toBe("Geometric portrait");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button").nth(1)).toBeFocused();
  expect(externalRequests).toEqual([]);
});

test.describe("scriptless legacy delivery", () => {
  test.use({ javaScriptEnabled: false });
  test("legacy images and whole ZIP remain usable without JavaScript", async ({ page, request }) => {
    await page.goto(route); await expect(page.getByRole("main").getByRole("img")).toHaveCount(2);
    const href = await page.getByRole("link", { name: labels.legacyGallery.download }).getAttribute("href");
    expect(href).toMatch(/^\/gallery\//);
    const archive = await request.get(href!); expect(archive.status()).toBe(200);
    const bytes = await archive.body(); expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304"); expect(bytes.length).toBe(179);
  });
});

for (const path of ["/client-gallery", "/client-gallery/bad", "/client-gallery/22222222222222222222222222222222", "/client-gallery/33333333333333333333333333333333", `${route}/image.jpg`, `/CLIENT-GALLERY/${handle}`, `/%63lient-gallery/${handle}`, `/${PREFIXED_LOCALE.prefix}${route}`, `/${REDUNDANT_DEFAULT_PREFIX}${route}`]) {
  test(`${path} refuses without discovery or caching`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 }); expect(response.status()).toBe(404);
    for (const [name, value] of Object.entries(hygiene)) expect(response.headers()[name]).toBe(value);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).not.toContain("Rocky shoreline");
  });
}

test("legacy trailing-slash redirect has the same response hygiene", async ({ request }) => {
  const response = await request.get(`${route}/`, { maxRedirects: 0 }); expect(response.status()).toBe(308);
  for (const [name, value] of Object.entries(hygiene)) expect(response.headers()[name]).toBe(value);
  expect(response.headers()["cache-control"]).toBe("no-store"); expect(response.headers().location).toContain(route);
});

test("a delivery failure returns a hygienic generic server error, never an empty gallery", async ({ request }) => {
  const response = await request.get("/client-gallery/44444444444444444444444444444444");
  expect(response.status()).toBe(500);
  for (const [name, value] of Object.entries(hygiene)) expect(response.headers()[name]).toBe(value);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).not.toContain("Synthetic legacy delivery failure");
});

test("ordinary sitemap and home do not discover legacy delivery", async ({ request }) => {
  for (const path of ["/", "/sitemap.xml"]) { const response = await request.get(path); expect(response.ok()).toBe(true); expect(await response.text()).not.toContain(route); }
});

test.describe("touch legacy delivery", () => {
  test.use({ hasTouch: true });
  test("legacy viewer supports tap opening and reopening on a touch viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(route);
  const opener = page.getByRole("main").getByRole("button").first();
  await openLightbox(page.getByRole("dialog"), () => opener.tap());
  // Emulated horizontal drag of the visible image, plus real touchscreen taps.
  const visible = await presentedImage(page.getByRole("dialog"));
  expect(visible).not.toBeNull();
  await page.mouse.move(300, 420); await page.mouse.down();
  await page.mouse.move(60, 420, { steps: 15 }); await page.mouse.up();
  await expect.poll(async () => (await presentedImage(page.getByRole("dialog")))?.alt).toBe("Geometric portrait");
  await page.getByRole("button", { name: labels.lightbox.close, exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openLightbox(page.getByRole("dialog"), () => opener.tap());
  await page.keyboard.press("Escape");
  });
});
