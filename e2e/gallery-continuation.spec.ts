import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The gallery continuation journey: reaching the rest of a gallery that does
 * not fit on one page.
 *
 * Everything here runs **without JavaScript**, which is the point rather than a
 * severity setting. ADR-0003 decision 8 requires the continuation control to be
 * a real `href` that renders a bounded page on its own, so that a continuation
 * URL can be reloaded, shared, and crawled; AB#72's second slice enhances that
 * same link into an in-place append. Proving the unenhanced path works is what
 * stops the enhancement from quietly becoming the only path.
 *
 * Items are compared by the result identity the grid carries in the DOM, never
 * by caption or alt text. A clone rewrites all of those, and "page two is not
 * page one again" is a claim about identity anyway.
 */

/**
 * The spec reads the same fixture the server under test does, so to learn where
 * a page boundary falls it needs the same codec the seam supplies. Built from
 * the harness environment rather than from a restated key, so the suite cannot
 * drift into minting cursors the application would reject.
 */
const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

/** One page of a fixture gallery, read the way the running application reads it. */
function mockPage(language: string, contentId: string) {
  return getMockGalleryResult(language, contentId, {
    cursorCodec: harnessCursorCodec,
  });
}

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const galleryLabels = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE,
).gallery;

/**
 * A gallery whose first page is not its last, found in the adapter data rather
 * than named here.
 *
 * A clone renames every category and slug in this tree and authors its own
 * galleries, so what the journey depends on is the property — more items than
 * one page holds — and not which fixture currently has it.
 */
function paginatedDefaultLocaleGallery(): {
  readonly path: string;
  readonly pageSize: number;
  /** Full pages after the first, capped: enough to prove the boundary repeats. */
  readonly walkableHops: number;
} {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = mockPage(language, contentId);
    if (path !== null && result?.page.hasNextPage) {
      return {
        path: `${STORY_ROOT}/${path.join("/")}`,
        pageSize: result.page.size,
        walkableHops: Math.min(3, countFullPagesAfterFirst(language, contentId)),
      };
    }
  }

  throw new Error("[e2e] The harness needs one gallery larger than a single page.");
}

/**
 * How many further *full* pages this gallery has, so the walk below asserts a
 * full page on every hop without depending on how large the fixture happens to
 * be. A gallery of two-and-a-bit pages is walked once; a four-hundred-item one
 * is walked three times and no further.
 */
function countFullPagesAfterFirst(language: string, contentId: string): number {
  let cursor = mockPage(language, contentId)?.page.endCursor ?? null;
  let full = 0;

  while (cursor !== null) {
    const next = getMockGalleryResult(language, contentId, {
      cursor,
      cursorCodec: harnessCursorCodec,
    });
    if (next === undefined || next.items.length < next.page.size) break;
    full += 1;
    cursor = next.page.hasNextPage ? next.page.endCursor : null;
  }

  return full;
}

/** A gallery that fits on one page, for the cursor-scope journey below. */
function completeDefaultLocaleGallery(): string {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = mockPage(language, contentId);
    if (path !== null && result !== undefined && !result.page.hasNextPage) {
      return `${STORY_ROOT}/${path.join("/")}`;
    }
  }

  throw new Error("[e2e] The harness needs one gallery bounded to a single page.");
}

const PAGINATED = paginatedDefaultLocaleGallery();
const COMPLETE_GALLERY_PATH = completeDefaultLocaleGallery();

// The whole suite runs unenhanced. Playwright's own option is the honest way to
// say so: no script runs at all, rather than a hand-built approximation of it.
test.use({ javaScriptEnabled: false });

/** The result identities the grid is presenting, in the order it presents them. */
async function presentedItemIds(page: import("@playwright/test").Page) {
  return page
    .getByRole("main")
    .locator("[data-item-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-item-id") ?? ""),
    );
}

test("a gallery larger than one page continues without JavaScript", async ({
  page,
}) => {
  await page.goto(PAGINATED.path, { waitUntil: "domcontentloaded" });

  const firstPage = await presentedItemIds(page);
  expect(firstPage.length).toBe(PAGINATED.pageSize);

  // The label is imported rather than written out: it is application-owned copy
  // a clone may translate, so naming it here would tie the gate to wording.
  const continueLink = page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore });

  // A real href, not a button waiting for script. This is the assertion the
  // whole no-JS suite exists to make.
  await expect(continueLink).toHaveAttribute("href", /\?cursor=/);

  const seen = new Set(firstPage);
  let previous = firstPage;

  // More than one hop, so the boundary is shown to repeat rather than to work
  // once: a cursor that failed to advance, or one that restarted the gallery,
  // shows up on the second hop and not the first.
  expect(PAGINATED.walkableHops).toBeGreaterThan(1);

  for (let hop = 0; hop < PAGINATED.walkableHops; hop += 1) {
    await page
      .getByRole("main")
      .getByRole("link", { name: galleryLabels.showMore })
      .click();

    const url = new URL(page.url());
    expect(url.pathname).toBe(PAGINATED.path);
    expect(url.searchParams.get("cursor")).toBeTruthy();

    const items = await presentedItemIds(page);
    expect(items.length).toBe(PAGINATED.pageSize);

    // No duplicates and no gaps: nothing already seen comes back, and the page
    // is full, so nothing between the two slices was skipped.
    for (const itemId of items) {
      expect(seen.has(itemId)).toBe(false);
      seen.add(itemId);
    }
    expect(items).not.toEqual(previous);
    previous = items;
  }

  expect(seen.size).toBe(PAGINATED.pageSize * (PAGINATED.walkableHops + 1));
});

