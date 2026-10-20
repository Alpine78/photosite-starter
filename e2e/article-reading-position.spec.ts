import type { Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./support/fixtures";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { listContentHeadings } from "../src/lib/content-headings";
import { canOverlayComparison } from "../src/lib/content-image-comparison";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { READING_POSITIONS_KEY, READING_DISABLED_KEY, READING_RETENTION_MS } from "../src/lib/reading-position-store";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";

const locale = appUnderTestEnvironment.SITE_LOCALE;
const language = new Intl.Locale(locale).language;
const contentId = "content-choosing-a-telephoto-lens";
function fixture(lang: string, routeLocale: string = locale, identity: string = contentId) {
  const content = mockContentPages[lang].get(identity);
  const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[lang]), identity);
  if (!content || !parts) throw new Error("[e2e] Published reading fixture missing in the requested locale");
  const prefix = lang === PREFIXED_LOCALE.prefix ? `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` : `/${DEFAULT_STORY_NAMESPACE}`;
  return { path: `${prefix}/${parts.join("/")}`, locale: routeLocale,
    headings: listContentHeadings(content.body), labels: getBuiltInLabels(routeLocale).readingPosition };
}
const article = fixture(language);
const savedHeading = article.headings.find((heading) => heading.level === 4)!;
const explicitHeading = article.headings.find((heading) => heading.id !== savedHeading.id)!;

async function ready(page: Page, labels = article.labels) {
  await expect(page.getByRole("checkbox", { name: labels.remember, includeHidden: true })).toBeAttached();
}
async function seed(page: Page, headingId = savedHeading.id, savedAt = Date.now()) {
  await page.goto("/");
  await page.evaluate(({ key, entry }) => localStorage.setItem(key, JSON.stringify([entry])), {
    key: READING_POSITIONS_KEY, entry: { contentId, locale, headingId, savedAt },
  });
}
async function positions(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), READING_POSITIONS_KEY);
}
async function aligned(page: Page, id: string) {
  await expect.poll(() => page.locator(`[id='${id}']`).evaluate((heading) => {
    const padding = getComputedStyle(document.documentElement).scrollPaddingTop;
    const offset = (padding === "auto" ? 0 : Number.parseFloat(padding)) + Number.parseFloat(getComputedStyle(heading).scrollMarginTop);
    return Math.abs(heading.getBoundingClientRect().top - offset);
  })).toBeLessThan(4);
}
// AB#372: the controls sit in the contents list footer. Below the two-column
// width that list is behind the sticky bar, which opens it as a modal sheet.
async function settings(page: Page, labels = article.labels) {
  await ready(page, labels);
  const bar = page.locator("[aria-haspopup='dialog'][aria-controls]");
  if (await bar.isVisible()) {
    await bar.click();
    await expect(page.getByRole("dialog", { name: getBuiltInLabels(locale).contentTree.onThisPage })).toBeVisible();
  }
  await expect(page.getByRole("checkbox", { name: labels.remember })).toBeVisible();
}

test("fresh persisted-state visit restores H4 without changing address, history or focus", async ({ page }) => {
  await seed(page);
  const query = "?keep=a%20b&keep=c";
  await page.goto(article.path + query, { waitUntil: "load" });
  await ready(page);
  await aligned(page, savedHeading.id);
  const before = await page.evaluate(() => ({ history: history.length, state: history.state, focus: document.activeElement?.tagName, search: location.search }));
  // Eagerly finish real fixture images and fonts to expose later geometry shifts in WebKit.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, async (image) => { image.loading = "eager"; await image.decode(); }));
  });
  await aligned(page, savedHeading.id);
  expect(await page.evaluate(() => ({ history: history.length, state: history.state, focus: document.activeElement?.tagName, search: location.search }))).toEqual(before);
  expect(before.focus).toBe("BODY");
  expect(new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).search).toBe(query);
});

test("a real reading gesture saves the accepted chapter and another page reuses the persisted state", async ({ page, context }, info) => {
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await expect(page.getByRole("tablist")).toBeVisible();
  expect(await positions(page)).toBeNull();
  await page.locator(`[id='${savedHeading.id}']`).evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  if (info.project.use.hasTouch) {
    // Mobile emulation uses the real keyboard path, not a claimed physical swipe.
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => window.scrollBy(0, 24));
  } else {
    await page.mouse.move(20, 200);
    await page.mouse.wheel(0, 24);
  }
  await expect.poll(async () => JSON.parse(await positions(page) ?? "[]")[0]?.headingId).toBe(savedHeading.id);
  const saved = JSON.parse((await positions(page))!);
  expect(saved).toHaveLength(1);
  expect(Object.keys(saved[0]).sort()).toEqual(["contentId", "headingId", "locale", "savedAt"]);
  expect(saved[0]).toMatchObject({ contentId, locale });
  const reopened = await context.newPage(); // Same guarded context; not a browser-process restart.
  try {
    await reopened.goto(article.path, { waitUntil: "load" });
    await ready(reopened);
    await aligned(reopened, savedHeading.id);
  } finally { await reopened.close(); }
});

