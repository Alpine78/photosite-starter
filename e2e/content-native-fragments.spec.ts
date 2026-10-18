import type { Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { listContentHeadings } from "../src/lib/content-headings";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, HARNESS_BASE_URL, PREFIXED_LOCALE } from "./support/harness-environment";
import { test, expect } from "./support/fixtures";

const query = "?tag=a%2Fb&tag=two+words&unused=%23keep";
const locales = [new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language, PREFIXED_LOCALE.prefix];
function fixture(language: string, contentId: string) {
  const content = mockContentPages[language].get(contentId);
  const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), contentId);
  if (!content || !parts) throw new Error("[e2e] Native fragment fixture missing");
  const root = language === PREFIXED_LOCALE.prefix ? `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` : `/${DEFAULT_STORY_NAMESPACE}`;
  return { path: `${root}/${parts.join("/")}`, headings: listContentHeadings(content.body), labels: getBuiltInLabels(language) };
}
async function ready(page: Page, label: string) {
  // This button replaces an inert SSR placeholder after client hydration. The
  // old-Link negative baseline additionally proves clicks reach the live router.
  await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeAttached();
}
async function expectAddress(page: Page, path: string, id: string, visible = true) {
  await expect(page).toHaveURL(`${HARNESS_BASE_URL}${path}${query}#${id}`);
  expect(new URL(page.url()).hash).toBe(`#${id}`);
  await expect(page.locator(`[id='${id}']`)).toHaveCount(1);
  if (visible) await expect(page.locator(`[id='${id}']`)).toBeInViewport();
}

for (const language of locales) {
  const gallery = fixture(language, "content-polar-night-sessions");
  for (const level of [2, 3, 4] as const) {
    test(`${language}: cold H${level} TOC pointer and keyboard retain one fragment and raw query`, async ({ page }) => {
      const initial = gallery.headings.find(heading => heading.level === level)!;
      const target = gallery.headings.find(heading => heading.id !== initial.id)!;
      await page.goto(`${gallery.path}${query}#${initial.id}`, { waitUntil: "load" });
      await ready(page, gallery.labels.theme.darkTheme);
      const nav = page.getByRole("navigation", { name: gallery.labels.contentTree.onThisPage });
      const link = nav.locator(`a[href='#${target.id}']`);
      if (test.info().project.use.hasTouch) await link.tap();
      else await link.click();
      await expectAddress(page, gallery.path, target.id);
      const back = nav.locator(`a[href='#${initial.id}']`);
      await back.focus(); await expect(back).toBeFocused();
      await page.keyboard.press("Enter");
      await expectAddress(page, gallery.path, initial.id);
    });
  }

  test(`${language}: native history, same fragment and gallery leading anchor preserve the current address`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const initial = gallery.headings.find(heading => heading.level === 4)!;
    const next = gallery.headings.find(heading => heading.level === 2)!;
    await page.goto(`${gallery.path}${query}#${initial.id}`, { waitUntil: "load" });
    await ready(page, gallery.labels.theme.darkTheme);
    await page.evaluate(() => history.replaceState({ ...history.state, fragmentTestMarker: "initial-entry" }, ""));
    const nav = page.getByRole("navigation", { name: gallery.labels.contentTree.onThisPage });
    const link = nav.locator(`a[href='#${next.id}']`);
    const initialLength = await page.evaluate(() => history.length);
    await link.click(); await expectAddress(page, gallery.path, next.id);
    const length = await page.evaluate(() => history.length);
    expect(length).toBe(initialLength + 1);
    expect(await page.evaluate(() => history.state?.fragmentTestMarker)).toBe("initial-entry");
    await link.click(); await expectAddress(page, gallery.path, next.id);
    expect(await page.evaluate(() => history.length)).toBe(length);
    // Native WebKit Back can restore the pre-click TOC scroll position instead
    // of scrolling to the old hash. An offline HTTP control reproduces this;
    // preserve browser history, while still requiring its exact URL and state.
    await page.goBack(); await expectAddress(page, gallery.path, initial.id, false);
    expect(await page.evaluate(() => history.state?.fragmentTestMarker)).toBe("initial-entry");
    await page.goForward(); await expectAddress(page, gallery.path, next.id, false);
    await nav.locator("a[href='#gallery']").click();
    await expectAddress(page, gallery.path, "gallery");
  });

  test(`${language}: real route navigation and Back restore the newly selected fragment`, async ({ page }) => {
    const initial = gallery.headings.find(heading => heading.level === 4)!;
    const next = gallery.headings.find(heading => heading.level === 2)!;
    await page.goto(`${gallery.path}${query}#${initial.id}`, { waitUntil: "load" });
    await ready(page, gallery.labels.theme.darkTheme);
    await page.getByRole("navigation", { name: gallery.labels.contentTree.onThisPage }).locator(`a[href='#${next.id}']`).click();
    await expectAddress(page, gallery.path, next.id);
    // The site header hides after the fragment scroll. Reveal it with native
    // reading input before leaving: actionability scrolling a hidden brand
    // link into view can otherwise change the departure position to page top.
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => page.getByRole("banner").evaluate(header =>
      !header.classList.contains("-translate-y-full") &&
      header.getBoundingClientRect().top >= -0.5,
    )).toBe(true);
    await expectAddress(page, gallery.path, next.id);
    await page.locator("header a").first().click();
    await expect(page.locator(`[id='${next.id}']`)).toHaveCount(0);
    await expect(page).not.toHaveURL(`${HARNESS_BASE_URL}${gallery.path}${query}#${next.id}`);
    await page.goBack(); await expectAddress(page, gallery.path, next.id);
  });

  test(`${language}: unavailable History API leaves ordinary anchor navigation usable`, async ({ page }) => {
    const initial = gallery.headings.find(heading => heading.level === 4)!;
    const next = gallery.headings.find(heading => heading.level === 2)!;
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${gallery.path}${query}#${initial.id}`, { waitUntil: "load" });
    await ready(page, gallery.labels.theme.darkTheme);
    await page.evaluate(() => { history.pushState = () => { throw new Error("Synthetic History API denial"); }; });
    await page.getByRole("navigation", { name: gallery.labels.contentTree.onThisPage }).locator(`a[href='#${next.id}']`).click();
    await expectAddress(page, gallery.path, next.id);
    expect(errors).toEqual([]);
  });

  test(`${language}: article links share the native same-document contract`, async ({ page }) => {
    const article = fixture(language, "content-shooting-in-low-light");
    const [initial, next] = article.headings;
    await page.goto(`${article.path}${query}#${initial.id}`, { waitUntil: "load" });
    await ready(page, article.labels.theme.darkTheme);
    const link = page.getByRole("navigation", { name: article.labels.contentTree.onThisPage }).locator(`a[href='#${next.id}']`);
    await link.focus(); await page.keyboard.press("Enter");
    await expectAddress(page, article.path, next.id);
  });
}

test.describe("native fragments without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const language of locales) {
    test(`${language}: server-rendered nested links and leading link work from a cold fragment`, async ({ page }) => {
      const gallery = fixture(language, "content-polar-night-sessions");
      const initial = gallery.headings.find(heading => heading.level === 4)!;
      const next = gallery.headings.find(heading => heading.level === 3)!;
      await page.goto(`${gallery.path}${query}#${initial.id}`, { waitUntil: "load" });
      const nav = page.getByRole("navigation", { name: gallery.labels.contentTree.onThisPage });
      await nav.locator(`a[href='#${next.id}']`).click(); await expectAddress(page, gallery.path, next.id);
      await nav.locator("a[href='#gallery']").click(); await expectAddress(page, gallery.path, "gallery");
    });
  }
});
