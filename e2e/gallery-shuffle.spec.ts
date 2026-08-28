import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The seeded-random gallery journey (AB#129, ADR-0009).
 *
 * Runs **without JavaScript**, for the same reason the continuation journey
 * does: the grid, its reading order, and the real continuation `href` must all
 * be there in the server-rendered document. What is proven here on top of the
 * generic continuation journey is specific to the shuffle:
 *
 * - the order the server renders is the deterministic seeded order the same
 *   fixture computes (AC2/AC4/AC8 — one authoritative order, materialized
 *   server-side, no post-hydration reorder);
 * - reloading a page renders the identical order (AC2);
 * - the pinned lead placements keep their exact manual positions (AC5);
 * - walking every page through the real link visits every placement exactly
 *   once, with no duplicate or skipped item (AC7/AC9).
 *
 * Lightbox navigation order and the responsive columns for this gallery are a
 * JavaScript concern and are covered by `gallery-content.spec.ts`'s own
 * reading-order assertions, which are gallery-agnostic.
 *
 * Items are compared by the result identity the grid carries in the DOM
 * (`data-item-id`), never by caption or alt text — a clone rewrites those.
 */

const SEEDED_GALLERY_ID = "content-shuffled-showcase";
const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const galleryLabels = labels.gallery;

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

/** The whole seeded order, read the way the running application reads it. */
async function expectedSeededOrder(language: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await getMockGalleryResult(language, SEEDED_GALLERY_ID, {
      ...(cursor === undefined ? {} : { cursor }),
      cursorCodec: harnessCursorCodec,
    });
    if (page === undefined) throw new Error("[e2e] the seeded fixture is missing");
    ids.push(...page.items.map((item) => item.itemId));
    if (!page.page.hasNextPage) return ids;
    cursor = page.page.endCursor;
  }
  throw new Error("[e2e] the seeded fixture did not terminate");
}

let LANGUAGE: string;
let GALLERY_PATH: string;
let PAGE_SIZE: number;
let EXPECTED_ORDER: string[];

test.beforeAll(async () => {
  LANGUAGE = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[LANGUAGE];
  if (treeInput === undefined) {
    throw new Error(`[e2e] the default locale ${LANGUAGE} publishes no mock tree.`);
  }
  const path = getCanonicalContentPath(buildContentTree(treeInput), SEEDED_GALLERY_ID);
  if (path === null) {
    throw new Error(`[e2e] ${SEEDED_GALLERY_ID} has no canonical path in the tree.`);
  }
  GALLERY_PATH = `${STORY_ROOT}/${path.join("/")}`;

  const first = await getMockGalleryResult(LANGUAGE, SEEDED_GALLERY_ID, {
    cursorCodec: harnessCursorCodec,
  });
  if (first === undefined || !first.page.hasNextPage) {
    throw new Error("[e2e] the seeded fixture must span more than one page.");
  }
  PAGE_SIZE = first.page.size;
  EXPECTED_ORDER = await expectedSeededOrder(LANGUAGE);
});

test.use({ javaScriptEnabled: false });

/** The result identities the grid is presenting, in presentation order. */
async function presentedItemIds(
  page: import("@playwright/test").Page,
  expectedCount: number,
) {
  const items = page.getByRole("main").locator("[data-item-id]");
  await expect(items).toHaveCount(expectedCount);
  return items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-item-id") ?? ""),
  );
}

test("renders the seeded order the fixture computes, deterministically across reloads", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });
  const firstVisit = await presentedItemIds(page, PAGE_SIZE);
  expect(firstVisit).toEqual(EXPECTED_ORDER.slice(0, PAGE_SIZE));

  // The pinned leads keep their exact manual positions at the head of the grid.
  expect(firstVisit.slice(0, 3)).toEqual([
    "shuffled-showcase-001",
    "shuffled-showcase-002",
    "shuffled-showcase-003",
  ]);

  await page.reload({ waitUntil: "domcontentloaded" });
  const secondVisit = await presentedItemIds(page, PAGE_SIZE);
  expect(secondVisit).toEqual(firstVisit);
});

test("walks every placement exactly once through the real continuation link", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });

  const seen: string[] = [];
  seen.push(...(await presentedItemIds(page, PAGE_SIZE)));

  for (let hop = 0; hop < 20; hop += 1) {
    const continueLink = page
      .getByRole("main")
      .getByRole("link", { name: galleryLabels.showMore });
    if ((await continueLink.count()) === 0) break;

    await expect(continueLink).toHaveAttribute("href", /.+/);
    await continueLink.first().click();
    await page.waitForLoadState("domcontentloaded");

    const items = page.getByRole("main").locator("[data-item-id]");
    await expect(items.first()).toBeVisible();
    seen.push(
      ...(await items.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-item-id") ?? ""),
      )),
    );
  }

  // Every item, once, in the one authoritative order — no duplicate, no gap.
  expect(seen).toEqual(EXPECTED_ORDER);
  expect(new Set(seen).size).toBe(EXPECTED_ORDER.length);
});
