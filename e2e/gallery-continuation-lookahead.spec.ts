import type { Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * AB#386: automatic continuation requests the next page when the sentinel after
 * the list is within one viewport below the visible area, or two once the
 * document has scrolled. Each case sets the viewport height from the sentinel's
 * measured position, so the band it lands in does not depend on the fixture's
 * exact layout, and proves "no request" after an explicit check (a resize event)
 * and two animation frames rather than after a wait.
 */
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]!), "content-endless-archive");
if (parts === null) throw new Error("[e2e] content-endless-archive needs a canonical path.");
const endless = `/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`;
const WIDTH = 1280;
// The acceptance criteria's distances, as viewport heights from the top of the
// visible area: one viewport below it at rest, two after scrolling. Literal on
// purpose, so the test pins the behaviour rather than following the constants.
const AT_REST = 2;
const AFTER_SCROLL = 3;

test.skip(({ isMobile }) => isMobile, "Viewport height is set directly; the desktop projects cover the threshold logic.");

/** Counts continuation requests and holds each one until released, so nothing appends mid-assertion. */
async function holdContinuations(page: Page) {
  let requests = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/gallery**", async (route) => {
    requests += 1;
    await held;
    await route.fallback();
  });
  return { count: () => requests, release: () => release() };
}

/**
 * The sentinel's distance from the top of the document, measured in a separate
 * tab that is closed before the case starts, so its own continuation request can
 * never be counted by the case's route.
 */
async function sentinelTop(page: Page, height: number): Promise<number> {
  const probe = await page.context().newPage();
  await probe.setViewportSize({ width: WIDTH, height });
  await probe.route("**/api/gallery**", (route) => route.abort());
  await probe.goto(endless, { waitUntil: "load" });
  const sentinel = probe.locator("[data-gallery-continuation-sentinel]");
  await expect(sentinel).toBeAttached();
  const top = await sentinel.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await probe.close();
  return top;
}

/** Opens the gallery at a viewport height that puts the sentinel `ratio` viewports from the top. */
async function openWithSentinelAt(page: Page, ratio: number) {
  const top = await sentinelTop(page, 600);
  const height = Math.round(top / ratio);
  await page.setViewportSize({ width: WIDTH, height });
  const continuations = await holdContinuations(page);
  await page.goto(endless, { waitUntil: "load" });
  // Hydrated: the sentinel exists only once automatic continuation is active.
  await expect(page.locator("[data-gallery-continuation-sentinel]")).toBeAttached();
  const measured = await page.locator("[data-gallery-continuation-sentinel]").evaluate(
    (element, viewport) => element.getBoundingClientRect().top / viewport, height);
  expect(measured, "the sentinel landed where the case needs it").toBeCloseTo(ratio, 1);
  return { height, continuations };
}

/** Makes the grid run its check now, then lets that frame and the next pass. */
async function settledCheck(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test("without scrolling, a sentinel within one viewport below is requested", async ({ page }) => {
  const { continuations } = await openWithSentinelAt(page, AT_REST - 0.5);
  await expect.poll(continuations.count).toBe(1);
  continuations.release();
});

test("without scrolling, a sentinel two viewports below is not requested yet", async ({ page }) => {
  const { continuations } = await openWithSentinelAt(page, (AT_REST + AFTER_SCROLL) / 2);
  await settledCheck(page);
  expect(continuations.count()).toBe(0);
  continuations.release();
});

test("after a scroll, the same distance requests the next page once", async ({ page }) => {
  const { height, continuations } = await openWithSentinelAt(page, (AT_REST + AFTER_SCROLL) / 2 + 0.2);
  await settledCheck(page);
  expect(continuations.count()).toBe(0);
  // A small scroll that leaves the sentinel beyond the at-rest distance.
  await page.evaluate((distance) => window.scrollBy(0, distance), Math.round(height * 0.2));
  const after = await page.locator("[data-gallery-continuation-sentinel]").evaluate(
    (element, viewport) => element.getBoundingClientRect().top / viewport, height);
  expect(after).toBeGreaterThan(AT_REST);
  expect(after).toBeLessThan(AFTER_SCROLL);
  await expect.poll(continuations.count).toBe(1);
  // Single flight: more checks while the request is held add nothing.
  await settledCheck(page);
  await page.evaluate(() => window.scrollBy(0, 10));
  await settledCheck(page);
  expect(continuations.count()).toBe(1);
  continuations.release();
});

test("after a scroll, a sentinel beyond two viewports below is not requested", async ({ page }) => {
  const { height, continuations } = await openWithSentinelAt(page, AFTER_SCROLL + 1);
  await page.evaluate((distance) => window.scrollBy(0, distance), Math.round(height * 0.2));
  await settledCheck(page);
  expect(continuations.count()).toBe(0);
  continuations.release();
});