test("explicit fragment and native history retain priority over a saved different chapter", async ({ page }) => {
  await seed(page);
  await page.goto(`${article.path}#${explicitHeading.id}`, { waitUntil: "load" });
  await ready(page);
  await expect(page.locator(`[id='${explicitHeading.id}']`)).toBeInViewport();
  expect(new URL(page.url()).hash).toBe(`#${explicitHeading.id}`);
  await page.goto("/");
  await page.goBack({ waitUntil: "load" });
  await ready(page);
  await expect(page.locator(`[id='${explicitHeading.id}']`)).toBeInViewport();
  expect(new URL(page.url()).hash).toBe(`#${explicitHeading.id}`);
});

test("native Back returns to its no-fragment top position instead of the saved chapter", async ({ page }) => {
  await seed(page);
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await aligned(page, savedHeading.id);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goto("/");
  await page.goBack({ waitUntil: "load" });
  await ready(page);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(new URL(page.url()).hash).toBe("");
  expect(JSON.parse((await positions(page))!)[0].headingId).toBe(savedHeading.id);
});

test("missing and expired positions leave a fresh article at its beginning", async ({ page }) => {
  for (const [id, timestamp] of [["removed-heading", Date.now()], [savedHeading.id, Date.now() - READING_RETENTION_MS]] as const) {
    await seed(page, id, timestamp);
    await page.goto(article.path, { waitUntil: "load" });
    await ready(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(new URL(page.url()).hash).toBe("");
  }
});

test("an automatic restore names its chapter and offers the start of the story", async ({ page }) => {
  await seed(page);
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await aligned(page, savedHeading.id);
  // The live region itself is an empty in-flow element; its panel is what shows.
  const notice = page.getByRole("status").getByText(article.labels.resumed.replace("{chapter}", savedHeading.text));
  await expect(notice).toBeVisible();
  await page.getByRole("status").getByRole("button", { name: article.labels.backToStart }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(notice).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");
  expect(JSON.parse((await positions(page))!)[0].headingId).toBe(savedHeading.id);
});

test("a visit without a saved place shows no resume notice", async ({ page }) => {
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await expect(page.getByRole("button", { name: article.labels.backToStart })).toHaveCount(0);
});

test("clear and disable controls persist accurately without affecting ordinary reading", async ({ page }) => {
  await seed(page);
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await aligned(page, savedHeading.id);
  await settings(page);
  await page.getByRole("button", { name: article.labels.clear, exact: true }).click();
  const feedback = page.getByRole("status").filter({ hasText: article.labels.cleared });
  await expect(feedback).toBeVisible();
  // A persistent live region must receive another child/text update even when
  // an action's announcement has exactly the same wording the second time.
  await feedback.evaluate((region) => {
    region.setAttribute("data-feedback-updates", "0");
    const observer = new MutationObserver(() => {
      region.setAttribute("data-feedback-updates", "1");
      observer.disconnect();
    });
    observer.observe(region, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole("button", { name: article.labels.clear, exact: true }).click();
  await expect(feedback).toHaveAttribute("data-feedback-updates", "1");
  await expect(feedback).toBeVisible();
  expect(await positions(page)).toBeNull();
  await page.getByRole("checkbox", { name: article.labels.remember }).uncheck();
  await expect(page.getByRole("checkbox", { name: article.labels.remember })).not.toBeChecked();
  expect(await page.evaluate((key) => localStorage.getItem(key), READING_DISABLED_KEY)).toBe("1");
  await page.reload({ waitUntil: "load" });
  await ready(page);
  await settings(page);
  await expect(page.getByRole("checkbox", { name: article.labels.remember })).not.toBeChecked();
  await page.getByRole("checkbox", { name: article.labels.remember }).check();
  await expect(page.getByRole("checkbox", { name: article.labels.remember })).toBeChecked();
  expect(await positions(page)).toBeNull();
});

test("storage denied at acquisition never breaks the article and reports control failure", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } }));
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await settings(page);
  await page.getByRole("button", { name: article.labels.clear, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: article.labels.failure })).toBeVisible();
  const link = page.getByRole("navigation", { name: getBuiltInLabels(locale).contentTree.onThisPage }).locator(`a[href='#${explicitHeading.id}']`);
  await link.click();
  await aligned(page, explicitHeading.id);
});

