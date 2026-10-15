import { getBuiltInLabels } from "../src/lib/deployment-config";
import { mockContentListingRecords } from "../src/lib/mock-content-listing";
import { storyCardCallToAction } from "../src/lib/story-card-cta";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * A gallery card names how many photographs it opens (AB#298). Expectations
 * come from the same fixtures and wording the harness serves, never from
 * written-down copy: a clone replaces both the titles and the labels.
 */

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;

test("a gallery card's call-to-action carries the gallery's photograph count", async ({
  page,
  externalRequests,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const rootHref = await page
    .locator("#home-latest-stories")
    .getByRole("link")
    .first()
    .getAttribute("href");
  expect(rootHref).toBeTruthy();
  await page.goto(rootHref!, { waitUntil: "domcontentloaded" });

  const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
  const records = mockContentListingRecords[language]!;
  const cards = page
    .locator('section[aria-labelledby="branch-content"]')
    .getByRole("listitem")
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { level: 3 }) });
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  let counted = 0;
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const title = ((await card.locator("h3").textContent()) ?? "").trim();
    const record = [...records.values()].find((candidate) => candidate.title === title);
    if (record?.imageCount === undefined) continue;
    counted += 1;
    const expected = storyCardCallToAction(
      { variant: "gallery", imageCount: record.imageCount },
      labels,
    );
    await expect(card).toContainText(expected);
  }
  expect(counted).toBeGreaterThan(0);
  expect(externalRequests).toEqual([]);
});
