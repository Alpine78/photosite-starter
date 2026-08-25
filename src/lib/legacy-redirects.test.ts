import { describe, expect, it } from "vitest";

import {
  buildLegacyGoneHtml,
  buildLegacyRedirects,
  legacyRedirectDestinationSearch,
  LegacyRedirectValidationError,
  resolveLegacyGoneLanguage,
  resolveLegacyGoneRoute,
  resolveLegacyRedirect,
  type LegacyRedirectEntry,
} from "@/lib/legacy-redirects";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";

const testConfig = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: [],
  reservedLocaleRouteSegments: [],
});

function issueCodes(entries: readonly LegacyRedirectEntry[]) {
  try {
    buildLegacyRedirects(entries);
  } catch (error) {
    if (error instanceof LegacyRedirectValidationError) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
  return [];
}

describe("buildLegacyRedirects", () => {
  it("resolves a redirect row to its exact target", () => {
    const redirects = buildLegacyRedirects([
      {
        source: "/valokuvat/f1",
        outcome: {
          kind: "redirect",
          target: "/tarinat/urheilu/f1",
          reservedQueryParams: "strip",
        },
      },
    ]);

    expect(resolveLegacyRedirect(redirects, "/valokuvat/f1")).toEqual({
      kind: "redirect",
      target: "/tarinat/urheilu/f1",
      reservedQueryParams: "strip",
    });
  });

  it("accepts a source with exactly one trailing slash, for a directory-style legacy URL", () => {
    const redirects = buildLegacyRedirects([
      {
        source: "/en/",
        outcome: {
          kind: "redirect",
          target: "/en/stories",
          reservedQueryParams: "strip",
        },
      },
    ]);

    expect(resolveLegacyRedirect(redirects, "/en/")).toEqual({
      kind: "redirect",
      target: "/en/stories",
      reservedQueryParams: "strip",
    });
    // The slash-free spelling is a distinct pathname with no row of its own.
    expect(resolveLegacyRedirect(redirects, "/en")).toBeUndefined();
  });

  it("still rejects a target with a trailing slash — a canonical route never carries one", () => {
    expect(
      issueCodes([
        {
          source: "/en/",
          outcome: {
            kind: "redirect",
            target: "/en/stories/",
            reservedQueryParams: "strip",
          },
        },
      ]),
    ).toEqual(["invalid-target"]);
  });

  it("resolves a gone row with its reason", () => {
    const redirects = buildLegacyRedirects([
      {
        source: "/component/tags/tag/kokeilu",
        outcome: { kind: "gone", reason: "no current replacement" },
      },
    ]);

    expect(resolveLegacyRedirect(redirects, "/component/tags/tag/kokeilu")).toEqual({
      kind: "gone",
      reason: "no current replacement",
    });
  });

  it("answers undefined for a pathname with no recorded row", () => {
    const redirects = buildLegacyRedirects([]);
    expect(resolveLegacyRedirect(redirects, "/never-crawled")).toBeUndefined();
  });

  it("accepts the site root as a source or a target", () => {
    const redirects = buildLegacyRedirects([
      {
        source: "/vanha-etusivu",
        outcome: { kind: "redirect", target: "/", reservedQueryParams: "strip" },
      },
    ]);
    expect(resolveLegacyRedirect(redirects, "/vanha-etusivu")).toEqual({
      kind: "redirect",
      target: "/",
      reservedQueryParams: "strip",
    });
  });

  it("rejects a duplicate source", () => {
    expect(
      issueCodes([
        { source: "/blogi", outcome: { kind: "gone", reason: "a" } },
        { source: "/blogi", outcome: { kind: "gone", reason: "b" } },
      ]),
    ).toEqual(["duplicate-source"]);
  });

  it("rejects a target equal to its own source", () => {
    expect(
      issueCodes([
        {
          source: "/valokuvaus",
          outcome: {
            kind: "redirect",
            target: "/valokuvaus",
            reservedQueryParams: "strip",
          },
        },
      ]),
    ).toEqual(["self-redirect"]);
  });

  it("rejects a redirect chained through another legacy source", () => {
    expect(
      issueCodes([
        {
          source: "/vanha-polku",
          outcome: {
            kind: "redirect",
            target: "/toinen-vanha-polku",
            reservedQueryParams: "strip",
          },
        },
        {
          source: "/toinen-vanha-polku",
          outcome: {
            kind: "redirect",
            target: "/tarinat/kohde",
            reservedQueryParams: "strip",
          },
        },
      ]),
    ).toEqual(["chained-target"]);
  });

  it("rejects a source that is not an absolute lowercase hyphenated path", () => {
    expect(
      issueCodes([
        { source: "blogi", outcome: { kind: "gone", reason: "a" } },
      ]),
    ).toEqual(["invalid-source"]);
    expect(
      issueCodes([
        { source: "/Blogi", outcome: { kind: "gone", reason: "a" } },
      ]),
    ).toEqual(["invalid-source"]);
    expect(
      issueCodes([
        { source: "/blogi//post", outcome: { kind: "gone", reason: "a" } },
      ]),
    ).toEqual(["invalid-source"]);
    expect(
      issueCodes([
        { source: "/blogi%20post", outcome: { kind: "gone", reason: "a" } },
      ]),
    ).toEqual(["invalid-source"]);
  });

  it("rejects a source inside the reserved /api namespace", () => {
    expect(
      issueCodes([
        { source: "/api", outcome: { kind: "gone", reason: "a" } },
      ]),
    ).toEqual(["reserved-source"]);
    expect(
      issueCodes([
        {
          source: "/api/legacy-endpoint",
          outcome: { kind: "gone", reason: "a" },
        },
      ]),
    ).toEqual(["reserved-source"]);
  });

  it("rejects a redirect target that is not a canonical path", () => {
    expect(
      issueCodes([
        {
          source: "/valokuvaus",
          outcome: {
            kind: "redirect",
            target: "https://example.com/x",
            reservedQueryParams: "strip",
          },
        },
      ]),
    ).toEqual(["invalid-target"]);
  });

  it("collects issues from more than one bad row rather than stopping at the first", () => {
    // Sorted by subject: "/valokuvaus" (starts with "/") sorts before
    // "Blogi" (starts with "B") under plain string comparison.
    expect(
      issueCodes([
        { source: "Blogi", outcome: { kind: "gone", reason: "a" } },
        {
          source: "/valokuvaus",
          outcome: {
            kind: "redirect",
            target: "/valokuvaus",
            reservedQueryParams: "strip",
          },
        },
      ]),
    ).toEqual(["self-redirect", "invalid-source"]);
  });
});

describe("resolveLegacyGoneRoute", () => {
  it("resolves a path under a configured non-default prefix to that locale's route", () => {
    const route = resolveLegacyGoneRoute(
      testConfig,
      "/en/component/tags/tag/wrc",
    );
    expect(route.locale).toBe("en");
    expect(route.isDefault).toBe(false);
    expect(route.basePath).toBe("/en");
    expect(route.storyNamespace).toBe("stories");
  });

  it("falls back to the default locale's route for an unprefixed path", () => {
    const route = resolveLegacyGoneRoute(
      testConfig,
      "/component/tags/tag/kokeilu",
    );
    expect(route.locale).toBe("fi");
    expect(route.isDefault).toBe(true);
  });

  it("falls back to the default locale's route for the site root", () => {
    expect(resolveLegacyGoneRoute(testConfig, "/").locale).toBe("fi");
  });

  it("does not mistake a path merely starting with a prefix's letters for that prefix", () => {
    // "envelope" is not "en" — only an exact first-segment match counts.
    expect(resolveLegacyGoneRoute(testConfig, "/envelope/foo").locale).toBe(
      "fi",
    );
  });
});

describe("buildLegacyGoneHtml", () => {
  const fiDefaultRoute = testConfig.byLocale.get("fi")!;
  const enPrefixedRoute = testConfig.byLocale.get("en")!;

  it("renders Finnish copy, with a matching lang attribute, and a link to the default locale's home page", () => {
    const html = buildLegacyGoneHtml(fiDefaultRoute);
    expect(html).toContain('<html lang="fi">');
    expect(html).toContain("410 Sivu poistettu");
    expect(html).toContain("Tämä sivu on poistettu pysyvästi.");
    expect(html).toContain('<a href="/">Etusivulle</a>');
  });

  it("renders English copy, with a matching lang attribute, and a link to that locale's own story root rather than the default locale's home page", () => {
    const html = buildLegacyGoneHtml(enPrefixedRoute);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("410 Gone");
    expect(html).toContain("This page has been permanently removed.");
    expect(html).toContain('<a href="/en/stories">Go to the homepage</a>');
  });

  it("falls back to English for a locale it has no copy for", () => {
    const html = buildLegacyGoneHtml({
      locale: "sv",
      prefix: "sv",
      storyNamespace: "stories",
      basePath: "/sv",
      isDefault: false,
    });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("410 Gone");
    expect(html).toContain('<a href="/sv/stories">Go to the homepage</a>');
  });
});

describe("resolveLegacyGoneLanguage", () => {
  it("resolves fi and en, and a regional variant of either, to their base language", () => {
    expect(resolveLegacyGoneLanguage("fi")).toBe("fi");
    expect(resolveLegacyGoneLanguage("en")).toBe("en");
    expect(resolveLegacyGoneLanguage("en-GB")).toBe("en");
    expect(resolveLegacyGoneLanguage("fi-FI")).toBe("fi");
  });

  it("falls back to English for a locale with no copy at all", () => {
    expect(resolveLegacyGoneLanguage("sv")).toBe("en");
  });
});

describe("legacyRedirectDestinationSearch", () => {
  it('"strip" drops the reserved cursor and section parameters this application interprets', () => {
    expect(legacyRedirectDestinationSearch("?cursor=old-token", "strip")).toBe(
      "",
    );
    expect(
      legacyRedirectDestinationSearch("?section=old-section", "strip"),
    ).toBe("");
    expect(legacyRedirectDestinationSearch("?cursor=a&section=b", "strip")).toBe(
      "",
    );
  });

  it('"preserve" forwards the reserved parameters unchanged, for a row that has verified its target treats them the same way', () => {
    expect(
      legacyRedirectDestinationSearch("?cursor=old-token", "preserve"),
    ).toBe("cursor=old-token");
    expect(
      legacyRedirectDestinationSearch("?section=old-section", "preserve"),
    ).toBe("section=old-section");
  });

  it("forwards every other parameter unchanged regardless of the reserved-parameter policy", () => {
    expect(
      legacyRedirectDestinationSearch("?utm_source=newsletter", "strip"),
    ).toBe("utm_source=newsletter");
    expect(
      legacyRedirectDestinationSearch(
        "?cursor=old&utm_source=newsletter",
        "strip",
      ),
    ).toBe("utm_source=newsletter");
    expect(
      legacyRedirectDestinationSearch(
        "?cursor=old&utm_source=newsletter",
        "preserve",
      ),
    ).toBe("cursor=old&utm_source=newsletter");
  });

  it("answers an empty string for no query at all", () => {
    expect(legacyRedirectDestinationSearch("", "strip")).toBe("");
  });

  it("keeps an unrecognized parameter's raw encoding byte-for-byte rather than round-tripping it through URLSearchParams", () => {
    // URLSearchParams.toString() would turn this into "q=a+b".
    expect(legacyRedirectDestinationSearch("?q=a%20b", "strip")).toBe(
      "q=a%20b",
    );
    // URLSearchParams.toString() would turn a bare flag into "flag=".
    expect(legacyRedirectDestinationSearch("?flag", "strip")).toBe("flag");
    expect(
      legacyRedirectDestinationSearch("?cursor=old&q=a%20b&flag", "strip"),
    ).toBe("q=a%20b&flag");
  });

  it("rides a numeric gallery lightbox query state through unexamined, the crawl's own /?4738 shape — a bare, key-less flag like any other unrecognized parameter", () => {
    expect(legacyRedirectDestinationSearch("?4738", "strip")).toBe("4738");
    expect(legacyRedirectDestinationSearch("?4738", "preserve")).toBe("4738");
    expect(
      legacyRedirectDestinationSearch("?cursor=old&4738", "strip"),
    ).toBe("4738");
  });
});

describe("legacy redirect resolution with a numeric lightbox query state", () => {
  it("carries a bare numeric flag onto a redirect's destination unchanged, composed through the real registry lookup rather than the pure search helper alone", () => {
    // A synthetic row for this composition test only — not a real crawl
    // decision; AB#19's actual redirect rows are recorded in
    // `legacy-redirects-data.ts`.
    const redirects = buildLegacyRedirects([
      {
        source: "/valokuvat/f1",
        outcome: {
          kind: "redirect",
          target: "/tarinat/urheilu/f1",
          reservedQueryParams: "strip",
        },
      },
    ]);

    const outcome = resolveLegacyRedirect(redirects, "/valokuvat/f1");
    expect(outcome?.kind).toBe("redirect");
    if (outcome?.kind !== "redirect") throw new Error("expected a redirect outcome");
    expect(
      legacyRedirectDestinationSearch("?4738", outcome.reservedQueryParams),
    ).toBe("4738");
  });
});
