import type { Locator, Page } from "@playwright/test";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import type { GallerySlice } from "../src/lib/gallery-slice";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { STORY_ROOT } from "./support/gallery";
import { focusIsInside, openLightbox, presentedImage } from "./support/lightbox";

const locale = appUnderTestEnvironment.SITE_LOCALE;
const language = new Intl.Locale(locale).language;
const labels = getBuiltInLabels(locale);
const tree = buildContentTree(mockContentTreeInputs[language]);
const codec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);

function pathFor(contentId: string) {
  const segments = getCanonicalContentPath(tree, contentId);
  if (!segments) throw new Error(`[e2e] No canonical gallery path for ${contentId}`);
  return `${STORY_ROOT}/${segments.join("/")}`;
}

const triggers = (page: Page) => page.getByRole("main").locator("[data-item-id]");
const nextButton = (dialog: Locator) => dialog.getByRole("button", { name: labels.lightbox.next, exact: true });

async function expectPosition(dialog: Locator, position: number, total: number) {
  await expect(dialog.getByText(`${position}${labels.lightbox.indexSeparator}${total}`, { exact: true })).toBeVisible();
}

async function expectEnquiryAction(page: Page, dialog: Locator, itemId: string, allowed: boolean) {
  const enquiry = dialog.locator("[data-gallery-enquire]");
  if (!allowed) {
    await expect(enquiry).toBeHidden();
    await expect(enquiry).not.toHaveAttribute("href", /.+/);
    return;
  }
  await expect(enquiry).toBeVisible();
  await expect.poll(async () => {
    const href = await enquiry.getAttribute("href");
    return href === null ? null : new URL(href, page.url()).searchParams.get("enquire");
  }).toBe(itemId);
}

async function openAt(page: Page, index: number) {
  const dialog = page.getByRole("dialog");
  await openLightbox(dialog, () => triggers(page).nth(index).click());
  return dialog;
}

async function expectPreviewVisible(target: Locator) {
  await expect(target).toBeFocused();
  await expect.poll(() => target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    return rect.top < bottom && rect.bottom > top;
  })).toBe(true);
}

// The same Pointer Events path PhotoSwipe uses for finger swipes. Physical
// device/browser chrome and genuine touch are still an owner-run check.
async function swipeForward(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  if (!box) throw new Error("[e2e] No viewer bounds for swipe");
  const start = box.x + box.width * 0.85;
  const end = box.x + box.width * 0.15;
  const y = box.y + box.height / 2;
  await page.mouse.move(start, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(start + (end - start) * step / 12, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

let archive: { contentId: string; path: string; count: number; section: string; nextAlt: string };
let complete: { path: string; count: number };

test.beforeAll(async () => {
  for (const [contentId, content] of mockContentPages[language] ?? []) {
    if (content.variant !== "gallery") continue;
    const result = await getMockGalleryResult(language, contentId, { cursorCodec: codec });
    if (!result) continue;
    if (!archive && result.page.hasNextPage && result.items.length > 5) {
      for (const section of result.sections) {
        const sectionPage = await getMockGalleryResult(language, contentId, { sectionSlug: section.slug, cursorCodec: codec });
        if (!sectionPage?.page.hasNextPage) continue;
        if (!result.page.endCursor) throw new Error("[e2e] Archive fixture must have a next cursor");
        const next = await getMockGalleryResult(language, contentId, { cursor: result.page.endCursor, cursorCodec: codec });
        const first = next?.items[0];
        if (first?.media.type !== "image") throw new Error("[e2e] Archive fixture needs an appended photograph");
        archive = { contentId, path: pathFor(contentId), count: result.items.length, section: section.slug, nextAlt: first.media.alt };
        break;
      }
    }
    if (!complete && !result.page.hasNextPage && result.items.length > 2) {
      complete = { path: pathFor(contentId), count: result.items.length };
    }
  }
  if (!archive || !complete) throw new Error("[e2e] Continuity needs paginated and complete gallery fixtures");
  // These timing assertions exercise the documented five-image cap. A smaller
  // fixture needs separate expectations for the quarter-page rule.
  if (archive.count < 20) throw new Error("[e2e] Five-image lookahead coverage needs a page of at least 20 images");
});

test("starts the next slice before the loaded end and keeps one request in flight", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/gallery**", async (route) => {
    requests += 1;
    await gate;
    await route.fallback();
  });

  try {
    // Five photographs still follow this one: the request must have started
    // before navigation reaches the currently loaded boundary.
    const position = archive.count - 5;
    const dialog = await openAt(page, position - 1);
    await expect.poll(() => requests).toBe(1);
    await expectPosition(dialog, position, archive.count);
    await expect(dialog.getByRole("status")).toHaveCount(1);
    await expect(dialog.getByRole("status").locator("p")).toBeEmpty();
    for (let current = position + 1; current <= archive.count; current += 1) {
      await page.keyboard.press("ArrowRight");
      await expectPosition(dialog, current, archive.count);
    }
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await swipeForward(page, dialog);
    await expectPosition(dialog, archive.count, archive.count);
    await expect(dialog.getByRole("status")).toContainText(labels.gallery.loadingMore);
    await expect(dialog.getByText(labels.lightbox.lastImage, { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: labels.lightbox.next, exact: true, includeHidden: true })).toBeDisabled();
    expect(requests).toBe(1);
    await expect.poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0).toBeGreaterThan(0);
    const alt = (await presentedImage(dialog))?.alt;
    const caption = await dialog.locator("[data-gallery-caption]").textContent();

    release();
    await expect(triggers(page)).toHaveCount(archive.count * 2);
    await expectPosition(dialog, archive.count, archive.count * 2);
    expect((await presentedImage(dialog))?.alt).toBe(alt);
    await expect(dialog.locator("[data-gallery-caption]")).toHaveText(caption ?? "");
    await expect(nextButton(dialog)).toBeEnabled();
    await nextButton(dialog).click();
    await expectPosition(dialog, archive.count + 1, archive.count * 2);
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(archive.nextAlt);
    await expect.poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0).toBeGreaterThan(0);
  } finally {
    release();
  }
});

