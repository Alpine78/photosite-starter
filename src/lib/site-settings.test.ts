import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { mockSiteMark, mockSiteMarkDark } from "@/lib/mock-media";
import {
  getServicesContactCallToAction,
  getSiteSettings,
  resolveBrandDescriptor,
  resolveSiteName,
  resolveTitleTemplate,
  type SiteSettings,
} from "@/lib/site-settings";

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
  readSanityServicesContactCallToAction: vi.fn(),
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
  sanitySiteSettings.readSanityServicesContactCallToAction.mockReset();
});

describe("getSiteSettings", () => {
  it("returns the mock fixture when contentSource is mock", async () => {
    const settings = await getSiteSettings();

    // The fixture's default locale here is Finnish, so its name is the Finnish one.
    expect(settings.siteName).toBe("Valokuvaaja Jane Example");
    expect(settings.siteNames).toEqual({
      en: "Jane Example Photography",
      fi: "Valokuvaaja Jane Example",
    });
    expect(settings.defaultSeo.titleTemplate).toBe("%s | Valokuvaaja Jane Example");
    expect(settings.logo).toBe(mockSiteMark);
    expect(settings.logoDark).toBe(mockSiteMarkDark);
    expect(settings.brandDescriptors).toEqual({
      en: { text: "Photography", position: "after" },
      fi: { text: "Valokuvaaja", position: "before" },
    });
    expect(sanitySiteSettings.readSanitySiteSettings).not.toHaveBeenCalled();
  });

  it("reads Sanity settings, keyed by the deployment's default locale, when contentSource is sanity", async () => {
    deploymentConfig.contentSource = "sanity";
    const fixture: SiteSettings = {
      siteName: "Sanity Studio",
      siteNames: { fi: "Sanity Studio" },
      brandDescriptors: {},
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
      defaultSeo: {
        titleTemplate: "%s | Sanity Studio",
        titleTemplates: { fi: "%s | Sanity Studio" },
        description: "x",
      },
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


describe("getServicesContactCallToAction", () => {
  it("uses the mock copy in the requested locale", async () => {
    await expect(getServicesContactCallToAction("en-GB")).resolves.toEqual({
      heading: "Looking for something else?",
      text: "Tell me what you need and we can plan a service that fits.",
    });
    expect(sanitySiteSettings.readSanityServicesContactCallToAction).not.toHaveBeenCalled();
  });

  it("reads only the requested-language CTA from Sanity for a prefixed locale", async () => {
    deploymentConfig.contentSource = "sanity";
    const content = { heading: "Looking for something else?", text: "Tell me more." };
    sanitySiteSettings.readSanityServicesContactCallToAction.mockResolvedValue(content);

    await expect(getServicesContactCallToAction("en-GB")).resolves.toEqual(content);
    expect(sanitySiteSettings.readSanityServicesContactCallToAction).toHaveBeenCalledWith("en");
    expect(sanitySiteSettings.readSanitySiteSettings).not.toHaveBeenCalled();
  });
});

describe("per-locale brand (AB#187)", () => {
  const brand = {
    siteName: "Valokuvaaja Esimerkki",
    siteNames: { fi: "Valokuvaaja Esimerkki", en: "Example Photography" },
    defaultSeo: {
      titleTemplate: "%s | Valokuvaaja Esimerkki",
      titleTemplates: { fi: "%s | Valokuvaaja Esimerkki", en: "%s | Example Photography" },
      description: "x",
    },
  };

  it("resolves the site name and title template of the rendered locale", () => {
    expect(resolveSiteName(brand, "en-GB")).toBe("Example Photography");
    expect(resolveSiteName(brand, "fi-FI")).toBe("Valokuvaaja Esimerkki");
    expect(resolveTitleTemplate(brand, "en-GB")).toBe("%s | Example Photography");
  });

  it("resolves a descriptor only in its own language, never another's", () => {
    const descriptors = {
      brandDescriptors: {
        fi: { text: "Valokuvaaja", position: "before" as const },
        en: { text: "Photography", position: "after" as const },
      },
    };
    expect(resolveBrandDescriptor(descriptors, "en-GB")).toEqual({
      text: "Photography",
      position: "after",
    });
    expect(resolveBrandDescriptor(descriptors, "sv-FI")).toBeUndefined();
  });

  it("falls back to the default locale's brand for a language with none of its own", () => {
    expect(resolveSiteName(brand, "sv-FI")).toBe("Valokuvaaja Esimerkki");
    expect(resolveTitleTemplate(brand, "sv-FI")).toBe("%s | Valokuvaaja Esimerkki");
  });
});

describe("mock site marks", () => {
  it.each([
    ["light", mockSiteMark, "site-mark"],
    ["dark", mockSiteMarkDark, "site-mark-dark"],
  ] as const)("the %s mark is a brand-free, content-hashed PNG with its true intrinsic dimensions", (_mode, mark, name) => {
    const { src, version, width, height } = mark.rendition;
    const match = src.match(new RegExp(`^/gallery/${name}\\.([0-9a-f]{12})\\.png$`));
    expect(match?.[1]).toBe(version);

    const bytes = readFileSync(resolve(process.cwd(), "public", src.slice(1)));
    expect(createHash("sha256").update(bytes).digest("hex").startsWith(version)).toBe(true);
    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(height);
    // Not square, so a layout that forced one would visibly distort it.
    expect(width).not.toBe(height);
    expect(mark.alt).toBe("");
  });
});
