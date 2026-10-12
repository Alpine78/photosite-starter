import { describe, expect, it } from "vitest";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { RESERVED_LOCALE_ROUTE_SEGMENTS, RESERVED_ROOT_SEGMENTS } from "@/lib/public-routes";
import { buildStaticPagePath, localizeStaticPageLink, resolveStaticPageRequest, staticPageVersions } from "@/lib/static-page-routes";

const locales = [
  { locale: "fi-FI", prefix: null, storyNamespace: "tarinat", serviceNamespace: "palvelut" },
  { locale: "en-GB", prefix: "english", storyNamespace: "stories", serviceNamespace: "services" },
] as const;
const config = buildLocaleRouteConfig({ locales, reservedRootSegments: RESERVED_ROOT_SEGMENTS, reservedLocaleRouteSegments: RESERVED_LOCALE_ROUTE_SEGMENTS });

describe("localized home and contact identities", () => {
  it("uses configuration rather than a hardcoded English prefix", () => {
    expect(buildStaticPagePath(config, "fi-FI", "home")).toBe("/");
    expect(buildStaticPagePath(config, "fi-FI", "contact")).toBe("/contact");
    expect(buildStaticPagePath(config, "en-GB", "home")).toBe("/english");
    expect(buildStaticPagePath(config, "en-GB", "contact")).toBe("/english/contact");
    expect(() => buildStaticPagePath(config, "sv", "contact")).toThrow(/not configured/);
  });

  it("resolves only exact configured static pages, with one canonical casing target", () => {
    expect(resolveStaticPageRequest(config, "ENGLISH", ["Contact"])).toEqual({ kind: "contact", locale: "en-GB", canonicalPath: "/english/contact" });
    expect(resolveStaticPageRequest(config, "english")).toMatchObject({ kind: "home" });
    for (const [prefix, segments] of [["english", ["contact", "missing"]], ["english", ["unknown"]], ["sv", []], ["fi", ["contact"]]] as const) {
      expect(resolveStaticPageRequest(config, prefix, segments)).toBeUndefined();
    }
  });

  it("omits unpublished versions and preserves configured order", () => {
    expect(staticPageVersions(config, "home", ["en-GB"])).toEqual([{locale: "en-GB", path: "/english"}]);
    expect(staticPageVersions(config, "contact", ["en-GB", "fi-FI"])).toEqual([{locale: "fi-FI", path: "/contact"}, {locale: "en-GB", path: "/english/contact"}]);
  });

  it("maps known application paths without inventing translations for arbitrary links", () => {
    expect(localizeStaticPageLink(config, "en-GB", "/contact")).toBe("/english/contact");
    expect(localizeStaticPageLink(config, "en-GB", "/about")).toBe("/about");
  });

  it.each(["storyNamespace", "serviceNamespace"] as const)("rejects contact as a %s before routes can collide", (key) => {
    expect(() => buildLocaleRouteConfig({ locales: [{...locales[0], [key]: "contact"}], reservedRootSegments: RESERVED_ROOT_SEGMENTS, reservedLocaleRouteSegments: RESERVED_LOCALE_ROUTE_SEGMENTS })).toThrow(/collides/);
  });
});