test("an arriving slice preserves the current zoom and hidden caption", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/gallery**", async (route) => { await gate; await route.fallback(); });
  try {
    const position = archive.count - 5;
    const dialog = await openAt(page, position - 1);
    const zoom = dialog.getByRole("button", { name: labels.lightbox.zoom, exact: true });
    const caption = dialog.locator("[data-gallery-caption]");
    await expect.poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0).toBeGreaterThan(0);
    const alt = (await presentedImage(dialog))?.alt;
    const text = await caption.textContent();
    await zoom.click();
    await expect(zoom).toHaveAttribute("aria-pressed", "true");
    await expect(caption).toHaveAttribute("data-visually-hidden", "true");
    release();
    await expectPosition(dialog, position, archive.count * 2);
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(alt);
    await expect(caption).toHaveText(text ?? "");
    await expect(zoom).toHaveAttribute("aria-pressed", "true");
    await expect(caption).toHaveAttribute("data-visually-hidden", "true");
  } finally { release(); }
});

test("forward navigation stays on the terminal image", async ({ page }) => {
  await page.goto(complete.path, { waitUntil: "load" });
  const dialog = await openAt(page, complete.count - 2);
  await nextButton(dialog).focus();
  await nextButton(dialog).press("Enter");
  await expectPosition(dialog, complete.count, complete.count);
  await expect.poll(() => focusIsInside(dialog)).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expectPosition(dialog, complete.count, complete.count);
  await expect(dialog.getByRole("button", { name: labels.lightbox.next, exact: true, includeHidden: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText(labels.lightbox.lastImage);
  await swipeForward(page, dialog);
  await expectPosition(dialog, complete.count, complete.count);
  await page.keyboard.press("ArrowLeft");
  await expectPosition(dialog, complete.count - 1, complete.count);
});

test("closing returns the last viewed thumbnail to the visible viewport", async ({ page }, testInfo) => {
  await page.goto(archive.path, { waitUntil: "load" });
  const dialog = await openAt(page, 0);
  const position = Math.min(12, archive.count - 6);
  for (let current = 2; current <= position; current += 1) {
    await page.keyboard.press("ArrowRight");
    await expectPosition(dialog, current, archive.count);
  }
  const target = triggers(page).nth(position - 1);
  const close = dialog.getByRole("button", { name: labels.lightbox.close, exact: true });
  if (testInfo.project.use.hasTouch) await close.tap();
  else await close.click();
  await expect(dialog).toHaveCount(0);
  await expectPreviewVisible(target);
});

test("closing with a vertical drag returns the final preview to the visible viewport", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  const dialog = await openAt(page, 0);
  const position = Math.min(12, archive.count - 6);
  for (let current = 2; current <= position; current += 1) {
    await page.keyboard.press("ArrowRight");
    await expectPosition(dialog, current, archive.count);
  }
  const target = triggers(page).nth(position - 1);
  await expect.poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0).toBeGreaterThan(0);
  const box = await dialog.boundingBox();
  if (!box) throw new Error("[e2e] No viewer bounds for closing drag");
  // Exercise the installed viewer's supported vertical Pointer Events close
  // path. The owner's exact gesture and physical Safari remain unverified.
  const x = box.x + box.width / 2;
  const start = box.y + box.height * 0.35;
  const distance = box.height * 0.55;
  await page.mouse.move(x, start);
  await page.mouse.down();
  for (let step = 1; step <= 16; step += 1) {
    await page.mouse.move(x, start + distance * step / 16);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await expectPreviewVisible(target);
});

test("closing scrolls to the preview even when programmatic focus does not scroll", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  // Model the reported mobile focus/scroll split without claiming a physical
  // browser reproduction: focusing an off-screen preview cannot scroll here.
  await page.evaluate(() => {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (options) {
      focus.call(this, this.hasAttribute("data-item-id") ? { ...options, preventScroll: true } : options);
    };
  });
  const dialog = await openAt(page, 0);
  const position = Math.min(12, archive.count - 6);
  for (let current = 2; current <= position; current += 1) {
    await page.keyboard.press("ArrowRight");
    await expectPosition(dialog, current, archive.count);
  }
  const target = triggers(page).nth(position - 1);
  expect(await target.evaluate((element) => element.getBoundingClientRect().top >= innerHeight)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectPreviewVisible(target);
});

test("closing rechecks the preview after a layout adjustment in the next frame", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  // A controlled one-frame layout adjustment exercises the settling guard;
  // it is not a claim about the unverified physical Safari root cause.
  await page.evaluate(() => {
    document.documentElement.style.overflowAnchor = "none";
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (options) {
      focus.call(this, options);
      if (!this.hasAttribute("data-item-id") || !options?.preventScroll) return;
      requestAnimationFrame(() => {
        const main = document.querySelector("main");
        if (main) main.style.paddingTop = `${window.innerHeight * 2}px`;
      });
    };
  });
  const dialog = await openAt(page, 0);
  const position = Math.min(12, archive.count - 6);
  for (let current = 2; current <= position; current += 1) {
    await page.keyboard.press("ArrowRight");
    await expectPosition(dialog, current, archive.count);
  }
  const target = triggers(page).nth(position - 1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.getByRole("main").evaluate((element) => element.style.paddingTop)).not.toBe("");
  await expectPreviewVisible(target);
});

test("a failed lookahead stays put until the visitor retries inside the viewer", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  let requests = 0;
  await page.route("**/api/gallery**", async (route) => {
    requests += 1;
    if (requests === 1) await route.fulfill({ status: 503, body: "" });
    else await route.fallback();
  });
  const position = archive.count - 5;
  const dialog = await openAt(page, position - 1);
  await expect.poll(() => requests).toBe(1);
  for (let current = position + 1; current <= archive.count; current += 1) {
    await page.keyboard.press("ArrowRight");
    await expectPosition(dialog, current, archive.count);
  }
  await expect(dialog.getByRole("status")).toContainText(labels.gallery.loadFailed);
  await page.keyboard.press("ArrowRight");
  await swipeForward(page, dialog);
  await expectPosition(dialog, archive.count, archive.count);
  expect(requests).toBe(1);
  await expect(dialog.getByText(labels.lightbox.lastImage, { exact: true })).toHaveCount(0);

  const retry = dialog.getByRole("button", { name: labels.gallery.retry, exact: true });
  await retry.focus();
  await retry.press("Enter");
  await expect(triggers(page)).toHaveCount(archive.count * 2);
  await expectPosition(dialog, archive.count, archive.count * 2);
  await expect.poll(() => focusIsInside(dialog)).toBe(true);
  await expect(dialog.getByRole("status")).toHaveAttribute("data-empty", "true");
  await expect(dialog.getByRole("status").locator("p")).toBeEmpty();
  await expect(dialog.getByRole("button", { name: labels.gallery.retry, exact: true, includeHidden: true })).toBeHidden();
  await nextButton(dialog).click();
  await expectPosition(dialog, archive.count + 1, archive.count * 2);
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(archive.nextAlt);
  await expect.poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0).toBeGreaterThan(0);
  expect(requests).toBe(2);
});

