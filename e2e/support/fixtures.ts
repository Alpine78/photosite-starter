import { createHash } from "node:crypto";

import { test as base, expect } from "@playwright/test";

type HarnessFixtures = {
  /**
   * Third-party requests the page attempted, in the order they were attempted.
   * Always empty in a passing test — the fixture asserts that itself — but a
   * test can read it to make the expectation explicit at the point it matters.
   */
  externalRequests: string[];

  /**
   * The synthetic address this test's requests arrive from. Reading it is
   * rarely necessary; the fixture applies it whether or not a test asks.
   */
  clientAddress: string;
};

/**
 * A documentation-only address, unique to one test run.
 *
 * `2001:db8::/32` is reserved by RFC 3849 for documentation and is not
 * routable, so nothing here resembles a real visitor. Sixty-four bits of digest
 * make a collision between two tests a non-event rather than a rare, confusing
 * one.
 */
function syntheticClientAddress(identity: string): string {
  const digest = createHash("sha256").update(identity).digest("hex");
  const groups = [0, 4, 8, 12].map((offset) =>
    digest.slice(offset, offset + 4),
  );
  return ["2001", "db8", "0", "0", ...groups].join(":");
}

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

  /**
   * Each test arrives as its own client.
   *
   * The contact endpoint throttles per client, deriving that client from the
   * proxy header a hosting platform sets. Every browser in the matrix reaches
   * the harness server over loopback, so without this they would share one
   * bucket: the whole suite's submissions, across both projects and any CI
   * retry, would count against a single allowance and a later journey would
   * start failing on a 429 that has nothing to do with what it tests.
   *
   * The identity includes the project and the retry index, so a retried test
   * gets a fresh allowance rather than inheriting the spent one that a flaky
   * first attempt left behind. Setting the header is also what a deployment
   * behind a proxy does, so the endpoint sees the shape of request it was
   * written for instead of an addressless one.
   */
  clientAddress: [
    async ({ context }, use, testInfo) => {
      const address = syntheticClientAddress(
        [
          ...testInfo.titlePath,
          testInfo.project.name,
          testInfo.repeatEachIndex,
          testInfo.retry,
        ].join(" › "),
      );

      await context.setExtraHTTPHeaders({ "x-forwarded-for": address });
      await use(address);
    },
    { auto: true },
  ],

  /**
   * The same synthetic address for `request`, Playwright's API context.
   *
   * `context.setExtraHTTPHeaders` above reaches only browser-originated
   * requests. An `APIRequestContext` is a separate client, so a spec that posts
   * to an endpoint directly — the way the administrator, exchange, and enquiry
   * journeys check a boundary without a page — arrived with **no** forwarded
   * address at all, and `deriveClientKey` hashes an empty string. Every such
   * call in the whole matrix therefore shared one throttle bucket.
   *
   * That was not theoretical: `private-gallery-admin.spec.ts` posts to the
   * sign-in endpoint 9 times, twice over for the two projects, against an
   * in-process limit of 20 per client. Eighteen of twenty, before CI's `retries:
   * 1` adds any. The nineteenth would have failed on a throttle that has nothing
   * to do with what the test asserts — and, being a rate limit, it would have
   * cascaded into every later admin case in that run.
   *
   * Overriding the built-in fixture keeps the rule in one place rather than
   * asking each spec to remember a header.
   */
  request: async ({ playwright, baseURL, clientAddress }, use) => {
    const context = await playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      extraHTTPHeaders: { "x-forwarded-for": clientAddress },
    });
    // Playwright's fixture callback parameter is also named `use`; the rule
    // reads it as React's hook because this fixture's inferred name is a bare
    // noun. Nothing in this file is React, and the array-form fixtures above
    // escape the same false positive only because their functions are
    // anonymous.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(context);
    await context.dispose();
  },
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
