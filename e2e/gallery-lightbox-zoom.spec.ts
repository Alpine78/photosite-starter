import type { Locator, Page } from "@playwright/test";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import {
  firstMixedRatioGalleryPath,
  OPEN_ACTION_TIMEOUT,
  expectApprovedPublicRendition,
} from "./support/gallery";
import { openLightbox, presentedImage } from "./support/lightbox";

/**
 * The lightbox zoom and pan journey (AB#78).
 *
 * The core viewer — open, navigate, close, focus return, captions — is AB#15
 * and AB#16 and stays in `gallery-lightbox.spec.ts`. This file is only the
 * magnification behaviour layered on top: that a click or tap or the `z` key
 * enlarges the frame without cropping it or changing its ratio, that pan stays
 * inside the enlarged image, that the caption gets out of the way while keeping
 * its accessible text, that the zoom control announces its state, and that all
 * of it resets when the slide changes or the viewer closes.
 *
 * Control labels are imported, not written out — they are application copy a
 * clone translates. What is pinned is behaviour and accessible state.
 *
 * The one check this suite cannot make is a real finger on real glass: pinch to
 * zoom and a dragged pan on a physical touch device. That is AC6's documented
 * manual step, recorded as outstanding in `docs/adr/0001-lightbox-library.md`.
 */

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;

/** Resolved in `beforeAll`: the discovery awaits a bounded source (AB#134). */
let GALLERY_PATH: string;

test.beforeAll(async () => {
  GALLERY_PATH = await firstMixedRatioGalleryPath();
});

/** Opens the gallery and lets the grid settle before anything is clicked. */
async function gotoGallery(page: Page): Promise<void> {
  await page.goto(GALLERY_PATH, { waitUntil: "load" });
}

/** The zoom control, addressed by its accessible name rather than a class. */
function zoomControl(dialog: Locator) {
  return dialog.getByRole("button", { name: labels.zoom });
}

/** Waits until the presented image has actually decoded some bytes. */
async function waitForPresentedImage(
  dialog: Locator,
) {
  await expect
    .poll(async () => (await presentedImage(dialog))?.naturalWidth ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const presented = await presentedImage(dialog);
  expect(presented, "no image is covering the centre of the viewer").not.toBeNull();
  return presented!;
}

/** The active image's `aria-describedby`, and the caption's own id. */
async function describedByState(dialog: Locator) {
  const caption = dialog.locator("[data-gallery-caption]");
  const captionId = await caption.getAttribute("id");
  const presented = await presentedImage(dialog);
  return { captionId, describedBy: presented?.describedBy ?? null };
}

test("a click or tap enlarges the photograph without cropping it or changing its ratio", async ({
  page,
  externalRequests,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");
  const viewport = page.viewportSize();
  expect(viewport, "the journey needs a known viewport").not.toBeNull();

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );

  const before = await waitForPresentedImage(dialog);
  await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "false");

  // AC1 is about activating the photograph itself, not the zoom button. On the
  // pointer profile that is a single click (`imageClickAction: "zoom"`); on the
  // touch profile it is a double tap (`doubleTapAction: "zoom"` — a single tap
  // is the library's reserved chrome toggle), which is the standard
  // photo-viewer gesture and a genuine synthesized touch either way.
  const centreX = viewport!.width / 2;
  const centreY = viewport!.height / 2;
  if (test.info().project.use.hasTouch === true) {
    await page.touchscreen.tap(centreX, centreY);
    await page.touchscreen.tap(centreX, centreY);
  } else {
    await page.mouse.click(centreX, centreY);
  }

  // It actually enlarged: the rendered frame is meaningfully wider than the
  // fitted one it opened at.
  await expect
    .poll(async () => (await presentedImage(dialog))?.renderedWidth ?? 0)
    .toBeGreaterThan(before.renderedWidth + 4);

  const zoomed = await waitForPresentedImage(dialog);

  // No distortion and no crop: the frame on screen still has the public
  // derivative's own aspect ratio. Both measurements carry the browser's
  // density correction, so the ratio comparison is the sound one.
  expect(zoomed.renderedWidth / zoomed.renderedHeight).toBeCloseTo(
    zoomed.naturalWidth / zoomed.naturalHeight,
    1,
  );
  // Still only ever a versioned public web derivative (ADR-0005): magnifying
  // does not fetch a different, larger source.
  expectApprovedPublicRendition(zoomed.currentSrc);

  // The control reflects the state the image-click just produced.
  await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");

  expect(externalRequests).toEqual([]);
});

