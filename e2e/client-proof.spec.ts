import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

// ADR-0038 action item 2: the read-only proof page, on the harness fixture adapter.
const route = `/client-proof/${"7".repeat(32)}`;
const finiteRoute = `/client-proof/${"8".repeat(32)}`;
const fixtureDeadline = "2100-01-02T03:04:05.123Z";
const hygiene = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

for (const locale of [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix]) {
  const labels = getBuiltInLabels(locale), copy = labels.proofGallery, finnish = locale === "fi";
  const proof = (reference: string) => copy.reference.replace("{reference}", reference);

  test(`proof page ${locale} shows complete, permanently numbered proofs and their notices`, async ({ page, externalRequests }) => {
    const response = await page.goto(`${route}?locale=${locale}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    for (const [name, value] of Object.entries(hygiene)) expect(response?.headers()[name]).toBe(value);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(finnish ? "Vedokset" : "Proofs");
    await expect(page.locator("main time")).toHaveCount(0);
    const notice = page.getByRole("region", { name: copy.noticeTitle });
    for (const text of [copy.selectionNotice, copy.publicAccessNotice, copy.fileRetentionNotice]) await expect(notice).toContainText(text);
    // Numbers are permanent references in authored order, gaps and leading zeros included.
    await expect(page.getByRole("main").locator("figcaption")).toHaveText([proof("014"), proof("002")]);
    const images = page.getByRole("main").getByRole("img"); await expect(images).toHaveCount(2);
    // An image without alternative text is named by its number.
    await expect(images.nth(1)).toHaveAttribute("alt", proof("002"));
    for (const image of await images.all()) {
      // Lazy images load near the viewport; the tall portrait pushes the next one far down on mobile.
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      await expect(image).not.toHaveAttribute("src", /_next\/image/);
      expect(await image.evaluate((node: HTMLImageElement) => Math.abs(node.width / node.height - node.naturalWidth / node.naturalHeight))).toBeLessThan(0.01);
    }
    const dialog = page.getByRole("dialog");
    await page.getByRole("main").getByRole("button").first().focus();
    await openLightbox(dialog, () => page.keyboard.press("Enter"));
    const description = async () => {
      const id = (await presentedImage(dialog))?.describedBy;
      return id ? page.locator(`[id="${id}"]`).innerText() : undefined;
    };
    await expect.poll(description).toContain(proof("014"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(description).toContain(proof("002"));
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button").nth(1)).toBeFocused();
    const html = await page.content();
    for (const internal of ["clientProofGallery", "referenceHighWater", "originalFilename", "proofTerms", "select="]) expect(html).not.toContain(internal);
    expect(externalRequests).toEqual([]);
  });

  test(`finite proof page ${locale} shows its exact UTC cutoff`, async ({ page, externalRequests }) => {
    await page.goto(`${finiteRoute}?locale=${locale}`);
    const time = page.locator("main time");
    await expect(time).toHaveCount(1); await expect(time).toHaveAttribute("datetime", fixtureDeadline);
    expect(externalRequests).toEqual([]);
  });
}

test.describe("proof page without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("keeps complete images and their numbers visible", async ({ page, externalRequests }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main").getByRole("img")).toHaveCount(2);
    await expect(page.getByRole("main").locator("figcaption")).toHaveCount(2);
    expect(externalRequests).toEqual([]);
  });
});

test("the selection link's fragment is ignored and never sent", async ({ page, externalRequests }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  const response = await page.goto(`${route}#select=${"K".repeat(43)}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("main").locator("figcaption")).toHaveCount(2);
  expect(requested.some((url) => url.includes("K".repeat(43)))).toBe(false);
  expect(externalRequests).toEqual([]);
});

test("unknown, malformed and aliased proof paths stay unavailable with reserved-page headers", async ({ request }) => {
  for (const path of [`/client-proof/${"0".repeat(32)}`, "/client-proof/short", `/Client-Proof/${"7".repeat(32)}`, `/${PREFIXED_LOCALE.prefix}/client-proof/${"7".repeat(32)}`]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404); expect(response.headers()["cache-control"]).toContain("no-store");
    for (const [name, value] of Object.entries(hygiene)) expect(response.headers()[name]).toBe(value);
  }
  const slash = await request.get(`${route}/`, { maxRedirects: 0 });
  expect(slash.status()).toBe(308); expect(new URL(slash.headers().location, "http://harness.invalid").pathname).toBe(route);
});

test("a proof provider failure is a hygienic server error, never an empty gallery", async ({ request }) => {
  const response = await request.get(`/client-proof/${"e".repeat(32)}`);
  expect(response.status()).toBe(500); expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(await response.text()).not.toContain("Synthetic proof gallery failure");
});

test("proof pages stay out of the sitemap and robots policy names no handle", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("client-proof");
  expect(await (await request.get("/robots.txt")).text()).not.toContain("7".repeat(32));
});
