import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * AB#372: below the two-column width an article's contents list sits behind a
 * sticky bar that opens it as a sheet, and sections other than the current one
 * start collapsed. Reveal the complete list the way a reader would: open the
 * sheet when the bar is shown, then expand every collapsed section.
 */
export async function revealContents(page: Page, name: string): Promise<Locator> {
  const bar = page.locator("[aria-haspopup='dialog'][aria-controls]");
  if (await bar.isVisible()) {
    const sheet = page.getByRole("dialog", { name });
    // The bar is server-rendered; it opens the sheet once hydrated.
    await expect(async () => {
      if (!(await sheet.isVisible())) await bar.click({ timeout: 1000 });
      await expect(sheet).toBeVisible({ timeout: 1000 });
    }).toPass();
  }
  const nav = page.getByRole("navigation", { name });
  for (const toggle = nav.getByRole("button", { expanded: false }); await toggle.count() > 0;) await toggle.first().click();
  return nav;
}
