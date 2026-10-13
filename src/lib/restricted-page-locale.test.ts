import { describe, expect, it } from "vitest";
import { buildLocaleRouteConfig } from "./locale-routes";
import { restrictedLocale, restrictedLocaleFromSearch, restrictedLocaleHref } from "./restricted-page-locale";

const routes = buildLocaleRouteConfig({ locales: [
  { locale: "en-GB", prefix: null, storyNamespace: "stories" },
  { locale: "fi", prefix: "fi", storyNamespace: "tarinat" },
], reservedRootSegments: [], reservedLocaleRouteSegments: [] });

describe("restricted UI locale", () => {
  it.each(["fi", "en-GB"])("accepts configured full tag %s", (locale) => {
    expect(restrictedLocaleFromSearch(new URLSearchParams({ locale }), routes)).toBe(locale);
  });
  it.each(["", "locale=", "locale=en", "locale=FI", "locale=fi-FI", "locale=fi&locale=fi", "locale=fi&locale=en-GB", "locale=%20fi", `locale=${"x".repeat(129)}`])("defaults for malformed or unsupported input %s", (search) => {
    expect(restrictedLocaleFromSearch(new URLSearchParams(search), routes)).toBe("en-GB");
  });
  it("revalidates a header value and creates only a fixed clean page link", () => {
    expect(restrictedLocale("forged", routes)).toBe("en-GB");
    expect(restrictedLocaleHref("/private/fixture", "fi")).toBe("/private/fixture?locale=fi");
  });
  it.each(["//other.test", "https://other.test", "/private/fixture#secret", "/admin?return=elsewhere", "/\\other.test", "/admin\n"])("rejects an unsafe destination %s", (path) => {
    expect(() => restrictedLocaleHref(path, "fi")).toThrow();
  });
});
