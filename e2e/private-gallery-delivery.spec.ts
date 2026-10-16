import type { Page, Route } from "@playwright/test";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { HARNESS_BASE_URL } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * Real session/page authorization, then closure-local asset/byte responses.
 * The extra memory fixture has its own exchange allowance so these journeys
 * cannot consume the existing link/bootstrap spec's per-gallery rate limit.
 * No object storage, real customer bytes, or shared fixture mutation is used.
 */
const GALLERY_PATH = "/private/RERERERERERERERERERERA";
const CAPABILITY = "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU";
const DIMENSIONS: Record<string, readonly [number, number]> = {
  "memory-placement-01": [2048, 1365], "memory-placement-02": [1365, 2048],
  "memory-placement-03": [1600, 1600], "memory-placement-04": [2048, 768],
  "memory-placement-05": [1800, 1200],
};

type AssetRequest = { kind: "preview"; placementId: string } | { kind: "zip" };
async function reply(route: Route, url: string) {
  return route.fulfill({ status: 200, contentType: "application/json", headers: { date: new Date().toUTCString(), "cache-control": "no-store" },
    body: JSON.stringify({ ok: true, url, expiresAt: new Date(Date.now() + 300_000).toISOString() }) });
}

async function mockAssets(page: Page, options: {
  readonly zip?: (route: Route) => Promise<void>;
  readonly imageFailures?: Readonly<Record<string, number>>;
  readonly wrongFirstRatio?: boolean;
} = {}) {
  const requests: AssetRequest[] = [];
  const attempts = new Map<string, number>();
  await page.route(`**${GALLERY_PATH}/asset`, async route => {
    const input = route.request().postDataJSON() as AssetRequest;
    requests.push(input);
    if (input.kind === "zip") {
      if (options.zip !== undefined) return options.zip(route);
      return route.fulfill({ status: 403, body: '{"ok":false}', contentType: "application/json" });
    }
    expect(Object.keys(input).sort()).toEqual(["kind", "placementId"]);
    expect(DIMENSIONS[input.placementId]).toBeDefined();
    const attempt = (attempts.get(input.placementId) ?? 0) + 1;
    attempts.set(input.placementId, attempt);
    return reply(route, `${new URL(route.request().url()).origin}/mock-delivery/${input.placementId}.svg?attempt=${attempt}`);
  });
  await page.route("**/mock-delivery/*.svg*", async route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").at(-1)!.replace(/\.svg$/, "");
    if (Number(url.searchParams.get("attempt")) <= (options.imageFailures?.[id] ?? 0)) {
      return route.fulfill({ status: 403, body: "expired fixture URL" });
    }
    const [width, height] = options.wrongFirstRatio && id === "memory-placement-01" ? [1000, 1000] : DIMENSIONS[id];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "cache-control": "no-store" },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#789"/></svg>` });
  });
  return { requests, attempts };
}

