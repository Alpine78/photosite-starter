import type { Page } from "@playwright/test";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { targetResponseIssues } from "../scripts/legacy-redirect-verification.mts";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";

const targets = [
  { locale: appUnderTestEnvironment.SITE_LOCALE, root: "/", category: false },
  { locale: appUnderTestEnvironment.SITE_LOCALE, root: `/${DEFAULT_STORY_NAMESPACE}`, category: true },
  { locale: PREFIXED_LOCALE.prefix, root: `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`, category: true },
];

const canonicalHref = (path: string) => `${appUnderTestEnvironment.SITE_CANONICAL_BASE_URL}${path === "/" ? "" : path}`;

/** Discover a published category through the real route's accessible navigation. */
async function targetPath(page: Page, target: (typeof targets)[number]) {
  if (!target.category) return target.root;
  // The navigation and notice are server-rendered; image completion is unrelated.
  await page.goto(target.root, { waitUntil: "domcontentloaded" });
  const categories = page.getByRole("region", { name: getBuiltInLabels(target.locale).contentTree.categories, exact: true });
  const href = await categories.getByRole("link").first().getAttribute("href");
  expect(href).toBeTruthy();
  return href!;
}

async function assertNotice(page: Page, path: string, locale: string) {
  const response = await page.goto(`${path}?legacy-notice=content-unavailable`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText(getBuiltInLabels(locale).contentTree.legacyFallbackNotice);
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /\bnoindex\b/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonicalHref(path));
  await expect(page.locator('link[hreflang]')).toHaveCount(0);
  // Exercise the owner-run checker against real server HTML, including Next's
  // root-canonical serialization, rather than only synthetic markup.
  expect(targetResponseIssues(
    { kind: "redirect", target: path, reservedQueryParams: "strip", fallbackNotice: "content-unavailable" },
    { status: response!.status(), contentType: response!.headers()["content-type"], html: await response!.text() },
    appUnderTestEnvironment.SITE_CANONICAL_BASE_URL,
  )).toEqual([]);
}

for (const target of targets) {
  test(`a fixed localized legacy fallback notice is accessible and noindex at ${target.root}`, async ({ page }) => {
    await assertNotice(page, await targetPath(page, target), target.locale);
  });

  test(`invalid and repeated legacy notice values are ignored at ${target.root}`, async ({ page }) => {
    const path = await targetPath(page, target);
    for (const query of ["legacy-notice=untrusted-copy", "legacy-notice=content-unavailable&legacy-notice=content-unavailable", "legacy-notice=content-unavailable&legacy-notice=untrusted-copy"]) {
      const response = await page.goto(`${path}?${query}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonicalHref(path));
    }
  });
}

test.describe("legacy fallback without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("the server-rendered notice is available while photographs are pending", async ({ page, baseURL }) => {
    let releaseImages!: () => void;
    let imagePending = false;
    const imagesReleased = new Promise<void>((resolve) => { releaseImages = resolve; });
    await page.route((url) => url.origin === new URL(baseURL!).origin &&
      (url.pathname === "/_next/image" || url.pathname.endsWith(".webp")), async (route) => {
      imagePending = true;
      await imagesReleased;
      await route.continue();
    });
    try {
      await assertNotice(page, "/", appUnderTestEnvironment.SITE_LOCALE);
      await expect.poll(() => imagePending).toBe(true);
      // The complete load event is still held by images; SSR assertions need only the DOM.
      expect(await page.evaluate(() => document.readyState)).toBe("interactive");
    } finally {
      releaseImages();
      // Drain intercepted handlers; finishing image downloads is outside this SSR check.
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  test("home and both languages' category targets still explain the fallback", async ({ page }) => {
    for (const target of targets) await assertNotice(page, await targetPath(page, target), target.locale);
  });
});
