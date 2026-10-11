import { describe, expect, it } from "vitest";
import {
  isPreviewAliasHost,
  readProductionNoindexAliasHosts,
  ProductionNoindexAliasError,
  PreviewNoindexAliasError,
  previewNoindexAliasHostPattern,
  readPreviewNoindexAliasHost,
} from "@/lib/preview-noindex-alias";

import { loadDeploymentConfig } from "@/lib/deployment-config";

const ALIAS = "photosite-starter-preview.vercel.app";

describe("isPreviewAliasHost", () => {
  it.each([
    "photosite-starter-preview.vercel.app",
    "a.vercel.app",
    "deploy-1.team-x.vercel.app",
    "Photosite-Preview.vercel.app",
  ])("accepts a bare *.vercel.app host (case-insensitively): %s", (value) => {
    expect(isPreviewAliasHost(value)).toBe(true);
  });

  it.each([
    ["a scheme", "https://photosite-starter-preview.vercel.app"],
    ["a path", "photosite-starter-preview.vercel.app/api/revalidate"],
    ["a port", "photosite-starter-preview.vercel.app:443"],
    ["a custom domain", "preview.example.com"],
    ["the bare apex", "vercel.app"],
    ["leading whitespace", " photosite-starter-preview.vercel.app"],
    ["trailing whitespace", "photosite-starter-preview.vercel.app "],
    ["inner whitespace", "photosite starter.vercel.app"],
    ["an unexpanded pipeline macro", "$(PREVIEW_STABLE_ALIAS)"],
    ["a label starting with a hyphen", "-preview.vercel.app"],
    ["an empty string", ""],
  ])("refuses %s", (_case, value) => {
    expect(isPreviewAliasHost(value)).toBe(false);
  });
});

describe("previewNoindexAliasHostPattern", () => {
  it("escapes the dots so the host matches literally as a Next.js regex", () => {
    expect(previewNoindexAliasHostPattern(ALIAS)).toBe(
      "photosite-starter-preview\\.vercel\\.app",
    );
  });

  it("produces a pattern that matches only the exact host", () => {
    const pattern = new RegExp(`^${previewNoindexAliasHostPattern(ALIAS)}$`);
    expect(pattern.test(ALIAS)).toBe(true);
    expect(pattern.test("photosite-starter-previewXvercelXapp")).toBe(false);
    expect(pattern.test(`evil-${ALIAS}`)).toBe(false);
  });
});

describe("readPreviewNoindexAliasHost", () => {
  it.each([
    ["unset", undefined],
    ["production", "production"],
    ["development", "development"],
    ["an empty string", ""],
  ])(
    "returns undefined when VERCEL_ENV is %s, regardless of the alias",
    (_case, vercelEnv) => {
      expect(
        readPreviewNoindexAliasHost({
          VERCEL_ENV: vercelEnv,
          PREVIEW_STABLE_ALIAS: ALIAS,
        }),
      ).toBeUndefined();
    },
  );

  it("returns the normalized host on a Preview build with a valid alias", () => {
    expect(
      readPreviewNoindexAliasHost({
        VERCEL_ENV: "preview",
        PREVIEW_STABLE_ALIAS: ALIAS,
      }),
    ).toBe(ALIAS);
  });

  it("lower-cases the host", () => {
    expect(
      readPreviewNoindexAliasHost({
        VERCEL_ENV: "preview",
        PREVIEW_STABLE_ALIAS: "PhotoSite-Preview.VERCEL.app",
      }),
    ).toBe("photosite-preview.vercel.app");
  });

  it("trims surrounding whitespace on VERCEL_ENV before comparing", () => {
    expect(
      readPreviewNoindexAliasHost({
        VERCEL_ENV: " preview ",
        PREVIEW_STABLE_ALIAS: ALIAS,
      }),
    ).toBe(ALIAS);
  });

  it("throws on a Preview build with no alias set", () => {
    expect(() =>
      readPreviewNoindexAliasHost({ VERCEL_ENV: "preview" }),
    ).toThrow(PreviewNoindexAliasError);
    expect(() =>
      readPreviewNoindexAliasHost({
        VERCEL_ENV: "preview",
        PREVIEW_STABLE_ALIAS: "   ",
      }),
    ).toThrow(/PREVIEW_STABLE_ALIAS/);
  });

  it.each([
    ["an unexpanded pipeline macro", "$(PREVIEW_STABLE_ALIAS)"],
    ["a URL instead of a host", "https://photosite-starter-preview.vercel.app/"],
    ["a custom domain", "preview.example.com"],
    ["inner whitespace", "photosite starter.vercel.app"],
    ["surrounding whitespace", " photosite-starter-preview.vercel.app "],
  ])("throws on a Preview build with %s", (_case, alias) => {
    expect(() =>
      readPreviewNoindexAliasHost({
        VERCEL_ENV: "preview",
        PREVIEW_STABLE_ALIAS: alias,
      }),
    ).toThrow(PreviewNoindexAliasError);
  });
});

