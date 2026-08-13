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
