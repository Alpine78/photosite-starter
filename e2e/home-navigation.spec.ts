import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/**
 * The smoke test that proves the harness: a production build boots, serves the
 * site root, optimizes an image, and navigates between routes in every browser
 * of the configured matrix.
 *
 * Assertions stay generic on purpose. A clone rebrands the site name and its
 * navigation labels, so the test derives them from the running page instead of
 * hardcoding them, and identifies links by the application-owned route they
 * point at. What it pins down is structure a clone must keep: landmarks, one
 * level-one heading, a titled document, a loaded hero image, and a navigation
 * link that marks the current page.
 *
 * Route-specific journeys — services and articles, gallery sections,
 * pagination, contact — are separate stories that join this gate as their
 * features land (AB#87, AB#119, AB#120, AB#90).
 */

/** Application-owned route, not authored content: safe to name here. */
const PORTFOLIO_PATH = "/portfolio";

test("the home page renders and its header navigates to a section", async ({
  page,
  externalRequests,
}) => {
  await test.step("the home page renders its chrome, title, and hero image", async () => {
    // Document ready, not the load event: waiting for every subresource makes
    // navigation hostage to the slowest lazy image. What must actually arrive
    // is asserted below, explicitly.
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveTitle(/\S/);

    const banner = page.getByRole("banner");
    await expect(banner).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    // The brand link and the level-one heading both render the configured site
    // name, so they agree without the test knowing what that name is.
    const siteName = (
      await banner.getByRole("link").first().textContent()
    )?.trim();
    expect(siteName).toBeTruthy();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName!);

    // A visible <img> proves layout; a non-zero natural width proves the
    // production image pipeline actually delivered bytes.
    const hero = page.getByRole("main").getByRole("img").first();
    await expect(hero).toBeVisible();
    await expect
      .poll(
        () =>
          hero.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        // Longer than the default assertion timeout: the first request for a
        // rendition pays for optimizing it, on a cold cache and a cold agent.
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });

  await test.step("the header navigates to the portfolio route", async () => {
    const portfolioLink = (await openHeaderNavigation(page)).locator(
      `a[href="${PORTFOLIO_PATH}"]`,
    );
    await expect(portfolioLink).toHaveRole("link");
    await expect(portfolioLink).toHaveAccessibleName(/\S/);

    await portfolioLink.click();
    await page.waitForURL(`**${PORTFOLIO_PATH}`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("img").first(),
    ).toBeVisible();
  });

  await test.step("the navigation marks the route it is on", async () => {
    // Reopened rather than reused: the compact layout closes its menu on
    // navigation, so the assertion has to work from the new page's own header.
    const currentLink = (await openHeaderNavigation(page)).locator(
      `a[href="${PORTFOLIO_PATH}"]`,
    );
    await expect(currentLink).toHaveAttribute("aria-current", "page");
  });

  // Stated here as well as enforced by the guard fixture: a public page of this
  // site loads nothing from a third-party origin.
  expect(externalRequests).toEqual([]);
});

/**
 * Returns the header navigation for the current viewport. The compact layout
 * keeps it behind a toggle and the wide layout renders it inline, so a journey
 * that runs on both asks for it this way rather than assuming one of them.
 */
async function openHeaderNavigation(page: Page): Promise<Locator> {
  const banner = page.getByRole("banner");
  const menuToggle = banner.getByRole("button");

  if (await menuToggle.isVisible()) {
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  }

  return banner.getByRole("navigation").filter({ visible: true });
}
