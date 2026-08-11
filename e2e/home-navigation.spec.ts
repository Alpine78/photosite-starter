import { expect, test } from "./support/fixtures";
import {
  expectImageDelivered,
  openHeaderNavigation,
} from "./support/public-page";

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
 * Route-specific journeys are separate stories that join this gate as their
 * features land: gallery sections (AB#119), curated gallery pagination
 * (AB#120), and the fuller contact journey (AB#89). The services routes, the
 * content tree, and the site menu itself already have their own suites in
 * `services.spec.ts`, `content-tree.spec.ts`, and `navigation.spec.ts`; what
 * stays here is the header doing its one job on the home page.
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

    await expectImageDelivered(
      page.getByRole("main").getByRole("img").first(),
    );
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
