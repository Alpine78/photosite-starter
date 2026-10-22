import type { Locator, Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";

const locale = appUnderTestEnvironment.SITE_LOCALE;
const language = new Intl.Locale(locale).language;
const labels = getBuiltInLabels(locale);
const codec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);

async function sectionedGallery(selectedLanguage = language, root = `/${DEFAULT_STORY_NAMESPACE}`) {
  const tree = buildContentTree(mockContentTreeInputs[selectedLanguage]);
  for (const [contentId, page] of mockContentPages[selectedLanguage]) {
    if (page.variant !== "gallery" || page.body.length === 0) continue;
    const path = getCanonicalContentPath(tree, contentId);
    const result = await getMockGalleryResult(selectedLanguage, contentId, { cursorCodec: codec });
    if (!path || !result || result.sections.length < 2) continue;
    for (const section of result.sections) {
      const selected = await getMockGalleryResult(selectedLanguage, contentId, { cursorCodec: codec, sectionSlug: section.slug });
      if (selected?.page.hasNextPage && selected.photoCount !== undefined) {
        return { path: `${root}/${path.join("/")}`, section, photoCount: selected.photoCount };
      }
    }
  }
  throw new Error("[e2e] Pointer activation needs a sectioned gallery with a body and a long section.");
}

async function released(nav: Locator) {
  await expect.poll(() => nav.evaluate((node) =>
    [node.style.translate, node.style.top, node.style.transitionProperty],
  )).toEqual(["", "", ""]);
}

async function settled(nav: Locator) {
  await expect.poll(() => nav.evaluate((node) =>
    node.getAnimations().filter((animation) => animation.playState === "running").length,
  )).toBe(0);
}

test("the original automatic-scroll pointer path activates without preparing focus", async ({ page }) => {
  const gallery = await sectionedGallery();
  await page.goto(gallery.path);
  const nav = page.getByRole("navigation", { name: labels.gallery.sectionsNav, exact: true });
  const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
  // The locator's native scroll happens after its stable check, as in CI1175.
  await target.click({ delay: 400 });
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(new URL((await target.getAttribute("href"))!, page.url()).href);
  await released(nav);
});

test("dragging away cancels the link and the next press still works", async ({ page }) => {
  const gallery = await sectionedGallery();
  await page.goto(gallery.path);
  const nav = page.getByRole("navigation", { name: labels.gallery.sectionsNav, exact: true });
  const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
  const { point } = await hiddenInBody(page, nav, target);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect.poll(() => nav.evaluate((node) => node.style.translate)).not.toBe("");
  await page.mouse.move(point.x, 1, { steps: 8 });
  await page.mouse.up();
  await released(nav);
  expect(new URL(page.url()).searchParams.has("section")).toBe(false);
  await target.click();
  await expect(target).toHaveAttribute("aria-current", "true");
});

test("losing window focus clears a pending press without leaving the filter stuck", async ({ page }) => {
  const gallery = await sectionedGallery();
  await page.goto(gallery.path);
  const nav = page.getByRole("navigation", { name: labels.gallery.sectionsNav, exact: true });
  const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
  const { point } = await hiddenInBody(page, nav, target);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect.poll(() => nav.evaluate((node) => node.style.translate)).not.toBe("");
  // Headless browsers cannot transfer OS-window focus. This lifecycle signal
  // tests cleanup only; activation and touch cancellation use native input.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await released(nav);
  await page.mouse.move(point.x, 1);
  await page.mouse.up();
  expect(new URL(page.url()).searchParams.has("section")).toBe(false);
  await target.press("Enter");
  await expect(target).toHaveAttribute("aria-current", "true");
});

test("a modified native click keeps its new-tab destination", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Desktop new-tab modifier semantics; mobile activation has native tap coverage.");
  const gallery = await sectionedGallery();
  await page.goto(gallery.path);
  const nav = page.getByRole("navigation", { name: labels.gallery.sectionsNav, exact: true });
  const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
  const { point } = await hiddenInBody(page, nav, target);
  const expected = new URL((await target.getAttribute("href"))!, page.url()).href;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.mouse.click(point.x, point.y, { delay: 400 }),
  ]);
  await page.keyboard.up(modifier);
  await expect(popup).toHaveURL(expected);
  expect(new URL(page.url()).searchParams.has("section")).toBe(false);
  await released(nav);
  await popup.close();
});

