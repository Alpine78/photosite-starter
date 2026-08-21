import type { Locator, Page } from "@playwright/test";
import { buildContentRedirects } from "../src/lib/content-redirects";
import {
  buildAdjacentContentQuery,
  resolveAdjacentContent,
  selectAdjacentRecords,
} from "../src/lib/content-listing";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { resolveStoryRoute } from "../src/lib/content-routes";
import { mockContentListingRecords } from "../src/lib/mock-content-listing";
import { mockContentPages } from "../src/lib/mock-content-pages";
import {
  mockContentRedirectInputs,
  mockContentTreeInputs,
} from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
  REDUNDANT_DEFAULT_PREFIX,
} from "./support/harness-environment";

/**
 * The public content tree: branch routes, canonical detail routes, breadcrumbs,
 * and the URL contract around them.
 *
 * Nothing here names a category, a page title, or a label. A clone rebrands its
 * whole taxonomy, so the journey discovers the tree by walking it from the
 * story root and asserts the structure a clone must keep: ancestry that matches
 * the path, one canonical address per listed page, keyboard-operable links,
 * alternates that name the other locale's version, and honest answers — a
 * permanent redirect, or a 404 — for paths the tree does not serve.
 *
 * The route spaces come from the harness settings rather than from this file,
 * so the suite and the application under test cannot disagree about where the
 * tree is published.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const PREFIXED_STORY_ROOT = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`;

/** One real redirect from the deterministic content adapter the harness runs. */
function retiredDefaultRoute(): { readonly from: string; readonly to: string } {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  const redirects = buildContentRedirects(
    tree,
    mockContentRedirectInputs[language] ?? [],
  );
  for (const [previousPath, currentPath] of redirects) {
    if (resolveStoryRoute(tree, currentPath)?.kind === "content") {
      return {
        from: `${STORY_ROOT}/${previousPath}`,
        to: `${STORY_ROOT}/${currentPath.join("/")}`,
      };
    }
  }

  throw new Error("[e2e] The harness needs one retired article path.");
}

const RETIRED_DEFAULT_ROUTE = retiredDefaultRoute();

/**
 * One real category redirect from the deterministic content adapter. The
 * content-page redirect above already proves the registry for a `content`
 * kind; category renames are recorded and resolved the same way but were
 * never exercised end to end, so this walks the same registry filtered to a
 * `category` target instead.
 */
function retiredCategoryRoute(): { readonly from: string; readonly to: string } {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  const redirects = buildContentRedirects(
    tree,
    mockContentRedirectInputs[language] ?? [],
  );
  for (const [previousPath, currentPath] of redirects) {
    if (resolveStoryRoute(tree, currentPath)?.kind === "category") {
      return {
        from: `${STORY_ROOT}/${previousPath}`,
        to: `${STORY_ROOT}/${currentPath.join("/")}`,
      };
    }
  }

  throw new Error("[e2e] The harness needs one retired category path.");
}

const RETIRED_CATEGORY_ROUTE = retiredCategoryRoute();

/**
 * One published article's canonical path, derived from the same adapter data
 * the harness serves rather than written down here.
 *
 * Three properties are required rather than assumed. The variant matters,
 * because this journey is about the article page — its body, its table of
 * contents, and its sibling navigation — while the curated gallery route has
 * its own suite in `gallery-lightbox.spec.ts`. The page must also have a
 * sibling in the global article sequence, so the navigation this story had to
 * carry over is exercised rather than skipped as absent. Finally, the cover
 * carries an attribution so this journey proves the cover figure itself keeps
 * it rather than passing on a body caption alone.
 */
type ArticleUnderTest = {
  readonly path: string;
  readonly siblingPaths: readonly string[];
  readonly coverAttributions: readonly string[];
  /**
   * Every caption and credit the page's images carry, from the adapter data.
   * The page must show each of them: an image with a credit is showing someone
   * else's name, and a surface that drops it publishes uncredited work.
   */
  readonly attributions: readonly string[];
};

