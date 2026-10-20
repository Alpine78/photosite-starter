import type { Locator, Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE,
} from "./support/harness-environment";
import { headerMenuToggle, openHeaderNavigation } from "./support/public-page";

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const cursorCodec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);

async function routes() {
  const tree = buildContentTree(mockContentTreeInputs[language]);
  for (const [id, content] of mockContentPages[language]) {
    if (content.variant !== "gallery") continue;
    const gallery = await getMockGalleryResult(language, id, { cursorCodec });
    const path = getCanonicalContentPath(tree, id);
    if (!path || !gallery || gallery.sections.length === 0 || gallery.items.length < 24) continue;
    const prefixedTree = buildContentTree(mockContentTreeInputs[PREFIXED_LOCALE.prefix]);
    const prefixedPath = getCanonicalContentPath(prefixedTree, id);
    if (!prefixedPath) continue;
    return [
      `/${DEFAULT_STORY_NAMESPACE}/${path.join("/")}`,
      `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}/${prefixedPath.join("/")}`,
    ];
  }
  throw new Error("[e2e] Header scroll needs a long sectioned gallery in both locales.");
}

async function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height };
  });
}

async function shown(page: Page) {
  await expect.poll(async () => Math.abs((await bounds(page.getByRole("banner"))).top)).toBeLessThan(1);
}

async function hidden(page: Page) {
  await expect.poll(async () => (await bounds(page.getByRole("banner"))).bottom).toBeLessThanOrEqual(1);
}

async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect.poll(() => page.getByRole("banner").evaluate((element) =>
    getComputedStyle(element).position,
  )).toBe("sticky");
  await expect.poll(() => page.evaluate(() =>
    parseFloat(document.documentElement.style.getPropertyValue("--site-header-height")),
  )).toBeGreaterThan(0);
}

async function down(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 1200);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await hidden(page);
}

async function up(page: Page) {
  await page.evaluate(() => window.scrollBy(0, -2));
  await shown(page);
}

test("a first small upward scroll at the page end reveals the menu in both locales without reflow", async ({ page }) => {
  for (const path of await routes()) {
    await ready(page, path);
    await shown(page);
    const mainTop = () => page.getByRole("main").evaluate((element) =>
      element.getBoundingClientRect().top + window.scrollY,
    );
    const originalTop = await mainTop();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await hidden(page);
    const bottomY = await page.evaluate(() => window.scrollY);
    expect(bottomY).toBeGreaterThan(500);
    await up(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(bottomY - 4);
    expect(await mainTop()).toBeCloseTo(originalTop, 0);
    await expect(await openHeaderNavigation(page)).toBeVisible();
  }
});

test("keyboard focus reveals and pins the header, and Tab reaches its controls", async ({ page }) => {
  await ready(page, (await routes())[0]);
  await down(page);
  await page.keyboard.press("Tab");
  await shown(page);
  expect(await page.getByRole("banner").evaluate((element) => element.contains(document.activeElement))).toBe(true);

  // preventScroll isolates the focus reveal from a browser scrolling to a link.
  const link = page.getByRole("banner").getByRole("link").first();
  await link.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.evaluate(() => window.scrollBy(0, 300));
  await expect(link).toBeFocused();
  await shown(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  await shown(page);
});

test("an open disclosure stays visible with body focus and Escape closes it", async ({ page }) => {
  await ready(page, (await routes())[0]);
  await down(page);
  await up(page);
  const compact = headerMenuToggle(page);
  const toggle = await compact.isVisible()
    ? compact
    : page.getByRole("banner").getByRole("navigation").getByRole("button").first();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollBy(0, 300);
  });
  await shown(page);
  await expect(panel).toBeVisible();
  const main = page.getByRole("main");
  const beforeEscape = (await bounds(main)).top;
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  // Returning focus to the sticky toggle must not move the page (AB#377): the
  // jump also reversed the next scroll's direction and flaked this test. The
  // content's viewport position, not scrollY, is the invariant: an in-flow
  // compact panel shrinks the document as it closes.
  expect(Math.abs((await bounds(main)).top - beforeEscape)).toBeLessThan(1);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollBy(0, 100);
  });
  await hidden(page);
});

