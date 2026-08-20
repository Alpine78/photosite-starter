import type { Locator, Page } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { LIGHTBOX_PRELOAD_WINDOW } from "../src/lib/image-delivery";
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
 * AB#79: the lightbox loads only a small, bounded window of adjacent
 * photographs, never the whole gallery, and a failed preload neither blocks
 * the photograph on screen nor stays broken.
 *
 * The bound this suite checks is `LIGHTBOX_PRELOAD_WINDOW` itself
 * (`src/lib/image-delivery.ts`), not a number restated here, so a future
 * change to that constant changes what this suite expects rather than
 * silently drifting from it. `docs/adr/0010-lightbox-preload-window.md`
 * records the measured evidence this suite exists to keep true.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

/** One slide back, `after` forward, plus the current slide itself. */
const PRELOAD_BOUND =
  LIGHTBOX_PRELOAD_WINDOW[0] + LIGHTBOX_PRELOAD_WINDOW[1] + 1;

/**
 * A gallery whose first loaded page holds comfortably more items than the
 * preload window plus this suite's own forward-navigation steps, so a
 * bounded-window assertion is never confused with "ran out of loaded slides"
 * and forward navigation never itself crosses a page cursor (a separate,
 * already-tested mechanism — `gallery-continuation.spec.ts`,
 * `gallery-append.spec.ts`).
 *
 * Found in the adapter data rather than named here, per this suite's own
 * convention: a clone renames every category and slug in the tree, so what
 * the journey depends on is the property, not which fixture currently has it.
 */
const NAVIGATION_STEPS = 4;
const MIN_LOADED_ITEMS = PRELOAD_BOUND + NAVIGATION_STEPS + 2;

async function galleryWithLoadedRoom(): Promise<{
  readonly path: string;
  readonly pageSize: number;
}> {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE)
    .language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await getMockGalleryResult(language, contentId, {
      cursorCodec: harnessCursorCodec,
    });
    if (
      path !== null &&
      result !== undefined &&
      result.items.length >= MIN_LOADED_ITEMS
    ) {
      return { path: `${STORY_ROOT}/${path.join("/")}`, pageSize: result.page.size };
    }
  }

  throw new Error(
    `[e2e] The harness needs one gallery whose first page holds at least ${MIN_LOADED_ITEMS} items.`,
  );
}

/**
 * The underlying public rendition path a Next.js optimizer request names,
 * regardless of which width candidate or quality it asked for.
 *
 * That normalization is what makes "how many distinct photographs did the
 * lightbox touch" answerable at all: the grid and the lightbox can request
 * different width candidates for the same photograph, and a browser that
 * already holds one candidate in cache may request the other again or not at
 * all depending on the run — neither is itself a bounded-window violation.
 */
function underlyingRenditionPath(requestUrl: string): string | null {
  const parsed = new URL(requestUrl);
  if (parsed.pathname !== "/_next/image") return null;

  const underlying = parsed.searchParams.get("url");
  return underlying === null ? null : decodeURIComponent(underlying);
}

async function gotoGallery(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "load" });
}

/**
 * The photograph currently on screen: not hidden from assistive technology,
 * and covering the centre of the viewport (the library keeps neighbouring
 * slides mounted off to the sides). One lookup shared by every caller that
 * needs a property of it, so the "which image is presented" rule can only
 * drift out of step with itself in one place.
 */
async function presentedImage(
  dialog: Locator,
): Promise<{ readonly alt: string; readonly naturalWidth: number } | null> {
  return dialog.evaluate((root) => {
    const centreX = window.innerWidth / 2;
    const centreY = window.innerHeight / 2;

    for (const image of root.querySelectorAll("img")) {
      if (
        image.getAttribute("aria-hidden") === "true" ||
        image.getAttribute("role") === "presentation"
      ) {
        continue;
      }
      const rect = image.getBoundingClientRect();
      const coversCentre =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left <= centreX &&
        rect.right >= centreX &&
        rect.top <= centreY &&
        rect.bottom >= centreY;
      if (coversCentre) {
        return { alt: image.alt, naturalWidth: image.naturalWidth };
      }
    }
    return null;
  });
}

async function presentedImageAlt(dialog: Locator): Promise<string | null> {
  return (await presentedImage(dialog))?.alt ?? null;
}

