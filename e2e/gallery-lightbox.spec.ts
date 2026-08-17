import type { Locator, Page } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { focusIsInside, openLightbox } from "./support/lightbox";
import { openHeaderNavigation } from "./support/public-page";

/**
 * The gallery lightbox journey: open, navigate, close, and get focus back.
 *
 * Keyboard is the primary path here rather than an afterthought — a gallery
 * that can only be browsed with a pointer fails the project's accessibility
 * target, and focus behaviour is the reason ADR-0001 chose this library at all.
 *
 * The control labels are imported rather than written out: they are
 * application-owned copy that a clone may translate, so naming them here would
 * make the gate depend on wording instead of on behaviour. Image alt text comes
 * from the running page for the same reason. What is pinned down is structure:
 * a real button per item, a named modal dialog, trapped focus, ordered
 * navigation, uncropped frames, and one instance at a time.
 */

/**
 * A curated gallery's canonical path, derived from the same adapter data the
 * harness serves rather than written down here.
 *
 * A clone renames every category and slug in this tree, so naming one would
 * make the gate depend on this fixture's content. What the journey needs is a
 * gallery with enough items to navigate between and enough differently shaped
 * ones to prove the layout never crops or reorders them.
 */
async function firstDefaultLocaleGallery(): Promise<string> {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await getMockGalleryResult(language, contentId);
    if (path === null || result === undefined) continue;

    const ratios = new Set(
      result.items.map(
        (item) => item.media.rendition.width / item.media.rendition.height,
      ),
    );
    if (result.items.length > 1 && ratios.size > 1) {
      return `${STORY_ROOT}/${path.join("/")}`;
    }
  }

  throw new Error("[e2e] The harness needs one mixed-ratio gallery of two or more items.");
}

/**
 * A published gallery with no items, by the same derivation. The empty state is
 * a state the site serves, so the journey has to find it in the adapter data
 * rather than assume which page it is.
 */
async function emptyDefaultLocaleGallery(): Promise<string> {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await getMockGalleryResult(language, contentId);
    if (path !== null && result?.items.length === 0) {
      return `${STORY_ROOT}/${path.join("/")}`;
    }
  }

  throw new Error("[e2e] The harness needs one published gallery with no items.");
}

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;

/**
 * Resolved once in `beforeAll` rather than at module scope: finding either
 * gallery now awaits a bounded source (AB#134), and Playwright test files
 * load before any hook runs.
 */
let GALLERY_PATH: string;
let EMPTY_GALLERY_PATH: string;

test.beforeAll(async () => {
  GALLERY_PATH = await firstDefaultLocaleGallery();
  EMPTY_GALLERY_PATH = await emptyDefaultLocaleGallery();
});

/** The unprefixed route under test belongs to the harness's default locale. */
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;
const galleryLabels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).gallery;

