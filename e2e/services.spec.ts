import type { Locator, Page } from "@playwright/test";
import { getServices, type Service } from "../src/lib/services";
import { expect, test } from "./support/fixtures";
import { DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import {
  expectImageDelivered,
  openHeaderNavigation,
} from "./support/public-page";

/**
 * The services journey: the listing, one service's detail page, the navigation
 * between them and into the story section, and the answer an address the site
 * does not serve gets.
 *
 * The articles half of this story is already served by `content-tree.spec.ts`:
 * AB#124 moved articles into the content tree, so their listing, their one
 * canonical detail route, the navigation between the two, and unknown-path
 * behaviour are journeys of the tree rather than of a `/blog` route. This file
 * covers what remained uncovered — the static services routes.
 *
 * What the assertions may name is limited on purpose. Service names, prices,
 * and copy are content a clone replaces wholesale, so expected text is derived
 * from the same adapter the harness serves rather than written down here, and
 * everything else is located by accessible role or by the application-owned
 * route it addresses.
 */

const SERVICES_PATH = "/services";
const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;

/** A slug the adapter cannot answer, in the shape a real one has. */
const UNKNOWN_SERVICE_PATH = `${SERVICES_PATH}/no-such-service`;

function detailPath(service: Service): string {
  return `${SERVICES_PATH}/${service.slug}`;
}

/** A listing card: the only links on the listing that carry a heading. */
function serviceCards(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { level: 2 }) });
}

/**
 * Breadcrumb steps. The separator is `aria-hidden`, so it is not a list item in
 * the accessibility tree and does not inflate the count.
 */
function breadcrumbSteps(page: Page): Locator {
  return page
    .getByRole("main")
    .getByRole("navigation")
    .first()
    .getByRole("listitem");
}

/**
 * The service the detail journey opens: one that has both a cover and a price
 * list, so the page's optional parts are exercised rather than skipped.
 */
async function serviceWithCoverAndPricing(): Promise<Service> {
  const service = (await getServices()).find(
    (candidate) =>
      candidate.coverMedia?.type === "image" &&
      candidate.pricing !== undefined &&
      candidate.pricing.length > 0,
  );

  if (service === undefined) {
    throw new Error("[e2e] The harness needs one priced service with a cover.");
  }

  return service;
}

test("the services listing addresses every service it lists", async ({
  page,
  externalRequests,
}) => {
  const services = await getServices();
  expect(services.length).toBeGreaterThan(0);

  await page.goto(SERVICES_PATH, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // One card per service, in the order the adapter returned them, each
  // addressing its own detail route: the listing neither drops a service nor
  // invents an address for one.
  const cards = serviceCards(page);
  await expect(cards).toHaveCount(services.length);
  expect(
    await cards.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    ),
  ).toEqual(services.map(detailPath));

  for (const card of await cards.all()) {
    await expect(card).toHaveAccessibleName(/\S/);
  }

  const covered = await serviceWithCoverAndPricing();
  await expectImageDelivered(
    page.locator(`a[href="${detailPath(covered)}"] img`),
  );

  expect(externalRequests).toEqual([]);
});

