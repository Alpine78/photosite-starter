import { describe, expect, it } from "vitest";
import {
  isPreviewAliasHost,
  PreviewNoindexAliasError,
  previewNoindexAliasHostPattern,
  readPreviewNoindexAliasHost,
} from "@/lib/preview-noindex-alias";

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
