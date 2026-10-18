import type { Page } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { OPEN_ACTION_TIMEOUT } from "./support/gallery";
import { openLightbox, presentedImage } from "./support/lightbox";

/**
 * A photograph placed in a content body opens the same fullscreen viewer the
 * curated gallery grid uses (AB#147).
 *
 * Each article loose photograph opens alone (AB#323). A gallery body keeps its
 * own sequence: ADR-0003 decision 2 keeps a body media block
 * out of a gallery variant's curated grid, sections, and pagination, so this
 * journey proves the two viewers on one gallery page are separate — one walks
 * the body's own images, the other walks the curated result — and that a
 * YouTube block between two body photographs is not a slide.
 *
 * Nothing here names a caption, a title, or a photograph: a clone replaces all
 * of them. What is pinned is behaviour — a named modal dialog, a real control
 * per body image, ordered navigation, focus return keyed to the occurrence the
 * visitor opened, and the plain image that a scriptless visitor still gets.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;

const defaultLanguage = new Intl.Locale(
  appUnderTestEnvironment.SITE_LOCALE,
).language;

function defaultTree() {
  const input = mockContentTreeInputs[defaultLanguage];
  if (input === undefined) {
    throw new Error(`[e2e] The default locale ${defaultLanguage} has no tree.`);
  }
  return buildContentTree(input);
}

function canonicalPath(contentId: string): string {
  const segments = getCanonicalContentPath(defaultTree(), contentId);
  if (segments === null) {
    throw new Error(`[e2e] ${contentId} has no canonical path.`);
  }
  return `${STORY_ROOT}/${segments.join("/")}`;
}

function bodyImageAlts(contentId: string): readonly string[] {
  const page = mockContentPages[defaultLanguage]?.get(contentId);
  if (page === undefined) {
    throw new Error(`[e2e] ${defaultLanguage} publishes no ${contentId}.`);
  }
  return page.body.flatMap((block) =>
    block.type === "media" && block.media.type === "image"
      ? [block.media.alt]
      : [],
  );
}

/** One default-locale article whose body places more than one photograph, with
 * a non-image block among them, so navigation has a real sequence to walk and
 * the excluded block is provable. */
function articleWithBodyGallery(): { path: string; alts: readonly string[]; captions: readonly (readonly string[])[] } {
  for (const [contentId, page] of mockContentPages[defaultLanguage] ?? []) {
    if (page.variant !== "article" || page.endGalleryId !== undefined) continue;
    const imageCount = page.body.filter(
      (block) => block.type === "media" && block.media.type === "image",
    ).length;
    const hasOther = page.body.some(
      (block) => block.type !== "media" || block.media.type !== "image",
    );
    if (imageCount >= 2 && hasOther) {
      return {
        path: canonicalPath(contentId), alts: bodyImageAlts(contentId),
        captions: page.body.flatMap(block => block.type === "media" && block.media.type === "image"
          ? [[block.caption ?? block.media.caption, block.media.credit].filter((text): text is string => Boolean(text))]
          : []),
      };
    }
  }
  throw new Error(
    "[e2e] The harness needs an article with two or more body photographs.",
  );
}

/** One default-locale gallery variant whose body places a photograph, so the
 * body viewer and the curated grid viewer coexist on one page. */
function galleryWithBodyImage(): { path: string; alts: readonly string[] } {
  for (const [contentId, page] of mockContentPages[defaultLanguage] ?? []) {
    if (page.variant !== "gallery") continue;
    const alts = bodyImageAlts(contentId);
    if (alts.length >= 1) {
      return { path: canonicalPath(contentId), alts };
    }
  }
  throw new Error(
    "[e2e] The harness needs a gallery variant with a body photograph.",
  );
}

const ARTICLE = articleWithBodyGallery();
const GALLERY = galleryWithBodyImage();

/** The body's own lightbox triggers, in source order — every hydrated body
 * figure carries the DOM-visible half of its occurrence identity. */
function bodyTriggers(page: Page) {
  return page.getByRole("main").locator("article [data-item-id]:not([data-mini-gallery] [data-item-id]):not([data-article-end-gallery] [data-item-id])");
}