test("Finnish section links keep their native touch or pointer activation", async ({ page, isMobile }) => {
  const gallery = await sectionedGallery(PREFIXED_LOCALE.prefix,
    `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`);
  const translated = getBuiltInLabels(PREFIXED_LOCALE.prefix);
  await page.goto(gallery.path);
  const nav = page.getByRole("navigation", { name: translated.gallery.sectionsNav, exact: true });
  const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
  await hiddenInBody(page, nav, target);
  if (isMobile) await target.tap();
  else await target.click({ delay: 400 });
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(page.getByText(`${new Intl.NumberFormat(PREFIXED_LOCALE.prefix).format(gallery.photoCount)} ${translated.gallery.photoPlural}`, { exact: true })).toBeVisible();
  await released(nav);
});

test.describe("native touch panning", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  test("a pan cancels activation and leaves the next touch usable", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Native drag uses Chromium CDP; WebKit is covered by native tap.");
    const gallery = await sectionedGallery();
    await page.goto(gallery.path);
    const nav = page.getByRole("navigation", { name: labels.gallery.sectionsNav, exact: true });
    const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
    const { point } = await hiddenInBody(page, nav, target);
    const startY = await page.evaluate(() => scrollY);
    const session = await context.newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
      for (let step = 1; step <= 8; step += 1) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y - step * 20, id: 1 }] });
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await session.detach();
    }
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(startY + 20);
    await released(nav);
    expect(new URL(page.url()).searchParams.has("section")).toBe(false);
    await target.tap();
    await expect(target).toHaveAttribute("aria-current", "true");
    await released(nav);
  });
});

/** Keep the row in normal flow: its translated, hidden pose is still visible. */
async function hiddenInBody(page: Page, nav: Locator, target: Locator) {
  // The reveal hook takes the scroll position at mount as its baseline and
  // hides the row only on a later downward scroll. A scroll before hydration is
  // never seen (AB#377, CI run 1442: the row stayed shown), so repeat the
  // downward scroll from the top until the application answers.
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await target.scrollIntoViewIfNeeded();
    await expect(nav).toHaveClass(/-translate-y-full/, { timeout: 2_000 });
  }).toPass();
  await settled(nav);
  await page.evaluate(() => window.scrollBy(0, -2));
  await expect(nav).not.toHaveClass(/-translate-y-full/);
  await settled(nav);
  const top = await nav.evaluate((node) => node.getBoundingClientRect().top);
  const initialY = await page.evaluate(() => scrollY);
  await page.evaluate(() => window.scrollBy(0, 1));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(initialY + 1);
  await expect(nav).toHaveClass(/-translate-y-full/);
  await settled(nav);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThan(0);
  expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height);
  return { point: { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, shownTop: top - 1 };
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`section pointer activation (${reducedMotion})`, () => {
    test.use({ reducedMotion });

    test("a native held press keeps its link target and the committed filter position", async ({ page }) => {
      const gallery = await sectionedGallery();
      await page.goto(gallery.path);
      const nav = page.getByRole("navigation", { name: labels.gallery.sectionsNav, exact: true });
      const target = nav.getByRole("link", { name: gallery.section.label, exact: true });
      const { point, shownTop } = await hiddenInBody(page, nav, target);
      const href = await target.getAttribute("href");
      expect(href).not.toBeNull();
      await nav.evaluate((node) => {
        const identify = (event: Event) => event.target instanceof Element
          ? event.target.closest("a")?.getAttribute("href") ?? "not-a-link"
          : "not-an-element";
        node.addEventListener("pointerdown", (event) => {
          node.setAttribute("data-observed-pointer-down", identify(event));
        }, { once: true });
        document.addEventListener("pointerup", (event) => {
          node.setAttribute("data-observed-pointer-up", identify(event));
        }, { once: true, capture: true });
      });

      // A real held press spans the existing 200ms transition. No focus, forced
      // click, synthetic activation, motion override or retry prepares this press.
      await page.mouse.click(point.x, point.y, { delay: 400 });
      await expect(nav).toHaveAttribute("data-observed-pointer-down", href!);
      await expect(nav).toHaveAttribute("data-observed-pointer-up", href!);
      await expect(page).toHaveURL(new URL(href!, page.url()).href);
      await expect(target).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("heading", { level: 2, name: gallery.section.label, exact: true })).toBeVisible();
      await expect(page.getByText(`${new Intl.NumberFormat(locale).format(gallery.photoCount)} ${labels.gallery.photoPlural}`, { exact: true })).toBeVisible();
      await settled(nav);
      await expect.poll(async () => Math.abs(await nav.evaluate((node) => node.getBoundingClientRect().top) - shownTop)).toBeLessThanOrEqual(2);
      expect(await nav.evaluate((node) => node.style.translate)).toBe("");
      expect(await nav.evaluate((node) => node.style.top)).toBe("");
      expect(await nav.evaluate((node) => node.style.transitionProperty)).toBe("");
    });
  });
}
