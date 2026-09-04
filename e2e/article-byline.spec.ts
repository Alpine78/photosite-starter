import { getBuiltInLabels } from "@/lib/deployment-config";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getSiteSettings } from "../src/lib/site-settings";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";

/**
 * The per-article author byline (AB#151): an explicit override when authored,
 * the site's photographer name otherwise — one decided meta line shared with
 * AB#150's event date, never two independently-shipped additions to the hero.
 *
 * `SiteSettings.photographerName` is read from the same mock seam the running
 * app reads, never hardcoded here: it is exactly the kind of brand-sensitive
 * value a clone replaces (AGENTS.md), so the assertion has to travel with it.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);

function canonicalPath(contentId: string): string {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  const segments = getCanonicalContentPath(buildContentTree(treeInput), contentId);
  if (segments === null) {
    throw new Error(`[e2e] ${contentId} has no canonical path.`);
  }
  return `${STORY_ROOT}/${segments.join("/")}`;
}

function bylineFor(author: string): string {
  return labels.article.byline.replace("{author}", author);
}

// content-choosing-a-telephoto-lens authors an explicit override
// (mock-content-pages.ts); content-reading-coastal-light (has a hero) and
// content-packing-for-a-photo-trip (no cover, no hero) both rely on the
// site-wide fallback — the normal, zero-extra-authoring state.
const ARTICLE_WITH_EXPLICIT_AUTHOR = canonicalPath(
  "content-choosing-a-telephoto-lens",
);
const ARTICLE_WITH_HERO_NO_AUTHOR = canonicalPath(
  "content-reading-coastal-light",
);
const ARTICLE_NO_HERO_NO_AUTHOR = canonicalPath(
  "content-packing-for-a-photo-trip",
);

test("shows the article's own explicit author on the hero, not the site's photographer name", async ({
  page,
}) => {
  const settings = await getSiteSettings();
  await page.goto(ARTICLE_WITH_EXPLICIT_AUTHOR, { waitUntil: "domcontentloaded" });

  const hero = page.locator("main > figure").first();
  await expect(
    hero.getByText(bylineFor("Alex Rivers"), { exact: true }),
  ).toBeVisible();
  await expect(
    hero.getByText(bylineFor(settings.photographerName), { exact: true }),
  ).toHaveCount(0);
});

test("falls back to the site's photographer name on the hero when no author is authored", async ({
  page,
}) => {
  const settings = await getSiteSettings();
  await page.goto(ARTICLE_WITH_HERO_NO_AUTHOR, { waitUntil: "domcontentloaded" });

  const hero = page.locator("main > figure").first();
  await expect(
    hero.getByText(bylineFor(settings.photographerName), { exact: true }),
  ).toBeVisible();
});

test("falls back to the site's photographer name in the constrained header when the article has no cover", async ({
  page,
}) => {
  const settings = await getSiteSettings();
  await page.goto(ARTICLE_NO_HERO_NO_AUTHOR, { waitUntil: "domcontentloaded" });

  await expect(page.locator("main > figure")).toHaveCount(0);
  await expect(
    page
      .getByRole("main")
      .getByText(bylineFor(settings.photographerName), { exact: true }),
  ).toBeVisible();
});

test("the byline is real, reachable text alongside the title and date — not baked into the image", async ({
  page,
}) => {
  const settings = await getSiteSettings();
  await page.goto(ARTICLE_WITH_HERO_NO_AUTHOR, { waitUntil: "domcontentloaded" });

  const byline = page.getByText(bylineFor(settings.photographerName), {
    exact: true,
  });
  await expect(byline).toBeVisible();
  expect(await byline.evaluate((element) => element.tagName)).toBe("P");
  // The date it is coordinated with (AB#150) is still present alongside it.
  await expect(page.locator("main > figure time")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
