import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { getSiteSettings, type SiteSettings } from "@/lib/site-settings";

/**
 * `site-settings.ts` is a route-facing seam: it dispatches between the mock
 * fixture layer and the Sanity adapter based on
 * `getDeploymentConfig().contentSource`. These tests exercise that dispatch
 * directly — `sanity-site-settings.test.ts` covers the adapter's own
 * projection logic and is stubbed here.
 *
 * `localeRoutes` starts empty and is filled in below, once this module's own
 * imports (including `buildLocaleRouteConfig`) have resolved: `vi.hoisted`'s
 * callback runs before them, so referencing an import inside it throws a
 * temporal-dead-zone error.
 */
const deploymentConfig = vi.hoisted(() => ({
  contentSource: "mock" as "mock" | "sanity",
  locale: "fi-FI",
  localeRoutes: undefined as unknown as ReturnType<
    typeof buildLocaleRouteConfig
  >,
}));

const stubLabels = {
  pages: {
    home: "Etusivu",
    services: "Palvelut",
    portfolio: "Portfolio",
    contact: "Ota yhteyttä",
    stories: "Tarinat",
  },
} as unknown as ReturnType<
  (typeof import("@/lib/deployment-config"))["getDefaultLocaleLabels"]
>;

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => deploymentConfig,
  getDefaultLocaleLabels: () => stubLabels,
}));

const sanitySiteSettings = vi.hoisted(() => ({
  readSanitySiteSettings: vi.fn(),
}));

vi.mock("@/lib/sanity-site-settings", () => sanitySiteSettings);

deploymentConfig.localeRoutes = buildLocaleRouteConfig({
  locales: [
    { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
    { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
});

beforeEach(() => {
  deploymentConfig.contentSource = "mock";
  sanitySiteSettings.readSanitySiteSettings.mockReset();
});

describe("getSiteSettings", () => {
  it("returns the mock fixture when contentSource is mock", async () => {
    const settings = await getSiteSettings();

    expect(settings.siteName).toBe("Studio Example");
    expect(sanitySiteSettings.readSanitySiteSettings).not.toHaveBeenCalled();
  });

  it("reads Sanity settings, keyed by the deployment's default locale, when contentSource is sanity", async () => {
    deploymentConfig.contentSource = "sanity";
    const fixture: SiteSettings = {
      siteName: "Sanity Studio",
      photographerName: "Sanity Photographer",
      tagline: "From the CMS",
      navigation: [],
      contact: {
        email: "hello@example.test",
        privacyNotice: {
          collected: "x",
          purpose: "x",
          recipient: "x",
          retention: "x",
        },
      },
      socialLinks: [],
      footerLinks: [],
      copyrightHolder: "Sanity Studio",
      defaultSeo: { titleTemplate: "%s | Sanity Studio", description: "x" },
    };
    sanitySiteSettings.readSanitySiteSettings.mockResolvedValue(fixture);

    const settings = await getSiteSettings();

    expect(settings).toEqual(fixture);
    expect(sanitySiteSettings.readSanitySiteSettings).toHaveBeenCalledWith({
      language: "fi",
      locale: "fi-FI",
      config: deploymentConfig.localeRoutes,
    });
  });

  it("propagates a classified Sanity failure rather than falling back to the fixture", async () => {
    deploymentConfig.contentSource = "sanity";
    sanitySiteSettings.readSanitySiteSettings.mockRejectedValue(
      new Error("classified sanity failure"),
    );

    await expect(getSiteSettings()).rejects.toThrow(
      "classified sanity failure",
    );
  });
});
