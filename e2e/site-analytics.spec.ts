import { expect, test } from "./support/fixtures";

/**
 * Site analytics is an opt-in adapter that is off unless a production
 * deployment selects a provider (ADR-0037). The harness never does, so these
 * journeys pin the default a clone inherits: no provider script, no provider
 * request, and no cookie. They run against a production build, the same code
 * the deployed site serves; the provider's own behaviour on a deployed site is
 * a manual check recorded in `docs/analytics-data-flow.md`.
 */
test.describe("site analytics default", () => {
  test("loads no provider script and requests nothing under /_vercel", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));

    await page.goto("/");
    await page.waitForLoadState("load");

    expect(await page.locator('script[src*="/_vercel/"]').count()).toBe(0);
    expect(requested.filter((path) => path.startsWith("/_vercel"))).toEqual([]);
  });

  test("sets no cookie and writes no analytics storage on the home page", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForLoadState("load");

    expect(await context.cookies()).toEqual([]);
    const analyticsKeys = await page.evaluate(() =>
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) =>
        /^(va|vercel|_vercel)/i.test(key),
      ),
    );
    expect(analyticsKeys).toEqual([]);
  });
});
