import { type Page } from "@playwright/test";
import { listContentHeadings } from "../src/lib/content-headings";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { openLightbox } from "./support/lightbox";

const locale = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const tree = buildContentTree(mockContentTreeInputs[locale]);
function pathOf(id: string) {
  const path = getCanonicalContentPath(tree, id);
  if (!path) throw new Error("[e2e] The reading fixture needs a canonical route.");
  return `/${DEFAULT_STORY_NAMESPACE}/${path.join("/")}`;
}
const article = pathOf("content-choosing-a-telephoto-lens");
const gallery = pathOf("content-polar-night-sessions");

async function wheelPastHeading(page: Page, level: number) {
  // Wait for the article’s progressive tab enhancement before positioning the fixture.
  // Its existing cold-fragment layout shift is tracked separately, not caused by this observer.
  if (new URL(page.url()).pathname === article) await expect(page.getByRole("tablist")).toBeVisible();
  const target = page.locator(`[data-content-body] h${level}`).first();
  await target.evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  const id = await target.getAttribute("id");
  await page.mouse.move(20, 200);
  // The real input unlocks tracking; the earlier programmatic placement alone cannot.
  await page.mouse.wheel(0, 24);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${id}`);
  return `#${id}`;
}

test("reading through H4 replaces only the fragment and preserves route, query, state, focus and history length", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop; mobile has native-link smoke coverage below.");
  const query = "?reading-check=a%20b&reading-check=c";
  await page.goto(article + query, { waitUntil: "load" });
  const link = page.getByRole("navigation", { name: labels.contentTree.onThisPage }).getByRole("link").first();
  await link.focus();
  const initial = await page.evaluate(() => {
    window.history.replaceState({ ...window.history.state, readingFixture: "preserved" }, "");
    return { length: window.history.length, search: window.location.search, pathname: window.location.pathname };
  });
  const fetches: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr", "document"].includes(request.resourceType()) &&
        new URL(request.url()).pathname === new URL(page.url()).pathname) fetches.push(request.url());
  });
  const hash = await wheelPastHeading(page, 4);
  await expect(link).toBeFocused();
  expect(await page.evaluate(() => ({ length: window.history.length, search: window.location.search, pathname: window.location.pathname }))).toEqual(initial);
  expect(await page.evaluate(() => window.history.state.readingFixture)).toBe("preserved");
  expect(fetches).toEqual([]);
  const position = await page.evaluate(() => window.scrollY);
  await page.clock.install();
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.scrollY)).toBe(position);
  await expect(page).toHaveURL(article + query + hash);
});

test("a prefixed-locale gallery keeps its path, raw query, state and focus while reading H4", async ({ page }) => {
  const language = PREFIXED_LOCALE.prefix;
  const contentId = "content-polar-night-sessions";
  const content = mockContentPages[language].get(contentId);
  const path = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), contentId);
  const heading = content && listContentHeadings(content.body).find((item) => item.level === 4);
  if (!path || !heading) throw new Error("[e2e] A prefixed-locale H4 gallery fixture is required.");
  const pathname = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}/${path.join("/")}`;
  const search = "?reading-check=a%20b&reading-check=c";
  await page.goto(pathname + search + "#gallery", { waitUntil: "load" });
  await expect(page.getByRole("tablist")).toBeVisible();
  const link = page.locator(`a[href='#${heading.id}']`);
  await link.focus();
  const initial = await page.evaluate(() => {
    window.history.replaceState({ ...window.history.state, readingFixture: "prefixed" }, "");
    return { pathname: location.pathname, search: location.search, length: history.length };
  });
  await page.locator(`#${heading.id}`).evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => new URL(page.url()).hash).toBe(`#${heading.id}`);
  expect(await page.evaluate(() => ({ pathname: location.pathname, search: location.search, length: history.length }))).toEqual(initial);
  expect(initial).toMatchObject({ pathname, search });
  expect(await page.evaluate(() => history.state.readingFixture)).toBe("prefixed");
  await expect(link).toBeFocused();
});

test("a direct H4 address remains authoritative until new reading input", async ({ page }) => {
  // This gallery’s authored H4 precedes any progressive tab block. Article tab
  // hydration can independently displace an initial fragment (separate follow-up).
  const fixture = mockContentPages[locale].get("content-polar-night-sessions");
  if (!fixture) throw new Error("[e2e] The gallery fixture must exist.");
  const heading = listContentHeadings(fixture.body).find((item) => item.level === 4);
  if (!heading) throw new Error("[e2e] The gallery must author an H4 target.");
  const hash = `#${heading.id}`;
  await page.goto(gallery + hash, { waitUntil: "load" });
  await expect(page.locator(hash)).toBeInViewport();
  await page.clock.install();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe(hash);
});

test("clicking the already current chapter cancels tracking during native anchor scrolling", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop.");
  await page.goto(article, { waitUntil: "load" });
  const hash = await wheelPastHeading(page, 4);
  await page.clock.install();
  await page.locator(`a[href='${hash}']`).click();
  // Programmatic movement after explicit navigation must not be treated as reading input.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe(hash);
});