test("a pointer-used header link does not pin the next page, and navigation clears the gallery offset", async ({ page }) => {
  await ready(page, (await routes())[0]);
  await down(page);
  await up(page);
  await page.getByRole("banner").locator('a[href="/"]').first().click();
  await page.waitForURL("/");
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--gallery-section-height"),
  )).toBe("");
  // URL updates precede App Router scroll restoration. Let that native scroll
  // finish before producing the next downward event, just as a visitor does.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  // Do not blur here: this specifically catches a pointer-focused link
  // accidentally pinning the persistent header after client navigation.
  await page.evaluate(() => window.scrollTo(0, 600));
  await hidden(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shown(page);
});

test("upward article anchor jumps leave the destination below the revealed header", async ({ page }) => {
  const tree = buildContentTree(mockContentTreeInputs[language]);
  const [id] = [...mockContentPages[language]].filter(([, content]) =>
    content.variant === "article" && content.body.some((block) => block.type === "heading"),
  ).sort(([, a], [, b]) => b.body.length - a.body.length)[0];
  const path = getCanonicalContentPath(tree, id);
  expect(path).not.toBeNull();
  await ready(page, `/${DEFAULT_STORY_NAMESPACE}/${path!.join("/")}`);
  const href = await page.getByRole("main").locator('a[href^="#"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await hidden(page);
  await page.evaluate((hash) => { location.hash = hash!; }, href);
  await shown(page);
  const heading = page.locator(`[id="${href!.slice(1)}"]`);
  await expect.poll(async () => (await bounds(heading)).top - (await bounds(page.getByRole("banner"))).bottom).toBeGreaterThanOrEqual(-1);
});

test("gallery controls and header stack, remain clickable and have independent focus pins", async ({ page }) => {
  await ready(page, (await routes())[0]);
  const sections = page.getByRole("navigation", { name: labels.gallery.sectionsNav });
  await down(page);
  await up(page);
  await expect.poll(async () => (await bounds(sections)).top - (await bounds(page.getByRole("banner"))).bottom).toBeCloseTo(0, 0);
  const option = sections.getByRole("link").nth(1);
  const target = await option.getAttribute("href");
  await option.click();
  await page.waitForURL(target!);

  // The existing gallery contract retains any focus; the header retains
  // keyboard focus only. A section can stay visible while the header hides.
  await sections.getByRole("link").first().evaluate((element) =>
    (element as HTMLElement).focus({ preventScroll: true }),
  );
  // A section commit or native focus can leave the document well past 1200px.
  // Start inside the current document, then prove a real downward scroll;
  // scrolling upward correctly reveals the header and cannot test this pin.
  const startY = await page.evaluate(() => {
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const start = Math.floor(maximum / 2);
    window.scrollTo(0, start);
    return start;
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(startY);
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  const before = await page.evaluate(() => ({
    y: window.scrollY,
    maximum: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(before.maximum - before.y).toBeGreaterThan(100);
  await page.evaluate((target) => window.scrollTo(0, target), Math.min(before.y + 400, before.maximum));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before.y);
  await hidden(page);
  await expect.poll(async () => Math.abs((await bounds(sections)).top)).toBeLessThan(1);
  await page.keyboard.press("Tab");
  await page.getByRole("banner").getByRole("link").first().evaluate((element) =>
    (element as HTMLElement).focus({ preventScroll: true }),
  );
  await shown(page);
  await page.evaluate(() => window.scrollBy(0, 100));
  await shown(page);
  await expect.poll(async () => (await bounds(sections)).bottom - (await bounds(page.getByRole("banner"))).bottom).toBeLessThanOrEqual(1);
});

test("reduced motion retains reveal behavior and returning to the top restores the header", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page, (await routes())[0]);
  await down(page);
  await up(page);
  expect(await page.getByRole("banner").evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("none");
  await page.evaluate(() => window.scrollBy(0, 100));
  await hidden(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shown(page);
});

test("resizing updates the real header height and its gallery offset", async ({ page }) => {
  await ready(page, (await routes())[0]);
  await down(page);
  await up(page);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollBy(0, -2));
    await shown(page);
    await expect.poll(async () => page.getByRole("banner").evaluate((element) =>
      parseFloat(document.documentElement.style.getPropertyValue("--site-header-offset")) - element.getBoundingClientRect().height,
    )).toBeCloseTo(0, 0);
  }
});

test("an open menu fits a short viewport and its last link remains reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 200 });
  await ready(page, (await routes())[0]);
  await down(page);
  await up(page);
  await openHeaderNavigation(page);
  const panel = page.locator("#mobile-nav");
  await expect.poll(async () => (await bounds(panel)).bottom).toBeLessThanOrEqual(200);
  const last = panel.getByRole("link").last();
  await last.focus();
  await expect(last).toBeFocused();
  const linkBox = await bounds(last);
  expect(linkBox.top).toBeGreaterThanOrEqual(0);
  expect(linkBox.bottom).toBeLessThanOrEqual(200);

  await page.setViewportSize({ width: 1440, height: 200 });
  const toggle = page.getByRole("banner").getByRole("navigation").getByRole("button").first();
  await toggle.click();
  const submenu = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
  await expect.poll(async () => (await bounds(submenu)).bottom).toBeLessThanOrEqual(200);
  const lastChild = submenu.getByRole("link").last();
  await lastChild.focus();
  await expect(lastChild).toBeFocused();
  expect((await bounds(lastChild)).bottom).toBeLessThanOrEqual(200);
});

test("service pricing stays below a revealed header in both locale layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  for (const root of ["/services", `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.serviceNamespace}`]) {
    await ready(page, root);
    const card = page.getByRole("main").getByRole("link")
      .filter({ has: page.locator("img") }).first();
    const href = await card.getAttribute("href");
    expect(href).toBeTruthy();
    await ready(page, href!);
    const aside = page.getByRole("complementary");
    await expect(aside.getByRole("heading")).toHaveCount(1);
    const originalTop = (await bounds(aside)).top;
    await page.evaluate((y) => window.scrollTo(0, y), originalTop + 100);
    await hidden(page);
    await expect.poll(async () => (await bounds(aside)).top).toBeCloseTo(32, 0);
    await up(page);
    await expect.poll(async () =>
      (await bounds(aside)).top - (await bounds(page.getByRole("banner"))).bottom,
    ).toBeGreaterThanOrEqual(31);
    await page.evaluate(() => window.scrollBy(0, 50));
    await hidden(page);
    await expect.poll(async () => (await bounds(aside)).top).toBeCloseTo(32, 0);
  }
});