test("article loose photographs open individually and retain caption, zoom, focus and reading position", async ({ page, externalRequests }) => {
  await page.goto(ARTICLE.path, { waitUntil: "load" });
  const triggers = bodyTriggers(page);
  const dialog = page.getByRole("dialog");
  await expect(triggers).toHaveCount(ARTICLE.alts.length);
  expect(ARTICLE.alts.length).toBeGreaterThan(1);
  const ids = await triggers.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-item-id")));
  expect(new Set(ids).size).toBe(ids.length);

  // Every occurrence, including first/middle/last, keeps its own one-image
  // boundary. Reopen by keyboard as well as pointer to exercise registrations.
  for (const [index, alt] of ARTICLE.alts.entries()) {
    const trigger = triggers.nth(index);
    await expect(trigger).toHaveAccessibleName(alt);
    await trigger.evaluate(node => node.scrollIntoView({ block: "center", behavior: "instant" }));
    await trigger.focus();
    const before = await page.evaluate(() => window.scrollY);
    for (const keyboard of [false, true]) {
      await openLightbox(dialog, () => keyboard ? trigger.press("Enter") : trigger.click());
      await expect(dialog).toHaveAccessibleName(labels.viewer);
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(alt);
      await expect(dialog.getByRole("button", { name: labels.next, exact: true })).toBeHidden();
      await expect(dialog.getByRole("button", { name: labels.previous, exact: true })).toBeHidden();
      await expect(dialog.locator(".pswp__counter")).toBeHidden();
      await expect(dialog.getByRole("status")).toBeEmpty();
      await expect(dialog.getByText(labels.lastImage, { exact: true })).toHaveCount(0);
      await expect(dialog.locator('a[href*="enquire="]')).toHaveCount(0);
      for (const key of ["ArrowRight", "ArrowLeft", "ArrowRight"]) await page.keyboard.press(key);
      await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(alt);
      await expect(dialog.getByRole("status")).toBeEmpty();
      const caption = dialog.locator("[data-gallery-caption]");
      if (ARTICLE.captions[index].length > 0) {
        await expect(caption.locator(":scope > p")).toHaveText([...ARTICLE.captions[index]]);
        expect((await presentedImage(dialog))?.describedBy).toBe(await caption.getAttribute("id"));
      } else {
        await expect(caption).toBeHidden();
        expect((await presentedImage(dialog))?.describedBy).toBeNull();
      }
      const zoom = dialog.getByRole("button", { name: labels.zoom, exact: true });
      await expect(zoom).toHaveAttribute("aria-pressed", "false");
      await zoom.click();
      await expect(zoom).toHaveAttribute("aria-pressed", "true");
      await zoom.click();
      await expect(zoom).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThanOrEqual(8);
    }
  }
  expect(externalRequests).toEqual([]);
});

