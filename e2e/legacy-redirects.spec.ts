import {
  resolveLegacyGoneLanguage,
  resolveLegacyGoneRoute,
} from "../src/lib/legacy-redirects";
import {
  ALREADY_LIVE_LEGACY_PATHS,
  EXCLUDED_LEGACY_PATHS,
  PENDING_LEGACY_PATHS,
} from "../src/lib/legacy-redirects-tracking";
import { RETIRED_TAG_PATHS } from "../src/lib/legacy-redirects-data";
import { buildLocaleRouteConfig } from "../src/lib/locale-routes";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";

/**
 * AB#19's decided rows against the production build the harness serves.
 *
 * `legacy-redirects.test.ts` and `legacy-redirects-data.test.ts` already
 * prove the registry's own logic and its completeness against the crawl
 * inventory in isolation; this journey proves the real Next.js Proxy
 * actually answers with a genuine 410 for a sample of the decided rows, in
 * the locale the request path itself names (Finnish for an unprefixed
 * source, English for an `/en/...` one) rather than always the deployment's
 * default — not just that `resolveLegacyRedirect` returns the right value —
 * and that this pass did not widen what 404s: a pending row (no decision
 * yet), an excluded row, and a legacy-shaped path the crawl never saw all
 * still get the site's ordinary not-found behavior.
 *
 * No `redirect` row exists yet (every decided row this pass is `gone`), so
 * there is no 301 journey here — that gap is deliberate, not an oversight;
 * see `legacy-redirects-tracking.ts` for what remains open.
 */

/**
 * The same locale route configuration the harness's own deployment settings
 * describe (`sitemap-robots.spec.ts` builds it the same way), so the
 * expected locale below comes from the harness's actual wiring rather than
 * from this project's production locale assignment — which the harness
 * deliberately inverts (English default, Finnish prefixed) precisely so a
 * test cannot get away with assuming production's specific layout.
 */
