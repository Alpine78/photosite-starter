import type { Page } from "@playwright/test";

import { getBuiltInLabels } from "../src/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { HARNESS_BASE_URL, PREFIXED_LOCALE, appUnderTestEnvironment } from "./support/harness-environment";
import { expectImageDelivered, headerMenuToggle } from "./support/public-page";

const locales = [
  { path: "/", locale: appUnderTestEnvironment.SITE_LOCALE },
  { path: `/${PREFIXED_LOCALE.prefix}`, locale: PREFIXED_LOCALE.prefix },
];

/** Apply persistent text enlargement before the document's first layout. */
async function rootSize(page: Page, path: string, size: number) {
  await page.route(`${HARNESS_BASE_URL}${path}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace("<head>", `<head><style>html{font-size:${size}px!important}</style>`),
    });
  });
}

async function settle(page: Page, size: number, hydrated = true) {
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${size}px`);
  if (hydrated) await expect(page.locator("html")).toHaveAttribute("data-language-menu", "");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // With scripts disabled Chromium does not dispatch rAF callbacks, even for
  // automation. Reading the rectangles flushes CSS layout in that case.
  if (hydrated) await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
}

async function fit(page: Page, width: number, root: number) {
  const header = page.getByRole("banner");
  const evidence = await header.evaluate((element) => {
    const bar = element.firstElementChild!;
    const brand = bar.firstElementChild!;
    const shown = (node: Element) => node.getBoundingClientRect().width > 0
      && node.getBoundingClientRect().height > 0;
    const groups = Array.from(bar.children).slice(1).filter(shown);
    const box = (node: Element) => {
      const b = node.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const controls = groups.map(box);
    const text: ReturnType<typeof box>[] = [];
    const walker = document.createTreeWalker(brand, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      text.push(...Array.from(range.getClientRects()).map(b => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom })));
    }
    return {
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      brand: box(brand), controls, text,
      contentRight: Math.max(...text.map(fragment => fragment.right),
        ...Array.from(brand.querySelectorAll("img")).filter(shown).map(node => node.getBoundingClientRect().right)),
      // Measure the actual bar children, including complete text fragments.
      // Parent boxes alone missed the old zero-width brand painting under nav.
      bounds: Array.from(bar.querySelectorAll("*")).filter(node => shown(node) && !node.closest(".sr-only"))
        .map(node => ({ tag: node.tagName, ...box(node) })),
    };
  });
  expect(evidence.width).toBe(width);
  expect(evidence.scrollWidth).toBeLessThanOrEqual(width);
  expect(evidence.controls).toHaveLength(1);
  if (width >= 390) {
    // Free bar space must not become a home-link target/focus ring. At these
    // widths the full intrinsic brand fits; a constrained broken word can
    // legitimately leave a small unused remainder on its own text line.
    expect(evidence.brand.right).toBeLessThanOrEqual(evidence.contentRight + 1);
  }
  for (const b of [...evidence.bounds, ...evidence.text]) {
    expect(b.left, JSON.stringify(b)).toBeGreaterThanOrEqual(-1);
    expect(b.right, JSON.stringify(b)).toBeLessThanOrEqual(width + 1);
  }
  for (const b of [evidence.brand, ...evidence.text]) {
    const c = evidence.controls[0];
    expect(b.right <= c.left + 1 || b.left >= c.right - 1 || b.bottom <= c.top + 1 || b.top >= c.bottom - 1,
      JSON.stringify({ brand: b, controls: c })).toBe(true);
  }
  expect(await headerMenuToggle(page).isVisible()).toBe(evidence.width < 64 * root);
  if (root === 16 && (width === 390 || width === 768)) {
    // The accepted default-scale layout still fits these single-row widths.
    expect(evidence.brand.top).toBeLessThan(evidence.controls[0].bottom);
    expect(evidence.brand.bottom).toBeGreaterThan(evidence.controls[0].top);
  }
  const mark = header.locator("img").filter({ visible: true });
  await expect(mark).toHaveCount(1);
  await expectImageDelivered(mark);
  const ratio = await mark.evaluate((node) => {
    const image = node as HTMLImageElement;
    const b = image.getBoundingClientRect();
    return { actual: b.width / b.height, native: image.naturalWidth / image.naturalHeight, height: b.height };
  });
  expect(ratio.actual).toBeCloseTo(ratio.native, 1);
  expect(ratio.height).toBeLessThanOrEqual(width < 640 ? 33.5 : 43.5);
}