test("a request started from the grid shares its pending and failed state with the viewer", async ({ page }) => {
  await page.goto(archive.path, { waitUntil: "load" });
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/gallery**", async (route) => {
    requests += 1;
    if (requests === 1) {
      await gate;
      await route.fulfill({ status: 503, body: "" });
    } else await route.fallback();
  });
  try {
    await page.getByRole("link", { name: labels.gallery.showMore, exact: true }).click();
    const dialog = await openAt(page, archive.count - 1);
    await expect(dialog.getByRole("status")).toContainText(labels.gallery.loadingMore);
    await expect(dialog.getByRole("button", { name: labels.gallery.retry, exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
    release();
    await expect(dialog.getByRole("status")).toContainText(labels.gallery.loadFailed);
    await dialog.getByRole("button", { name: labels.gallery.retry, exact: true }).click();
    await expect(triggers(page)).toHaveCount(archive.count * 2);
    await expectPosition(dialog, archive.count, archive.count * 2);
    expect(requests).toBe(2);
  } finally { release(); }
});

test("crosses several cursor boundaries in order and stops at an exact-multiple end", async ({ page }) => {
  test.slow();
  const expectedIds: string[] = [];
  const expectedEnquiryAllowed: boolean[] = [];
  let cursor: string | undefined;
  for (let slice = 0; slice < 3; slice += 1) {
    const result = await getMockGalleryResult(language, archive.contentId, { cursor, cursorCodec: codec });
    if (!result) throw new Error("[e2e] Missing archive slice");
    expectedIds.push(...result.items.map((item) => item.itemId));
    expectedEnquiryAllowed.push(...result.items.map((item) => item.enquiryAllowed === true));
    cursor = result.page.endCursor ?? undefined;
  }
  expect(expectedEnquiryAllowed).toContain(true);
  expect(expectedEnquiryAllowed).toContain(false);
  await page.goto(archive.path, { waitUntil: "load" });
  let requests = 0;
  await page.route("**/api/gallery**", async (route) => {
    requests += 1;
    const response = await route.fetch();
    const slice = await response.json() as GallerySlice;
    // A synthetic terminal cursor, preserving all real fixture data and order.
    await route.fulfill({ response, json: requests === 2 ? { ...slice, nextCursor: null } : slice });
  });
  const dialog = await openAt(page, 0);
  for (let position = 1; position <= expectedIds.length; position += 1) {
    const total = position >= archive.count * 2 - 5 ? archive.count * 3
      : position >= archive.count - 5 ? archive.count * 2 : archive.count;
    if (position > 1) await page.keyboard.press("ArrowRight");
    await expectPosition(dialog, position, total);
    await expectEnquiryAction(page, dialog, expectedIds[position - 1], expectedEnquiryAllowed[position - 1]);
  }
  await expect(dialog.getByRole("status")).toHaveText(labels.lightbox.lastImage);
  await page.keyboard.press("ArrowRight");
  await expectPosition(dialog, expectedIds.length, expectedIds.length);
  await expect.poll(() => triggers(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")))).toEqual(expectedIds);
  expect(requests).toBe(2);
  await page.keyboard.press("ArrowLeft");
  await expectPosition(dialog, expectedIds.length - 1, expectedIds.length);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectPreviewVisible(triggers(page).nth(expectedIds.length - 2));
});

test("a section stays scoped through every page and its true terminal item", async ({ page }) => {
  test.slow();
  const expectedIds: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await getMockGalleryResult(language, archive.contentId, { sectionSlug: archive.section, cursor, cursorCodec: codec });
    if (!result) throw new Error("[e2e] Missing section slice");
    expectedIds.push(...result.items.map((item) => item.itemId));
    cursor = result.page.hasNextPage ? result.page.endCursor ?? undefined : undefined;
  } while (cursor);
  await page.goto(`${archive.path}?section=${encodeURIComponent(archive.section)}`, { waitUntil: "load" });
  const requestedSections: (string | null)[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/gallery") requestedSections.push(url.searchParams.get("section"));
  });
  const dialog = await openAt(page, archive.count - 1);
  for (let position = archive.count; position <= expectedIds.length; position += 1) {
    if (position > archive.count) await page.keyboard.press("ArrowRight");
    await expect(dialog.locator(".pswp__counter")).toHaveText(new RegExp(`^${position}\\D`));
    // Near a boundary, wait for this page before trying to move beyond it.
    if (position % archive.count === 0 && position < expectedIds.length) {
      await expect(triggers(page)).toHaveCount(Math.min(position + archive.count, expectedIds.length));
    }
  }
  await expect(dialog.getByRole("status")).toHaveText(labels.lightbox.lastImage);
  await page.keyboard.press("ArrowRight");
  await expectPosition(dialog, expectedIds.length, expectedIds.length);
  await expect.poll(() => triggers(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")))).toEqual(expectedIds);
  expect(requestedSections.length).toBe(Math.ceil(expectedIds.length / archive.count) - 1);
  expect(requestedSections.every((section) => section === archive.section)).toBe(true);
});

for (const contentId of ["content-large-archive", "content-masonry-below"]) {
  test(`closing an appended item restores its viewport and occurrence: ${contentId}`, async ({ page }) => {
    const first = await getMockGalleryResult(language, contentId, { cursorCodec: codec });
    if (!first?.page.endCursor) throw new Error("[e2e] Missing continuation cursor");
    const second = await getMockGalleryResult(language, contentId, { cursor: first.page.endCursor, cursorCodec: codec });
    const appended = second?.items[0];
    if (!appended) throw new Error("[e2e] Missing appended photograph");
    await page.goto(pathFor(contentId), { waitUntil: "load" });
    const dialog = await openAt(page, archive.count - 1);
    await expect.poll(() => triggers(page).count()).toBeGreaterThan(archive.count);
    await nextButton(dialog).click();
    const target = triggers(page).nth(archive.count);
    const itemId = await target.getAttribute("data-item-id");
    expect(itemId).toBe(appended.itemId);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectPreviewVisible(target);
    // Opening again reads the grown list; repeating media may never select
    // another occurrence with the same mediaId.
    await openLightbox(dialog, () => target.press("Enter"));
    await expectEnquiryAction(page, dialog, appended.itemId, appended.enquiryAllowed === true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectPreviewVisible(target);
  });
}

test("a short final page stops at its last photograph", async ({ page }) => {
  const result = await getMockGalleryResult(language, "content-masonry-below", { cursorCodec: codec });
  if (!result?.page.endCursor) throw new Error("[e2e] Masonry fixture must continue");
  const last = await getMockGalleryResult(language, "content-masonry-below", { cursor: result.page.endCursor, cursorCodec: codec });
  if (!last || last.page.hasNextPage || last.items.length >= result.items.length) throw new Error("[e2e] Expected a short final slice");
  const total = result.items.length + last.items.length;
  await page.goto(pathFor("content-masonry-below"), { waitUntil: "load" });
  const dialog = await openAt(page, result.items.length - 1);
  await expect(triggers(page)).toHaveCount(total);
  for (let position = result.items.length + 1; position <= total; position += 1) {
    await nextButton(dialog).click();
    await expectPosition(dialog, position, total);
  }
  await expect(dialog.getByRole("status")).toHaveText(labels.lightbox.lastImage);
  await page.keyboard.press("ArrowRight");
  await swipeForward(page, dialog);
  await expectPosition(dialog, total, total);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectPreviewVisible(triggers(page).last());
});

test("a one-image viewer exposes the end without requesting more", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/gallery") requests += 1; });
  await page.goto(pathFor("content-layout-single"), { waitUntil: "load" });
  const dialog = await openAt(page, 0);
  await expect(dialog.getByRole("status")).toHaveText(labels.lightbox.lastImage);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(await triggers(page).first().locator("img").getAttribute("alt"));
  expect(requests).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectPreviewVisible(triggers(page).first());
});