/** What the visitor is actually looking at, measured rather than assumed. */
type PresentedImage = {
  readonly alt: string;
  /** The element this photograph names as its description, if it names one. */
  readonly describedBy: string | null;
  readonly currentSrc: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

test("the gallery grid opens a lightbox that navigates and closes by keyboard", async ({
  page,
  externalRequests,
}) => {
  await gotoGallery(page);

  const main = page.getByRole("main");
  const triggers = main.getByRole("button");
  const dialog = page.getByRole("dialog");

  await test.step("every grid item is opened by a real, named control", async () => {
    await expect(triggers.first()).toBeVisible();

    // One opener per image: a passive figure is not a tab stop, so the count of
    // buttons and the count of images have to agree.
    const images = main.getByRole("img");
    await expect(images).toHaveCount(await triggers.count());
    expect(await triggers.count()).toBeGreaterThan(1);

    await expect(triggers.first()).toHaveAccessibleName(/\S/);
    await expect(triggers.first()).toHaveAttribute("aria-haspopup", "dialog");
  });

  // Each opener is named by the photograph it opens, which is what lets the
  // rest of this journey follow one item without knowing the content.
  const itemNames = await galleryImageAlts(triggers);
  await expect(triggers.first()).toHaveAccessibleName(itemNames[0]);

  await test.step("the keyboard opens it on the item the visitor was on", async () => {
    await triggers.first().focus();
    await expect(triggers.first()).toBeFocused();

    // Refocused inside the action so a repeat still presses Enter at the
    // trigger, wherever focus ended up in between.
    await openLightbox(dialog, async () => {
      await triggers.first().focus({ timeout: OPEN_ACTION_TIMEOUT });
      await page.keyboard.press("Enter");
    });

    await expect(dialog).toHaveAccessibleName(labels.viewer);
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[0]);
  });

  await test.step("the dialog holds focus and the page behind it cannot take it", async () => {
    // The trap is asserted by pushing focus onto a control in the page behind
    // the dialog and watching it come back, rather than by walking Tab stops:
    // WebKit moves Tab focus between form controls only unless the platform's
    // full-keyboard-access setting is on, so a Tab walk would measure that
    // setting instead of this dialog.
    await page
      .getByRole("banner")
      .getByRole("link")
      .first()
      .evaluate((element: HTMLElement) => element.focus());

    await expect.poll(() => focusIsInside(dialog)).toBe(true);
  });

  await test.step("arrow keys walk the result order", async () => {
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[1]);

    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[0]);
  });

  await test.step("the previous and next controls walk the same order", async () => {
    // Asserted on every profile, touch included. The library hides these on a
    // touch device on the assumption that a visitor swipes, and this project
    // overrides that: a swipe is a dragging gesture, which is exactly what
    // limited motor control or a switch device makes hard, so a gallery whose
    // only pointer navigation is a swipe is not operable for everyone.
    const previousControl = dialog.getByRole("button", {
      name: labels.previous,
    });
    const nextControl = dialog.getByRole("button", { name: labels.next });

    await expect(previousControl).toBeVisible();
    await expect(nextControl).toBeVisible();

    await nextControl.click();
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[1]);

    await previousControl.click();
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[0]);

    // Left on the second item, so the focus-return assertion below is about
    // where the visitor navigated to rather than where they started.
    await nextControl.click();
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[1]);
  });

  await test.step("Escape closes it and focus lands on the item it ended on", async () => {
    await page.keyboard.press("Escape");

    await expect(dialog).toHaveCount(0);
    // Not the trigger that opened it: the visitor navigated away from that one,
    // and focus follows where they actually ended up.
    await expect(triggers.nth(1)).toBeFocused();
  });

  await test.step("the close control closes it too, leaving nothing behind", async () => {
    await openLightbox(dialog, () =>
      triggers.nth(2).click({ timeout: OPEN_ACTION_TIMEOUT }),
    );

    await dialog.getByRole("button", { name: labels.close }).click();

    await expect(dialog).toHaveCount(0);
    await expect(triggers.nth(2)).toBeFocused();
  });

  await test.step("reopening leaves exactly one dialog", async () => {
    await openLightbox(dialog, () =>
      triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
    );
    await expect(dialog).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  expect(externalRequests).toEqual([]);
});

test("the lightbox shows whole, uncropped frames from the public rendition", async ({
  page,
}) => {
  await gotoGallery(page);

  const main = page.getByRole("main");
  const triggers = main.getByRole("button");
  const dialog = page.getByRole("dialog");
  const viewport = page.viewportSize();
  expect(viewport, "the journey needs a known viewport to measure against").not.toBeNull();

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );

  // Every item, because the rule has to hold for landscape, portrait, and
  // square frames alike — the shapes are exactly what a crop would hide.
  const itemCount = await triggers.count();

  for (let index = 0; index < itemCount; index += 1) {
    // A non-zero natural width is the proof that bytes actually arrived; the
    // first request for a rendition pays for optimizing it on a cold cache.
    await expect
      .poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    const presented = await presentedImage(dialog);
    expect(presented, `slide ${index} presented no image`).not.toBeNull();
    if (presented === null) {
      return;
    }

    // The whole frame is on screen: nothing is cut off by the viewport.
    expect(presented.left).toBeGreaterThanOrEqual(-1);
    expect(presented.top).toBeGreaterThanOrEqual(-1);
    expect(presented.right).toBeLessThanOrEqual(viewport!.width + 1);
    expect(presented.bottom).toBeLessThanOrEqual(viewport!.height + 1);

    // And it is the whole frame, at its own ratio — not a fitted crop of one.
    // Both measurements carry the browser's density correction, so comparing
    // ratios is sound where comparing widths to the delivered pixels would not
    // be: a candidate the optimizer declines to upscale reports a corrected
    // width below its own slot without anything being cropped.
    expect(presented.renderedWidth / presented.renderedHeight).toBeCloseTo(
      presented.naturalWidth / presented.naturalHeight,
      1,
    );

    expectApprovedPublicRendition(presented.currentSrc);

    if (index < itemCount - 1) {
      await page.keyboard.press("ArrowRight");
    }
  }
});