test("the zoom control announces its name, its pressed state, and works from the keyboard", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );
  await waitForPresentedImage(dialog);

  const control = zoomControl(dialog);
  await expect(control).toBeVisible();
  await expect(control).toHaveAccessibleName(labels.zoom);
  await expect(control).toHaveAttribute("aria-pressed", "false");

  await test.step("activating the control toggles its state", async () => {
    await control.click();
    await expect(control).toHaveAttribute("aria-pressed", "true");

    await control.click();
    await expect(control).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("the z key toggles the same state", async () => {
    // Focus is already inside the dialog from opening it.
    await page.keyboard.press("z");
    await expect(control).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("z");
    await expect(control).toHaveAttribute("aria-pressed", "false");
  });
});

test("the caption gets out of the way while zoomed but keeps its accessible text", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");
  const caption = dialog.locator("[data-gallery-caption]");

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );
  await waitForPresentedImage(dialog);

  // Walk forward until a slide that actually carries metadata — the rule is
  // only observable on one that has a caption to hide.
  await expect
    .poll(
      async () => {
        if (await caption.isVisible()) return true;
        await page.getByRole("button", { name: labels.next }).click();
        return caption.isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const before = await describedByState(dialog);
  expect(before.captionId, "the caption needs an id to be referenced by").toBeTruthy();
  expect(before.describedBy).toBe(before.captionId);
  await expect(caption).toHaveText(/\S/);
  await expect(caption).toHaveAttribute("tabindex", "0");

  const capturedText = (await caption.textContent())?.trim() ?? "";
  expect(capturedText.length).toBeGreaterThan(0);

  await test.step("zooming hides it visually without discarding it", async () => {
    await zoomControl(dialog).click();
    await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");

    // Out of sight and out of the way of a pan gesture...
    await expect(caption).toHaveAttribute("data-visually-hidden", "true");
    await expect
      .poll(() => caption.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("0");
    await expect
      .poll(() => caption.evaluate((el) => getComputedStyle(el).pointerEvents))
      .toBe("none");
    // ...and out of the tab order, so a keyboard visitor cannot land on it
    // while it is invisible.
    await expect(caption).toHaveAttribute("tabindex", "-1");

    // ...but still there for assistive technology: the text is intact and the
    // photograph still points at it.
    await expect(caption).toHaveText(capturedText);
    const zoomedState = await describedByState(dialog);
    expect(zoomedState.describedBy).toBe(before.captionId);
  });

  await test.step("zooming back out restores it", async () => {
    await zoomControl(dialog).click();
    await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "false");

    await expect(caption).toHaveAttribute("data-visually-hidden", "false");
    await expect(caption).toHaveAttribute("tabindex", "0");
    await expect
      .poll(() => caption.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
  });
});

test("zoom state resets when the slide changes and when the viewer is reopened", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");
  const caption = dialog.locator("[data-gallery-caption]");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );
  await waitForPresentedImage(dialog);

  await test.step("changing slides drops the zoom", async () => {
    await zoomControl(dialog).click();
    await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");

    // The Next button rather than an arrow key: horizontal arrows navigate even
    // while zoomed, but the button is the control this reset is really about.
    await page.getByRole("button", { name: labels.next }).click();

    const next = await waitForPresentedImage(dialog);
    await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "false");
    await expect(caption).toHaveAttribute("data-visually-hidden", "false");

    // Back to a fitted, whole frame inside the viewport.
    expect(next.left).toBeGreaterThanOrEqual(-1);
    expect(next.top).toBeGreaterThanOrEqual(-1);
    expect(next.right).toBeLessThanOrEqual(viewport!.width + 1);
    expect(next.bottom).toBeLessThanOrEqual(viewport!.height + 1);
    expect(next.renderedWidth / next.renderedHeight).toBeCloseTo(
      next.naturalWidth / next.naturalHeight,
      1,
    );
  });

  await test.step("closing and reopening the same item starts unzoomed with no retained pan", async () => {
    await zoomControl(dialog).click();
    await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");
    // Create a pan offset that must not survive the close.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await openLightbox(dialog, () =>
      triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
    );
    const reopened = await waitForPresentedImage(dialog);

    await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "false");
    await expect(caption).toHaveAttribute("tabindex", "0");

    // Fitted and centred: no leftover magnification, no leftover pan.
    expect(reopened.left).toBeGreaterThanOrEqual(-1);
    expect(reopened.top).toBeGreaterThanOrEqual(-1);
    expect(reopened.right).toBeLessThanOrEqual(viewport!.width + 1);
    expect(reopened.bottom).toBeLessThanOrEqual(viewport!.height + 1);
    expect(
      Math.abs((reopened.left + reopened.right) / 2 - viewport!.width / 2),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs((reopened.top + reopened.bottom) / 2 - viewport!.height / 2),
    ).toBeLessThanOrEqual(2);
  });
});