async function presentedImageNaturalWidth(dialog: Locator): Promise<number> {
  return (await presentedImage(dialog))?.naturalWidth ?? 0;
}

let GALLERY_PATH: string;
let GALLERY_PAGE_SIZE: number;

test.beforeAll(async () => {
  const gallery = await galleryWithLoadedRoom();
  GALLERY_PATH = gallery.path;
  GALLERY_PAGE_SIZE = gallery.pageSize;
});

test("opening a large gallery loads only the bounded adjacent window, not the whole page", async ({
  page,
}) => {
  await gotoGallery(page, GALLERY_PATH);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");

  // Attached only once the grid itself has settled, so the grid's own
  // thumbnail requests (already fired during `waitUntil: "load"`) are not
  // mistaken for ones the lightbox caused.
  const apiGalleryRequests: string[] = [];
  const touchedIdentities = new Set<string>();
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/gallery")) {
      apiGalleryRequests.push(url);
      return;
    }
    const identity = underlyingRenditionPath(url);
    if (identity !== null) touchedIdentities.add(identity);
  });

  await openLightbox(dialog, () => triggers.first().click());
  await expect
    .poll(() => presentedImageNaturalWidth(dialog), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.waitForLoadState("networkidle").catch(() => {});

  expect(
    apiGalleryRequests,
    "opening a gallery must never itself cross the page cursor — only reaching the last loaded slide does, through the shared continuation contract",
  ).toEqual([]);

  expect(
    touchedIdentities.size,
    `expected at most ${PRELOAD_BOUND} distinct photographs requested by opening the lightbox (LIGHTBOX_PRELOAD_WINDOW = [${LIGHTBOX_PRELOAD_WINDOW.join(", ")}]), saw ${touchedIdentities.size}`,
  ).toBeLessThanOrEqual(PRELOAD_BOUND);
  expect(
    touchedIdentities.size,
    "the bounded window must stay far below the loaded page, let alone the whole gallery",
  ).toBeLessThan(GALLERY_PAGE_SIZE);

  // AB#79's acceptance criterion asks for the measurement to be recorded;
  // this is the observed evidence behind
  // docs/adr/0010-lightbox-preload-window.md, captured from a real run.
  console.log(
    `[AB#79] distinct photographs requested on open: ${touchedIdentities.size} (bound ${PRELOAD_BOUND}, page size ${GALLERY_PAGE_SIZE})`,
  );
});

test("navigating forward loads a small, bounded number of additional photographs per step", async ({
  page,
}) => {
  await gotoGallery(page, GALLERY_PATH);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");

  const touchedIdentities = new Set<string>();
  page.on("request", (request) => {
    const identity = underlyingRenditionPath(request.url());
    if (identity !== null) touchedIdentities.add(identity);
  });

  await openLightbox(dialog, () => triggers.first().click());
  await expect
    .poll(() => presentedImageNaturalWidth(dialog), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.waitForLoadState("networkidle").catch(() => {});

  const perStepDeltas: number[] = [];
  for (let step = 0; step < NAVIGATION_STEPS; step += 1) {
    const before = new Set(touchedIdentities);
    const previousAlt = await presentedImageAlt(dialog);

    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => presentedImageAlt(dialog), { timeout: 10_000 })
      .not.toBe(previousAlt);
    await page.waitForLoadState("networkidle").catch(() => {});

    let delta = 0;
    for (const identity of touchedIdentities) {
      if (!before.has(identity)) delta += 1;
    }
    perStepDeltas.push(delta);
  }

  for (const [index, delta] of perStepDeltas.entries()) {
    expect(
      delta,
      `navigation step ${index + 1} requested ${delta} new photographs, expected at most ${PRELOAD_BOUND}`,
    ).toBeLessThanOrEqual(PRELOAD_BOUND);
  }

  // See the note in the previous test.
  console.log(
    `[AB#79] per-step new photographs requested while navigating forward: ${perStepDeltas.join(", ")} (bound ${PRELOAD_BOUND})`,
  );
});

