import { applyMockEndDateGate } from "../src/lib/content";
import { buildContentTree } from "../src/lib/content-tree";
import { buildLocaleRouteConfig } from "../src/lib/locale-routes";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getServices } from "../src/lib/services";
import { buildSitemapPaths } from "../src/lib/sitemap";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";

/**
 * `/sitemap.xml` and `/robots.txt` against the production build the harness
 * serves. The Vitest suite already proves `buildSitemapPaths`' exclusion and
 * duplicate rules in isolation; this journey proves Next.js actually emits
 * valid XML at the real route with the real absolute origin, and that
 * `robots.txt` answers with this harness's declared deployment stage
 * (`development`, see `harness-environment.ts`) — the disallow-all branch.
 * The production-allow branch has its own deterministic coverage in
 * `src/lib/robots.test.ts`, since this harness's stage cannot flip live.
 *
 * The expected URL set is computed the same way `buildSitemapPaths` is,
 * from the same mock fixtures, rather than a hand-picked spot check — the
 * acceptance criterion is "every route exactly once," and a clone rebrands
 * the taxonomy, so nothing here names a category or page by its label.
 */

function expectedLocaleRoutes() {
  return buildLocaleRouteConfig({
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
}

async function expectedSitemapUrls(): Promise<Set<string>> {
  const localeRoutes = expectedLocaleRoutes();
  // AB#150/ADR-0017: the running app gates a placement's effective
  // `published` by `endDate` before the tree is built (`content.ts`'s mock
  // adapter boundary) — `content-ended-gallery`/`content-ended-article` carry
  // a permanently-past one, so applying the same gate here is what keeps this
  // "expected" set in agreement with what the live sitemap actually serves,
  // rather than the raw, ungated fixture input.
  const now = new Date();
  const trees = new Map(
    localeRoutes.locales.flatMap((route) => {
      const language = new Intl.Locale(route.locale).language;
      const input = mockContentTreeInputs[language];
      return input === undefined
        ? []
        : [
            [
              route.locale,
              buildContentTree(applyMockEndDateGate(input, language, now)),
            ] as const,
          ];
    }),
  );

  const services = await getServices();
  const paths = buildSitemapPaths({ localeRoutes, trees, services });

  return new Set(
    paths.map(
      (path) => new URL(path, appUnderTestEnvironment.SITE_CANONICAL_BASE_URL).toString(),
    ),
  );
}

test("sitemap.xml lists every expected public route exactly once, as valid absolute XML", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"] ?? "").toContain("xml");

  const body = await response.text();
  const locations = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map(
    (match) => match[1],
  );

  // Well-formed enough to parse without a new XML dependency: paired tags,
  // no unescaped ampersands (canonical URLs here carry none).
  expect(body).toContain("<urlset");
  expect(locations.length).toBeGreaterThan(0);

  expect(new Set(locations).size).toBe(locations.length);

  const expected = await expectedSitemapUrls();
  expect(new Set(locations)).toEqual(expected);

  for (const location of locations) {
    expect(location).not.toContain("?cursor=");
    expect(location).not.toContain("?section=");
    expect(
      location.startsWith(appUnderTestEnvironment.SITE_CANONICAL_BASE_URL),
    ).toBe(true);
  }
});

test("robots.txt disallows everything and names no sitemap on this harness's declared stage", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"] ?? "").toContain("text/plain");

  const body = await response.text();
  expect(body).toMatch(/User-Agent:\s*\*/i);
  expect(body).toMatch(/Disallow:\s*\/\s*$/im);
  expect(body).not.toMatch(/Sitemap:/i);
});
