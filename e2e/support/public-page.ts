import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Interactions and assertions that belong to any public page rather than to one
 * journey: the site chrome, and the proof that an image was really delivered.
 *
 * They live here because more than one journey needs them and both browser
 * projects have to mean the same thing by them — a helper that quietly assumed
 * the wide layout would make the mobile project test a different site.
 */

/**
 * The compact layout's navigation panel, named by its toggle's `aria-controls`.
 * Kept in step with `src/components/site-header.tsx` by hand: importing that
 * component here would pull React and the Next runtime into the harness.
 */
const COMPACT_PANEL_ID = "mobile-nav";

/**
 * The control that opens the whole menu in the compact layout, hidden in the
 * wide one. It is told apart from the submenu toggles inside the menu by the
 * panel it controls rather than by a label, which a clone rebrands and a second
 * locale renders differently.
 */
export function headerMenuToggle(page: Page): Locator {
  return page
    .getByRole("banner")
    .locator(`button[aria-controls="${COMPACT_PANEL_ID}"]`);
}

/**
 * Returns the header navigation for the current viewport. The compact layout
 * keeps it behind a toggle and the wide layout renders it inline, so a journey
 * that runs on both asks for it this way rather than assuming one of them.
 *
 * Idempotent: it ensures the menu is open rather than toggling it, so a journey
 * that asks twice does not close what the first call opened.
 */
export async function openHeaderNavigation(page: Page): Promise<Locator> {
  const menuToggle = headerMenuToggle(page);

  if (await menuToggle.isVisible()) {
    // Retried rather than clicked once. The header is server-rendered before
    // its script has run, and an interaction in that window reaches no handler
    // at all — it is not queued and never replayed. Retrying until the control
    // answers keeps a journey about the menu rather than about the moment
    // hydration happened to finish on a loaded agent.
    await expect(async () => {
      if ((await menuToggle.getAttribute("aria-expanded")) !== "true") {
        await menuToggle.click();
      }
      await expect(menuToggle).toHaveAttribute("aria-expanded", "true", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 15_000 });
  }

  return page
    .getByRole("banner")
    .getByRole("navigation")
    .filter({ visible: true });
}

/**
 * Asserts that an image arrived, not merely that markup for one exists. A
 * visible `<img>` proves layout; a non-zero natural width proves the production
 * image pipeline actually delivered bytes for the rendition the page asked for.
 */
export async function expectImageDelivered(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(
      () =>
        image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      // Longer than the default assertion timeout: the first request for a
      // rendition pays for optimizing it, on a cold cache and a cold agent.
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}
