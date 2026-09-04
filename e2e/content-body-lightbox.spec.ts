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
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { OPEN_ACTION_TIMEOUT } from "./support/gallery";
import { openLightbox, presentedImage } from "./support/lightbox";

/**
 * A photograph placed in a content body opens the same fullscreen viewer the
 * curated gallery grid uses (AB#147).
 *
 * The body sequence is its own: ADR-0003 decision 2 keeps a body media block
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
function articleWithBodyGallery(): { path: string; alts: readonly string[] } {
  for (const [contentId, page] of mockContentPages[defaultLanguage] ?? []) {
    if (page.variant !== "article") continue;
    const imageCount = page.body.filter(
      (block) => block.type === "media" && block.media.type === "image",
    ).length;
    const hasOther = page.body.some(
      (block) => block.type !== "media" || block.media.type !== "image",
    );
    if (imageCount >= 2 && hasOther) {
      return { path: canonicalPath(contentId), alts: bodyImageAlts(contentId) };
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
  return page.getByRole("main").locator("article [data-item-id]");
}

test("an article body photograph opens the viewer, walks its own images, and returns focus where it ended", async ({
  page,
  externalRequests,
}) => {
  await page.goto(ARTICLE.path, { waitUntil: "load" });

  const triggers = bodyTriggers(page);
  const dialog = page.getByRole("dialog");

  await test.step("every body photograph is a real, named control once hydrated", async () => {
    await expect(triggers).toHaveCount(ARTICLE.alts.length);
    // The article also carries a cover figure and a YouTube block; neither is a
    // trigger, which is what this count proves.
    expect(ARTICLE.alts.length).toBeGreaterThan(1);

    await expect(triggers.first()).toHaveAttribute("aria-haspopup", "dialog");
    await expect(triggers.first()).toHaveAccessibleName(ARTICLE.alts[0]);

    const itemIds = await triggers.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-item-id")),
    );
    expect(itemIds.every((id): id is string => Boolean(id))).toBe(true);
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  await test.step("a pointer opens the shared fullscreen dialog on that photograph", async () => {
    await openLightbox(dialog, () =>
      triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
    );

    await expect(dialog).toHaveAccessibleName(labels.viewer);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(ARTICLE.alts[0]);

    // A body photograph is not a curated placement, so the viewer offers no
    // "Enquire about this photograph" control (AB#60 was not extended here).
    await expect(
      dialog.getByRole("link", { name: labels.enquire }),
    ).toHaveCount(0);
  });

  await test.step("navigation steps through the body images and nothing else", async () => {
    // Forward to the last body image.
    for (let index = 1; index < ARTICLE.alts.length; index += 1) {
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(async () => (await presentedImage(dialog))?.alt)
        .toBe(ARTICLE.alts[index]);
    }

    // One more wraps straight back to the first: the YouTube block between the
    // two photographs is not a slide, so the sequence length is the image count.
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(ARTICLE.alts[0]);

    // And no slide is ever a broken video embed.
    await expect(dialog.locator("iframe")).toHaveCount(0);
  });

  await test.step("the active photograph carries its own caption for assistive technology", async () => {
    const caption = dialog.locator("[data-gallery-caption]");
    const captionId = await caption.getAttribute("id");
    expect(captionId).toBeTruthy();

    // Left on the first image by the wrap above; its figure names the caption.
    const presented = await presentedImage(dialog);
    expect(presented?.alt).toBe(ARTICLE.alts[0]);
    if ((await caption.locator(":scope > p").count()) > 0) {
      expect(presented?.describedBy).toBe(captionId);
      await expect(caption).toHaveText(/\S/);
    }
  });

  await test.step("Escape closes it and focus lands on the occurrence it ended on", async () => {
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(ARTICLE.alts[1]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(triggers.nth(1)).toBeFocused();
  });

  await test.step("the keyboard opens it too, and focus returns to that same control", async () => {
    await openLightbox(dialog, async () => {
      await triggers.first().focus({ timeout: OPEN_ACTION_TIMEOUT });
      await page.keyboard.press("Enter");
    });
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(ARTICLE.alts[0]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(triggers.first()).toBeFocused();
  });

  expect(externalRequests).toEqual([]);
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
  const allTriggers = main.locator("[data-item-id]");
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

    // Stepping `bodyCount` times returns to the first body image: the curated
    // grid's items are not in this sequence.
    for (let step = 0; step < bodyCount; step += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(GALLERY.alts[0]);

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
    await expect(main.locator("article [data-item-id]")).toHaveCount(0);
    await expect(main.locator("article button img")).toHaveCount(0);
  });
});