function firstDefaultLocaleArticleWithSibling(): ArticleUnderTest {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  const records = mockContentListingRecords[language];
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "article") continue;
    const path = getCanonicalContentPath(tree, contentId);
    const query = buildAdjacentContentQuery(tree, contentId);
    if (path === null || query === null) continue;

    const candidateRows = query.contentIds.flatMap((candidateId) => {
      const record = records?.get(candidateId);
      return record === undefined ? [] : [record];
    });
    const adjacent = resolveAdjacentContent({
      tree,
      contentId,
      records: selectAdjacentRecords(candidateRows, query.anchorContentId),
    });
    const siblingPaths = [adjacent.previous, adjacent.next].flatMap((sibling) =>
      sibling === undefined ? [] : [`${STORY_ROOT}/${sibling.path.join("/")}`],
    );
    if (siblingPaths.length === 0) continue;

    const images = [
      ...(page.cover === undefined ? [] : [page.cover]),
      ...page.body.flatMap((block) =>
        block.type === "media" && block.media.type === "image"
          ? [block.media]
          : [],
      ),
    ];
    const coverAttributions =
      page.cover === undefined
        ? []
        : [page.cover.caption, page.cover.credit].filter(
            (text): text is string =>
              text !== undefined && text.length > 0,
          );
    if (coverAttributions.length === 0) continue;

    return {
      path: `${STORY_ROOT}/${path.join("/")}`,
      siblingPaths,
      coverAttributions,
      attributions: images.flatMap((image) =>
        [image.caption, image.credit].filter(
          (text): text is string => text !== undefined && text.length > 0,
        ),
      ),
    };
  }

  throw new Error(
    "[e2e] The harness needs an article with a sibling and an attributed cover.",
  );
}

const ARTICLE = firstDefaultLocaleArticleWithSibling();
const ARTICLE_ROUTE = ARTICLE.path;

type LocalizedArticleUnderTest = {
  readonly path: string;
  readonly exactDefaultLocalePath: string;
  readonly imageAlts: readonly string[];
  readonly coverAlt: string;
  readonly publishedAt: string;
};

/** One translated article whose cover and body both carry localized image text. */
function firstPrefixedLocaleArticleWithImages(): LocalizedArticleUnderTest {
  const language = new Intl.Locale(PREFIXED_LOCALE.prefix).language;
  const treeInput = mockContentTreeInputs[language];
  const defaultLanguage = new Intl.Locale(
    appUnderTestEnvironment.SITE_LOCALE,
  ).language;
  const defaultTreeInput = mockContentTreeInputs[defaultLanguage];
  if (treeInput === undefined || defaultTreeInput === undefined) {
    throw new Error("[e2e] The harness needs both localized content trees.");
  }

  const tree = buildContentTree(treeInput);
  const defaultTree = buildContentTree(defaultTreeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "article" || page.cover === undefined) continue;

    const path = getCanonicalContentPath(tree, contentId);
    const defaultPath = getCanonicalContentPath(defaultTree, contentId);
    const bodyImageAlts = page.body.flatMap((block) =>
      block.type === "media" && block.media.type === "image"
        ? [block.media.alt]
        : [],
    );
    if (path === null || defaultPath === null || bodyImageAlts.length === 0) {
      continue;
    }

    return {
      path: `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}/${path.join("/")}`,
      exactDefaultLocalePath: `${STORY_ROOT}/${defaultPath.join("/")}`,
      imageAlts: [page.cover.alt, ...bodyImageAlts],
      coverAlt: page.cover.alt,
      publishedAt: page.publishedAt,
    };
  }

  throw new Error(
    "[e2e] The harness needs a translated article with cover and body images.",
  );
}

type BlockRichArticleUnderTest = {
  readonly path: string;
  readonly quote: string;
  readonly listItem: string;
  readonly mediaAlt: string;
  readonly videoId: string;
  readonly videoTitle: string;
};

/** One article exercising every body-block variant, including opt-in video. */
function firstDefaultLocaleBlockRichArticle(): BlockRichArticleUnderTest {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "article") continue;
    const path = getCanonicalContentPath(tree, contentId);
    const quote = page.body.find((block) => block.type === "blockquote");
    const list = page.body.find((block) => block.type === "list");
    const media = page.body.find(
      (block) => block.type === "media" && block.media.type === "image",
    );
    const video = page.body.find((block) => block.type === "youtube");
    if (
      path === null ||
      quote?.type !== "blockquote" ||
      list?.type !== "list" ||
      list.items[0] === undefined ||
      media?.type !== "media" ||
      media.media.type !== "image" ||
      video?.type !== "youtube"
    ) {
      continue;
    }

    return {
      path: `${STORY_ROOT}/${path.join("/")}`,
      quote: quote.text,
      listItem: list.items[0],
      mediaAlt: media.media.alt,
      videoId: video.videoId,
      videoTitle: video.title,
    };
  }

  throw new Error("[e2e] The harness needs one block-rich article.");
}

