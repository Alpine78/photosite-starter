import { getBuiltInLabels } from "../src/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { openLightbox } from "./support/lightbox";
import {
  DEFAULT_SEARCH_NAMESPACE,
  PREFIXED_LOCALE,
  REDUNDANT_DEFAULT_PREFIX,
  appUnderTestEnvironment,
} from "./support/harness-environment";

/**
 * The keyword gallery (ADR-0012, AB#71) against the production build. Keyword ids and their
 * order come from the project's own neutral mock vocabulary, not a deployment's content.
 */

const SEARCH_PATH = `/${DEFAULT_SEARCH_NAMESPACE}`;
const gallery = (keywords: string, cursor?: string) => `${SEARCH_PATH}?keywords=${keywords}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
const defaultLocale = appUnderTestEnvironment.SITE_LOCALE;
const labels = getBuiltInLabels(defaultLocale).search;

test.describe("asking about a photograph in a keyword gallery", () => {
  const builtIn = getBuiltInLabels(defaultLocale);
  const SEARCH = SEARCH_PATH;
  const COAST = `${SEARCH}?keywords=coast`;
  const synthetic = { name: "Harness Visitor", email: "visitor@harness.test", message: "Automated public-journey check. No reply is expected." };

  async function submit(page: import("@playwright/test").Page) {
    const button = page.locator("form").getByRole("button", { name: /\S/ });
    await expect(button).toBeEnabled();
    for (const [name, value] of Object.entries(synthetic)) await page.locator(`[name="${name}"]`).fill(value);
    await button.click();
  }

  test("the viewer's control keeps the selection, and the form sends only public context", async ({ page }) => {
    await page.goto(COAST);
    const dialog = page.getByRole("dialog");
    await openLightbox(dialog, () => page.getByRole("main").locator('[data-item-id="coastal-landscape"]').click());
    const enquire = dialog.getByRole("link", { name: builtIn.lightbox.enquire });
    await expect(enquire).toHaveAttribute("href", `${COAST}&enquire=coastal-landscape`);
    await enquire.click();
    await expect(page.getByRole("heading", { name: builtIn.enquiry.pageTitle })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${COAST.replace("?", "\\?")}$`));
    await expect(page.getByRole("main").getByRole("link", { name: builtIn.enquiry.backToGallery })).toHaveAttribute("href", COAST);

    const posted = page.waitForRequest((request) => request.url().endsWith("/api/enquiry"));
    await submit(page);
    const body = (await posted).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "dynamic", itemId: "coastal-landscape" });
    expect(body).not.toHaveProperty("contentId");
    await expect(page.getByRole("main").getByRole("status")).toContainText(builtIn.contact.successTitle);
  });

  test("a photograph that is not opted in has no control, and its form refuses", async ({ page }) => {
    await page.goto(`${SEARCH}?keywords=water`);
    const dialog = page.getByRole("dialog");
    await openLightbox(dialog, () => page.getByRole("main").locator('[data-item-id="lakeside-reeds"]').click());
    await expect(dialog.getByRole("link", { name: builtIn.lightbox.enquire })).toHaveCount(0);
    await page.goto(`${SEARCH}?keywords=water&enquire=lakeside-reeds`);
    await submit(page);
    await expect(page.getByRole("main").getByRole("status")).toContainText(builtIn.enquiry.unavailable);
  });

  test("the address keeps ADR-0012's rules", async ({ page, request }) => {
    const seaside = await request.get(`${SEARCH}?keywords=seaside&enquire=coastal-landscape`, { maxRedirects: 0 });
    expect(seaside.status()).toBe(308);
    expect(seaside.headers().location).toContain("keywords=coast&enquire=coastal-landscape");
    expect((await request.get(`${COAST}&cursor=abc&enquire=coastal-landscape`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get(`${SEARCH}?keywords=nonexistent-keyword&enquire=coastal-landscape`, { maxRedirects: 0 })).status()).toBe(404);
    await page.goto(`${COAST}&enquire=Not%20Valid`);
    await expect(page.getByRole("main").locator("[data-item-id]").first()).toBeVisible();
  });
});