for (const { path, locale } of locales) {
  for (const root of [16, 32]) {
    test(`complete ${locale} header fits its root-relative boundaries at ${root}px`, async ({ page }) => {
      await rootSize(page, path, root);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await settle(page, root);
      for (const width of [320, 390, 639, 640, 768, 1023, 1024, 1280, 2000, 2047, 2048, 2200]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page, root);
        await test.step(`${width}px`, () => fit(page, width, root));
      }
    });
  }

  test(`${locale} short-screen fallback follows a height-only resize`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await rootSize(page, path, 32);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await settle(page, 32);
    const header = page.getByRole("banner");
    await expect.poll(() => header.evaluate(node => getComputedStyle(node).position)).toBe("sticky");
    await page.setViewportSize({ width: 320, height: 320 });
    await expect.poll(() => header.evaluate(node => getComputedStyle(node).position)).toBe("relative");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--site-header-height"))).toBe("0px");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--site-header-offset"))).toBe("0px");
    await page.setViewportSize({ width: 320, height: 900 });
    await expect.poll(() => header.evaluate(node => getComputedStyle(node).position)).toBe("sticky");
    expect(await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--site-header-height")))).toBeGreaterThan(0);
  });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
    test(`${locale} enlarged compact menu remains reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await rootSize(page, path, 32);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await settle(page, 32);
      const header = page.getByRole("banner");
      const toggle = headerMenuToggle(page);
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const navigation = header.getByRole("navigation").filter({ visible: true });
      const submenu = navigation.getByRole("button").first();
      await submenu.focus();
      await page.keyboard.press("Enter");
      await expect(submenu).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(submenu).toHaveAttribute("aria-expanded", "false");
      await expect(submenu).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const last = page.locator("#mobile-nav").getByRole("link").last();
      await last.focus();
      await expect(last).toBeFocused();
      const bounds = await last.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(-1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox!.y).toBeGreaterThanOrEqual(-1);
      expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(viewport.height + 1);

      // Native showModal() must remain viewport-bound after size containment.
      const copy = getBuiltInLabels(locale).search;
      await header.getByRole("link", { name: copy.open }).filter({ visible: true }).click();
      const dialog = page.getByRole("dialog", { name: copy.title });
      await expect(dialog).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox!.x).toBeCloseTo(0, 0);
      expect(dialogBox!.y).toBeCloseTo(0, 0);
      expect(dialogBox!.width).toBeCloseTo(viewport.width, 0);
      expect(dialogBox!.height).toBeCloseTo(viewport.height, 0);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    });
  }
}

test.describe("header CSS without scripts", () => {
  test.use({ javaScriptEnabled: false });
  for (const { path, locale } of locales) {
    test(`${locale} enlarged header fits before enhancement and keeps its search link`, async ({ page }) => {
      await rootSize(page, path, 32);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await settle(page, 32, false);
      for (const width of [320, 390, 1280, 2048]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page, 32, false);
        await fit(page, width, 32);
      }
      const search = page.getByRole("banner").getByRole("link", { name: getBuiltInLabels(locale).search.open }).filter({ visible: true });
      const href = await search.getAttribute("href");
      await search.click();
      await expect(page).toHaveURL(`${HARNESS_BASE_URL}${href}`);
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});


test("the hydrated fallback language links also fit enlarged chrome", async ({ page }) => {
  const path = "/header-reflow-missing-fixture";
  await page.setViewportSize({ width: 1280, height: 900 });
  await rootSize(page, path, 32);
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response!.status()).toBe(404);
  await settle(page, 32);
  await fit(page, 1280, 32);
  const toggle = headerMenuToggle(page);
  await toggle.click();
  const languages = page.locator("#mobile-nav").locator('a[hreflang]');
  await expect(languages).toHaveCount(locales.length - 1);
  await expect(languages).toHaveAttribute("href", `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`);
});