const LOCALIZED_ARTICLE = firstPrefixedLocaleArticleWithImages();
const BLOCK_RICH_ARTICLE = firstDefaultLocaleBlockRichArticle();

/** The scaffold routes AB#124 removed outright rather than redirecting. */
const REMOVED_SCAFFOLD_ROUTES = ["/blog", "/blog/any-old-slug"];

/** A listing card: the only links in main that carry a level-three heading. */
function contentCards(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { level: 3 }) });
}

/** Links deeper into the tree: inside the namespace, and not a listing card. */
function branchLinks(page: Page): Locator {
  return page
    .getByRole("main")
    .locator(`a[href^="${STORY_ROOT}/"]`)
    .filter({ hasNot: page.getByRole("heading", { level: 3 }) });
}

/**
 * Breadcrumb steps. The separators are `aria-hidden`, so they are not list
 * items in the accessibility tree and do not inflate the count.
 */
function breadcrumbSteps(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("navigation")
    .first()
    .getByRole("listitem");
}

async function hrefOf(link: Locator): Promise<string> {
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  return href as string;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every branch reachable from the story root, discovered rather than listed.
 * The visited set bounds the walk, so a tree of any shape terminates.
 */
async function crawlBranches(page: Page): Promise<readonly string[]> {
  const visited = new Set<string>();
  const queue: string[] = [STORY_ROOT];

  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (visited.has(path)) continue;
    visited.add(path);

    await page.goto(path, { waitUntil: "domcontentloaded" });
    for (const link of await branchLinks(page).all()) {
      const href = await hrefOf(link);
      if (!visited.has(href)) queue.push(href);
    }
  }

  visited.delete(STORY_ROOT);
  const branches = [...visited].sort();
  expect(branches.length).toBeGreaterThan(0);
  return branches;
}