describe("readProductionNoindexAliasHosts", () => {
  const production = {
    VERCEL_ENV: "production",
    SITE_CANONICAL_BASE_URL: "https://example.com",
  };

  it("deduplicates case-equivalent hosts and returns a frozen exact list", () => {
    const aliases = readProductionNoindexAliasHosts({
      ...production,
      PRODUCTION_NOINDEX_ALIASES: "First.vercel.app, second.team.vercel.app, first.vercel.app",
    });
    expect(aliases).toEqual(["first.vercel.app", "second.team.vercel.app"]);
    expect(Object.isFrozen(aliases)).toBe(true);
  });

  it.each([undefined, ""])("leaves an unconfigured clone unchanged: %s", (value) => {
    expect(readProductionNoindexAliasHosts({ ...production, PRODUCTION_NOINDEX_ALIASES: value })).toEqual([]);
  });

  it.each([undefined, "", "preview", "development"])("does nothing outside a Production build: %s", (platform) => {
    expect(readProductionNoindexAliasHosts({
      VERCEL_ENV: platform,
      PRODUCTION_NOINDEX_ALIASES: "invalid",
    })).toEqual([]);
  });

  it.each([
    " ", "first.vercel.app,", ",first.vercel.app", "first.vercel.app,,second.vercel.app",
    "https://first.vercel.app", "first.vercel.app:443", "first.vercel.app/path",
    "*.vercel.app", "first.vercel.app.evil.test", "first.vercel.app.", "vercel.app",
    "first.vercel.app\n", "first.vercel.app\r\n", "$(PRODUCTION_NOINDEX_ALIASES)",
    `${"a".repeat(64)}.vercel.app`,
    Array.from({ length: 9 }, (_, i) => `alias-${i}.vercel.app`).join(","),
    "a".repeat(2048),
  ])("refuses malformed or oversized configuration: %s", (value) => {
    expect(() => readProductionNoindexAliasHosts({ ...production, PRODUCTION_NOINDEX_ALIASES: value })).toThrow(ProductionNoindexAliasError);
  });

  it("refuses to hide the canonical Vercel host, including its other port", () => {
    expect(() => readProductionNoindexAliasHosts({
      ...production,
      SITE_CANONICAL_BASE_URL: "https://First.VERCEL.app:8443/",
      PRODUCTION_NOINDEX_ALIASES: "first.vercel.app",
    })).toThrow(/must not include/);
  });

  // A config leaf cannot import the server-only resolver. Pin both parsers to
  // the same origin contract so future resolver changes cannot silently diverge.
  const resolverEnvironment = {
    SITE_CONTENT_SOURCE: "mock", SITE_DEPLOYMENT_STAGE: "development",
    SITE_LOCALE: "en-GB", SITE_LOCALE_ROUTES: "en-GB||stories",
    SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
    SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536", SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
  };
  it.each([
    "https://example.com", "https://WWW.example.com/", "http://localhost:3210",
    "https://example.com:8443/", " https://example.com/ ", "https://[::1]:8443",
  ])("accepts the resolver's canonical origin: %s", (origin) => {
    const config = loadDeploymentConfig({ ...resolverEnvironment, SITE_CANONICAL_BASE_URL: origin });
    expect(config.canonicalBaseUrl.origin).toBe(new URL(origin.trim()).origin);
    expect(readProductionNoindexAliasHosts({ ...production, SITE_CANONICAL_BASE_URL: origin, PRODUCTION_NOINDEX_ALIASES: "first.vercel.app" })).toEqual(["first.vercel.app"]);
  });
  it.each([
    undefined, "", "relative", "//example.com", "ftp://example.com",
    "https://user:password@example.com", "https://example.com/path",
    "https://example.com/?query=1", "https://example.com/#fragment",
  ])("refuses the resolver's invalid canonical origin: %s", (origin) => {
    expect(() => loadDeploymentConfig({ ...resolverEnvironment, SITE_CANONICAL_BASE_URL: origin })).toThrow();
    expect(() => readProductionNoindexAliasHosts({ ...production, SITE_CANONICAL_BASE_URL: origin, PRODUCTION_NOINDEX_ALIASES: "first.vercel.app" })).toThrow(ProductionNoindexAliasError);
  });
});