test("a failed preload does not block the current slide and recovers once the visitor reaches it", async ({
  page,
}) => {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE)
    .language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  const tree = buildContentTree(treeInput);
  const contentId = [...(mockContentPages[language] ?? [])].find(
    ([id, page]) =>
      page.variant === "gallery" &&
      getCanonicalContentPath(tree, id) !== null &&
      `${STORY_ROOT}/${(getCanonicalContentPath(tree, id) ?? []).join("/")}` ===
        GALLERY_PATH,
  )?.[0];
  if (contentId === undefined) {
    throw new Error("[e2e] Could not re-resolve the gallery this suite already selected.");
  }
  const result = await getMockGalleryResult(language, contentId, {
    cursorCodec: harnessCursorCodec,
  });
  const forwardIndex = LIGHTBOX_PRELOAD_WINDOW[1];
  const targetItem = result?.items[forwardIndex];
  if (targetItem === undefined) {
    throw new Error("[e2e] The selected gallery has no item at the forward preload boundary.");
  }
  const targetPath = targetItem.media.rendition.src;

  await gotoGallery(page, GALLERY_PATH);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");

  // Registered only after the grid has settled, so a grid thumbnail already
  // on screen is never the request this aborts — only the lightbox's own
  // preload of the same photograph, whichever candidate width it asks for.
  let abortedOnce = false;
  await page.route("**/_next/image**", async (route) => {
    const identity = underlyingRenditionPath(route.request().url());
    if (identity === targetPath && !abortedOnce) {
      abortedOnce = true;
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });

  await openLightbox(dialog, () => triggers.first().click());
  await expect
    .poll(() => presentedImageNaturalWidth(dialog), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // The photograph on screen renders and the dialog is still usable — one
  // adjacent slide's preload failing touches nothing else.
  expect(await dialog.count()).toBe(1);
  await expect.poll(() => abortedOnce, { timeout: 10_000 }).toBe(true);

  for (let step = 0; step < forwardIndex; step += 1) {
    const previousAlt = await presentedImageAlt(dialog);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => presentedImageAlt(dialog), { timeout: 10_000 })
      .not.toBe(previousAlt);
  }

  // Landing on the slide whose preload failed retries it, with no project
  // code of this suite's own — PhotoSwipe's own activation path does this.
  await expect
    .poll(() => presentedImageNaturalWidth(dialog), { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test("adjacent preloading holds JS heap growth to a small, bounded amount", async ({
  page,
  browserName,
}) => {
  // JS heap sampling needs Chromium's CDP; WebKit — the project's actual
  // mobile engine (`mobile-webkit`) — has no portable Playwright equivalent.
  // This runs on the desktop-chromium project as a documented best-effort
  // proxy rather than a true iOS measurement; see the limitation recorded in
  // docs/adr/0010-lightbox-preload-window.md.
  test.skip(
    browserName !== "chromium",
    "JS heap sampling needs Chromium's CDP; no portable WebKit equivalent exists (ADR-0010).",
  );

  // The iPhone 15 CSS viewport `mobile-webkit` runs at, so this proxy
  // measurement is at least taken at the same layout size the real mobile
  // profile presents the gallery at.
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoGallery(page, GALLERY_PATH);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");

  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const heapUsed = async (): Promise<number> => {
    const { metrics } = await session.send("Performance.getMetrics");
    return (
      metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0
    );
  };

  const before = await heapUsed();

  await openLightbox(dialog, () => triggers.first().click());
  await expect
    .poll(() => presentedImageNaturalWidth(dialog), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.waitForLoadState("networkidle").catch(() => {});

  for (let step = 0; step < NAVIGATION_STEPS; step += 1) {
    const previousAlt = await presentedImageAlt(dialog);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => presentedImageAlt(dialog), { timeout: 10_000 })
      .not.toBe(previousAlt);
  }
  await page.waitForLoadState("networkidle").catch(() => {});

  const after = await heapUsed();
  const deltaMB = (after - before) / (1024 * 1024);

  console.log(
    `[AB#79] JS heap delta after opening + ${NAVIGATION_STEPS} forward navigations: ${deltaMB.toFixed(2)} MB (Chromium CDP proxy at the mobile-webkit viewport size, ${GALLERY_PAGE_SIZE}-item loaded page)`,
  );

  // A generous bound: this proxy measurement exists to catch a preload
  // window that regressed into loading unboundedly many photographs, not to
  // pin today's exact byte count, and JS heap alone undercounts the decoded
  // image memory a compositor holds outside it (see the ADR).
  expect(deltaMB).toBeLessThan(50);
});