test("the story root leads into a branch that states its own ancestry", async ({
  page,
  externalRequests,
}) => {
  await page.goto(STORY_ROOT, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await contentCards(page).count()).toBeGreaterThan(0);

  const firstBranch = branchLinks(page).first();
  await expect(firstBranch).toHaveAccessibleName(/\S/);
  const branchPath = await hrefOf(firstBranch);

  await test.step("a keyboard alone reaches and opens the branch", async () => {
    await firstBranch.focus();
    await expect(firstBranch).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**${branchPath}`);
  });

  await test.step("its breadcrumb matches its path and marks the current page", async () => {
    // One step per path segment: the story root, then each category down to
    // and including this one.
    const depth = branchPath.split("/").filter(Boolean).length;
    const steps = breadcrumbSteps(page);

    await expect(steps).toHaveCount(depth);
    await expect(steps.first().getByRole("link")).toHaveAttribute(
      "href",
      STORY_ROOT,
    );
    // The page the visitor is on is text, not a link back to itself.
    await expect(steps.last().getByRole("link")).toHaveCount(0);
    await expect(
      page.getByRole("main").locator("[aria-current='page']"),
    ).toHaveCount(1);
  });

  await test.step("it declares itself canonical at the URL it was served at", async () => {
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
      "href",
      new RegExp(`${escapeForRegExp(branchPath)}$`),
    );
  });

  expect(externalRequests).toEqual([]);
});

test("a listed page has one canonical address wherever it appears", async ({
  page,
}) => {
  // ADR-0003 gives content one detail route. A page listed in a second category
  // links to that same route rather than to a copy beneath the second one.
  const addresses = new Map<string, Set<string>>();

  for (const branch of await crawlBranches(page)) {
    await page.goto(branch, { waitUntil: "domcontentloaded" });

    for (const card of await contentCards(page).all()) {
      const name = (await card.textContent())?.trim() ?? "";
      const href = await hrefOf(card);
      expect(href.startsWith(`${STORY_ROOT}/`)).toBe(true);
      addresses.set(name, (addresses.get(name) ?? new Set<string>()).add(href));
    }
  }

  expect(addresses.size).toBeGreaterThan(0);
  for (const [name, hrefs] of addresses) {
    expect(
      [...hrefs],
      `one canonical address is expected for ${JSON.stringify(name)}`,
    ).toHaveLength(1);
  }
});

test("a content page opens from its listing and states where it lives", async ({
  page,
  externalRequests,
}) => {
  const categoryPath = ARTICLE_ROUTE.slice(0, ARTICLE_ROUTE.lastIndexOf("/"));

  await test.step("a keyboard alone reaches the page from its category", async () => {
    await page.goto(categoryPath, { waitUntil: "domcontentloaded" });

    const card = page.getByRole("main").locator(`a[href="${ARTICLE_ROUTE}"]`);
    await expect(card).toHaveCount(1);
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**${ARTICLE_ROUTE}`);
  });

  await test.step("it renders as one titled, dated document", async () => {
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main").locator("time").first()).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}/,
    );
  });

  await test.step("its breadcrumb follows canonical ancestry to itself", async () => {
    // One step per path segment: the story root, each category, then the page.
    const depth = ARTICLE_ROUTE.split("/").filter(Boolean).length;
    const steps = breadcrumbSteps(page);

    await expect(steps).toHaveCount(depth);
    await expect(steps.first().getByRole("link")).toHaveAttribute(
      "href",
      STORY_ROOT,
    );
    await expect(steps.nth(depth - 2).getByRole("link")).toHaveAttribute(
      "href",
      categoryPath,
    );
    await expect(steps.last().getByRole("link")).toHaveCount(0);
    await expect(
      page.getByRole("main").locator("[aria-current='page']"),
    ).toHaveCount(1);
  });

  await test.step("it declares itself canonical at its one address", async () => {
    // The keyboard step above proves the client navigation. Canonical metadata
    // is a document-response contract, so verify it on a direct load rather
    // than coupling the assertion to Next's transient head reconciliation
    // while the old category document is being replaced.
    await page.reload({ waitUntil: "domcontentloaded" });
    const canonical = page.locator(
      `link[rel='canonical'][href$="${ARTICLE_ROUTE}"]`,
    );
    await expect(canonical).toHaveCount(1);
    await expect(page.locator("link[rel='canonical']")).toHaveCount(1);
  });

  await test.step("its body renders, and its cover keeps its attribution", async () => {
    const body = page.getByRole("main");
    await expect(body.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect(body.locator("p").first()).toHaveText(/\S/);
    const coverFigure = body.locator("article > figure").first();
    await expect(coverFigure.locator("img")).toBeVisible();

    const coverCaption = await coverFigure.locator("figcaption").textContent();
    for (const attribution of ARTICLE.coverAttributions) {
      expect(coverCaption, `the cover must show "${attribution}"`).toContain(
        attribution,
      );
    }

    // The expected text comes from the same adapter data the harness serves, so
    // the assertion is about what the page owes each image rather than about
    // wording a clone would replace.
    expect(ARTICLE.attributions.length).toBeGreaterThan(0);
    const captions = (
      await body.locator("figcaption").allTextContents()
    ).join("\n");

    for (const attribution of ARTICLE.attributions) {
      expect(captions, `the page must show "${attribution}"`).toContain(
        attribution,
      );
    }
  });

  await test.step("its table of contents jumps to a heading in the body", async () => {
    const contents = page
      .getByRole("main")
      .getByRole("navigation")
      .filter({ has: page.locator("a[href^='#']") });
    await expect(contents).toHaveCount(1);

    const first = contents.getByRole("link").first();
    const fragment = await hrefOf(first);
    expect(fragment.startsWith("#")).toBe(true);

    // The anchor the link names has to be a heading that actually exists —
    // the failure a derived table of contents exists to prevent.
    const target = page.locator(`h2${fragment.replace("#", "#")}`);
    await expect(target).toHaveCount(1);

    await first.focus();
    await page.keyboard.press("Enter");
    await expect(target).toBeInViewport();
  });

  await test.step("it links a neighbour in the global article sequence", async () => {
    const siblings = page
      .getByRole("main")
      .getByRole("navigation")
      .filter({ has: page.locator(`a[href^="${STORY_ROOT}/"]`) })
      .last();

    const sibling = siblings.getByRole("link").first();
    await expect(sibling).toHaveAccessibleName(/\S/);

    const siblingPath = await hrefOf(sibling);
    expect(siblingPath).not.toBe(ARTICLE_ROUTE);
    expect(ARTICLE.siblingPaths).toContain(siblingPath);

    await sibling.click();
    await page.waitForURL(`**${siblingPath}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  await test.step("an unrecognized parameter leaves the page alone", async () => {
    // A content page owns no continuation contract, so `cursor` is just another
    // parameter arriving from a campaign or messaging app.
    const response = await page.goto(`${ARTICLE_ROUTE}?cursor=not-a-real-token`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  expect(externalRequests).toEqual([]);
});

test("a localized article keeps localized media and article metadata", async ({
  page,
}) => {
  const response = await page.goto(LOCALIZED_ARTICLE.path, {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    new RegExp(`^${PREFIXED_LOCALE.prefix}\\b`),
  );

  const imageAlts = await page
    .locator("main article figure img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("alt")));
  expect(imageAlts).toEqual(LOCALIZED_ARTICLE.imageAlts);
  await expect(page.locator("meta[property='og:image:alt']")).toHaveAttribute(
    "content",
    LOCALIZED_ARTICLE.coverAlt,
  );
  await expect(page.locator("meta[property='og:type']")).toHaveAttribute(
    "content",
    "article",
  );
  await expect(
    page.locator("meta[property='article:published_time']"),
  ).toHaveAttribute("content", LOCALIZED_ARTICLE.publishedAt);

  const exactLanguageLink = page
    .getByRole("main")
    .locator(`a[hreflang="${appUnderTestEnvironment.SITE_LOCALE}"]`);
  await expect(exactLanguageLink).toHaveAttribute(
    "href",
    LOCALIZED_ARTICLE.exactDefaultLocalePath,
  );
  await expect(exactLanguageLink).not.toHaveAttribute("aria-describedby", /.+/);
});

test("a block-rich article stays private until video opt-in", async ({
  page,
  externalRequests,
}) => {
  await page.route("https://www.youtube-nocookie.com/**", async (route) => {
    await route.fulfill({ contentType: "text/html", body: "" });
  });

  await page.goto(BLOCK_RICH_ARTICLE.path, { waitUntil: "domcontentloaded" });
  const article = page.locator("main article");

  await expect(article.getByText(BLOCK_RICH_ARTICLE.quote, { exact: true })).toBeVisible();
  await expect(
    article.getByText(BLOCK_RICH_ARTICLE.listItem, { exact: true }),
  ).toBeVisible();
  await expect(article.getByAltText(BLOCK_RICH_ARTICLE.mediaAlt)).toBeVisible();
  await expect(
    article.getByText(BLOCK_RICH_ARTICLE.videoTitle, { exact: true }),
  ).toBeVisible();
  await expect(article.locator("iframe")).toHaveCount(0);
  expect(externalRequests).toEqual([]);

  const fallbackLanguageLink = article.locator(
    `a[hreflang="${PREFIXED_LOCALE.prefix}"]`,
  );
  const noteId = await fallbackLanguageLink.getAttribute("aria-describedby");
  expect(noteId).toBeTruthy();
  await expect(page.locator(`#${noteId}`)).toHaveText(/\S/);

  await article.getByRole("button").click();
  await expect(article.locator("iframe")).toHaveAttribute(
    "src",
    new RegExp(`/embed/${BLOCK_RICH_ARTICLE.videoId}\\?autoplay=1$`),
  );
  expect(externalRequests).toEqual([]);
});

test("the removed article scaffold routes are gone, not redirected", async ({
  page,
}) => {
  // AB#124 removed `/blog` and `/blog/<slug>` rather than redirecting them:
  // they were never deployed or indexed, so nobody holds those URLs, and only
  // the verified production inventory earns a place in the redirect registry.
  for (const path of REMOVED_SCAFFOLD_ROUTES) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });

    expect(response?.status(), `${path} is expected to be gone`).toBe(404);
    expect(new URL(page.url()).pathname).toBe(path);
  }
});