test("horizontal pointer swipes cannot leave an article's standalone photograph", async ({ page }) => {
  await page.goto(ARTICLE.path);
  const trigger = bodyTriggers(page).first();
  const dialog = page.getByRole("dialog");
  await openLightbox(dialog, () => trigger.click());
  const initial = await presentedImage(dialog);
  expect(initial).not.toBeNull();
  const box = (await dialog.boundingBox())!;
  // The same trusted pointer-drag path as the existing gallery swipe journey.
  // Physical touch/pinch hardware remains a manual check, not a harness claim.
  for (const direction of [1, -1]) {
    const start = box.x + box.width * (direction === 1 ? 0.85 : 0.15);
    const end = box.x + box.width - (start - box.x);
    const y = box.y + box.height / 2;
    await page.mouse.move(start, y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(start + (end - start) * step / 12, y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(initial!.alt);
    await expect.poll(async () => (await presentedImage(dialog))?.currentSrc).toBe(initial!.currentSrc);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("repeated loose photographs across mini-galleries retain their own focus and caption in both locales", async ({ page }) => {
  for (const locale of [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix]) {
    const language = new Intl.Locale(locale).language;
    const tree = buildContentTree(mockContentTreeInputs[language]);
    const segments = getCanonicalContentPath(tree, "content-reading-coastal-light")!;
    const prefix = locale === appUnderTestEnvironment.SITE_LOCALE
      ? STORY_ROOT : `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`;
    const localLabels = getBuiltInLabels(locale).lightbox;
    await page.goto(`${prefix}/${segments.join("/")}`);
    const triggers = bodyTriggers(page);
    await expect(triggers).toHaveCount(2);
    expect(await triggers.first().locator("img").getAttribute("src")).toBe(await triggers.last().locator("img").getAttribute("src"));
    const dialog = page.getByRole("dialog", { name: localLabels.viewer });
    for (const index of [0, 1, 0]) {
      const trigger = triggers.nth(index);
      await openLightbox(dialog, () => trigger.click());
      await expect(dialog.locator(".pswp__counter")).toBeHidden();
      await expect(dialog.getByRole("button", { name: localLabels.next, exact: true })).toBeHidden();
      await expect(dialog.getByRole("status")).toBeEmpty();
      await expect(dialog.getByText(localLabels.lastImage, { exact: true })).toHaveCount(0);
      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByRole("status")).toBeEmpty();
      const caption = dialog.locator("[data-gallery-caption]");
      if (index === 1) {
        await expect(caption).toBeHidden();
        expect((await presentedImage(dialog))?.describedBy).toBeNull();
      } else {
        await expect(caption).toBeVisible();
        expect((await presentedImage(dialog))?.describedBy).toBe(await caption.getAttribute("id"));
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await expect(page.locator("[data-mini-gallery]")).toHaveCount(2);
    await expect(page.locator("[data-article-end-gallery] [data-item-id]").first()).toBeAttached();
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("a standalone viewer still isolates its image and returns keyboard focus", async ({ page }) => {
    await page.goto(ARTICLE.path);
    const trigger = bodyTriggers(page).last();
    const dialog = page.getByRole("dialog");
    await openLightbox(dialog, () => trigger.press("Enter"));
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(ARTICLE.alts.at(-1));
    await expect(dialog.locator(".pswp__counter")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test("the lightbox shows the whole body photograph, uncropped, from the public rendition", async ({
  page,
}) => {
  await page.goto(ARTICLE.path, { waitUntil: "load" });

  const dialog = page.getByRole("dialog");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  await openLightbox(dialog, () =>
    bodyTriggers(page).first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );

  await expect
    .poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const presented = await presentedImage(dialog);
  expect(presented).not.toBeNull();
  if (presented === null) return;

  // Whole frame on screen, at its own ratio — not a fitted crop of one.
  expect(presented.left).toBeGreaterThanOrEqual(-1);
  expect(presented.top).toBeGreaterThanOrEqual(-1);
  expect(presented.right).toBeLessThanOrEqual(viewport!.width + 1);
  expect(presented.bottom).toBeLessThanOrEqual(viewport!.height + 1);
  expect(presented.renderedWidth / presented.renderedHeight).toBeCloseTo(
    presented.naturalWidth / presented.naturalHeight,
    1,
  );
});

test("on a gallery variant page the body viewer and the curated grid are separate sequences", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "load" });

  const main = page.getByRole("main");
  const allTriggers = main.locator("[data-item-id]:not([data-mini-gallery] [data-item-id])");
  const dialog = page.getByRole("dialog");

  // The body's images come before the grid in the document, so the first
  // trigger is a body one and the grid triggers follow it.
  const bodyCount = GALLERY.alts.length;
  const totalCount = await allTriggers.count();
  expect(bodyCount).toBeGreaterThanOrEqual(1);
  expect(
    totalCount,
    "the fixture needs a curated grid as well as a body image",
  ).toBeGreaterThan(bodyCount);

  await test.step("every trigger on the page has a distinct identity — no body/grid collision", async () => {
    const ids = await allTriggers.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-item-id")),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  await test.step("the body trigger opens a viewer bounded by the body's images", async () => {
    await openLightbox(dialog, () =>
      allTriggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
    );
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(GALLERY.alts[0]);

    // Stepping `bodyCount` times stops at the final body image: the curated
    // grid's items are not in this sequence (AB#251).
    for (let step = 0; step < bodyCount; step += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(GALLERY.alts.at(-1));
    await expect(dialog.getByRole("status")).toHaveText(labels.lastImage);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  await test.step("a grid trigger opens its own, larger viewer", async () => {
    await openLightbox(dialog, () =>
      allTriggers.nth(bodyCount).click({ timeout: OPEN_ACTION_TIMEOUT }),
    );

    // The curated grid has more than one item, and the body photograph is not
    // among them: walking forward from a grid item never reaches the body alt.
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .not.toBe(GALLERY.alts[0]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a body photograph stays a plain image, not a dead control", async ({
    page,
  }) => {
    await page.goto(ARTICLE.path, { waitUntil: "domcontentloaded" });

    const main = page.getByRole("main");

    // The photographs are still there…
    await expect(main.locator("article img").first()).toBeVisible();
    // …but no body photograph has been wrapped in a control that would do
    // nothing without a script to answer it. (The click-to-load video block is
    // a button by design; it is not an image trigger.)
    await expect(main.locator("article [data-item-id]:not([data-mini-gallery] [data-item-id])")).toHaveCount(0);
    await expect(main.locator("article button img")).toHaveCount(0);
  });
});
