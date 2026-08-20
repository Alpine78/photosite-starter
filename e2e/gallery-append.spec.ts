import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { STALE_RECOVERY_TIMEOUT_MS } from "@/components/gallery-grid";
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

async function mockPage(language: string, contentId: string) {
  return getMockGalleryResult(language, contentId, {
    cursorCodec: harnessCursorCodec,
  });
}

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const galleryLabels = labels.gallery;

/** A gallery whose first page is not its last, found in the adapter data. */
async function paginatedGallery(): Promise<{
  readonly path: string;
  readonly pageSize: number;
  /** Every item it holds, so the walk to the end knows where the end is. */
  readonly totalItems: number;
}> {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await mockPage(language, contentId);
    if (path !== null && result?.page.hasNextPage) {
      let total = result.items.length;
      let cursor = result.page.endCursor as string | null;
      while (cursor !== null) {
        const next = await getMockGalleryResult(language, contentId, {
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

/**
 * Resolved once in `beforeAll` rather than at module scope: finding it now
 * awaits a bounded gallery source (AB#134), and Playwright test files load
 * before any hook runs, so a module-scope `await` would need top-level await
 * this suite otherwise has no reason to depend on.
 */
let GALLERY: {
  readonly path: string;
  readonly pageSize: number;
  readonly totalItems: number;
};

test.beforeAll(async () => {
  GALLERY = await paginatedGallery();
});

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
    const result = await mockPage(language, contentId);
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

test("navigating to another slice of the same gallery replaces what is loaded", async ({
  page,
}) => {
  // A continuation page and the first page share one route and one component
  // position, so a client-side navigation between them can reuse the grid. If
  // it kept the slice it was mounted with, the address would say "first page"
  // while the screen showed a later one — and the continuation link built from
  // that stale cursor would skip everything before it.
  await page.goto(GALLERY.path, { waitUntil: "load" });
  const firstItems = await presentedItemIds(page);

  const nextHref = await continueControl(page).getAttribute("href");
  await page.goto(nextHref ?? "", { waitUntil: "load" });

  const continuationItems = await presentedItemIds(page);
  expect(continuationItems[0]).not.toBe(firstItems[0]);

  await page
    .getByRole("link", { name: galleryLabels.backToStart })
    .click();
  await page.waitForURL((url) => url.search === "");

  // The first page's own slice, not the one the previous render held.
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);
  expect(await presentedItemIds(page)).toEqual(firstItems);
});

test("a navigation that begins but never lands does not leave the control stuck loading forever", async ({
  page,
}) => {
  // The grid marks itself provisionally stale the moment a qualifying
  // navigation *begins* (before Next.js's own transition has even started
  // fetching), because App Router keeps the outgoing instance mounted until
  // the new page actually commits — see gallery-grid.tsx's own comment. A
  // `popstate` event is one of the two signals that marking is based on
  // (the other being a link click); dispatching one with no accompanying URL
  // change reproduces exactly what a blocked, cancelled, or failed
  // navigation looks like from this component's point of view: the "we might
  // be leaving" signal fired, but the address never actually changed.
  //
  // A response resolving *before* `STALE_RECOVERY_TIMEOUT_MS` elapses is
  // still correctly dropped — from this component's point of view a
  // genuinely still-pending navigation looks identical up to that point, and
  // `gallery-sections.spec.ts`'s own "a delayed in-flight continuation is
  // ignored once a section switch begins" test requires exactly that (that
  // test settles well inside the timeout window). What must not happen is
  // the marking becoming a one-way latch with no route back to `false` at
  // all: once the timeout elapses with no real navigation having landed, the
  // very same still-in-flight response must be able to update the UI,
  // proving the control recovers on its own rather than being stuck showing
  // "loading" text forever with no way out but a full page reload.
  await page.clock.install();
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gallery**", async (route) => {
    await held;
    await route.fallback();
  });

  const control = page.locator("a[rel='next']");
  await continueControl(page).click();
  await expect(control).toHaveAttribute("aria-busy", "true");

  const urlBeforePopstate = page.url();
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await expect(page).toHaveURL(urlBeforePopstate);

  // Advance past the recovery window before releasing the held response, so
  // the recovery timer has definitely already cleared the stale marking by
  // the time that response resolves.
  await page.clock.fastForward(STALE_RECOVERY_TIMEOUT_MS + 1000);
  release?.();

  // The same original response, not a retry, updates the grid and returns
  // the control to a non-busy state.
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);
  await expect(control).toHaveAttribute("aria-busy", "false");
});

test("a response that settles before the recovery window elapses is still reconciled once it does", async ({
  page,
}) => {
  // The far more common ordering than the previous test's: most fetches
  // settle well under `STALE_RECOVERY_TIMEOUT_MS`, so by the time a
  // navigation is confirmed abandoned, the dropped response has usually
  // already resolved and `loadNext` has already run its stale check against
  // it. Without reconciling a *preserved* outcome — rather than only
  // clearing the stale marking for some later, still-in-flight response to
  // find — this ordering would leave the control stuck exactly as
  // permanently as if no recovery existed at all.
  await page.clock.install();
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gallery**", async (route) => {
    await held;
    await route.fallback();
  });

  const control = page.locator("a[rel='next']");
  await continueControl(page).click();

  const urlBeforePopstate = page.url();
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await expect(page).toHaveURL(urlBeforePopstate);

  // The response settles shortly after the stale marking — long before the
  // recovery window elapses — and is correctly dropped, exactly like the
  // previous test's ordering, at this point. Waiting for the network
  // response itself, rather than a grid count that was already true before
  // anything happened, is what actually proves the drop occurred before the
  // clock advances below — a count assertion alone cannot tell "already
  // dropped" apart from "hasn't arrived yet".
  const responseSettled = page.waitForResponse((response) =>
    response.url().includes("/api/gallery"),
  );
  release?.();
  await responseSettled;
  // A small margin past the network response landing, for the page's own
  // promise continuation (the `isStaleRef` check inside `loadNext`) to have
  // actually run — `waitForResponse` observes the HTTP exchange, not the
  // in-page JavaScript that reacts to it.
  await page.waitForTimeout(200);
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);
  await expect(control).toHaveAttribute("aria-busy", "true");

  // Only once the recovery window elapses does the *already-settled*
  // outcome get reconciled — no second request, no retry click.
  await page.clock.fastForward(STALE_RECOVERY_TIMEOUT_MS + 1000);

  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);
  await expect(control).toHaveAttribute("aria-busy", "false");
});

