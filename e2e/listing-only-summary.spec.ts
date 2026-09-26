import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { mockAuthoredContentRecords } from "../src/lib/mock-content-listing";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * A listing-only lead (AB#172): the page's `summary` is the excerpt on its
 * listing card and its meta, Open Graph and structured-data description, but
 * the page itself does not render it — not on a gallery hero, not in a
 * gallery's constrained header, not as an article's lead paragraph.
 *
 * The three fixtures are the mock layer's listing-only pages, one per
 * surface that would otherwise render the lead. The lead text is read from
 * the same records the harness serves, never written down here.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;

function canonicalSegments(contentId: string): readonly string[] {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  const segments = getCanonicalContentPath(buildContentTree(treeInput), contentId);
  if (segments === null) throw new Error(`[e2e] ${contentId} has no canonical path.`);
  return segments;
}

function summaryOf(contentId: string): string {
  const summary = mockAuthoredContentRecords[language]?.get(contentId)?.summary;
  if (summary === undefined) throw new Error(`[e2e] ${contentId} has no ${language} summary.`);
  return summary;
}

const CASES = [
  { contentId: "content-masonry-below", surface: "gallery hero" },
  { contentId: "content-grid-overlay", surface: "gallery header without a cover" },
  { contentId: "content-shooting-in-low-light", surface: "article lead" },
] as const;

for (const { contentId, surface } of CASES) {
  test(`a listing-only lead stays off the ${surface} but keeps its descriptions`, async ({ page }) => {
    const segments = canonicalSegments(contentId);
    const path = `${STORY_ROOT}/${segments.join("/")}`;
    const summary = summaryOf(contentId);

    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // None of these fixtures' bodies restates the lead, so any exact match on
    // the page would be the lead itself.
    await expect(page.getByRole("main").getByText(summary, { exact: true })).toHaveCount(0);

    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", summary);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", summary);
    if (contentId === "content-shooting-in-low-light") {
      const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
      const article = jsonLd
        .map((text) => JSON.parse(text) as { "@type"?: string; description?: string })
        .find((entity) => entity["@type"] === "Article");
      expect(article?.description).toBe(summary);
    }

    // The parent category's listing still shows the lead as the card's excerpt.
    await page.goto(`${STORY_ROOT}/${segments.slice(0, -1).join("/")}`, {
      waitUntil: "domcontentloaded",
    });
    const card = page.locator("li").filter({ has: page.locator(`a[href="${path}"]`) });
    await expect(card.getByText(summary, { exact: true })).toBeVisible();
  });
}