test("the lightbox presents the metadata of the item on screen, and nothing more", async ({
  page,
}) => {
  await gotoGallery(page);

  const main = page.getByRole("main");
  const triggers = main.getByRole("button");
  const dialog = page.getByRole("dialog");
  const caption = dialog.locator("[data-gallery-caption]");
  const captionText = caption.locator(".pswp__gallery-caption-text");
  const creditText = caption.locator(".pswp__gallery-caption-credit");
  const viewport = page.viewportSize();
  expect(viewport, "the journey needs a known viewport to measure against").not.toBeNull();

  // Expectations come from the gallery itself. A clone replaces every caption
  // in it, so what is checked is that the viewer says about an item what the
  // grid already said about the same one — not any particular wording.
  const itemNames = await galleryImageAlts(triggers);
  const gridCaptions = await galleryCaptions(main);

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );

  const captionId = await caption.getAttribute("id");
  expect(captionId, "the caption region needs an id to be referenced by").toBeTruthy();
  let sawCredit = false;
  let sawItemWithoutCreditAfterIt = false;

  for (let index = 0; index < itemNames.length; index += 1) {
    await expect
      .poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(itemNames[index]);

    // Metadata is replaced on a slide change, never added to: a second region
    // would mean a caption from an earlier slide was still on screen.
    await expect(caption).toHaveCount(1);

    const presented = await presentedImage(dialog);
    expect(presented, `slide ${index} presented no image`).not.toBeNull();

    const expectedCaption = gridCaptions[index];
    await expect(captionText).toHaveCount(expectedCaption ? 1 : 0);
    if (expectedCaption) {
      await expect(captionText).toHaveText(expectedCaption);
    }

    const creditCount = await creditText.count();
    expect(creditCount, `slide ${index} rendered duplicate credits`).toBeLessThanOrEqual(1);
    if (creditCount === 1) {
      await expect(creditText).toHaveText(/\S/);
      sawCredit = true;
    } else if (sawCredit) {
      sawItemWithoutCreditAfterIt = true;
    }

    const metadataPartCount = Number(Boolean(expectedCaption)) + creditCount;
    await expect(caption.locator(":scope > p")).toHaveCount(metadataPartCount);

    if (metadataPartCount > 0) {
      // On screen means it has something to say, and the photograph on screen
      // is what says it: a screen reader reaching this image is pointed at the
      // text a sighted visitor is reading, for this slide and no other.
      await expect(caption).toHaveText(/\S/);
      expect(presented?.describedBy).toBe(captionId);

      // Readable where it is: the region stays inside the viewport at every
      // profile the suite runs, rather than running off a narrow one.
      const box = await caption.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
    } else {
      // An item carrying neither caption nor credit gets no strip across its
      // frame, and no description pointing assistive technology at empty text.
      expect(presented?.describedBy ?? null).toBeNull();
    }

    if (index < itemNames.length - 1) {
      await page.keyboard.press("ArrowRight");
    }
  }

  expect(sawCredit, "the public fixture needs to exercise the credit path").toBe(true);
  expect(
    sawItemWithoutCreditAfterIt,
    "the journey needs to prove that a credit does not survive the next item",
  ).toBe(true);
});