test("returning to the introduction clears only this reader’s own fragment", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop.");
  await page.goto(article, { waitUntil: "load" });
  const hash = await wheelPastHeading(page, 4);
  const introduction = page.locator("[data-content-body]");
  await introduction.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.mouse.wheel(0, -24);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");

  // The same introduction geometry does not grant ownership of a supplied address.
  await page.goto(article + hash, { waitUntil: "load" });
  await expect(page.getByRole("tablist")).toBeVisible();
  await introduction.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.mouse.move(20, 200);
  await page.mouse.wheel(0, -24);
  await page.clock.install();
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe(hash);
});

test("Back and Forward restore native fragments without the observer replacing them", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop.");
  await page.goto(gallery, { waitUntil: "load" });
  const hash = await wheelPastHeading(page, 4);
  await page.getByRole("navigation", { name: labels.contentTree.onThisPage }).getByRole("link", { name: labels.gallery.jumpToImages }).click();
  await expect(page).toHaveURL(gallery + "#gallery");
  await page.goBack();
  await expect(page).toHaveURL(gallery + hash);
  await page.clock.install();
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe(hash);
  await page.goForward();
  await expect(page).toHaveURL(gallery + "#gallery");
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe("#gallery");
});

test("the gallery grid anchor is unchanged while the reader remains outside the editorial body", async ({ page }) => {
  await page.goto(gallery + "#gallery", { waitUntil: "load" });
  await page.clock.install();
  await page.keyboard.press("PageDown");
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe("#gallery");
});

test("a reading fragment composes with an App Router section change and native history", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop.");
  const path = pathOf("content-large-archive");
  await page.goto(path, { waitUntil: "load" });
  const hash = await wheelPastHeading(page, 2);
  const control = page.getByRole("navigation", { name: labels.gallery.sectionsNav }).locator("a[href*='?section=']").first();
  const destination = await control.getAttribute("href");
  expect(destination).toBeTruthy();
  await control.click();
  await expect(page).toHaveURL(destination!);
  await page.goBack();
  await expect(page).toHaveURL(path + hash);
  await expect(page.getByRole("navigation", { name: labels.gallery.sectionsNav }).getByRole("link", { name: labels.gallery.allSections })).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => window.history.state !== null)).toBe(true);
});

for (const key of ["End", " "]) {
  test(`a tab control's ${key === " " ? "Space" : key} key does not unlock reading tracking`, async ({ page }) => {
    await page.goto(article, { waitUntil: "load" });
    await expect(page.getByRole("tablist")).toBeVisible();
    await page.clock.install();
    await page.getByRole("tab").first().focus();
    await page.keyboard.press(key === " " ? "Space" : key);
    if (key === "End") await expect(page.getByRole("tab").last()).toBeFocused();
    // A control activation is not reading input. Later layout/programmatic
    // movement must remain locked, just like an initial direct-link scroll.
    await page.locator("[data-content-body] h4").first().evaluate((heading) => heading.scrollIntoView({ block: "start" }));
    await page.clock.runFor(50);
    await page.clock.fastForward(1500);
    expect(new URL(page.url()).hash).toBe("");
  });
}

test("reading with the keyboard updates an existing heading without adding history", async ({ page }) => {
  await page.goto(article, { waitUntil: "load" });
  await expect(page.getByRole("tablist")).toBeVisible();
  const heading = page.locator("[data-content-body] h4").first();
  await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const before = await page.evaluate(() => window.history.length);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${await heading.getAttribute("id")}`);
  expect(await page.evaluate(() => window.history.length)).toBe(before);
});

test("viewer input and close restoration do not become reading input", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop.");
  await page.goto(article, { waitUntil: "load" });
  await wheelPastHeading(page, 4);
  const trigger = page.locator("[data-content-body]").getByRole("button").filter({ has: page.getByRole("img") }).first();
  await openLightbox(page.getByRole("dialog"), () => trigger.click());
  const hash = await page.evaluate(() => window.location.hash);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.install();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.clock.fastForward(1500);
  expect(await page.evaluate(() => window.location.hash)).toBe(hash);
});

test("a denied History API leaves the narrative usable", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Real wheel input is covered on desktop.");
  await page.goto(article, { waitUntil: "load" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("tablist")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.deniedHistoryAttempts = "0";
    window.history.replaceState = () => {
      document.documentElement.dataset.deniedHistoryAttempts = String(
        Number(document.documentElement.dataset.deniedHistoryAttempts) + 1,
      );
      throw new DOMException("Denied", "SecurityError");
    };
  });
  await page.locator("[data-content-body] h4").first().evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  await page.mouse.move(20, 200);
  await page.mouse.wheel(0, 24);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.deniedHistoryAttempts)).toBe("1");
  await expect(page.locator("[data-content-body] h4").first()).toBeInViewport();
  expect(errors).toEqual([]);
  expect(new URL(page.url()).hash).toBe("");
});

test.describe("native links without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("a server-rendered H4 link still reaches its unchanged heading", async ({ page }) => {
    await page.goto(article, { waitUntil: "load" });
    const id = await page.locator("[data-content-body] h4").first().getAttribute("id");
    await page.locator(`a[href='#${id}']`).click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
    expect(new URL(page.url()).hash).toBe(`#${id}`);
  });
});
