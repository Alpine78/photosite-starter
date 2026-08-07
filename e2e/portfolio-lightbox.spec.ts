import type { Locator, Page } from "@playwright/test";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

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

/** Application-owned route, not authored content: safe to name here. */
const PORTFOLIO_PATH = "/portfolio";

/** The unprefixed route under test belongs to the harness's default locale. */
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;

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

test("the portfolio grid opens a lightbox that navigates and closes by keyboard", async ({
  page,
  externalRequests,
}) => {
  await gotoPortfolio(page);

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
  await gotoPortfolio(page);

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
  await gotoPortfolio(page);

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
  await gotoPortfolio(page);

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
  await gotoPortfolio(page);

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
 * Opens the portfolio page and lets its grid settle.
 *
 * The grid is a masonry layout whose columns move as its images arrive, and a
 * control whose box is still shifting is not one a visitor could click either.
 * Waiting for load costs about a second and removes that whole class of false
 * failure; images below the fold stay lazy and do not hold it up.
 */
async function gotoPortfolio(page: Page): Promise<void> {
  await page.goto(PORTFOLIO_PATH, { waitUntil: "load" });
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
async function openLightbox(
  dialog: Locator,
  act: () => Promise<void>,
): Promise<void> {
  // Generous, because the first open in a session also fetches the viewer
  // module that the route deliberately does not ship, on a cold cache and with
  // every other worker competing for the same server.
  await expect
    .poll(
      async () => {
        if ((await dialog.count()) === 0) {
          await act().catch(() => {});
        }
        return dialog.count();
      },
      { timeout: 20_000 },
    )
    .toBe(1);

  await expect.poll(() => focusIsInside(dialog), { timeout: 10_000 }).toBe(true);
}

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
 * What the grid itself says about each photograph, in result order, with an
 * empty string where it says nothing. Content again, so it is read from the
 * page: it is the expectation the viewer is measured against.
 */
async function galleryCaptions(main: Locator): Promise<string[]> {
  return main
    .getByRole("listitem")
    .evaluateAll((items) =>
      items.map(
        (item) => item.querySelector("figcaption")?.textContent?.trim() ?? "",
      ),
    );
}

async function focusIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate(
    (root) =>
      document.activeElement !== null && root.contains(document.activeElement),
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