async function openGallery(page: Page, locale = "en-GB") {
  await page.goto(`${GALLERY_PATH}?locale=${locale}#${CAPABILITY}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(getBuiltInLabels(locale).privateGallery.galleryHeading);
  await expect(page.locator("[data-item-id]")).toHaveCount(5);
}

for (const locale of ["fi", "en-GB"]) for (const width of [390, 1440]) {
  test(`delivery photographs preserve their full frames in ${locale} at ${width}px`, async ({ page, browserName, externalRequests }) => {
    test.skip(browserName === "webkit", "WebKit does not store the Secure session cookie on the harness's plain-HTTP loopback origin; hosted HTTPS remains a separate check.");
    await page.setViewportSize({ width, height: 844 });
    const mocks = await mockAssets(page, { wrongFirstRatio: true });
    await openGallery(page, locale);
    const labels = getBuiltInLabels(locale).privateGallery;
    await expect(page.getByRole("button", { name: labels.downloadZip })).toBeEnabled();
    for (const [id, [w, h]] of Object.entries(DIMENSIONS)) {
      const frame = page.locator(`[data-item-id="${id}"]`);
      await frame.scrollIntoViewIfNeeded();
      const image = frame.getByRole("img");
      await expect(image).toBeVisible();
      await expect(image).toHaveJSProperty("complete", true);
      await expect(image).toHaveJSProperty("naturalWidth", id === "memory-placement-01" ? 1000 : w);
      await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(await image.getAttribute("src")).not.toContain("/_next/image");
      expect(await image.evaluate(el => getComputedStyle(el).objectFit)).toBe("contain");
      const ratio = await frame.evaluate(el => { const box = el.getBoundingClientRect(); return box.width / box.height; });
      expect(ratio).toBeCloseTo(w / h, 1);
    }
    expect(mocks.requests.filter(input => input.kind === "zip")).toHaveLength(0);
    expect(externalRequests).toEqual([]);
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.evaluate(() => history.state)).not.toEqual(expect.objectContaining({ capability: CAPABILITY }));
  });
}

test("delivery preview expiry remints once, then offers an explicit keyboard retry", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Secure session cookies are not stored on this plain-HTTP WebKit harness.");
  const labels = getBuiltInLabels("en-GB").privateGallery;
  const mocks = await mockAssets(page, { imageFailures: { "memory-placement-01": 1, "memory-placement-02": 2 } });
  await openGallery(page);
  const first = page.locator('[data-item-id="memory-placement-01"]');
  const second = page.locator('[data-item-id="memory-placement-02"]');
  await first.scrollIntoViewIfNeeded();
  await expect(first.getByRole("img")).toHaveJSProperty("naturalWidth", 2048);
  expect(mocks.attempts.get("memory-placement-01")).toBe(2);
  await second.scrollIntoViewIfNeeded();
  const retry = second.getByRole("button", { name: labels.retryImage });
  await expect(retry).toBeVisible();
  expect(mocks.attempts.get("memory-placement-02")).toBe(2);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(second.getByRole("img")).toHaveJSProperty("naturalHeight", 2048);
  expect(mocks.attempts.get("memory-placement-02")).toBe(3);
});

test("ZIP minting is deliberate, single-flight and hands a native attachment to the browser", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Secure session cookies are not stored on this plain-HTTP WebKit harness.");
  const labels = getBuiltInLabels("en-GB").privateGallery;
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const mocks = await mockAssets(page, { zip: async route => {
    await held;
    return reply(route, `${new URL(route.request().url()).origin}/mock-delivery/gallery.zip`);
  } });
  const byteRequests: Array<{ method: string; resourceType: string; referrer?: string }> = [];
  await page.route("**/mock-delivery/gallery.zip", async route => {
    byteRequests.push({ method: route.request().method(), resourceType: route.request().resourceType(), referrer: route.request().headers().referer });
    return route.fulfill({ status: 200, contentType: "application/zip", headers: {
      "content-disposition": 'attachment; filename="fixture-gallery.zip"', "cache-control": "no-store",
    }, body: Buffer.from("504b0506000000000000000000000000000000000000", "hex") });
  });
  await openGallery(page);
  expect(mocks.requests.filter(r => r.kind === "zip")).toHaveLength(0);
  const button = page.getByRole("button", { name: labels.downloadZip });
  await expect(button).toBeEnabled();
  const downloadEvent = page.waitForEvent("download");
  await button.click({ clickCount: 2 });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  expect(mocks.requests.filter(r => r.kind === "zip")).toEqual([{ kind: "zip" }]);
  release();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("fixture-gallery.zip");
  expect(await download.failure()).toBeNull();
  await expect(page.getByRole("status").filter({ hasText: labels.downloadRequested })).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(button).toBeEnabled();
  expect(byteRequests).toHaveLength(1);
  expect(byteRequests[0]).toMatchObject({ method: "GET", referrer: undefined });
  expect(["fetch", "xhr"]).not.toContain(byteRequests[0].resourceType);
  expect(new URL(page.url()).pathname).toBe(GALLERY_PATH);
  expect(await page.evaluate(() => location.href)).not.toContain("gallery.zip");
});

test("an unavailable ZIP stays generic and a later click reauthorizes", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Secure session cookies are not stored on this plain-HTTP WebKit harness.");
  const labels = getBuiltInLabels("fi").privateGallery;
  const mocks = await mockAssets(page);
  await openGallery(page, "fi");
  const button = page.getByRole("button", { name: labels.downloadZip });
  await expect(button).toBeEnabled();
  await button.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: labels.downloadUnavailable })).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(() => mocks.requests.filter(r => r.kind === "zip").length).toBe(2);
  expect(new URL(page.url()).pathname).toBe(GALLERY_PATH);
});

test.describe("authorized delivery without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("renders an honest explanation and inert download with no eager object URL", async ({ page, request }) => {
    const exchange = await request.post(`${GALLERY_PATH}/exchange`, { headers: { origin: HARNESS_BASE_URL, "content-type": "application/json" }, data: { capability: CAPABILITY } });
    expect(exchange.status()).toBe(200);
    const cookie = (exchange.headers()["set-cookie"] ?? "").split(";", 1)[0];
    const path = `${GALLERY_PATH}?locale=fi`;
    const authorized = await request.get(path, { headers: { cookie } });
    expect(authorized.status()).toBe(200);
    const html = await authorized.text();
    expect(html).not.toContain(CAPABILITY);
    expect(html).not.toMatch(/X-Amz-|mock-delivery|<img/);
    // Reuse this genuinely authorized SSR response to inspect no-script markup
    // in both engines, without pretending WebKit accepted an HTTP Secure cookie.
    await page.route(`**${path}`, route => route.fulfill({ response: authorized }));
    await page.goto(path);
    const labels = getBuiltInLabels("fi").privateGallery;
    // Playwright's text selector intentionally skips noscript descendants.
    await expect(page.locator("noscript p")).toHaveText(labels.deliveryJavascriptRequired);
    await expect(page.locator("noscript p")).toBeVisible();
    await expect(page.getByRole("button", { name: labels.downloadZip })).toBeDisabled();
    await expect(page.locator("[data-item-id]")).toHaveCount(5);
    expect(authorized.headers()["cache-control"]).toContain("no-store");
    expect(authorized.headers()["referrer-policy"]).toBe("no-referrer");
  });
});