test("theme and language controls still work in a revealed header", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await ready(page, (await routes())[0]);
  await down(page);
  await up(page);
  const theme = page.getByRole("banner").getByRole("button", { name: labels.theme.darkTheme });
  await theme.click();
  await expect(theme).toHaveAttribute("aria-pressed", "true");
  await openHeaderNavigation(page);
  const translation = page.getByRole("banner").locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]`).filter({ visible: true });
  const href = await translation.getAttribute("href");
  await translation.click();
  await page.waitForURL(href!);
  await shown(page);
  await expect(page.locator("html")).toHaveAttribute("lang", PREFIXED_LOCALE.prefix);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("the original header remains in flow with its server-rendered links", async ({ page }) => {
    await page.goto((await routes())[0]);
    const header = page.getByRole("banner");
    await expect(header).toBeVisible();
    expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("relative");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--site-header-offset"))).toBe("");
    await expect(header.locator('a[href="/services"]').first()).toHaveCount(1);
    // A desktop visitor can follow an SSR navigation link; the compact menu
    // retains its pre-existing script requirement, while the brand link works.
    const link = await headerMenuToggle(page).isVisible()
      ? header.getByRole("link").first()
      : header.getByRole("navigation").locator('a[href="/services"]');
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForURL(href!);
  });
});
