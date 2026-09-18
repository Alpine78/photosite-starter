import { test, expect } from "./support/fixtures";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";

/**
 * AB#163's tab-group body block (ADR-0020) against the production build the
 * harness serves.
 *
 * `content-block.test.ts` and `sanity-content-blocks.test.ts` already prove
 * the Studio schema and the read boundary's own rules; `joomla-html-conversion.test.ts`
 * proves the Bootstrap-tab recognizer. What only a real browser can establish
 * is the part the acceptance criteria name explicitly: that every tab's table
 * renders, stacked and reachable, with no JavaScript at all, and that once
 * hydrated the WAI-ARIA Tabs pattern actually switches panels with the mouse
 * and the keyboard, without trapping focus.
 */

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const tree = buildContentTree(mockContentTreeInputs[language]);

const pathTo = (contentId: string) =>
  `/${DEFAULT_STORY_NAMESPACE}/${getCanonicalContentPath(tree, contentId)!.join("/")}`;

/** The article fixture authors a two-tab group (AB#163). */
const articlePath = pathTo("content-choosing-a-telephoto-lens");
/** The gallery fixture authors the same shared block, proving it is not article-only. */
const galleryPath = pathTo("content-polar-night-sessions");

test.describe("no JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("stacks every tab's table with its label, instead of an inactive control hiding one", async ({ page }) => {
    await page.goto(articlePath);

    // No tab UI at all without a script to drive it — a stacked list of
    // labelled tables, not a disabled-looking control.
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);

    await expect(page.getByText("RAW burst", { exact: true })).toBeVisible();
    await expect(page.getByText("JPEG burst", { exact: true })).toBeVisible();

    const regions = page.getByRole("region", { name: labels.table.label });
    await expect(regions).toHaveCount(2);

    const first = regions.first();
    await expect(first.locator("thead th").first()).toHaveText("Card");
    await expect(first.locator("tbody tr")).toHaveCount(2);
    const second = regions.nth(1);
    await expect(second.locator("tbody tr")).toHaveCount(2);
  });

  test("each tab's table region is reachable by keyboard alone", async ({ page }) => {
    await page.goto(galleryPath);
    // Each tab's table is named by its own caption here — this gallery's
    // body also carries AB#22's own caption-less standalone table, so a
    // same-name fallback would be ambiguous between the two fixtures.
    const first = page.getByRole("region", { name: "December sessions" });
    const second = page.getByRole("region", { name: "January sessions" });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    let focusedCount = 0;
    for (let press = 0; press < 60 && focusedCount < 2; press += 1) {
      await page.keyboard.press("Tab");
      const isFirst = await first.evaluate((node) => node === document.activeElement);
      const isSecond = await second.evaluate((node) => node === document.activeElement);
      if (isFirst || isSecond) focusedCount += 1;
    }
    expect(focusedCount).toBe(2);
  });
});

test.describe("with JavaScript", () => {
  test("hydrates into a WAI-ARIA tablist with one active panel, switched by click", async ({ page }) => {
    await page.goto(articlePath);
    const tablist = page.getByRole("tablist", { name: labels.tabGroup.label });
    await expect(tablist).toBeVisible();

    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.first()).toHaveText("RAW burst");
    await expect(tabs.nth(1)).toHaveText("JPEG burst");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");

    // A plain attribute selector, not `getByRole`: the browser correctly
    // removes a `hidden` element from the accessibility tree, which is
    // exactly the point of using native `hidden` for the inactive panel —
    // `getByRole("tabpanel")` alone would only ever find the one visible one.
    const panels = page.locator('[role="tabpanel"]');
    await expect(panels).toHaveCount(2);
    await expect(panels.first()).toBeVisible();
    await expect(panels.nth(1)).toBeHidden();
    await expect(panels.first().locator("tbody tr").first().locator("td").first()).toHaveText("Card A");

    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "false");
    await expect(panels.first()).toBeHidden();
    await expect(panels.nth(1)).toBeVisible();
    await expect(panels.nth(1).locator("tbody tr").first().locator("td").first()).toHaveText("Card A");
  });

  test("arrow keys move focus and switch the active tab, without trapping it", async ({ page }) => {
    await page.goto(galleryPath);
    const tabs = page.getByRole("tablist").getByRole("tab");
    await expect(tabs).toHaveCount(2);

    await tabs.first().focus();
    await expect(tabs.first()).toHaveAttribute("tabindex", "0");
    await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(await tabs.nth(1).evaluate((node) => node === document.activeElement)).toBe(true);
    await expect(tabs.first()).toHaveAttribute("tabindex", "-1");

    // Wrapping: one more ArrowRight from the last tab returns to the first.
    await page.keyboard.press("ArrowRight");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

    // Escaping the tablist: Tab moves focus onward rather than cycling within it.
    await page.keyboard.press("Tab");
    expect(await tabs.first().evaluate((node) => node === document.activeElement)).toBe(false);
  });

  test("names the tablist and each tabpanel from the built-in and tab labels, in both variants", async ({ page }) => {
    await page.goto(articlePath);
    await expect(page.getByRole("tablist", { name: labels.tabGroup.label })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "RAW burst" })).toBeVisible();

    await page.goto(galleryPath);
    await expect(page.getByRole("tablist", { name: labels.tabGroup.label })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "December" })).toBeVisible();
  });
});
