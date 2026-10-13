import type { Locator, Page } from "@playwright/test";
import { getBuiltInLabels, getDeploymentConfig } from "../src/lib/deployment-config";
import { buildServicePath } from "../src/lib/locale-routes";
import { getServiceRoutes, getServices, type Service } from "../src/lib/services";
import { buildStaticPagePath } from "../src/lib/static-page-routes";
import { expect, test } from "./support/fixtures";
import {
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";
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
const PREFIXED_SERVICES_PATH = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.serviceNamespace}`;
const PREFIXED_STORY_ROOT = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`;

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

test("a prefixed locale keeps its service and story namespaces separate", async ({
  page,
}) => {
  const services = await getServices(PREFIXED_LOCALE.prefix);
  const service = services[0];
  expect(service).toBeDefined();

  const listingResponse = await page.goto(PREFIXED_SERVICES_PATH, {
    waitUntil: "domcontentloaded",
  });
  expect(listingResponse?.status()).toBe(200);
  await expect(serviceCards(page)).toHaveCount(services.length);
  await expect(
    page.getByRole("main").locator(
      `a[href="${PREFIXED_SERVICES_PATH}/${service.slug}"]`,
    ),
  ).toHaveCount(1);

  const detailResponse = await page.goto(
    `${PREFIXED_SERVICES_PATH}/${service.slug}`,
    { waitUntil: "domcontentloaded" },
  );
  expect(detailResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(service.name);

  // Both namespaces enter the same catch-all. A service route must therefore
  // leave the sibling story namespace for the story resolver instead of
  // treating its second segment as a generic service namespace.
  const storyResponse = await page.goto(PREFIXED_STORY_ROOT, {
    waitUntil: "domcontentloaded",
  });
  expect(storyResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
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

const deployment = getDeploymentConfig();
const localeRoutes = deployment.localeRoutes;

for (const localeRoute of localeRoutes.locales) {
  const locale = localeRoute.locale;
  const labels = getBuiltInLabels(locale);
  const listingPath = buildServicePath(localeRoutes, locale);
  const contactPath = buildStaticPagePath(localeRoutes, locale, "contact");

  test(`service labels, media and contact prefill retain ${locale}`, async ({ page }) => {
    const routes = await getServiceRoutes(locale);
    const priced = routes.find(({ service, path }) =>
      path.length === 1 && service.coverMedia?.type === "image" && service.pricing?.length,
    );
    if (!priced || priced.service.coverMedia?.type !== "image") {
      throw new Error("[e2e] A top-level priced service with a cover is required.");
    }
    const { service } = priced;
    const coverMedia = service.coverMedia;
    if (coverMedia?.type !== "image") throw new Error("[e2e] An image cover is required.");
    const path = buildServicePath(localeRoutes, locale, priced.path);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(service.name);
    await expect(page.getByRole("heading", { name: labels.services.pricing, exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("term")).toHaveText(service.pricing!.map(({ name }) => name));
    const cover = page.getByRole("article").getByRole("img");
    await expectImageDelivered(cover);
    await expect(cover).toHaveAttribute("alt", coverMedia.alt);
    await expect(cover).toHaveAttribute("width", String(coverMedia.rendition.width));
    await expect(cover).toHaveAttribute("height", String(coverMedia.rendition.height));
    const frame = await cover.evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return {
        renderedRatio: box.width / box.height,
        intrinsicRatio: image.naturalWidth / image.naturalHeight,
        objectFit: getComputedStyle(image).objectFit,
      };
    });
    expect(frame.objectFit).not.toBe("cover");
    expect(frame.renderedRatio).toBeCloseTo(frame.intrinsicRatio, 1);
    const breadcrumb = page.getByRole("main").getByRole("navigation", { name: labels.navigation.breadcrumb });
    await expect(breadcrumb.getByRole("link").first()).toHaveAttribute("href", listingPath);
    const enquiry = page.getByRole("main").locator(`a[href="${contactPath}?service=${encodeURIComponent(service.serviceId)}"]`);
    await expect(enquiry).toContainText(labels.actions.contactAboutService);
    await enquiry.click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("combobox", { name: labels.contact.subjectLabel })).toHaveValue(service.serviceId);
    await expect(page.getByRole("option", { name: service.name, exact: true })).toBeAttached();
  });

  test(`nested service breadcrumbs and real alternates retain ${locale}`, async ({ page }) => {
    const routes = await getServiceRoutes(locale);
    const nested = routes.find(({ path }) => path.length > 1);
    if (!nested) throw new Error("[e2e] A nested service is required.");
    const path = buildServicePath(localeRoutes, locale, nested.path);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(nested.service.name);
    const breadcrumb = page.getByRole("main").getByRole("navigation", { name: labels.navigation.breadcrumb });
    await expect(breadcrumb.getByRole("link").first()).toHaveAttribute("href", listingPath);
    const parent = routes.find(({ path: candidate }) => candidate.length === nested.path.length - 1 && candidate.every((segment, index) => segment === nested.path[index]));
    if (!parent) throw new Error("[e2e] The nested service's parent is required.");
    await expect(breadcrumb.getByRole("link", { name: parent.service.name, exact: true })).toHaveAttribute("href", buildServicePath(localeRoutes, locale, parent.path));
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new URL(path, deployment.canonicalBaseUrl).toString());
    for (const target of localeRoutes.locales) {
      const counterpart = (await getServiceRoutes(target.locale)).find(({ service }) => service.serviceId === nested.service.serviceId);
      if (!counterpart) throw new Error("[e2e] Each fixture locale needs the same nested service identity.");
      const targetPath = buildServicePath(localeRoutes, target.locale, counterpart.path);
      await expect(page.locator(`link[rel="alternate"][hreflang="${target.locale}"]`)).toHaveAttribute("href", new URL(targetPath, deployment.canonicalBaseUrl).toString());
    }
  });

  test(`an unknown service keeps its 404 response in ${locale}`, async ({ request }) => {
    const path = `${listingPath}/no-such-service`;
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(new URL(response.url()).pathname).toBe(path);
  });
}

test.describe("nested service language navigation without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the equivalent service opens in both directions", async ({ page }) => {
    const [first, second] = localeRoutes.locales;
    if (!second) throw new Error("[e2e] Two fixture locales are required.");
    const nested = (await getServiceRoutes(first.locale)).find(({ path }) => path.length > 1);
    if (!nested) throw new Error("[e2e] A nested service is required.");
    await page.goto(buildServicePath(localeRoutes, first.locale, nested.path));
    for (const target of [second, first]) {
      const counterpart = (await getServiceRoutes(target.locale)).find(({ service }) => service.serviceId === nested.service.serviceId);
      if (!counterpart) throw new Error("[e2e] A nested service counterpart is required.");
      const path = buildServicePath(localeRoutes, target.locale, counterpart.path);
      await page.getByRole("main").locator(`a[hreflang="${target.locale}"]`).click();
      await expect(page).toHaveURL(new URL(path, page.url()).toString());
      await expect(page.locator("html")).toHaveAttribute("lang", target.locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(counterpart.service.name);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new URL(path, deployment.canonicalBaseUrl).toString());
    }
  });
});