test("a branch names and links the other locale's version of itself", async ({
  page,
}) => {
  await page.goto(STORY_ROOT, { waitUntil: "domcontentloaded" });

  const alternates = page.locator("link[rel='alternate'][hreflang]");
  const hrefs = await alternates.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );

  expect(hrefs.some((href) => href.endsWith(STORY_ROOT))).toBe(true);
  expect(hrefs.some((href) => href.endsWith(PREFIXED_STORY_ROOT))).toBe(true);
  await expect(page.locator("meta[property='og:image:alt']")).toHaveCount(1);

  await test.step("the switch is navigation a visitor can see and use", async () => {
    const switchLink = page
      .getByRole("main")
      .locator(`a[href="${PREFIXED_STORY_ROOT}"]`);
    await expect(switchLink).toHaveCount(1);
    const languageSwitch = page
      .getByRole("main")
      .locator(`nav:has(a[href="${PREFIXED_STORY_ROOT}"])`);
    await expect(languageSwitch).toHaveCount(1);
    await expect(languageSwitch.locator(":scope > span")).toBeVisible();

    await switchLink.click();
    await page.waitForURL(`**${PREFIXED_STORY_ROOT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      new RegExp(`^${PREFIXED_LOCALE.prefix}\\b`),
    );
    await expect(page.locator("meta[property='og:image:alt']")).toHaveCount(0);
    expect(await contentCards(page).count()).toBeGreaterThan(0);
  });

  await test.step("a differently cased locale prefix normalizes in that locale", async () => {
    await page.goto(
      `/${PREFIXED_LOCALE.prefix.toUpperCase()}/${PREFIXED_LOCALE.storyNamespace}`,
      { waitUntil: "domcontentloaded" },
    );

    expect(new URL(page.url()).pathname).toBe(PREFIXED_STORY_ROOT);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      new RegExp(`^${PREFIXED_LOCALE.prefix}\\b`),
    );
  });
});

test("a path the tree does not serve answers honestly", async ({ page }) => {
  const [branch] = await crawlBranches(page);

  await test.step("a casing variant redirects to the canonical path", async () => {
    await page.goto(branch.toUpperCase(), { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe(branch);
  });

  await test.step("the redundant default-locale prefix redirects away", async () => {
    await page.goto(`/${REDUNDANT_DEFAULT_PREFIX}${branch}`, {
      waitUntil: "domcontentloaded",
    });
    expect(new URL(page.url()).pathname).toBe(branch);
  });

  await test.step("an unknown branch is a 404, not a guess at an ancestor", async () => {
    const response = await page.goto(`${branch}/no-such-branch`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe(`${branch}/no-such-branch`);
  });

  await test.step("a continuation token nothing issued is a 404", async () => {
    const response = await page.goto(`${branch}?cursor=not-a-real-token`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(404);
  });

  await test.step("a cursor on a casing variant is a 404 without a redirect", async () => {
    const requestedPath = branch.toUpperCase();
    const response = await page.goto(`${requestedPath}?cursor=not-a-real-token`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe(requestedPath);
  });

  await test.step("an unrecognized parameter is ignored, not redirected on", async () => {
    const response = await page.goto(`${branch}?utm_source=newsletter`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(200);
    expect(page.url()).toContain("utm_source=newsletter");
  });
});

test("a retired path leads to the page's current one in a single redirect", async ({
  page,
}) => {
  // The path pair is derived from the same deterministic adapter data the
  // harness serves. The test therefore exercises actual recorded history
  // without restating a category slug or target in the journey.
  const redirects: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().isNavigationRequest() &&
      (response.status() === 308 || response.status() === 301)
    ) {
      redirects.push(new URL(response.url()).pathname);
    }
  });

  await page.goto(RETIRED_DEFAULT_ROUTE.from, {
    waitUntil: "domcontentloaded",
  });

  expect(redirects).toHaveLength(1);
  expect(new URL(page.url()).pathname).toBe(RETIRED_DEFAULT_ROUTE.to);
});

test("a retired category path leads to the branch's current one in a single redirect", async ({
  page,
}) => {
  const redirects: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().isNavigationRequest() &&
      (response.status() === 308 || response.status() === 301)
    ) {
      redirects.push(new URL(response.url()).pathname);
    }
  });

  await page.goto(RETIRED_CATEGORY_ROUTE.from, {
    waitUntil: "domcontentloaded",
  });

  expect(redirects).toHaveLength(1);
  expect(new URL(page.url()).pathname).toBe(RETIRED_CATEGORY_ROUTE.to);

  // Landed on a working branch, not merely a URL: the redirect target is a
  // real category page with its own heading and breadcrumb, not a dead end.
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(breadcrumbSteps(page).last().getByRole("link")).toHaveCount(0);
});
