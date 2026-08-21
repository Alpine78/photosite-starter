import { expect, type Locator } from "@playwright/test";

/**
 * Opening the fullscreen viewer, reliably.
 *
 * Shared by the lightbox journey and the continuation journey so both open it
 * the same way. Two things make a naive `click()` flaky here, and both are
 * properties of the viewer rather than of any one test:
 *
 * - **The viewer module is fetched on first open.** The route deliberately does
 *   not ship it, so the first open in a session pays for that download on a cold
 *   cache while every other worker competes for the same server.
 * - **Escape is only heard inside the dialog.** The activation has to end with
 *   focus in the viewer, or a keypress goes to whatever the page left focused.
 *
 * So the action is retried until the dialog exists, and then focus is waited for
 * rather than assumed.
 */
export async function openLightbox(
  dialog: Locator,
  act: () => Promise<void>,
): Promise<void> {
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

/** Whether the browser's focus is currently somewhere inside this element. */
export async function focusIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate(
    (root) =>
      document.activeElement !== null && root.contains(document.activeElement),
  );
}

/** What the visitor is actually looking at, measured rather than assumed. */
export type PresentedImage = {
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

/**
 * The photograph currently on screen, measured rather than queried.
 *
 * Two things make that less obvious than it sounds: the library keeps
 * neighbouring slides mounted off to the sides, and it stacks a decorative
 * low-resolution stand-in behind the frame it is still loading. So the search
 * is for the image that covers the middle of the screen and is exposed to
 * assistive technology — which is exactly the one a visitor is looking at.
 */
export async function presentedImage(
  dialog: Locator,
): Promise<PresentedImage | null> {
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