test("a fresh in-app article link restores the correct chapter after a continuation", async ({ page }) => {
  const id = "content-reading-coastal-light";
  const content = mockContentPages[language].get(id)!;
  const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), id)!;
  const path = `/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`;
  const heading = listContentHeadings(content.body)[0];
  const labels = getBuiltInLabels(locale);
  await page.goto(path, { waitUntil: "load" });
  await ready(page);
  const next = await page.locator("[data-article-end-gallery]").getByRole("link", { name: labels.gallery.showMore }).getAttribute("href");
  if (!next || !heading) throw new Error("[e2e] Continuation/heading fixture is missing");
  await page.evaluate(({ key, entry }) => localStorage.setItem(key, JSON.stringify([entry])), {
    key: READING_POSITIONS_KEY, entry: { contentId: id, locale, headingId: heading.id, savedAt: Date.now() },
  });
  await page.goto(next, { waitUntil: "load" });
  await expect(page.getByRole("button", { name: labels.theme.darkTheme, exact: true })).toBeAttached();
  await page.getByRole("link", { name: labels.article.backToArticle, exact: true }).click();
  await ready(page);
  await aligned(page, heading.id);
  expect(new URL(page.url()).pathname).toBe(path);
  expect(new URL(page.url()).hash).toBe("");
});

test("each locale owns its own saved chapter and localized controls", async ({ page }) => {
  // This article is actually published in both fixture languages; the lens
  // article deliberately has no Finnish route, so it must not be invented here.
  const id = "content-reading-coastal-light";
  const source = fixture(language, locale, id);
  const translated = fixture(PREFIXED_LOCALE.prefix, PREFIXED_LOCALE.prefix, id);
  const sourceHeading = source.headings[0];
  const translatedHeading = translated.headings[0];
  await page.goto("/");
  await page.evaluate(({ key, entry }) => localStorage.setItem(key, JSON.stringify([entry])), {
    key: READING_POSITIONS_KEY, entry: { contentId: id, locale, headingId: sourceHeading.id, savedAt: Date.now() },
  });
  await page.goto(translated.path, { waitUntil: "load" });
  await ready(page, translated.labels);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.evaluate(({ key, entry }) => {
    const current = JSON.parse(localStorage.getItem(key) ?? "[]");
    localStorage.setItem(key, JSON.stringify([...current, entry]));
  }, { key: READING_POSITIONS_KEY, entry: { contentId: id, locale: translated.locale, headingId: translatedHeading.id, savedAt: Date.now() } });
  await page.reload({ waitUntil: "load" });
  await ready(page, translated.labels);
  await aligned(page, translatedHeading.id);
  await page.goto(source.path, { waitUntil: "load" });
  await ready(page);
  await aligned(page, sourceHeading.id);
});

test("pre-hydration scrolling cancels restoration when delayed scripts become available", async ({ page }) => {
  await seed(page);
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/static/**/*.js", async (route) => { await scripts; await route.continue(); });
  try {
    await page.goto(article.path, { waitUntil: "commit" });
    await expect(page.locator(`[id='${savedHeading.id}']`)).toBeAttached();
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
  } finally { release(); }
  await ready(page);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.scrollY)).toBe(200);
  await expect(page.locator(`[id='${savedHeading.id}']`)).not.toBeInViewport();
});

test("denied removals and quota writes report failure while disabling remains effective on this page", async ({ page }) => {
  await seed(page);
  await page.addInitScript(({ positionsKey, disabledKey }) => {
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === positionsKey || key === disabledKey) throw new DOMException("Quota", "QuotaExceededError");
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key === positionsKey || key === disabledKey) throw new DOMException("Denied", "SecurityError");
      return remove.call(this, key);
    };
  }, { positionsKey: READING_POSITIONS_KEY, disabledKey: READING_DISABLED_KEY });
  await page.goto(article.path, { waitUntil: "load" });
  await ready(page);
  await aligned(page, savedHeading.id);
  await settings(page);
  await page.getByRole("button", { name: article.labels.clear, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: article.labels.failure })).toBeVisible();
  expect(JSON.parse((await positions(page))!)[0].headingId).toBe(savedHeading.id);
  await page.getByRole("checkbox", { name: article.labels.remember }).uncheck();
  await expect(page.getByRole("checkbox", { name: article.labels.remember })).not.toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: article.labels.failure })).toBeVisible();
});