test("a continuation page offers the way back a cursor cannot", async ({
  page,
}) => {
  await page.goto(PAGINATED.path, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .click();

  // A continuation URL is indexable, so a visitor can arrive on a middle slice
  // straight from a search result. Cursors point forward only, so without this
  // link the items before it would be unreachable from here.
  await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.backToStart })
    .click();

  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).pathname).toBe(PAGINATED.path);
});

test("a continuation page is its own canonical address", async ({ page }) => {
  await page.goto(PAGINATED.path, { waitUntil: "domcontentloaded" });
  const nextHref = await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .getAttribute("href");
  expect(nextHref).toBeTruthy();

  await page.goto(nextHref ?? "", { waitUntil: "domcontentloaded" });

  // A distinct sequential slice, so decision 8 makes it indexable and
  // self-canonical rather than a duplicate pointing back at the first page.
  const cursor = new URL(page.url()).searchParams.get("cursor") ?? "";
  const canonical = await page
    .locator("link[rel='canonical']")
    .getAttribute("href");
  expect(canonical).toContain(PAGINATED.path);
  expect(new URL(canonical ?? "").searchParams.get("cursor")).toBe(cursor);

  // And no alternate-language set: the token is scoped to one gallery's ordering
  // in one locale, so no other locale holds an equivalent slice to point at, and
  // an `hreflang` set that is not reciprocal states a relationship that does not
  // exist. The visible language switch still leads to the other locale's first
  // page, which decision 7 requires.
  await expect(page.locator("link[rel='alternate'][hreflang]")).toHaveCount(0);
});

test("a gallery refuses a continuation token that names no slice of it", async ({
  page,
}) => {
  await test.step("a token this deployment never minted", async () => {
    const response = await page.goto(
      `${PAGINATED.path}?cursor=not-a-token-this-deployment-minted`,
      { waitUntil: "domcontentloaded" },
    );

    // Decision 8 answers a malformed, tampered, wrong-scope, or stale cursor
    // with a 404 rather than quietly serving the first page: the URL promised a
    // particular slice, and serving a different one under it is a claim a
    // crawler then indexes.
    expect(response?.status()).toBe(404);
  });

  await test.step("a real token issued by a different gallery", async () => {
    await page.goto(PAGINATED.path, { waitUntil: "domcontentloaded" });
    const nextHref = await page
      .getByRole("main")
      .getByRole("link", { name: galleryLabels.showMore })
      .getAttribute("href");
    const cursor = new URL(nextHref ?? "", page.url()).searchParams.get(
      "cursor",
    );

    // Correctly signed, genuinely issued, and still not a page here: the cursor
    // is bound to the gallery that issued it, so it cannot be replayed into
    // another one to reveal a slice of it.
    const response = await page.goto(
      `${COMPLETE_GALLERY_PATH}?cursor=${encodeURIComponent(cursor ?? "")}`,
      { waitUntil: "domcontentloaded" },
    );

    expect(response?.status()).toBe(404);
  });

  await test.step("a repeated parameter, which names no single slice", async () => {
    const response = await page.goto(
      `${PAGINATED.path}?cursor=first-token&cursor=second-token`,
      { waitUntil: "domcontentloaded" },
    );

    expect(response?.status()).toBe(404);
  });
});

test("a gallery that fits on one page offers no continuation", async ({
  page,
}) => {
  await page.goto(COMPLETE_GALLERY_PATH, { waitUntil: "domcontentloaded" });

  // Nothing to continue to, so nothing that says there is. A control that led
  // to an empty page would be worse than none at all.
  await expect(
    page.getByRole("main").getByRole("link", { name: galleryLabels.showMore }),
  ).toHaveCount(0);

  // And no way "back to the start" from a page that is the start.
  await expect(
    page.getByRole("main").getByRole("link", { name: galleryLabels.backToStart }),
  ).toHaveCount(0);
});
