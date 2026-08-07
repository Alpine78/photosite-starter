import type { Locator, Page } from "@playwright/test";
import { buildContentRedirects } from "../src/lib/content-redirects";
import { buildContentTree } from "../src/lib/content-tree";
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
 * The public content tree: branch routes, breadcrumbs, and the URL contract
 * around them.
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
  const first = redirects.entries().next().value;
  if (first === undefined) {
    throw new Error("[e2e] The harness needs one retired content path.");
  }

  const [previousPath, currentPath] = first;
  return {
    from: `${STORY_ROOT}/${previousPath}`,
    to: `${STORY_ROOT}/${currentPath.join("/")}`,
  };
}

const RETIRED_DEFAULT_ROUTE = retiredDefaultRoute();

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

    await switchLink.click();
    await page.waitForURL(`**${PREFIXED_STORY_ROOT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      new RegExp(`^${PREFIXED_LOCALE.prefix}\\b`),
    );
    await expect(page.locator("meta[property='og:image:alt']")).toHaveCount(0);
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
