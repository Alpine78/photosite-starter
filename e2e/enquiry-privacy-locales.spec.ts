import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels, getDeploymentConfig } from "../src/lib/deployment-config";
import { buildStoryPath } from "../src/lib/locale-routes";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { buildStaticPagePath } from "../src/lib/static-page-routes";
import { HARNESS_BASE_URL } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

const routes = getDeploymentConfig().localeRoutes;

test.describe("gallery enquiry privacy follows its page language", () => {
  test.use({ javaScriptEnabled: false });

  for (const route of routes.locales) {
    test(`${route.locale} reuses its authored contact notice without a foreign-language fallback`, async ({ page }) => {
      const labels = getBuiltInLabels(route.locale);
      const contactNotices = new Map<string, string[]>();
      for (const contactLocale of routes.locales) {
        const contactLabels = getBuiltInLabels(contactLocale.locale);
        const response = await page.goto(buildStaticPagePath(routes, contactLocale.locale, "contact"));
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: contactLabels.pages.contact })).toBeVisible();
        const notice = page.getByRole("main").locator("details").filter({
          has: page.locator("summary").filter({ hasText: contactLabels.contact.privacyTitle }),
        });
        await notice.locator("summary").click();
        await expect(notice.getByRole("definition")).toHaveCount(4);
        const definitions = await notice.getByRole("definition").allTextContents();
        expect(definitions.every((value) => value.trim().length > 0)).toBe(true);
        contactNotices.set(contactLocale.locale, definitions);
      }
      const expected = contactNotices.get(route.locale)!;
      for (const [locale, opposite] of contactNotices) {
        if (locale === route.locale) continue;
        for (let index = 0; index < 4; index++) expect(expected[index]).not.toBe(opposite[index]);
      }

      const input = mockContentTreeInputs[new Intl.Locale(route.locale).language];
      if (input === undefined) throw new Error("The fixture locale has no content tree");
      const path = getCanonicalContentPath(buildContentTree(input), "content-selected-work");
      if (path === null) throw new Error("The fixture locale has no selected-work gallery");
      const galleryPath = buildStoryPath(routes, route.locale, path);
      await page.goto(galleryPath);
      const firstItem = page.locator("#gallery [data-item-id]").first();
      const itemId = await firstItem.getAttribute("data-item-id");
      expect(itemId).toBeTruthy();
      const response = await page.goto(`${galleryPath}?enquire=${encodeURIComponent(itemId!)}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: labels.enquiry.pageTitle })).toBeVisible();
      const notice = page.getByRole("main").getByRole("region", { name: labels.contact.privacyTitle });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole("definition")).toHaveText(expected);
      await expect(notice.getByRole("term")).toHaveText([
        labels.contact.privacyCollected, labels.contact.privacyPurpose,
        labels.contact.privacyRecipient, labels.contact.privacyRetention,
      ]);
      const back = page.getByRole("link", { name: labels.enquiry.backToGallery });
      await expect(back).toHaveAttribute("href", galleryPath);
      await back.click();
      await expect(page).toHaveURL(new URL(galleryPath, HARNESS_BASE_URL).href);
    });
  }
});
