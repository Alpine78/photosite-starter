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
import { openLightbox } from "./support/lightbox";

/**
 * The gallery append journey: continuing *in place*, with JavaScript.
 *
 * The unenhanced half lives in `gallery-continuation.spec.ts`, where the same
 * control is a real link that navigates. This file covers what script adds on
 * top of it (AB#72): the next slice arrives in the page a visitor is already
 * on, the lightbox keeps going past the slice it was opened from, and a failure
 * on either path leaves everything already loaded exactly where it was.
 *
 * Items are identified by the result identity the grid carries in the DOM,
 * never by caption or alt text, because a clone rewrites all of those.
 */

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

function mockPage(language: string, contentId: string) {
  return getMockGalleryResult(language, contentId, {
    cursorCodec: harnessCursorCodec,
  });
}

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const galleryLabels = labels.gallery;

/** A gallery whose first page is not its last, found in the adapter data. */
function paginatedGallery(): {
  readonly path: string;
  readonly pageSize: number;
  /** Every item it holds, so the walk to the end knows where the end is. */
  readonly totalItems: number;
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
      let total = result.items.length;
      let cursor = result.page.endCursor as string | null;
      while (cursor !== null) {
        const next = getMockGalleryResult(language, contentId, {
          cursor,
          cursorCodec: harnessCursorCodec,
        });
        if (next === undefined) break;
        total += next.items.length;
        cursor = next.page.hasNextPage ? next.page.endCursor : null;
      }

      return {
        path: `${STORY_ROOT}/${path.join("/")}`,
        pageSize: result.page.size,
        totalItems: total,
      };
    }
  }

  throw new Error("[e2e] The harness needs one gallery larger than a single page.");
}

const GALLERY = paginatedGallery();

/** Every result identity the grid is presenting, once it has settled. */
function gridItems(page: import("@playwright/test").Page) {
  return page.getByRole("main").locator("[data-item-id]");
}

async function presentedItemIds(page: import("@playwright/test").Page) {
  return gridItems(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-item-id") ?? ""),
  );
}

const continueControl = (page: import("@playwright/test").Page) =>
  page.getByRole("link", { name: galleryLabels.showMore });

test("the next slice arrives in the page rather than replacing it", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  await continueControl(page).click();
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);

  const items = await presentedItemIds(page);

  // No duplicates, and the second slice follows the first rather than
  // rearranging it: a visitor's scroll position must keep meaning what it did.
  expect(new Set(items).size).toBe(items.length);
  expect(items.slice(0, GALLERY.pageSize)).toEqual(
    items.slice(0, GALLERY.pageSize).toSorted(),
  );

  // The address is deliberately untouched: it still names the first page, which
  // is what a reload would honestly restore.
  expect(new URL(page.url()).search).toBe("");
});

test("focus stays on the control a visitor activated", async ({ page }) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  await continueControl(page).press("Enter");
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);

  // Keyboard continuation that dropped focus to the body would lose a visitor's
  // place in a gallery that just grew by a whole page.
  await expect(continueControl(page)).toBeFocused();
});

test("a failed continuation keeps what is loaded and can be retried", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  // One failure, then the real endpoint again — so the retry exercises recovery
  // rather than a second stub.
  let failNext = true;
  await page.route("**/api/gallery**", async (route) => {
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, body: "" });
      return;
    }
    await route.fallback();
  });

  await continueControl(page).click();

  // The failure is announced, nothing already loaded is discarded, and the
  // control offers the retry rather than disappearing.
  await expect(page.getByRole("status")).toHaveText(galleryLabels.loadFailed);
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  const retry = page.getByRole("link", { name: galleryLabels.retry });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);
});

test("the lightbox navigates every item the grid has loaded", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await continueControl(page).click();
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);

  const items = await presentedItemIds(page);

  // Opening an item from the appended slice proves the lightbox is reading the
  // grown list rather than the slice it was first rendered with. Opened by
  // keyboard, so focus ends inside the dialog and Escape reaches it.
  const dialog = page.getByRole("dialog");
  const opener = gridItems(page).nth(GALLERY.pageSize);
  await openLightbox(dialog, async () => {
    await opener.focus();
    await page.keyboard.press("Enter");
  });

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");

  // Focus returns to the trigger for the item the visitor ended on, which is
  // the one before the one they opened.
  await expect(
    page.locator(`[data-item-id="${items[GALLERY.pageSize - 1]}"]`),
  ).toBeFocused();
});