test("a gallery body does not acquire article reading storage or controls", async ({ page }) => {
  const id = "content-polar-night-sessions";
  const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), id)!;
  await page.goto(`/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`, { waitUntil: "load" });
  await expect(page.getByRole("button", { name: getBuiltInLabels(locale).theme.darkTheme, exact: true })).toBeAttached();
  await expect(page.getByText(article.labels.heading, { exact: true })).toHaveCount(0);
  const target = page.locator("[data-content-body] h4").first();
  await target.evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => window.scrollBy(0, 24));
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe("");
  expect(await positions(page)).toBeNull();
});

test("late comparison-image enhancement retains the restored chapter until reader input", async ({ page }) => {
  const id = "content-reading-coastal-light";
  const content = mockContentPages[language].get(id)!;
  const parts = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), id)!;
  const path = `/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`;
  const heading = listContentHeadings(content.body)[0];
  const comparisons = content.body.filter((block) => block.type === "image-comparison");
  const sources = new Set<string>(comparisons.flatMap((block) => [block.first.rendition.src, block.second.rendition.src]));
  await page.goto("/");
  await page.evaluate(({ key, entry }) => localStorage.setItem(key, JSON.stringify([entry])), {
    key: READING_POSITIONS_KEY, entry: { contentId: id, locale, headingId: heading.id, savedAt: Date.now() },
  });
  let release!: () => void;
  const images = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/image?**", async (route) => {
    if (sources.has(new URL(route.request().url()).searchParams.get("url") ?? "")) await images;
    await route.continue();
  });
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await ready(page);
    await aligned(page, heading.id);
  } finally { release(); }
  // WebKit may leave images above the restored viewport lazy. Finish only the
  // real comparison fixtures so all engines exercise the same late load event.
  await page.locator("[data-comparison-view] img").evaluateAll((images) => {
    for (const image of images) (image as HTMLImageElement).loading = "eager";
  });
  await expect(page.locator("[data-comparison-view='reveal']")).toHaveCount(comparisons.filter(canOverlayComparison).length);
  await aligned(page, heading.id);
  // An explicit viewer/control gesture takes over from the automatic anchor.
  await page.getByRole("button", { name: getBuiltInLabels(locale).imageComparison.showComplete, exact: true }).first().click();
  await expect.poll(() => page.locator(`[id='${heading.id}']`).evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(100);
});

test("a separate browser process restores the chapter from its isolated persistent profile", async ({ playwright, browserName, baseURL, clientAddress, externalRequests }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "Desktop Chromium and WebKit cover the process restart; other journeys cover mobile emulation.");
  if (!baseURL) throw new Error("[e2e] The persistent-profile guard requires the harness origin");
  const origin = new URL(baseURL).origin;
  const profile = await mkdtemp(join(tmpdir(), "photosite-reading-profile-"));
  let persisted: string | null = null;
  try {
    for (const phase of ["save", "restore"] as const) {
      const context = await playwright[browserName].launchPersistentContext(profile, {
        headless: true, baseURL, viewport: info.project.use.viewport,
        extraHTTPHeaders: { "x-forwarded-for": clientAddress }, serviceWorkers: "block",
      });
      try {
        // A separately launched browser must carry the same strict project guard.
        await context.route("**/*", async (route) => {
          if (new URL(route.request().url()).origin === origin) await route.continue();
          else { externalRequests.push(route.request().url()); await route.abort("blockedbyclient"); }
        });
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(article.path, { waitUntil: "load" });
        await ready(page);
        if (phase === "save") {
          await expect(page.getByRole("tablist")).toBeVisible();
          await page.locator(`[id='${savedHeading.id}']`).evaluate((heading) => heading.scrollIntoView({ block: "start" }));
          await page.keyboard.press("ArrowDown");
          await page.evaluate(() => window.scrollBy(0, 24));
          await expect.poll(async () => JSON.parse(await positions(page) ?? "[]")[0]?.headingId).toBe(savedHeading.id);
          persisted = await positions(page);
        } else {
          expect(await positions(page)).toBe(persisted);
          await aligned(page, savedHeading.id);
          expect(new URL(page.url()).hash).toBe("");
        }
      } finally { await context.close(); } // Also terminates this separate browser process.
    }
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("reading remains native and settings explain their script requirement", async ({ page }) => {
    await page.goto(article.path, { waitUntil: "load" });
    await expect(page.getByText(article.labels.javascript, { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: article.labels.remember })).toHaveCount(0);
    await page.getByRole("navigation", { name: getBuiltInLabels(locale).contentTree.onThisPage }).locator(`a[href='#${explicitHeading.id}']`).click();
    expect(new URL(page.url()).hash).toBe(`#${explicitHeading.id}`);
    await expect(page.locator(`[id='${explicitHeading.id}']`)).toBeInViewport();
    expect(await positions(page)).toBeNull();
  });
});
