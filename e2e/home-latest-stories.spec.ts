import { applyMockEndDateGate } from "../src/lib/content";
import { buildLatestContent, buildLatestContentQuery } from "../src/lib/content-listing";
import { buildContentTree } from "../src/lib/content-tree";
import { mockContentListingRecords, mockContentUpdatedAt } from "../src/lib/mock-content-listing";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getServices } from "../src/lib/services";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";
import { expectImageDelivered } from "./support/public-page";

/**
 * The home page's latest stories (AB#252) and a service's package list.
 *
 * Expectations are derived from the same fixtures the harness serves, never
 * written down: titles are content a clone replaces. The fixtures give two
 * pages an update instant that disagrees with their event-date order, so the
 * test fails if the section sorted by event date instead.
 */

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const LATEST_COUNT = 2;

function expectedLatestTitles(): string[] {
  const tree = buildContentTree(
    applyMockEndDateGate(mockContentTreeInputs[language]!, language, new Date()),
  );
  const records = buildLatestContentQuery({ tree, limit: LATEST_COUNT }).contentIds.flatMap((id) => {
    const record = mockContentListingRecords[language]?.get(id);
    const updatedAt = mockContentUpdatedAt[language]?.get(id);
    return record === undefined || updatedAt === undefined ? [] : [{ ...record, updatedAt }];
  });
  return buildLatestContent({ tree, records, limit: LATEST_COUNT }).map((entry) => entry.title);
}

test("the home page lists the most recently updated stories, not the newest by event date", async ({
  page,
  externalRequests,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const section = page.locator("#home-latest-stories");
  await expect(section).toBeVisible();
  const heading = section.getByRole("heading", { level: 2 });
  await expect(heading).toHaveCount(1);

  const cards = section.getByRole("list").getByRole("link");
  await expect(cards).toHaveCount(LATEST_COUNT);
  const titles = await cards.evaluateAll((links) =>
    links.map((link) => link.querySelector("h3")?.textContent?.trim() ?? ""),
  );
  expect(titles).toEqual(expectedLatestTitles());

  // Every card is one link with a decorative-arrow call-to-action (AB#298):
  // no nested interactive element, and the arrow stays out of the name.
  for (const card of await cards.all()) {
    await expect(card.locator("a, button")).toHaveCount(0);
    const arrow = card.locator('[aria-hidden="true"]', { hasText: "→" });
    await expect(arrow).toHaveCount(1);
    const cta = arrow.locator("..");
    expect(((await cta.textContent()) ?? "").replace("→", "").trim().length).toBeGreaterThan(0);
    expect(await card.getAttribute("aria-label")).toBeNull();
  }

  // Each card leads to a real story page, and the section links to the root.
  const firstHref = await cards.first().getAttribute("href");
  const allStories = section.getByRole("link").first();
  const rootHref = await allStories.getAttribute("href");
  expect(rootHref).toBeTruthy();
  expect(firstHref!.startsWith(rootHref!)).toBe(true);

  const image = cards.first().locator("img");
  if ((await image.count()) > 0) {
    // Lazy below the fold: bring it in so the browser actually fetches it.
    await image.scrollIntoViewIfNeeded();
    await expectImageDelivered(image);
  }

  await cards.first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(titles[0]!);
  expect(externalRequests).toEqual([]);
});

for (const route of [
  { name: "prefixed", services: () => getServices(PREFIXED_LOCALE.prefix), base: `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.serviceNamespace}` },
  { name: "default", services: () => getServices(), base: "/services" },
]) {
test(`a service lists its packages as headings with their covers, and each opens (${route.name} route)`, async ({
  page,
  externalRequests,
}) => {
  const services = await route.services();
  const parent = services.find((service) =>
    services.some((candidate) => candidate.parentServiceId === service.serviceId),
  );
  if (parent === undefined) throw new Error("[e2e] The harness needs one service with packages.");
  const children = services.filter((service) => service.parentServiceId === parent.serviceId);
  const base = route.base;

  await page.goto(`${base}/${parent.slug}`, { waitUntil: "domcontentloaded" });

  const section = page.locator("#service-packages-heading").locator("xpath=..");
  await expect(section.getByRole("heading", { level: 2 })).toHaveCount(1);
  const links = section.getByRole("list").getByRole("link");
  await expect(links).toHaveCount(children.length);
  expect(
    await links.evaluateAll((nodes) => nodes.map((node) => node.querySelector("h3")?.textContent?.trim())),
  ).toEqual(children.map((child) => child.name));
  expect(
    await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
  ).toEqual(children.map((child) => `${base}/${parent.slug}/${child.slug}`));

  // A package's cover keeps its native ratio.
  const covered = section.locator("img").first();
  if ((await covered.count()) > 0) {
    await covered.scrollIntoViewIfNeeded();
    await expectImageDelivered(covered);
    const geometry = await covered.evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return { ratio: box.width / box.height, native: image.naturalWidth / image.naturalHeight };
    });
    expect(geometry.ratio).toBeCloseTo(geometry.native, 1);
  }

  await links.first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(children[0]!.name);
  expect(externalRequests).toEqual([]);
});
}