const harnessLocaleRoutes = buildLocaleRouteConfig({
  locales: [
    {
      locale: appUnderTestEnvironment.SITE_LOCALE,
      prefix: null,
      storyNamespace: DEFAULT_STORY_NAMESPACE,
    },
    {
      locale: PREFIXED_LOCALE.prefix,
      prefix: PREFIXED_LOCALE.prefix,
      storyNamespace: PREFIXED_LOCALE.storyNamespace,
    },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

const GONE_COPY_BY_LANGUAGE = {
  fi: { heading: "410 Sivu poistettu", linkName: "Etusivulle" },
  en: { heading: "410 Gone", linkName: "Go to the homepage" },
} as const;

/**
 * None of `RETIRED_TAG_PATHS` start with the harness's prefixed locale's own
 * prefix (production's tag pages are `/component/...` and
 * `/en/component/...`; the harness's prefixed locale is `fi`, not `en`), so
 * every sample here resolves to the harness's *default* locale regardless of
 * path — proving the wiring is correct for at least one real locale
 * end-to-end, including its link back to that locale's own home page.
 * `resolveLegacyGoneRoute` and `buildLegacyGoneHtml`'s own Vitest suites are
 * what prove path-to-locale selection and the non-default-locale link target
 * (that locale's story root, not its home page, which does not exist yet)
 * across more than one configured prefix; duplicating that here would need a
 * decided row under the harness's actual prefix, which does not exist in
 * this pass's data.
 *
 * `RETIRED_TAG_PATHS` is first-site data (see `legacy-redirects-data.ts`'s
 * own comment) that a clone empties to `[]`, so every sample below is
 * `undefined` for such a clone — filtered out here rather than passed to
 * `page.goto`, which the tests below skip entirely once nothing is left to
 * sample, keeping the suite green for a clone with no legacy rows of its own
 * rather than failing before it ever reaches the application under test.
 */
const SAMPLE_GONE_PATHS = [
  RETIRED_TAG_PATHS[0],
  RETIRED_TAG_PATHS[Math.floor(RETIRED_TAG_PATHS.length / 2)],
  RETIRED_TAG_PATHS[RETIRED_TAG_PATHS.length - 1],
  RETIRED_TAG_PATHS.find((path) => path.startsWith("/en/")),
].filter((path): path is string => path !== undefined);

test("a decided legacy tag page answers 410 with an accessible body in the request's own locale", async ({
  page,
}) => {
  test.skip(
    SAMPLE_GONE_PATHS.length === 0,
    "no decided legacy rows in this clone's data",
  );

  for (const path of SAMPLE_GONE_PATHS) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    const expectedRoute = resolveLegacyGoneRoute(harnessLocaleRoutes, path);
    const expectedLanguage = resolveLegacyGoneLanguage(expectedRoute.locale);
    const copy = GONE_COPY_BY_LANGUAGE[expectedLanguage];

    expect(response?.status(), path).toBe(410);
    expect(response?.headers()["content-type"]).toContain("text/html");
    expect(response?.headers()["content-language"]).toBe(expectedLanguage);
    expect(response?.headers()["cache-control"]).toContain("max-age=3600");
    expect(
      await page.evaluate(() => document.documentElement.lang),
      path,
    ).toBe(expectedLanguage);

    await expect(
      page.getByRole("heading", { name: copy.heading }),
    ).toBeVisible();
    const homeLink = page.getByRole("link", { name: copy.linkName });
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute(
      "href",
      expectedRoute.isDefault ? "/" : `${expectedRoute.basePath}/${expectedRoute.storyNamespace}`,
    );
  }
});

test("a decided legacy tag page's query string rides through unexamined", async ({
  page,
}) => {
  test.skip(
    RETIRED_TAG_PATHS.length === 0,
    "no decided legacy rows in this clone's data",
  );

  const response = await page.goto(`${RETIRED_TAG_PATHS[0]}?start=20`, {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(410);
});

test("a numeric gallery lightbox query state (the crawl's own /?4738 shape) does not change a decided legacy path's outcome", async ({
  page,
}) => {
  test.skip(
    RETIRED_TAG_PATHS.length === 0,
    "no decided legacy rows in this clone's data",
  );

  // A bare, key-less numeric flag — Joomla's own per-image lightbox query
  // state, layered on a page URL rather than a distinct crawled route (see
  // `legacy-redirects-tracking.ts`). A 410 has no destination URL to rewrite,
  // so the only assertion available at this layer is that the response is
  // still the row's own decided outcome; `legacy-redirects.test.ts` proves
  // the byte-for-byte forwarding a future `redirect` row would need.
  const response = await page.goto(`${RETIRED_TAG_PATHS[0]}?4738`, {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(410);
});

test("a decided legacy path's trailing-slash variant still resolves to the same outcome in one extra hop, not a chain onto a live target", async ({
  page,
}) => {
  test.skip(
    RETIRED_TAG_PATHS.length === 0,
    "no decided legacy rows in this clone's data",
  );

  const navigationStatuses: number[] = [];
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) {
      navigationStatuses.push(response.status());
    }
  });

  const response = await page.goto(`${RETIRED_TAG_PATHS[0]}/`, {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(410);
  // The generic trailing-slash normalization redirect, then the terminal
  // 410 — never a redirect landing on another redirect.
  expect(navigationStatuses).toEqual([308, 410]);
});

test("a pending legacy path has no decided outcome yet and answers the ordinary 404", async ({
  page,
}) => {
  test.skip(
    PENDING_LEGACY_PATHS.length === 0,
    "no pending legacy rows in this clone's data",
  );

  const response = await page.goto(PENDING_LEGACY_PATHS[0], {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(404);
});

test("an excluded legacy path (Joomla's own error page) answers the ordinary 404, not a redirect or a 410", async ({
  page,
}) => {
  for (const path of EXCLUDED_LEGACY_PATHS) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBe(404);
  }
});

test("an already-live legacy path serves the current route, not a legacy outcome", async ({
  page,
}) => {
  for (const path of ALREADY_LIVE_LEGACY_PATHS) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBe(200);
  }
});

test("a legacy-shaped path the crawl never saw still gets the site's ordinary 404", async ({
  page,
}) => {
  const response = await page.goto(
    "/component/tags/tag/definitely-not-a-real-tag",
    { waitUntil: "domcontentloaded" },
  );

  expect(response?.status()).toBe(404);
});
