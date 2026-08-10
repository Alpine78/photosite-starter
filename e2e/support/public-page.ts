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
 * Returns the header navigation for the current viewport. The compact layout
 * keeps it behind a toggle and the wide layout renders it inline, so a journey
 * that runs on both asks for it this way rather than assuming one of them.
 */
export async function openHeaderNavigation(page: Page): Promise<Locator> {
  const banner = page.getByRole("banner");
  const menuToggle = banner.getByRole("button");

  if (await menuToggle.isVisible()) {
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  }

  return banner.getByRole("navigation").filter({ visible: true });
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