test("a later failed attempt does not hide an earlier successful one reconciled in the same window", async ({
  page,
}) => {
  // Two attempts can land inside one abandoned-navigation window before
  // recovery fires: the first succeeds (dropped, same as the previous
  // test), then a second, explicit attempt on the same still-mounted
  // instance fails outright. `sliceRef.current` already advanced past both
  // — appending is what de-duplicates, so the first attempt's items are
  // never re-fetched — but only the *state* (`"idle"` vs `"failed"`) should
  // depend on which attempt was most recent. Reconciling only on the
  // latest outcome, rather than always syncing to the accumulated
  // `sliceRef.current`, would leave the first attempt's real, already-
  // fetched items permanently invisible: a plain retry click reads the
  // already-advanced cursor and would skip straight past them.
  await page.clock.install();
  await page.goto(GALLERY.path, { waitUntil: "load" });
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  let releaseFirst: (() => void) | undefined;
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let requestCount = 0;
  await page.route("**/api/gallery**", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await firstHeld;
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 503, body: "" });
  });

  const control = page.locator("a[rel='next']");
  await continueControl(page).click();

  const urlBeforePopstate = page.url();
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await expect(page).toHaveURL(urlBeforePopstate);

  const firstSettled = page.waitForResponse((response) =>
    response.url().includes("/api/gallery"),
  );
  releaseFirst?.();
  await firstSettled;
  await page.waitForTimeout(200);
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  // A second, explicit attempt on this same instance — still within the
  // recovery window, so it too is dropped, but this one fails outright.
  const secondSettled = page.waitForResponse((response) =>
    response.url().includes("/api/gallery"),
  );
  await control.click();
  await secondSettled;
  await page.waitForTimeout(200);
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize);

  await page.clock.fastForward(STALE_RECOVERY_TIMEOUT_MS + 1000);

  // The state reports the most recent attempt's own outcome (failed, so
  // the control offers a retry) — but the first attempt's real, already-
  // fetched items are visible, not hidden behind it.
  await expect(gridItems(page)).toHaveCount(GALLERY.pageSize * 2);
  await expect(page.getByRole("status")).toHaveText(galleryLabels.loadFailed);
});