test("long lightbox metadata stays inside the viewport and remains reachable", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const caption = dialog.locator("[data-gallery-caption]");
  const captionText = caption.locator(".pswp__gallery-caption-text");

  await openLightbox(dialog, () =>
    page.getByRole("main").getByRole("button").first().click({
      timeout: OPEN_ACTION_TIMEOUT,
    }),
  );

  // The CMS boundary deliberately permits prose rather than imposing a
  // presentation-specific length limit. Stress the overlay without coupling
  // the public fixture to artificial copy that a clone would have to replace.
  await captionText.evaluate((element) => {
    element.textContent =
      "A long but valid authored caption for a photograph. ".repeat(120);
  });

  const viewport = page.viewportSize();
  const box = await caption.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  const overflow = await caption.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

  await caption.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => caption.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await captionText.evaluate((element) => {
    element.textContent = "UnbrokenMetadata".repeat(120);
  });
  const horizontalOverflow = await captionText.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test("a drag gesture navigates the lightbox", async ({ page }) => {
  await gotoGallery(page);

  const triggers = page.getByRole("main").getByRole("button");
  const dialog = page.getByRole("dialog");

  const [firstName, secondName] = await galleryImageAlts(triggers);

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );
  await expect
    .poll(async () => (await presentedImage(dialog))?.alt)
    .toBe(firstName);

  // Pointer events are the same path the library's touch handling uses, so
  // this proves the gesture is wired. A real finger on real glass — including
  // pinch-to-zoom — is a documented manual check, not something the harness
  // can honestly claim to have exercised.
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) {
    return;
  }
  const midpointY = box.y + box.height / 2;
  const startX = box.x + box.width * 0.85;
  const endX = box.x + box.width * 0.15;
  const steps = 12;

  await page.mouse.move(startX, midpointY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      startX + ((endX - startX) * step) / steps,
      midpointY,
    );
    // Spread over real time: the library decides between a settled drag and a
    // flick from pointer velocity, and instantaneous moves give it neither.
    await page.waitForTimeout(16);
  }
  await page.mouse.up();

  await expect
    .poll(async () => (await presentedImage(dialog))?.alt, { timeout: 10_000 })
    .toBe(secondName);
});

test("every chrome surface opens the featured gallery at its canonical route", async ({
  page,
  externalRequests,
}) => {
  // The header, footer, and home hero each name this gallery by its stable
  // content identity and resolve it through the tree. Checked one at a time:
  // clicking whichever happens to be visible would let two of the three break
  // while this stayed green.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const target = `a[href="${GALLERY_PATH}"]`;

  await test.step("the home hero opens it", async () => {
    const hero = page.getByRole("main").locator(target).first();
    await expect(hero).toBeVisible();
    await hero.click();
    await page.waitForURL(`**${GALLERY_PATH}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  await test.step("the footer opens it", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const footerLink = page.getByRole("contentinfo").locator(target);
    await expect(footerLink).toHaveCount(1);
    await footerLink.click();
    await page.waitForURL(`**${GALLERY_PATH}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  await test.step("the header menu opens it", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Opened through the helper, because the compact layout keeps the entry
    // behind a toggle and a hidden link proves nothing about either layout.
    const headerLink = (await openHeaderNavigation(page)).locator(target);
    await expect(headerLink).toHaveCount(1);
    await headerLink.click();
    await page.waitForURL(`**${GALLERY_PATH}`);
  });

  await test.step("the page it lands on states where it lives", async () => {
    await expect(page.getByRole("main").getByRole("button").first()).toBeVisible();
    // The breadcrumb follows canonical ancestry back into the story tree.
    // Scoped to the page's own content, so the header cannot answer for it.
    await expect(
      page.getByRole("main").locator(`a[href="${STORY_ROOT}"]`).first(),
    ).toBeVisible();
  });

  expect(externalRequests).toEqual([]);
});

test("a gallery declares its own address and its other locale version", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });

  await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
    "href",
    new RegExp(`${GALLERY_PATH}$`),
  );

  const alternates = page.locator("link[rel='alternate'][hreflang]");
  const hreflangs = await alternates.evaluateAll((links) =>
    links.map((link) => ({
      hreflang: link.getAttribute("hreflang") ?? "",
      href: link.getAttribute("href") ?? "",
    })),
  );

  // Its own version, the other locale's, and the default the two share.
  expect(hreflangs.some((link) => link.href.endsWith(GALLERY_PATH))).toBe(true);
  expect(
    hreflangs.some((link) =>
      link.href.includes(`/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}/`),
    ),
  ).toBe(true);
  expect(hreflangs.some((link) => link.hreflang === "x-default")).toBe(true);

  // A gallery's social image is its cover, which is its own opening photograph
  // when none was authored — never an invented one.
  await expect(page.locator("meta[property='og:image']")).toHaveCount(1);
});