test.describe("keyword gallery", () => {
  test("a canonical address renders the selection on the server and says what it means", async ({ page }) => {
    const response = await page.goto(gallery("coast,water"));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(labels.keywordTitle.split("{names}")[0]);
    await expect(page.getByText(labels.keywordSummary)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /keywords=coast,water$/);
  });

  for (const [name, spelling] of [
    ["reordered", "water,coast"],
    ["with a repeat", "coast,water,water"],
    ["with a redundant ancestor", "coast,water,nature"],
    ["with a merged id", "seaside,water"],
  ] as const) {
    test(`a selection ${name} redirects permanently to one canonical address`, async ({ request }) => {
      const response = await request.get(gallery(spelling), { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toMatch(/keywords=coast,water$/);
    });
  }

  test("casing and a trailing slash collapse in one redirect after validation", async ({ request }) => {
    for (const path of [`${SEARCH_PATH.toUpperCase()}?keywords=water,coast`, `${SEARCH_PATH}/?keywords=coast,water`, `/${REDUNDANT_DEFAULT_PREFIX}${SEARCH_PATH}?keywords=water,coast`]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(308);
      expect(new URL(response.headers().location, "http://x").pathname + new URL(response.headers().location, "http://x").search, path).toBe(gallery("coast,water"));
    }
  });

  test("an invalid selection or cursor answers 404 in every spelling, and is never redirected", async ({ request }) => {
    const refused = [
      gallery("unknown"),
      gallery("Coast"),
      gallery("archive,autumn,coast,forest,trees,water"),
      gallery("coast", "not-a-cursor"),
      `${SEARCH_PATH}?keywords=coast&cursor=a&cursor=a`,
      `${SEARCH_PATH}?keywords=coast&cursor=`,
      `${SEARCH_PATH}/?keywords=coast&cursor=not-a-cursor`,
      `${SEARCH_PATH.toUpperCase()}?keywords=unknown`,
      `/${REDUNDANT_DEFAULT_PREFIX}${SEARCH_PATH}?keywords=unknown`,
    ];
    for (const path of refused) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).toContain("noindex");
    }
  });

  test("a selection nothing matches is a real page that says so", async ({ page }) => {
    expect((await page.goto(gallery("autumn,coast")))?.status()).toBe(200);
    await expect(page.getByText(labels.keywordNoResults)).toBeVisible();
    await expect(page.getByRole("list", { name: /./ }).getByRole("button")).toHaveCount(0);
  });

  test("an empty selection stays the search landing state", async ({ page }) => {
    expect((await page.goto(`${SEARCH_PATH}?keywords=,%20,`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: labels.title })).toBeVisible();
  });

  test("the keyboard opens a photograph, and the page shows only one bounded page of them", async ({ page }) => {
    await page.goto(gallery("archive"));
    const tiles = page.getByRole("button", { name: /./ }).filter({ has: page.locator("img") });
    await expect(tiles).toHaveCount(24);
    const viewer = page.getByRole("dialog");
    await openLightbox(viewer, async () => {
      await tiles.first().focus();
      await page.keyboard.press("Enter");
    });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(tiles.first()).toBeFocused();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the keyword browser is plain links", async ({ page }) => {
      await page.goto(SEARCH_PATH);
      const link = page.getByRole("region", { name: labels.keywordBrowseHeading }).getByRole("link").first();
      await expect(link).toHaveAttribute("href", /\?keywords=/);
    });

    test("the continuation is a real link, with the selection before the cursor, and offers a way back", async ({ page }) => {
      await page.goto(gallery("archive"));
      const next = page.locator('a[rel="next"]');
      const href = await next.getAttribute("href");
      expect(href).toMatch(/^[^?]+\?keywords=archive&cursor=/);
      expect((await page.goto(href!))?.status()).toBe(200);
      await expect(page.getByRole("link", { name: labels.keywordBackToStart })).toHaveAttribute("href", gallery("archive"));
    });
  });

  test("back and forward restore the selection after moving to another one", async ({ page }) => {
    await page.goto(gallery("coast"));
    const heading = page.getByRole("heading", { level: 1 });
    const first = await heading.textContent();
    await page.goto(gallery("archive"));
    const second = await heading.textContent();
    expect(second).not.toBe(first);
    await page.goBack();
    await expect(heading).toHaveText(first!);
    await page.goForward();
    await expect(heading).toHaveText(second!);
  });

  test("the search landing state browses the vocabulary by keyboard, down to a gallery", async ({ page }) => {
    await page.goto(SEARCH_PATH);
    const browser = page.getByRole("region", { name: labels.keywordBrowseHeading });
    await expect(browser).toBeVisible();
    await expect(browser.getByRole("heading", { level: 3 }).first()).toBeVisible();
    const link = browser.getByRole("link").first();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/\?keywords=[a-z0-9-]+$/);
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${href!.replace("?", "\\?")}$`));
    await expect(page.getByText(labels.keywordSummary)).toBeVisible();
  });

  test("a parent's count matches the photographs its gallery can reach", async ({ page }) => {
    await page.goto(SEARCH_PATH);
    const nature = page.getByRole("listitem").filter({ has: page.locator('a[href$="keywords=nature"]') });
    await expect(nature.first()).toContainText("4");
    await page.goto(gallery("nature"));
    await expect(page.getByRole("button", { name: /./ }).filter({ has: page.locator("img") })).toHaveCount(4);
  });

  test("a results page does not repeat the browser", async ({ page }) => {
    await page.goto(`${SEARCH_PATH}?q=zzzzzzzz`);
    await expect(page.getByRole("region", { name: labels.keywordBrowseHeading })).toHaveCount(0);
  });

  test.describe("keyword selector", () => {
    const field = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: labels.keywordSelectorLabel });
    const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: labels.keywordSelectorSelected }).getByRole("listitem");

    async function pick(page: import("@playwright/test").Page, term: string) {
      const input = field(page);
      await input.fill(term);
      await expect(page.getByRole("option").first()).toBeVisible();
      await input.press("ArrowDown");
      await expect(input).toHaveAttribute("aria-activedescendant", /.+/);
      await input.press("Enter");
      await expect(input).toHaveValue("");
    }

    test("the keyboard builds a selection and reaches its canonical gallery", async ({ page }) => {
      await page.goto(SEARCH_PATH);
      await pick(page, "water");
      await pick(page, "coast");
      await expect(chips(page)).toHaveCount(2);
      await page.getByRole("button", { name: labels.keywordSelectorShow }).click();
      await expect(page).toHaveURL(/\?keywords=coast,water$/);
      await expect(page.getByText(labels.keywordSummary)).toBeVisible();
    });

    test("a descendant replaces its ancestor, and removing it does not bring the ancestor back", async ({ page }) => {
      await page.goto(SEARCH_PATH);
      await pick(page, "nature");
      await pick(page, "water");
      await expect(chips(page)).toHaveCount(1);
      await expect(chips(page).first()).toContainText("Water");
      await page.getByRole("button", { name: labels.keywordSelectorRemove.replace("{name}", "Water") }).click();
      await expect(page.getByRole("list", { name: labels.keywordSelectorSelected })).toHaveCount(0);
      await expect(field(page)).toBeFocused();
    });

    test("it stops at five, and says why", async ({ page }) => {
      await page.goto(SEARCH_PATH);
      for (const term of ["water", "trees", "coast", "forest", "autumn"]) await pick(page, term);
      const input = field(page);
      await input.fill("archive");
      await expect(page.getByRole("option").first()).toBeVisible();
      await input.press("ArrowDown");
      await input.press("Enter");
      await expect(chips(page)).toHaveCount(5);
      await expect(page.getByRole("status").filter({ hasText: labels.keywordSelectorLimit.replace("{count}", "5") })).toBeAttached();
    });

    test("Escape closes the list, and no match is said out loud", async ({ page }) => {
      await page.goto(SEARCH_PATH);
      const input = field(page);
      await input.fill("water");
      await expect(page.getByRole("option").first()).toBeVisible();
      await input.press("Escape");
      await expect(page.getByRole("option")).toHaveCount(0);
      await expect(input).toHaveAttribute("aria-expanded", "false");
      await input.fill("zzzzzz");
      await expect(page.getByRole("status").filter({ hasText: labels.keywordSelectorNoMatches })).toBeAttached();
    });

    test("it asks a debounced, bounded endpoint rather than downloading the vocabulary", async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (request) => { if (request.url().includes("/api/keyword-suggest")) requests.push(request.postData() ?? ""); });
      await page.goto(SEARCH_PATH);
      await field(page).pressSequentially("water", { delay: 10 });
      await expect(page.getByRole("option").first()).toBeVisible();
      expect(requests.length).toBeLessThanOrEqual(2);
      expect(requests.at(-1)).toContain("water");
    });

    test("the endpoint matches an alias without returning it, and refuses what it should", async ({ request, baseURL }) => {
      const headers = { origin: baseURL! };
      const answer = await request.post("/api/keyword-suggest", { headers, data: { q: "seash", lang: defaultLocale } });
      expect(answer.status()).toBe(200);
      expect(answer.headers()["cache-control"]).toBe("no-store");
      const body = await answer.json() as { suggestions: readonly { keywordId: string }[] };
      expect(body.suggestions.map((entry) => entry.keywordId)).toEqual(["coast"]);
      expect(JSON.stringify(body)).not.toMatch(/seashore|shoreline/i);
      expect((await request.post("/api/keyword-suggest", { headers: { origin: "https://elsewhere.example" }, data: { q: "seash", lang: defaultLocale } })).status()).toBe(403);
      expect((await request.post("/api/keyword-suggest", { headers, data: { q: "seash", lang: "xx" } })).status()).toBe(422);
      expect((await request.post("/api/keyword-suggest", { headers, data: { q: "seash" } })).status()).toBe(400);
      expect((await request.post("/api/keyword-suggest", { headers, data: { q: "x".repeat(2000), lang: defaultLocale } })).status()).toBe(413);
      expect((await request.get("/api/keyword-suggest")).status()).toBe(405);
    });

    test.describe("without JavaScript", () => {
      test.use({ javaScriptEnabled: false });
      test("it stays out of the page", async ({ page }) => {
        await page.goto(SEARCH_PATH);
        await expect(page.getByRole("combobox")).toHaveCount(0);
      });
    });
  });

  test("the language links keep the selection and drop the cursor", async ({ page }) => {
    await page.goto(gallery("archive"));
    await page.goto((await page.locator('a[rel="next"]').getAttribute("href"))!);
    const links = page.locator(`a[href^="/${PREFIXED_LOCALE.prefix}"][href*="keywords=archive"]`);
    await expect(links.first()).toBeAttached();
    for (const href of await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")))) {
      expect(href).not.toContain("cursor=");
    }
  });

  test("the continuation endpoint accepts only the grid's own canonical address", async ({ request }) => {
    const refused = [
      `/api/keyword-gallery?path=${encodeURIComponent(gallery("water,coast"))}&cursor=x`,
      `/api/keyword-gallery?path=${encodeURIComponent(gallery("archive"))}`,
      `/api/keyword-gallery?path=${encodeURIComponent("//example.com?keywords=archive")}&cursor=x`,
      `/api/keyword-gallery?path=${encodeURIComponent(`${gallery("archive")}&q=x`)}&cursor=x`,
      `/api/keyword-gallery?path=${encodeURIComponent(gallery("archive"))}&cursor=x&extra=1`,
    ];
    for (const url of refused) expect([400, 404], url).toContain((await request.get(url)).status());
  });
});
