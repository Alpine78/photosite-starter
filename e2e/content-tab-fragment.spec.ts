import { test, expect } from "./support/fixtures";
import { type Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { listContentHeadings } from "../src/lib/content-headings";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, HARNESS_BASE_URL, PREFIXED_LOCALE } from "./support/harness-environment";

const defaultLanguage = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const contentId = "content-shooting-in-low-light";
const cases = [
  { language: defaultLanguage, root: `/${DEFAULT_STORY_NAMESPACE}` },
  { language: PREFIXED_LOCALE.prefix, root: `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` },
].map(({ language, root }) => {
  const content = mockContentPages[language].get(contentId);
  const path = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), contentId);
  if (!content || !path) throw new Error("[e2e] Bilingual tab hydration fixture is required.");
  const headings = listContentHeadings(content.body).slice(-3);
  return { language, path: `${root}/${path.join("/")}`, headings };
});

async function headingTop(page: Page, id: string) {
  return page.locator(`[id='${id}']`).evaluate((node) => node.getBoundingClientRect().top);
}

for (const fixture of cases) {
  for (const [position, heading] of fixture.headings.entries()) {
    test(`${fixture.language}: fresh heading ${position} before/between/after two tab groups survives enhancement`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${fixture.path}#${heading.id}`, { waitUntil: "load" });
      await expect(page.getByRole("tablist")).toHaveCount(2);
      await expect(page.locator(`[id='${heading.id}']`)).toBeInViewport();
      const top = await headingTop(page, heading.id);
      expect(top).toBeGreaterThanOrEqual(0);
      const snapshot = await page.evaluate(() => ({ href: location.href, length: history.length, focus: document.activeElement?.tagName }));
      await page.clock.install();
      await page.clock.fastForward(1000);
      expect(Math.abs((await headingTop(page, heading.id)) - top)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => ({ href: location.href, length: history.length, focus: document.activeElement?.tagName }))).toEqual(snapshot);
      expect(errors).toEqual([]);
    });
  }
}

type ScrollEvidence = { sameHref: boolean; sameState: boolean; sameLength: boolean; sameFocus: boolean; phase: DocumentReadyState };
type ProbeWindow = typeof window & { tabScrollEvidence: ScrollEvidence[] };

async function observeCorrections(page: Page) {
  await page.addInitScript(() => {
    const probe = window as ProbeWindow;
    probe.tabScrollEvidence = [];
    const original = window.scrollBy;
    window.scrollBy = ((...args: unknown[]) => {
      const href = location.href, state = history.state, length = history.length, focus = document.activeElement;
      Reflect.apply(original, window, args);
      probe.tabScrollEvidence.push({ sameHref: href === location.href, sameState: state === history.state,
        sameLength: length === history.length, sameFocus: focus === document.activeElement, phase: document.readyState });
    }) as typeof window.scrollBy;
  });
}

/** Hold only the first-party chunk containing this real progressive component. */
async function holdTabChunk(page: Page, abort = false) {
  let held = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/static/**/*.js", async (route) => {
    if (new URL(route.request().url()).origin !== new URL(HARNESS_BASE_URL).origin) {
      await route.fallback(); return;
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if ((await response.text()).includes("data-content-tabs")) {
      held += 1;
      if (abort) { await route.abort("failed"); return; }
      await gate;
    }
    await route.fulfill({ response });
  });
  return { wait: () => expect.poll(() => held).toBeGreaterThan(0), release,
    finish: async () => { release(); await page.unrouteAll({ behavior: "wait" }); } };
}

