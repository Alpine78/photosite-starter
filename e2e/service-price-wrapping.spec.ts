import { getDeploymentConfig } from "../src/lib/deployment-config";
import { buildServicePath } from "../src/lib/locale-routes";
import { getServiceRoutes } from "../src/lib/services";
import { expect, test } from "./support/fixtures";

/** Verify actual line boxes, rather than asserting Tailwind class names. */
for (const locale of ["en-GB", "fi"]) {
  for (const width of [320, 1280]) {
    test(`price amounts and currency stay together at ${width}px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { localeRoutes } = getDeploymentConfig();
      const routes = await getServiceRoutes(locale);
      const priced = routes.filter(({ service }) => (service.pricing?.length ?? 0) > 0);
      expect(priced.length).toBeGreaterThan(0);

      await page.goto(buildServicePath(localeRoutes, locale));
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      let checkedCardPrices = 0;
      for (const { service, path } of routes) {
        if (service.startingPrice === undefined || service.hideFromListing) continue;
        const card = page.getByRole("main").locator(`a[href="${buildServicePath(localeRoutes, locale, path)}"]`);
        if (await card.count() === 0) continue;
        const price = card.getByText(service.startingPrice, { exact: true });
        await expect(price).toBeVisible();
        checkedCardPrices += 1;
        expect(await price.evaluate((element) => {
          const range = document.createRange(); range.selectNodeContents(element);
          return range.getClientRects().length;
        })).toBe(1);
      }

      expect(checkedCardPrices).toBeGreaterThan(0);
      for (const { service, path } of priced) {
        await page.goto(buildServicePath(localeRoutes, locale, path));
        // A package's definitions are its price, then its note when it has one (AB#384).
        const definitions = page.getByRole("main").getByRole("definition");
        await expect(definitions).toHaveText(
          service.pricing!.flatMap((entry) => entry.note ? [entry.price, entry.note] : [entry.price]));
        // Each price is the first definition of its package.
        const priceIndexes = new Set<number>();
        let position = 0;
        for (const entry of service.pricing!) {
          priceIndexes.add(position);
          position += entry.note ? 2 : 1;
        }
        // Synthetic stress copy on the actual rendered row; no CMS or fixture catalog change.
        await page.getByRole("main").getByRole("term").first().evaluate((element, language) => {
          element.textContent = language === "fi"
            ? "Pitkäkuvauspalvelunpaketinnimi ja useita lisäpalveluita samalla hinnalla"
            : "Anextendedphotographysessionpackage with additional coverage and delivery";
        }, locale);
        for (const price of (await definitions.all()).filter((_, index) => priceIndexes.has(index))) {
          const geometry = await price.evaluate((element) => {
            const range = document.createRange(); range.selectNodeContents(element);
            const box = element.getBoundingClientRect();
            return { lines: range.getClientRects().length, left: box.left, right: box.right };
          });
          expect(geometry.lines).toBe(1);
          expect(geometry.left).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(width);
        }
        const overflow = await page.getByRole("main").evaluate((element) => element.scrollWidth > element.clientWidth);
        expect(overflow).toBe(false);
        if (width === 320) {
          expect(await page.getByRole("main").getByRole("term").first().evaluate((element) => {
            const range = document.createRange(); range.selectNodeContents(element);
            return range.getClientRects().length;
          })).toBeGreaterThan(1);
        }
      }
    });
  }
}