test("a service opens from its card and leads back to the listing", async ({
  page,
  externalRequests,
}) => {
  const service = await serviceWithCoverAndPricing();
  const path = detailPath(service);

  await test.step("a keyboard alone reaches and opens the service", async () => {
    await page.goto(SERVICES_PATH, { waitUntil: "domcontentloaded" });

    const card = page.getByRole("main").locator(`a[href="${path}"]`);
    await expect(card).toHaveCount(1);
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**${path}`);
  });

  await test.step("it renders its own description and uncropped cover", async () => {
    const article = page.getByRole("main").getByRole("article");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      service.name,
    );
    for (const paragraph of service.description) {
      await expect(article.getByText(paragraph, { exact: true })).toBeVisible();
    }

    const cover = article.getByRole("img");
    await expectImageDelivered(cover);
    // The cover is shown whole: its rendered box keeps the rendition's own
    // ratio instead of being cut to a fixed cell.
    const cropping = await cover.evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return {
        renderedRatio: box.width / box.height,
        intrinsicRatio: image.naturalWidth / image.naturalHeight,
        objectFit: getComputedStyle(image).objectFit,
      };
    });
    expect(cropping.objectFit).not.toBe("cover");
    expect(cropping.renderedRatio).toBeCloseTo(cropping.intrinsicRatio, 1);
  });

  await test.step("it lists what the service costs", async () => {
    const pricing = service.pricing ?? [];
    const main = page.getByRole("main");

    await expect(main.getByRole("term")).toHaveText(
      pricing.map((packaged) => packaged.name),
    );
    await expect(main.getByRole("definition")).toHaveText(
      pricing.map((packaged) => packaged.price),
    );
  });

  await test.step("it offers the contact route as its next step", async () => {
    const enquiry = page.getByRole("main").locator('a[href^="/contact"]');

    await expect(enquiry).toHaveCount(1);
    await expect(enquiry).toHaveAccessibleName(/\S/);
  });

  await test.step("it declares itself canonical at its own address", async () => {
    // A document-response contract, so it is verified on a direct load rather
    // than while Next.js is still reconciling the previous page's head.
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.locator("link[rel='canonical']")).toHaveCount(1);
    await expect(
      page.locator(`link[rel='canonical'][href$="${path}"]`),
    ).toHaveCount(1);
  });

  await test.step("its breadcrumb states where it lives and leads back there", async () => {
    const steps = breadcrumbSteps(page);

    // The listing, then this service. The page a visitor is on is text, not a
    // link back to itself.
    await expect(steps).toHaveCount(2);
    await expect(steps.last().getByRole("link")).toHaveCount(0);
    await expect(steps.last()).toHaveText(service.name);

    const back = steps.first().getByRole("link");
    await expect(back).toHaveAttribute("href", SERVICES_PATH);
    await back.click();
    await page.waitForURL(`**${SERVICES_PATH}`);
    await expect(serviceCards(page)).toHaveCount((await getServices()).length);
  });

  expect(externalRequests).toEqual([]);
});

test("a service without a cover or a price still renders completely", async ({
  page,
}) => {
  // Both are optional in the content model, and the mock layer keeps one
  // service of each shape for exactly this reason: a missing cover must not
  // leave a broken frame, and a service quoted per project must not imply a
  // price list it does not have.
  const services = await getServices();
  const withoutCover = services.find(
    (service) => service.coverMedia === undefined,
  );
  const withoutPricing = services.find(
    (service) => service.pricing === undefined || service.pricing.length === 0,
  );

  if (withoutCover === undefined || withoutPricing === undefined) {
    throw new Error(
      "[e2e] The harness needs a service without a cover and one without pricing.",
    );
  }

  await test.step("the cover-less service leads with its name", async () => {
    await page.goto(detailPath(withoutCover), { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      withoutCover.name,
    );
    await expect(page.getByRole("main").getByRole("img")).toHaveCount(0);
    await expect(
      page.getByRole("main").locator('a[href^="/contact"]'),
    ).toHaveCount(1);
  });

  await test.step("the unpriced service omits the price list, not the page", async () => {
    await page.goto(detailPath(withoutPricing), {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      withoutPricing.name,
    );
    await expect(page.getByRole("main").getByRole("term")).toHaveCount(0);
    await expect(
      page.getByRole("main").locator('a[href^="/contact"]'),
    ).toHaveCount(1);
  });
});

test("a slug no service answers to is a 404", async ({ page }) => {
  const response = await page.goto(UNKNOWN_SERVICE_PATH, {
    waitUntil: "domcontentloaded",
  });

  // Not a redirect to the listing and not a soft 200: an address the site never
  // published has to say so, to a visitor and to a crawler alike.
  expect(response?.status()).toBe(404);
  expect(new URL(page.url()).pathname).toBe(UNKNOWN_SERVICE_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

test("the chrome carries a visitor between the services and story sections", async ({
  page,
}) => {
  // The two public content sections a visitor moves between. Both routes come
  // from settings the harness owns rather than from a navigation label, which a
  // clone rebrands and a second locale renders differently.
  await page.goto(SERVICES_PATH, { waitUntil: "domcontentloaded" });

  const toStories = (await openHeaderNavigation(page)).locator(
    `a[href="${STORY_ROOT}"]`,
  );
  await expect(toStories).toHaveAccessibleName(/\S/);
  await toStories.click();
  await page.waitForURL(`**${STORY_ROOT}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // Reopened rather than reused: the compact layout closes its menu on
  // navigation, so the way back has to be found in the new page's own header.
  const toServices = (await openHeaderNavigation(page)).locator(
    `a[href="${SERVICES_PATH}"]`,
  );
  await toServices.click();
  await page.waitForURL(`**${SERVICES_PATH}`);
  await expect(serviceCards(page).first()).toBeVisible();

  const currentLink = (await openHeaderNavigation(page)).locator(
    `a[href="${SERVICES_PATH}"]`,
  );
  await expect(currentLink).toHaveAttribute("aria-current", "page");
});
