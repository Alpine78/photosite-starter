import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, HARNESS_BASE_URL } from "./support/harness-environment";

// Public synthetic credentials from the refused-in-production memory adapter.
const HANDLE = Buffer.alloc(16, 0x66).toString("base64url");
const CAPABILITY = Buffer.alloc(32, 0x77).toString("base64url");
const PATH = `/private/${HANDLE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const paging = labels.privateGalleryDeliveryPaging;
const frames = (page: import("@playwright/test").Page) => page.locator("[data-item-id]");
const pagingStatus = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: paging.navigation, exact: true })
  .locator("..").getByRole("status");

/** No third-party bytes, including when the independently prepared preview Grid is combined. */
async function mockPagingPreviews(page: import("@playwright/test").Page) {
  await page.route(`**${PATH}/asset`, async (route) => {
    const body = route.request().postDataJSON() as { kind?: unknown; placementId?: unknown };
    if (body.kind !== "preview" || typeof body.placementId !== "string" || !/^paged-delivery-[1-9][0-9]*$/.test(body.placementId)) {
      return route.fulfill({ status: 403, contentType: "application/json", body: '{"ok":false}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store", date: new Date().toUTCString() },
      body: JSON.stringify({ ok: true, url: `${new URL(route.request().url()).origin}/mock-delivery-pagination/${body.placementId}.svg`,
        expiresAt: new Date(Date.now() + 300_000).toISOString() }) });
  });
  await page.route("**/mock-delivery-pagination/*.svg", (route) => route.fulfill({
    status: 200, contentType: "image/svg+xml", headers: { "cache-control": "no-store" },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
  }));
}

async function open(page: import("@playwright/test").Page, locale = appUnderTestEnvironment.SITE_LOCALE) {
  await mockPagingPreviews(page);
  await page.goto(`${PATH}?locale=${locale}#${CAPABILITY}`);
  await expect(page.getByRole("heading", { name: getBuiltInLabels(locale).privateGallery.galleryHeading, exact: true })).toBeVisible();
  await expect(frames(page)).toHaveCount(100);
  await expect(page.getByRole("region", { name: getBuiltInLabels(locale).privateGalleryDeliveryPaging.navigation, exact: true })).toHaveCount(0);
}

test("delivery API serves every bounded page with session-scoped private headers", async ({ request }) => {
  const exchange = await request.post(`${PATH}/exchange`, {
    headers: { "content-type": "application/json", origin: HARNESS_BASE_URL }, data: { capability: CAPABILITY },
  });
  expect(exchange.status()).toBe(200);
  const cookie = exchange.headers()["set-cookie"].split(";", 1)[0];
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    const response = await request.get(`${PATH}/items?page=${index}`, { headers: { cookie } });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/objectKey|nominalBytes|galleryId|capability|memory\/preview/);
    ids.push(...body.view.items.map((item: { itemId: string }) => item.itemId));
  }
  expect(ids).toEqual(Array.from({ length: 205 }, (_, index) => `paged-delivery-${index + 1}`));
  for (const suffix of ["?page=3", "?page=10", "?page=1&page=1", "?page=1&locale=fi"]) {
    const response = await request.get(`${PATH}/items${suffix}`, { headers: { cookie } });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ ok: false });
  }
  const refused = await request.get(`${PATH}/items?page=1`, { headers: { cookie: "" } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ ok: false });
});

test.describe("delivery paging in the customer document", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName === "webkit", "WebKit cannot retain the Secure session cookie on the harness's HTTP loopback origin; API pages are covered in both engines.");
  });

  test("keyboard browsing reaches all photographs and retains focus while pending and at both boundaries", async ({ page }) => {
    await open(page);
    const next = page.getByRole("button", { name: paging.nextPage, exact: true });
    const previous = page.getByRole("button", { name: paging.previousPage, exact: true });
    await expect(previous).toHaveAttribute("aria-disabled", "true");
    await previous.focus();
    await previous.press("Enter");
    await expect(previous).toBeFocused();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route(`**${PATH}/items?page=1`, async (route) => { requests++; await barrier; await route.continue(); });
    await next.focus();
    await next.press("Enter");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await next.press("Enter");
    await next.press("Space");
    await expect(next).toBeFocused();
    expect(requests).toBe(1);
    release();
    await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-101");
    await expect(pagingStatus(page)).toHaveText(paging.range.replace("{from}", "101").replace("{to}", "200").replace("{total}", "205"));
    await expect(next).toBeFocused();
    await next.press("Enter");
    await expect(frames(page)).toHaveCount(5);
    await expect(frames(page).last()).toHaveAttribute("data-item-id", "paged-delivery-205");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
    await next.press("Enter");
    await expect(next).toBeFocused();
    await expect(frames(page)).toHaveCount(5);
    await previous.click();
    await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-101");
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}${PATH}?locale=${appUnderTestEnvironment.SITE_LOCALE}`);
    await page.reload();
    await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-1");
  });

  test("a generic refusal or malformed response keeps the current page and can be retried", async ({ page }) => {
    await open(page);
    let attempts = 0;
    await page.route(`**${PATH}/items?page=1`, async (route) => {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
      if (attempts === 2) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, view: { pageIndex: 1, totalCount: 205, items: [], hasNextPage: true } }) });
      return route.continue();
    });
    const next = page.getByRole("button", { name: paging.nextPage, exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await next.click();
      await expect(pagingStatus(page)).toHaveText(paging.refused);
      await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-1");
      await expect(frames(page)).toHaveCount(100);
      await expect(next).toBeFocused();
    }
    await next.click();
    await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-101");
  });

  test("native FI/EN switching resets to the first page and retains only the locale selector", async ({ page }) => {
    await open(page, "fi");
    const fi = getBuiltInLabels("fi");
    await page.getByRole("button", { name: fi.privateGalleryDeliveryPaging.nextPage, exact: true }).click();
    await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-101");
    const language = page.getByRole("navigation", { name: fi.contentTree.languages }).getByRole("link");
    await expect(language).toHaveAttribute("href", `${PATH}?locale=en-GB`);
    // A second, old-locale page request must not replace the new document's first page.
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let oldRequest = false;
    await page.route(`**${PATH}/items?page=2`, async (route) => {
      oldRequest = true;
      await barrier;
      // The old document may already have aborted this request.
      await route.continue().catch(() => {});
    });
    await page.getByRole("button", { name: fi.privateGalleryDeliveryPaging.nextPage, exact: true }).click();
    await expect.poll(() => oldRequest).toBe(true);
    await language.click();
    release();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(page.getByRole("button", { name: getBuiltInLabels("en-GB").privateGalleryDeliveryPaging.nextPage, exact: true })).toBeVisible();
    await expect(frames(page).first()).toHaveAttribute("data-item-id", "paged-delivery-1");
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}${PATH}?locale=en-GB`);
  });
});