for (const fixture of cases) {
  test(`${fixture.language}: delayed enhancement preserves the already visible native target`, async ({ page }, info) => {
    await observeCorrections(page);
    const gate = await holdTabChunk(page);
    const id = fixture.headings[2].id;
    try {
      await page.goto(`${fixture.path}#${id}`, { waitUntil: "domcontentloaded" });
      await gate.wait();
      await expect(page.getByRole("tablist")).toHaveCount(0);
      await expect(page.locator(`[id='${id}']`)).toBeInViewport();
      gate.release();
      await expect(page.getByRole("tablist")).toHaveCount(2);
      await page.waitForLoadState("load");
      await expect(page.locator(`[id='${id}']`)).toBeInViewport();
      const calls = await page.evaluate(() => (window as ProbeWindow).tabScrollEvidence);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.length).toBeLessThanOrEqual(2);
      for (const evidence of calls) expect(evidence).toMatchObject({ sameHref: true, sameState: true, sameLength: true, sameFocus: true });
      await info.attach("correction-phases", { body: JSON.stringify(calls), contentType: "application/json" });
    } finally { await gate.finish(); }
  });

  test(`${fixture.language}: enhancement before image load preserves the native target`, async ({ page }, info) => {
    await observeCorrections(page);
    const gate = await holdTabChunk(page);
    let imagesHeld = 0;
    let releaseImages!: () => void;
    const imageGate = new Promise<void>((resolve) => { releaseImages = resolve; });
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "image" &&
          new URL(route.request().url()).origin === new URL(HARNESS_BASE_URL).origin) {
        imagesHeld += 1;
        await imageGate;
        await route.continue();
      } else await route.fallback();
    });
    // Install before navigation: a clone added by the test after goto may be
    // too late, because lazy body photographs do not block Chromium's load.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const image = document.querySelector("img");
        if (!image) return;
        const blocker = image.cloneNode(false) as HTMLImageElement;
        blocker.loading = "eager";
        blocker.hidden = true;
        blocker.removeAttribute("id");
        document.body.append(blocker);
      }, { once: true });
    });
    const id = fixture.headings[2].id;
    try {
      await page.goto(`${fixture.path}#${id}`, { waitUntil: "domcontentloaded" });
      await gate.wait();
      await expect.poll(() => imagesHeld).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.readyState)).toBe("interactive");
      await expect(page.locator(`[id='${id}']`)).toBeInViewport();
      gate.release();
      await expect(page.getByRole("tablist")).toHaveCount(2);
      // Assert BEFORE releasing images: a later native fragment re-application
      // at window.load must not mask a missing compensation.
      await expect(page.locator(`[id='${id}']`)).toBeInViewport();
      const calls = await page.evaluate(() => (window as ProbeWindow).tabScrollEvidence);
      expect(await page.evaluate(() => document.readyState)).toBe("interactive");
      // Native scroll anchoring may already preserve the target. A redundant
      // correction is deliberately omitted in that case.
      expect(calls.length).toBeLessThanOrEqual(2);
      for (const evidence of calls) expect(evidence).toMatchObject({ sameHref: true, sameState: true,
        sameLength: true, sameFocus: true, phase: "interactive" });
      releaseImages();
      await page.waitForLoadState("load");
      await expect(page.locator(`[id='${id}']`)).toBeInViewport();
      await info.attach("correction-phases-before-load", { body: JSON.stringify(calls), contentType: "application/json" });
    } finally { releaseImages(); await gate.finish(); }
  });

  test(`${fixture.language}: newer keyboard and programmatic position win before delayed hydration`, async ({ page }) => {
    await observeCorrections(page);
    const gate = await holdTabChunk(page);
    const id = fixture.headings[2].id;
    try {
      await page.goto(`${fixture.path}#${id}`, { waitUntil: "domcontentloaded" });
      await gate.wait();
      await expect(page.locator(`[id='${id}']`)).toBeInViewport();
      await page.keyboard.press("Home");
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 80));
      await expect(page.locator(`[id='${id}']`)).not.toBeInViewport();
      gate.release();
      await expect(page.getByRole("tablist")).toHaveCount(2);
      await page.waitForLoadState("load");
      expect(await page.evaluate(() => window.scrollY)).toBe(80);
      expect(await page.evaluate(() => (window as ProbeWindow).tabScrollEvidence)).toEqual([]);
      expect(new URL(page.url()).hash).toBe(`#${id}`);
    } finally { await gate.finish(); }
  });

  test(`${fixture.language}: native Back and Forward still select headings after reduced-motion hydration`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const before = fixture.headings[0].id, after = fixture.headings[2].id;
    await page.goto(`${fixture.path}#${after}`, { waitUntil: "load" });
    await expect(page.getByRole("tablist")).toHaveCount(2);
    // AB337 separately fixes NextLink concatenating a cold initial hash.
    // Exercise the native browser history contract here without claiming that link fixed.
    await page.evaluate((id) => { window.location.hash = id; }, before);
    await expect(page).toHaveURL(`${fixture.path}#${before}`);
    await page.goBack();
    await expect(page).toHaveURL(`${fixture.path}#${after}`);
    await expect(page.locator(`[id='${after}']`)).toBeInViewport();
    await page.goForward();
    await expect(page).toHaveURL(`${fixture.path}#${before}`);
    await expect(page.locator(`[id='${before}']`)).toBeInViewport();
  });
}

for (const fragment of ["", "#missing-authored-heading"]) {
  test(`no unsolicited scroll for an absent target ${fragment || "(none)"}`, async ({ page }) => {
    await observeCorrections(page);
    await page.goto(cases[0].path + fragment, { waitUntil: "load" });
    await expect(page.getByRole("tablist")).toHaveCount(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => (window as ProbeWindow).tabScrollEvidence)).toEqual([]);
  });
}

test("unavailable component JavaScript leaves all labelled tables readable", async ({ page }) => {
  const gate = await holdTabChunk(page, true);
  const fixture = cases[0], id = fixture.headings[2].id;
  try {
    await page.goto(`${fixture.path}#${id}`, { waitUntil: "load" });
    await gate.wait();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(4);
    await expect(page.locator(`[id='${id}']`)).toBeInViewport();
  } finally { await gate.finish(); }
});


test("the original article’s cold H4 remains visible through its existing table group", async ({ page }) => {
  const id = "content-choosing-a-telephoto-lens";
  const content = mockContentPages[defaultLanguage].get(id);
  const path = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[defaultLanguage]), id);
  const heading = content && listContentHeadings(content.body).find((item) => item.level === 4);
  if (!path || !heading) throw new Error("[e2e] The original article H4 fixture is required.");
  const route = `/${DEFAULT_STORY_NAMESPACE}/${path.join("/")}?reading=a%20b&reading=c#${heading.id}`;
  await page.goto(route, { waitUntil: "load" });
  await expect(page.getByRole("tablist")).toHaveCount(1);
  await expect(page.locator(`[id='${heading.id}']`)).toBeInViewport();
  await expect(page).toHaveURL(route);
  const position = await headingTop(page, heading.id);
  await page.clock.install();
  await page.clock.fastForward(1000);
  expect(Math.abs((await headingTop(page, heading.id)) - position)).toBeLessThanOrEqual(1);
});