test("an open lightbox continues past the last loaded item", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  // Open the last item the grid holds, so the next navigation would otherwise
  // run out of gallery.
  const dialog = page.getByRole("dialog");
  const last = gridItems(page).nth(GALLERY.pageSize - 1);
  await openLightbox(dialog, async () => {
    await last.focus();
    await page.keyboard.press("Enter");
  });

  // Reaching the end asks for one more slice — and only then. The grid behind
  // the dialog grows, which is what makes the extra slides reachable.
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);

  // And the viewer keeps going rather than stopping at the old boundary.
  await page.keyboard.press("ArrowRight");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a failed continuation does not close the lightbox or lose the item", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  await page.route("**/api/gallery**", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );

  const items = await presentedItemIds(page);
  const dialog = page.getByRole("dialog");
  const last = gridItems(page).nth(GALLERY.pageSize - 1);
  await openLightbox(dialog, async () => {
    await last.focus();
    await page.keyboard.press("Enter");
  });

  // The fetch fails behind the open viewer. A visitor keeps the photograph they
  // were looking at: losing their place over a network blip would be worse than
  // simply not growing.
  await expect(dialog).toBeVisible();
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  await page.keyboard.press("Escape");
  await expect(
    page.locator(`[data-item-id="${items[GALLERY.pageSize - 1]}"]`),
  ).toBeFocused();
});

test("a gallery that fits on one page offers no control at all", async ({
  page,
}) => {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const tree = buildContentTree(mockContentTreeInputs[language]!);
  let complete: string | undefined;
  for (const [contentId, content] of mockContentPages[language] ?? []) {
    if (content.variant !== "gallery") continue;
    const path = getCanonicalContentPath(tree, contentId);
    const result = mockPage(language, contentId);
    if (path !== null && result !== undefined && !result.page.hasNextPage) {
      complete = `${STORY_ROOT}/${path.join("/")}`;
      break;
    }
  }
  expect(complete).toBeTruthy();

  await page.goto(complete ?? "", { waitUntil: "load" });

  await expect(continueControl(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: galleryLabels.retry }),
  ).toHaveCount(0);
});

test("the control says it is working while a slice is in flight", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  // Held open until the assertions below have seen the in-flight state, then
  // released — so the loading state is observed rather than raced past.
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gallery**", async (route) => {
    await held;
    await route.fallback();
  });

  await continueControl(page).click();

  const control = page.getByRole("link", { name: galleryLabels.loadingMore });
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute("aria-busy", "true");

  release?.();
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);
  await expect(continueControl(page)).toHaveAttribute("aria-busy", "false");
});

test("reaching the end says so and keeps focus off the document body", async ({
  page,
}) => {
  test.slow();
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  // Walk the whole gallery through the control, the way a visitor would. The
  // last activation is the one that matters: the control leaves the document,
  // and focus has to land somewhere a keyboard can continue from.
  for (let loaded = GALLERY.pageSize; loaded < GALLERY.totalItems; ) {
    await continueControl(page).click();
    loaded = Math.min(loaded + GALLERY.pageSize, GALLERY.totalItems);
    await expect(gridItems(page)).toHaveCount(loaded);
  }

  const items = await presentedItemIds(page);
  expect(items).toHaveLength(GALLERY.totalItems);
  expect(new Set(items).size).toBe(GALLERY.totalItems);

  // Nothing left to continue to, and the page says so rather than simply
  // losing its control.
  await expect(continueControl(page)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(galleryLabels.allLoaded);
  await expect(page.getByRole("status")).toBeFocused();
});

test("a lightbox continuation failure offers its retry inside the dialog", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  // One failure, then the real endpoint, so the retry proves recovery.
  let failNext = true;
  await page.route("**/api/gallery**", async (route) => {
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, body: "" });
      return;
    }
    await route.fallback();
  });

  const dialog = page.getByRole("dialog");
  const last = gridItems(page).nth(GALLERY.pageSize - 1);
  await openLightbox(dialog, async () => {
    await last.focus();
    await page.keyboard.press("Enter");
  });

  // The grid's own control is behind this modal, so the failure has to be
  // reported — and retryable — from inside the viewer.
  const notice = dialog.locator("[data-gallery-continuation]");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(galleryLabels.loadFailed);

  await notice.getByRole("button", { name: galleryLabels.retry }).click();

  // The retry succeeds: the sequence grows, the dialog never closed, and the
  // notice takes itself away.
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);
  await expect(dialog).toBeVisible();
  await expect(notice).toBeHidden();

  await page.keyboard.press("ArrowRight");
  await expect(dialog).toBeVisible();
});
