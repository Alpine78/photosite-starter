import type { Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, DEFAULT_SEARCH_NAMESPACE, DEFAULT_STORY_NAMESPACE, HARNESS_BASE_URL } from "./support/harness-environment";

// AB#382: a page title that is one long word (a Finnish compound, a product
// name) must wrap inside a 320 px viewport instead of widening the page
// (WCAG 2.1 SC 1.4.10). The fixture titles are short, so the server-rendered
// h1 text is replaced by a long single word; wrapping is CSS alone, so the
// check runs without JavaScript and cannot meet a hydration mismatch.
const LONG_WORD = "Valokuvauspalvelukokonaisuusesittelysivu";

test.use({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });

async function withLongTitle(page: Page) {
  const origin = new URL(HARNESS_BASE_URL).origin;
  await page.route((url) => url.origin === origin, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace(/(<h1\b[^>]*>)[^<]*(<\/h1>)/, `$1${LONG_WORD}$2`);
    await route.fulfill({ response, body });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const h1 = page.getByRole("heading", { level: 1, name: LONG_WORD });
  await expect(h1).toBeVisible();
  const { overflow, right, width } = await page.evaluate(() => {
    const heading = document.querySelector("h1")!.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      right: heading.right,
      width: document.documentElement.clientWidth,
    };
  });
  expect(overflow).toBeLessThanOrEqual(1);
  expect(right).toBeLessThanOrEqual(width + 1);
}

// The first article and the first gallery of the synthetic content, so the
// story detail titles (their own heading styles) are covered too.
function firstStoryPaths(): string[] {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const tree = buildContentTree(mockContentTreeInputs[language]);
  const paths: string[] = [];
  for (const variant of ["article", "gallery"] as const) {
    for (const [id, page] of mockContentPages[language]) {
      const segments = page.variant === variant ? getCanonicalContentPath(tree, id) : null;
      if (segments) { paths.push(`/${DEFAULT_STORY_NAMESPACE}/${segments.join("/")}`); break; }
    }
  }
  if (paths.length !== 2) throw new Error("[e2e] Title reflow needs a synthetic article and gallery.");
  return paths;
}

for (const path of ["/contact", "/services", `/${DEFAULT_STORY_NAMESPACE}`, `/${DEFAULT_SEARCH_NAMESPACE}`, ...firstStoryPaths()]) {
  test(`a one-word page title wraps inside 320 px on ${path}`, async ({ page }) => {
    await withLongTitle(page);
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  });
}

test("a one-word service title wraps inside 320 px", async ({ page }) => {
  await page.goto("/services");
  const href = await page.getByRole("main").locator('a[href^="/services/"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  await withLongTitle(page);
  await page.goto(href!);
  await expectNoHorizontalOverflow(page);
});
