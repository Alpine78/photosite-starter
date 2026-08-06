import { test as base, expect } from "@playwright/test";

type HarnessFixtures = {
  /**
   * Third-party requests the page attempted, in the order they were attempted.
   * Always empty in a passing test — the fixture asserts that itself — but a
   * test can read it to make the expectation explicit at the point it matters.
   */
  externalRequests: string[];
};

/**
 * Project test object. Every test gets the external-request guard.
 *
 * The guard exists because the project's privacy rule is a public-journey
 * property, not a code-review one: no tracking, no auto-loading third-party
 * embeds, no font or script fetched from someone else's origin. A request to
 * any origin other than the application under test is aborted and reported, so
 * a page that starts making one fails the suite instead of quietly working.
 *
 * It doubles as the "no real requests" boundary for external delivery. It is
 * registered on the browser context, and Playwright consults page handlers
 * before context handlers, so a journey that needs a controlled test adapter
 * for a browser-side external call registers its own `page.route(...)` stub in
 * the test and that stub answers first. Server-side delivery never reaches the
 * browser at all; its test adapter is selected through the harness environment
 * in `harness-environment.ts`.
 */
export const test = base.extend<HarnessFixtures>({
  externalRequests: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) {
        throw new Error(
          "[e2e] The external-request guard needs use.baseURL to know which origin is the application under test.",
        );
      }

      const applicationOrigin = new URL(baseURL).origin;
      const attempted: string[] = [];

      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();

        if (originOf(requestUrl) === applicationOrigin) {
          await route.continue();
          return;
        }

        attempted.push(requestUrl);
        await route.abort("blockedbyclient");
      });

      await use(attempted);

      expect(
        attempted,
        "The page under test requested a third-party origin. Public pages must not reach one, and a journey that needs an external call must stub it in the test.",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

/** An unparseable request URL is not the application's origin. */
function originOf(requestUrl: string): string | undefined {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return undefined;
  }
}

export { expect };