test("a published gallery with no items says so instead of 404ing", async ({
  page,
}) => {
  const response = await page.goto(EMPTY_GALLERY_PATH, {
    waitUntil: "domcontentloaded",
  });

  // The page exists — it is between selections — so the address a visitor may
  // already hold answers with the gallery rather than with nothing.
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Its empty state is readable, and it offers no grid to operate. The label is
  // imported rather than written out: it is application-owned copy a clone may
  // translate, so naming it here would tie the gate to wording.
  await expect(
    page.getByRole("main").getByText(galleryLabels.empty),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("img")).toHaveCount(0);
});

test("a gallery answers honestly for the addresses it does not serve", async ({
  page,
}) => {
  await test.step("a cursor it never issued is not a page", async () => {
    // A gallery recognizes `cursor` (ADR-0003 decision 8). This one fits on a
    // single page, so it has issued none, and a token arriving here is stale,
    // tampered with, or malformed. Continuation itself is exercised separately,
    // against a gallery large enough to have a second page.
    const response = await page.goto(
      `${GALLERY_PATH}?cursor=not-a-token-this-route-minted`,
      { waitUntil: "domcontentloaded" },
    );

    expect(response?.status()).toBe(404);
  });

  await test.step("an unrecognized parameter still opens the gallery", async () => {
    // The other half of the same rule: a campaign or referral link must not
    // turn a real page into a 404.
    const response = await page.goto(`${GALLERY_PATH}?utm_source=a-newsletter`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main").getByRole("button").first()).toBeVisible();
  });

  await test.step("a slug the tree does not serve is a 404", async () => {
    const parent = GALLERY_PATH.slice(0, GALLERY_PATH.lastIndexOf("/"));
    const response = await page.goto(`${parent}/no-such-gallery`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(404);
  });

  await test.step("the removed portfolio route is gone, not redirected", async () => {
    // Never deployed or indexed, so nobody holds it and it earns no redirect
    // (ADR-0003, 2026-08-10).
    const response = await page.goto("/portfolio", {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe("/portfolio");
  });
});

test("the grid reads in the same order the lightbox navigates, at every column count", async ({
  page,
}) => {
  // One authoritative order governs the source, the DOM, keyboard focus, and
  // the lightbox. The eye has to agree with them: a column-major masonry lays
  // DOM items one, two, three down its first column, so the top row *reads* as
  // one, three, five and a visitor following the grid is not following the
  // sequence the lightbox will open.
  const main = page.getByRole("main");

  for (const [width, expectedColumns] of [
    [390, 1],
    [800, 2],
    [1280, 3],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    // Layout, not pixels: every cell reserves its frame from the rendition's
    // real dimensions, so the geometry below is settled before any photograph
    // has decoded. Waiting for three full loads instead would buy nothing and
    // make this the slowest test in the suite.
    await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });
    await expect(galleryItems(main).first()).toBeVisible();

    const boxes = await galleryItems(main).evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const image = element.querySelector("img");
        return {
          alt: image?.getAttribute("alt") ?? "",
          // Rounded to whole pixels: subpixel layout differences within one row
          // are not a reading-order change.
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          ratio: rect.height / rect.width,
        };
      }),
    );

    expect(
      boxes.length,
      "the gallery under test needs enough items to fill a row",
    ).toBeGreaterThan(expectedColumns);
    expect(
      new Set(boxes.map((box) => box.ratio.toFixed(2))).size,
      "mixed aspect ratios are what make a wrong layout visible",
    ).toBeGreaterThan(1);

    // Items sharing a row start at the same top edge, so the layout's own
    // reading order is exactly this sort — and it must not reorder anything.
    const reading = [...boxes].sort(
      (left, right) => left.top - right.top || left.left - right.left,
    );
    expect(
      reading.map((box) => box.alt),
      `reading order differs from DOM order at ${width}px`,
    ).toEqual(boxes.map((box) => box.alt));

    expect(
      new Set(boxes.filter((box) => box.top === boxes[0].top).map((b) => b.left))
        .size,
      `expected ${expectedColumns} column(s) at ${width}px`,
    ).toBe(expectedColumns);

    // And that order is the one the lightbox will navigate.
    expect(await galleryImageAlts(main.getByRole("button"))).toEqual(
      boxes.map((box) => box.alt),
    );
  }
});

