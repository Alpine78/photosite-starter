import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * AB#21: the three-level (h2/h3/h4) body heading model and the nested
 * table-of-contents `ContentPageJumpNav` derives from it. Complements
 * `gallery-content.spec.ts`, which already proves the level-2-only case, the
 * absent-body case, and the continuation-omission rule (ADR-0003 decision 3)
 * — none of which this story changes, so none of it is re-proven here.
 *
 * `content-choosing-a-telephoto-lens` (article) and `content-polar-night-sessions`
 * (gallery) are the two fixtures AC7 requires authoring all three levels;
 * `content-understanding-exposure-triangle` (article) and
 * `content-coastal-mornings` (gallery) are the pre-existing bilingual
 * fixtures reused, unmodified, for the "accessible name in both locales"
 * check below.
 */

function canonicalPathOf(language: string, contentId: string): string {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The locale ${language} publishes no mock tree.`);
  }
  const tree = buildContentTree(treeInput);
  const path = getCanonicalContentPath(tree, contentId);
  if (path === null) {
    throw new Error(`[e2e] ${contentId} has no canonical route in ${language}.`);
  }
  const routeRoot =
    language === PREFIXED_LOCALE.prefix
      ? `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`
      : `/${DEFAULT_STORY_NAMESPACE}`;
  return `${routeRoot}/${path.join("/")}`;
}

const DEFAULT_LANGUAGE = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const defaultLabels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const prefixedLabels = getBuiltInLabels(PREFIXED_LOCALE.prefix);

const ARTICLE_PATH = canonicalPathOf(
  DEFAULT_LANGUAGE,
  "content-choosing-a-telephoto-lens",
);
const GALLERY_PATH = canonicalPathOf(DEFAULT_LANGUAGE, "content-polar-night-sessions");

/**
 * Every link's `href` resolves to exactly one element with that id, at the
 * expected heading level — AC6's "no link points to a missing or duplicate
 * target" made concrete, and a check that a nested-`<ol>` structural proof
 * alone would not catch (it proves nesting shape, not that the ids resolve).
 */
async function expectEveryLinkToResolveToOneHeadingAtItsLevel(
  nav: import("@playwright/test").Locator,
  page: import("@playwright/test").Page,
  levelByLinkName: ReadonlyMap<string, 2 | 3 | 4>,
) {
  for (const [name, level] of levelByLinkName) {
    const href = await nav.getByRole("link", { name }).getAttribute("href");
    expect(href?.startsWith("#")).toBe(true);
    const fragment = href ?? "";
    await expect(page.locator(fragment)).toHaveCount(1);
    await expect(page.locator(`h${level}${fragment}`)).toHaveCount(1);
  }
}

test("the article's nested table of contents follows the h2 > h3 > h4 hierarchy, each link landing on its own heading", async ({
  page,
}) => {
  await page.goto(ARTICLE_PATH, { waitUntil: "load" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const nav = page.getByRole("navigation", { name: defaultLabels.contentTree.onThisPage });
  await expect(nav).toHaveCount(1);

  await expectEveryLinkToResolveToOneHeadingAtItsLevel(
    nav,
    page,
    new Map<string, 2 | 3 | 4>([
      ["Key specifications to evaluate", 2],
      ["Build and handling", 3],
      ["Weather sealing in the field", 4],
    ]),
  );

  // Structural nesting: the h3 and h4 links are DOM descendants of their
  // parent heading's own <li>, not merely later in document order — proving
  // the rendered markup is a real nested list, not a flat one that happens
  // to read in the right sequence.
  const parentLi = nav
    .getByRole("link", { name: "Key specifications to evaluate" })
    .locator("xpath=ancestor::li[1]");
  const childLink = parentLi.getByRole("link", { name: "Build and handling" });
  await expect(childLink).toBeVisible();

  const grandchildLi = childLink.locator("xpath=ancestor::li[1]");
  const grandchildLink = grandchildLi.getByRole("link", {
    name: "Weather sealing in the field",
  });
  await expect(grandchildLink).toBeVisible();

  // A sibling h2's own link must NOT be a descendant of the first h2's <li>.
  const siblingLink = parentLi.getByRole("link", { name: "Conclusion" });
  await expect(siblingLink).toHaveCount(0);

  await grandchildLink.click();
  await expect(page.locator("h4", { hasText: "Weather sealing in the field" })).toBeInViewport();
});

test("the gallery's nested table of contents keeps the #gallery leading link before the heading tree", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH, { waitUntil: "load" });

  const nav = page.getByRole("navigation", { name: defaultLabels.contentTree.onThisPage });
  await expect(nav).toHaveCount(1);

  const topLevelLinks = nav.locator(":scope > ol > li > a");
  await expect(topLevelLinks.first()).toHaveText(defaultLabels.gallery.jumpToImages);

  await expectEveryLinkToResolveToOneHeadingAtItsLevel(
    nav,
    page,
    new Map<string, 2 | 3 | 4>([
      ["Planning around the light", 2],
      ["Checking the aurora forecast", 3],
      ["Reading the KP index", 4],
      ["Staying warm enough to wait", 2],
    ]),
  );

  const firstBranchLi = nav
    .getByRole("link", { name: "Planning around the light" })
    .locator("xpath=ancestor::li[1]");
  await expect(
    firstBranchLi.getByRole("link", { name: "Checking the aurora forecast" }),
  ).toBeVisible();
  // The second h2's own branch must not inherit the first h2's children.
  await expect(
    firstBranchLi.getByRole("link", { name: "Staying warm enough to wait" }),
  ).toHaveCount(0);
});

test("a nested table-of-contents entry is keyboard-operable", async ({ page }) => {
  await page.goto(ARTICLE_PATH, { waitUntil: "load" });
  const nav = page.getByRole("navigation", { name: defaultLabels.contentTree.onThisPage });
  const link = nav.getByRole("link", { name: "Build and handling" });

  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator("h3", { hasText: "Build and handling" })).toBeInViewport();
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the nested table of contents is server-rendered and its links resolve without a script runtime", async ({
    page,
  }) => {
    await page.goto(ARTICLE_PATH, { waitUntil: "load" });
    const nav = page.getByRole("navigation", { name: defaultLabels.contentTree.onThisPage });
    await expect(nav).toHaveCount(1);

    await expectEveryLinkToResolveToOneHeadingAtItsLevel(
      nav,
      page,
      new Map<string, 2 | 3 | 4>([
        ["Key specifications to evaluate", 2],
        ["Build and handling", 3],
        ["Weather sealing in the field", 4],
      ]),
    );

    const grandchildLink = nav.getByRole("link", { name: "Weather sealing in the field" });
    await grandchildLink.click();
    await expect(page).toHaveURL(/#section-/);
    await expect(
      page.locator("h4", { hasText: "Weather sealing in the field" }),
    ).toBeInViewport();
  });
});

test("the article's and gallery's table of contents carry the correct accessible name in both configured locales", async ({
  page,
}) => {
  const cases: ReadonlyArray<{
    readonly path: string;
    readonly labels: ReturnType<typeof getBuiltInLabels>;
  }> = [
    {
      path: canonicalPathOf(DEFAULT_LANGUAGE, "content-understanding-exposure-triangle"),
      labels: defaultLabels,
    },
    {
      path: canonicalPathOf(PREFIXED_LOCALE.prefix, "content-understanding-exposure-triangle"),
      labels: prefixedLabels,
    },
    {
      path: canonicalPathOf(DEFAULT_LANGUAGE, "content-coastal-mornings"),
      labels: defaultLabels,
    },
    {
      path: canonicalPathOf(PREFIXED_LOCALE.prefix, "content-coastal-mornings"),
      labels: prefixedLabels,
    },
  ];

  for (const { path, labels } of cases) {
    await page.goto(path, { waitUntil: "load" });
    await expect(
      page.getByRole("navigation", { name: labels.contentTree.onThisPage }),
    ).toHaveCount(1);
  }
});
