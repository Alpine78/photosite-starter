import type { Page } from "@playwright/test";
import { CONTENT_LISTING_ORDERING, MAX_CONTENT_LISTING_PAGE_SIZE } from "../src/lib/content-listing";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { createHmacKeysetCursorCodec } from "../src/lib/keyset-cursor";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";

/**
 * The authored event date journey (AB#150, ADR-0017): the ordering key that
 * replaces `publishedAt`, its cursor migration, and the scheduled `endDate`
 * auto-hide.
 *
 * Everything here runs **without JavaScript**, matching this suite's other
 * content-tree journeys — the properties under test (listing order, a 404, a
 * sitemap entry) are all server responses, not client behaviour.
 */

test.use({ javaScriptEnabled: false });

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const locale = appUnderTestEnvironment.SITE_LOCALE;

/** The mock's raw English tree, just to resolve a fixture's authored canonical path. */
const englishTree = buildContentTree(mockContentTreeInputs.en);

function pathOf(contentId: string): string {
  const segments = getCanonicalContentPath(englishTree, contentId);
  if (segments === null) {
    throw new Error(`no canonical path for "${contentId}" in the mock tree`);
  }
  return `${STORY_ROOT}/${segments.join("/")}`;
}

/** Every listing card's detail-route href, in document order (as `category-continuation.spec.ts` reads them). */
function cardHrefs(page: Page) {
  return page
    .getByRole("main")
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { level: 3 }) });
}

async function hrefsOn(page: Page): Promise<string[]> {
  const links = cardHrefs(page);
  const count = await links.count();
  const hrefs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    hrefs.push((await links.nth(index).getAttribute("href")) ?? "");
  }
  return hrefs;
}

test("a page published out of order in event-date terms lands in its real-world position", async ({
  page,
}) => {
  // `content-reading-coastal-light` authors `eventDate: 2025-03-15`, well
  // after its own `publishedAt` (2024-08-02) and after every other page's
  // effective date at the story root — including `content-selected-work`
  // (2025-01-15, no `eventDate`), which is *newer by publish order* but
  // *older by effective event date*. Ordering by `publishedAt` would have put
  // selected-work first; ordering by the effective event date puts
  // reading-coastal-light first instead.
  const reorderedPath = pathOf("content-reading-coastal-light");
  const olderByEventDatePath = pathOf("content-selected-work");

  await page.goto(STORY_ROOT, { waitUntil: "domcontentloaded" });
  const hrefs = await hrefsOn(page);

  const reorderedIndex = hrefs.indexOf(reorderedPath);
  const olderIndex = hrefs.indexOf(olderByEventDatePath);
  expect(reorderedIndex).toBeGreaterThanOrEqual(0);
  expect(olderIndex).toBeGreaterThanOrEqual(0);
  expect(reorderedIndex).toBeLessThan(olderIndex);
});

test.describe("a cursor minted under the pre-migration ordering rule is a 404", () => {
  /**
   * `content-listing-cursor.ts` always mints under the current
   * `CONTENT_LISTING_ORDERING`, so there is no way to obtain a genuinely
   * pre-migration cursor from the running app — this mints one directly with
   * the low-level codec the seam wraps, using the harness's own signing key
   * (`gallery-continuation.spec.ts` establishes the same pattern for its own
   * manually-minted cursors) and the historical `published-desc-v1` ordering
   * value ADR-0017 retired.
   */
  test("404s rather than silently serving a position under the new order", async ({
    page,
  }) => {
    expect(CONTENT_LISTING_ORDERING).toBe("event-date-desc-v1");

    const legacyCodec = createHmacKeysetCursorCodec(
      appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
    );
    const legacyCursor = legacyCodec.encode(
      {
        sourceId: "content-listing",
        normalizedFilter: `${locale} cat-gear`,
        ordering: "published-desc-v1",
        visibilityVersion: "irrelevant-to-a-wrong-scope-ordering-mismatch",
        pageSize: MAX_CONTENT_LISTING_PAGE_SIZE,
      },
      "2024-01-01",
      "content-x",
    );

    // `cat-gear` is the branch `category-continuation.spec.ts` already proves
    // is long enough to continue, so this cursor's shape is otherwise valid —
    // only its ordering scope is stale.
    const response = await page.goto(`${STORY_ROOT}/gear?cursor=${legacyCursor}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(404);
  });
});

test.describe("a page whose scheduled endDate has passed is fully unpublished", () => {
  // Permanently-past `endDate`s (`mock-content-listing.ts`), so this state is
  // one the site actually serves rather than one only a unit test constructs.
  const endedGalleryPath = pathOf("content-ended-gallery");
  const endedArticlePath = pathOf("content-ended-article");

  test("its own detail route 404s", async ({ page }) => {
    for (const path of [endedGalleryPath, endedArticlePath]) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${path} should 404`).toBe(404);
    }
  });

  test("it is absent from its own category's listing", async ({ page }) => {
    // Both fixtures are canonically placed in small branches — well under one
    // page — so an ordinary listing would otherwise show them; their absence
    // here is the `endDate` gate, not the page-size bound the story root's own
    // recency cutoff could also explain.
    await page.goto(`${STORY_ROOT}/portfolio`, { waitUntil: "domcontentloaded" });
    expect(await hrefsOn(page)).not.toContain(endedGalleryPath);

    await page.goto(`${STORY_ROOT}/technique`, { waitUntil: "domcontentloaded" });
    expect(await hrefsOn(page)).not.toContain(endedArticlePath);
  });

  test("it is absent from the sitemap", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    const body = await response.text();
    expect(body).not.toContain(endedGalleryPath);
    expect(body).not.toContain(endedArticlePath);
  });
});