/**
 * The photograph currently on screen, measured rather than queried.
 *
 * Two things make that less obvious than it sounds: the library keeps
 * neighbouring slides mounted off to the sides, and it stacks a decorative
 * low-resolution stand-in behind the frame it is still loading. So the search
 * is for the image that covers the middle of the screen and is exposed to
 * assistive technology — which is exactly the one a visitor is looking at.
 */
async function presentedImage(dialog: Locator): Promise<PresentedImage | null> {
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

      if (!coversCentre) {
        continue;
      }

      return {
        alt: image.alt,
        describedBy: image.getAttribute("aria-describedby"),
        currentSrc: image.currentSrc,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }

    return null;
  });
}

/**
 * Opens the gallery page and lets its grid settle.
 *
 * Rows resize as their images arrive, and a control whose box is still shifting
 * is not one a visitor could click either. Waiting for load costs about a second
 * and removes that whole class of false failure; images below the fold stay lazy
 * and do not hold it up.
 */
async function gotoGallery(page: Page): Promise<void> {
  await page.goto(GALLERY_PATH, { waitUntil: "load" });
}

/**
 * Time an opening action gets to land before it is treated as blocked.
 *
 * Short on purpose: a click that cannot reach the trigger has nothing to wait
 * for, and waiting out the default would spend the budget below on it.
 */
const OPEN_ACTION_TIMEOUT = 3_000;

/**
 * Performs an opening action and waits until the dialog has finished opening.
 *
 * Three real waits are folded in here.
 *
 * The grid is rendered on the server, so an action landing before React has
 * wired the opener does nothing at all; the action is therefore repeated, but
 * only while no dialog exists, so it can never open a second one.
 *
 * A repeat can also arrive while an earlier one is still opening — the viewer
 * module is fetched on first use — and then the trigger is already covered by
 * the dialog and the action cannot land. That is success in flight rather than
 * a failure, so a blocked action is swallowed and the poll simply keeps
 * waiting. A genuine failure still surfaces: the dialog never appears.
 *
 * And taking focus is the library's own last step of opening, which makes it
 * the honest readiness signal: a control clicked before that point is clicked
 * at a dialog that is still animating in.
 */
/**
 * The alternative text of each grid photograph, in result order. Content, so
 * the journey reads it from the page rather than knowing it: a clone replaces
 * every one of these photographs with its own.
 */
async function galleryImageAlts(triggers: Locator): Promise<string[]> {
  return triggers.evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector("img")?.alt ?? ""),
  );
}

/**
 * The grid's own items.
 *
 * A gallery page carries other lists — the breadcrumb trail, the language
 * switch, the tags — so "every list item in main" would mix them into the
 * sequence. The grid's list is the one whose items open images, which is a
 * property of what it does rather than of what this fixture happens to contain.
 */
function galleryItems(main: Locator): Locator {
  return main
    .getByRole("list")
    .filter({ has: main.page().getByRole("button") })
    .first()
    .getByRole("listitem");
}

/**
 * What the grid itself says about each photograph, in result order, with an
 * empty string where it says nothing. Content again, so it is read from the
 * page: it is the expectation the viewer is measured against.
 */
async function galleryCaptions(main: Locator): Promise<string[]> {
  return galleryItems(main).evaluateAll((items) =>
    items.map(
      (item) => item.querySelector("figcaption")?.textContent?.trim() ?? "",
    ),
  );
}

/**
 * The browser may only ever hold a versioned public web derivative, optimized
 * or not. Anything else reaching the viewer is the failure ADR-0005 exists to
 * prevent, so it is asserted rather than assumed.
 */
function expectApprovedPublicRendition(currentSrc: string): void {
  const delivered = new URL(currentSrc);
  const versionedPublicPath =
    /^\/gallery\/[a-z0-9]+(?:-[a-z0-9]+)*\.[a-f0-9]{12}\.(?:avif|jpe?g|png|webp)$/;

  const source =
    delivered.pathname === "/_next/image"
      ? (delivered.searchParams.get("url") ?? "")
      : delivered.pathname;

  expect(source, `unexpected lightbox source: ${currentSrc}`).toMatch(
    versionedPublicPath,
  );
}
