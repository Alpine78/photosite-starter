import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";
import { PREFIXED_LOCALE } from "./support/harness-environment";
import { expectImageDelivered, headerMenuToggle } from "./support/public-page";

/**
 * The header brand (AB#187): the mark and its dark-theme variant beside the
 * brand text, and the site name authored per language.
 *
 * Nothing here names the site, the photographer, or a mark file. A clone
 * rebrands all of them, so the brand is compared with the page's own
 * `og:site_name` — which the fixture, like the design proposal, authors as the
 * descriptor and the name read together — and each mark is measured against
 * its own intrinsic pixels. The fixture's marks are 3:2, so a layout forcing
 * them square would fail the ratio check.
 */

/** Application-owned routes, one per configured route space. */
const ROUTES = ["/", `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`];

/** The design proposal's mark height: 33px below `sm`, 43px from it. */
const SM_BREAKPOINT_PX = 640;

function brand(page: Page): Locator {
  // The brand is the first child of the bar: a link where the locale has a
  // home route, plain text where it does not yet.
  return page.getByRole("banner").locator(":scope > div:first-child > :first-child");
}

async function openGraphSiteName(page: Page): Promise<string> {
  const siteName = await page
    .locator('meta[property="og:site_name"]')
    .getAttribute("content");
  expect(siteName).toBeTruthy();
  return siteName!;
}

/** The brand's visible text, its lines joined in reading order. */
async function visibleBrandText(page: Page): Promise<string> {
  return brand(page).evaluate((element) =>
    (element as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
  );
}

test("the brand names the site in the locale it renders", async ({ page }) => {
  const [defaultRoute, prefixedRoute] = ROUTES;

  await page.goto(defaultRoute, { waitUntil: "domcontentloaded" });
  const defaultName = await openGraphSiteName(page);
  await expect(page.getByRole("banner").getByRole("link").first()).toHaveAccessibleName(
    defaultName,
  );
  // Compared case-insensitively: the descriptor line is uppercased by CSS.
  expect((await visibleBrandText(page)).toLowerCase()).toBe(defaultName.toLowerCase());

  // A prefixed locale has no home route of its own yet, so its brand is plain
  // text rather than a link — still this locale's name, not the default's.
  await page.goto(prefixedRoute, { waitUntil: "domcontentloaded" });
  const prefixedName = await openGraphSiteName(page);
  expect((await visibleBrandText(page)).toLowerCase()).toBe(prefixedName.toLowerCase());
});

test("one mark shows per theme, at its native ratio inside the bar, at every width", async ({
  page,
}) => {
  const shownSources = new Map<string, string>();

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const label = `${colorScheme} at ${width}px`;

      // Decorative beside the visible name, so they add nothing to its name.
      const marks = brand(page).locator("img");
      await expect(marks.first()).toHaveAttribute("alt", "");
      const shown = marks.filter({ visible: true });
      await expect(shown, label).toHaveCount(1);
      await expectImageDelivered(shown);

      const geometry = await shown.evaluate((element) => {
        const image = element as HTMLImageElement;
        const box = image.getBoundingClientRect();
        return {
          src: image.currentSrc,
          width: box.width,
          height: box.height,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        };
      });
      shownSources.set(colorScheme, new URL(geometry.src).searchParams.get("url") ?? geometry.src);

      const nativeRatio = geometry.naturalWidth / geometry.naturalHeight;
      expect(geometry.width / geometry.height, label).toBeCloseTo(nativeRatio, 1);
      expect(geometry.height, label).toBeLessThanOrEqual(
        width < SM_BREAKPOINT_PX ? 33.5 : 43.5,
      );
      expect(geometry.width, label).toBeLessThanOrEqual(160.5);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        label,
      ).toBeLessThanOrEqual(width);

      // The brand never runs under the controls beside it.
      const brandBox = await brand(page).boundingBox();
      const toggle = headerMenuToggle(page);
      const controls = (await toggle.isVisible())
        ? toggle
        : page.getByRole("banner").getByRole("navigation").filter({ visible: true });
      const controlsBox = await controls.boundingBox();
      expect(brandBox, label).not.toBeNull();
      expect(controlsBox, label).not.toBeNull();
      expect(brandBox!.x + brandBox!.width, label).toBeLessThanOrEqual(controlsBox!.x);
    }
  }

  // The fixture authors a dark variant, so each theme shows its own mark.
  expect(shownSources.get("light")).not.toBe(shownSources.get("dark"));
});

test("the pinned theme picks the mark too, not only the device preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shown = () => brand(page).locator("img").filter({ visible: true });
  const lightSource = await shown().getAttribute("src");

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(shown()).toHaveCount(1);
  expect(await shown().getAttribute("src")).not.toBe(lightSource);
});