test("pan stays inside the zoomed photograph and never reveals a gap past its edges", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );

  // A portrait frame: once magnified it overflows the viewport vertically on
  // both the desktop and the mobile profile, so the vertical pan bound is
  // actually reachable. The vertical axis is the one tested because horizontal
  // arrow keys navigate slides even while zoomed, and a pointer drag long
  // enough to hit the horizontal bound tips over into a slide change — neither
  // is a clean way to observe the clamp.
  await expect
    .poll(
      async () => {
        const shown = await presentedImage(dialog);
        if (shown && shown.naturalHeight > shown.naturalWidth) return true;
        await page.getByRole("button", { name: labels.next }).click();
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await waitForPresentedImage(dialog);

  await zoomControl(dialog).click();
  await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");

  const zoomed = await waitForPresentedImage(dialog);
  expect(
    zoomed.renderedHeight,
    "the magnified portrait frame must overflow the viewport to test the bound",
  ).toBeGreaterThan(viewport!.height + 2);

  await test.step("panning to the bottom stops with the bottom edge on the viewport edge", async () => {
    // ArrowDown pans the zoomed frame down; 40 presses is far more travel than
    // the image has, so it settles against the clamp.
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect
      .poll(async () => (await presentedImage(dialog))?.bottom ?? 0)
      .toBeLessThanOrEqual(viewport!.height + 2);

    const atBottom = await presentedImage(dialog);
    // The bottom edge is on the viewport's bottom edge — not short of it,
    // which would be a black gap below the photograph.
    expect(atBottom!.bottom).toBeGreaterThanOrEqual(viewport!.height - 2);
    // And the top has gone off-screen rather than the frame shrinking.
    expect(atBottom!.top).toBeLessThan(0);
  });

  await test.step("panning back to the top stops with the top edge on the viewport edge", async () => {
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press("ArrowUp");
    }
    await expect
      .poll(async () => (await presentedImage(dialog))?.top ?? -999)
      .toBeGreaterThanOrEqual(-2);

    const atTop = await presentedImage(dialog);
    expect(atTop!.top).toBeLessThanOrEqual(2);
    expect(atTop!.bottom).toBeGreaterThan(viewport!.height);
  });
});

test("a pointer drag starting over the hidden caption still pans the photograph", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");
  const caption = dialog.locator("[data-gallery-caption]");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );

  // A portrait frame that also carries a caption: zoomed, it overflows
  // vertically so there is pan headroom, and the caption overlays the lower
  // half of that frame — exactly where a drag would otherwise be intercepted.
  await expect
    .poll(
      async () => {
        const shown = await presentedImage(dialog);
        if (
          shown &&
          shown.naturalHeight > shown.naturalWidth &&
          (await caption.isVisible())
        ) {
          return true;
        }
        await page.getByRole("button", { name: labels.next }).click();
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await waitForPresentedImage(dialog);

  await zoomControl(dialog).click();
  await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toHaveAttribute("data-visually-hidden", "true");

  const captionBox = await caption.boundingBox();
  expect(captionBox, "the hidden caption still occupies layout").not.toBeNull();

  // Start the drag inside the caption's own rectangle. With `pointer-events`
  // left on the hidden region this gesture would scroll the caption instead;
  // the AB#78 rule is that it reaches the photograph and pans it.
  const startX = captionBox!.x + captionBox!.width / 2;
  const startY = captionBox!.y + Math.min(24, captionBox!.height / 2);
  const before = await presentedImage(dialog);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(startX, startY - step * 14);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();

  await expect
    .poll(async () => (await presentedImage(dialog))?.top ?? 0)
    .toBeLessThan(before!.top - 40);

  // The caption did not eat the gesture: it is still at scroll position zero.
  expect(await caption.evaluate((el) => el.scrollTop)).toBe(0);
});

test("closing the zoomed viewer leaves the page behind interactive and unlocked", async ({
  page,
}) => {
  await gotoGallery(page);

  const dialog = page.getByRole("dialog");
  const triggers = page.getByRole("main").getByRole("button");

  // Baseline the page chrome the viewer might touch, so the check compares
  // against what was there rather than assuming a clean slate.
  const baseline = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));

  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );
  await waitForPresentedImage(dialog);
  await zoomControl(dialog).click();
  await expect(zoomControl(dialog)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Nothing of the viewer is left in the document.
  expect(await page.locator(".pswp").count()).toBe(0);

  // The page chrome is exactly as it was before the viewer opened.
  const after = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  expect(after).toEqual(baseline);

  // And it genuinely responds again: the page scrolls...
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // ...and a grid trigger still opens the viewer, so no stray overlay is
  // swallowing the click.
  await page.evaluate(() => window.scrollTo(0, 0));
  await openLightbox(dialog, () =>
    triggers.first().click({ timeout: OPEN_ACTION_TIMEOUT }),
  );
  await expect(dialog).toHaveCount(1);
});
