import { test, expect } from "./support/fixtures";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";

/**
 * AB#22's data table body block against the production build the harness
 * serves.
 *
 * `sanity-content-blocks.test.ts` already proves the read boundary's own rules
 * and `content-block.test.ts` the Studio validation that mirrors them. What
 * only a real browser can establish is the part the acceptance criteria name
 * explicitly: that a table wide enough to overflow scrolls inside its own
 * region instead of dragging the whole page sideways, and that a keyboard
 * alone can reach and drive that region — with no JavaScript involved, which
 * is why the block renders a plain focusable container rather than enhancing
 * one after hydration.
 */

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const tree = buildContentTree(mockContentTreeInputs[language]);

const pathTo = (contentId: string) =>
  `/${DEFAULT_STORY_NAMESPACE}/${getCanonicalContentPath(tree, contentId)!.join("/")}`;

/** The article fixture authors the eight-column table, with a caption. */
const articlePath = pathTo("content-choosing-a-telephoto-lens");
/** The gallery fixture authors a narrow one with no caption. */
const galleryPath = pathTo("content-polar-night-sessions");

const ARTICLE_CAPTION =
  "Placeholder specifications; replaced with real data from the CMS.";

test("renders a semantic table with a caption, column headers, and data cells", async ({
  page,
}) => {
  await page.goto(articlePath);

  const table = page.locator("main table").first();
  await expect(table).toBeVisible();
  await expect(table.locator("caption")).toHaveText(ARTICLE_CAPTION);

  // Column headers are real `th[scope=col]`, not styled cells: that scope is
  // what lets a screen reader announce the right header with each cell.
  const headers = table.locator("thead th");
  await expect(headers).toHaveCount(8);
  await expect(headers.first()).toHaveAttribute("scope", "col");
  await expect(headers.first()).toHaveText("Lens");

  // Four authored rows, each with one cell per header, including the empty one.
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.first().locator("td")).toHaveCount(8);
  await expect(rows.nth(2).locator("td").nth(7)).toHaveText("");
});

test("names the scroll region from the caption, and from the built-in label when there is none", async ({
  page,
}) => {
  await page.goto(articlePath);
  await expect(
    page.getByRole("region", { name: ARTICLE_CAPTION }),
  ).toBeVisible();

  // The gallery variant carries the same block with no caption, which is both
  // the "shared by both variants" case and the fallback-name case.
  await page.goto(galleryPath);
  await expect(
    page.getByRole("region", { name: labels.table.label }),
  ).toBeVisible();
});

test("a table too wide for the page scrolls inside its own region, not the page", async ({
  page,
}) => {
  await page.goto(articlePath);
  const region = page.getByRole("region", { name: ARTICLE_CAPTION });

  // The premise of every assertion below: this fixture really does overflow at
  // this viewport. Eight columns does not guarantee it on its own, so it is
  // measured rather than assumed — if the fixture ever stopped overflowing,
  // the keyboard-scroll assertions would pass vacuously.
  const overflow = await region.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(overflow).toBeGreaterThan(0);

  // The page itself must not have inherited that overflow.
  const pageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

test("the scroll region is reachable and scrollable by keyboard with JavaScript disabled", async ({
  browser,
}) => {
  // A dedicated context: the keyboard path is meant to work with no script at
  // all, so proving it needs a page where none ran.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(articlePath);
    const region = page.getByRole("region", { name: ARTICLE_CAPTION });
    await expect(region).toBeVisible();
    expect(
      await region.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeGreaterThan(0);

    // Tab until the region takes focus, rather than calling `.focus()`: the
    // point is that it is reachable in the ordinary tab order, not merely that
    // it is focusable when asked directly.
    let focused = false;
    for (let press = 0; press < 40 && !focused; press += 1) {
      await page.keyboard.press("Tab");
      focused = await region.evaluate((node) => node === document.activeElement);
    }
    expect(focused).toBe(true);

    expect(await region.evaluate((node) => node.scrollLeft)).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => region.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);

    // And the region does not trap: tabbing again moves focus off it.
    await page.keyboard.press("Tab");
    expect(
      await region.evaluate((node) => node === document.activeElement),
    ).toBe(false);
  } finally {
    await context.close();
  }
});
