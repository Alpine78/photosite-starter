import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { getHomeContent } from "@/lib/home-content";
import type { SiteSettings } from "@/lib/site-settings";

/**
 * `home-content.ts` is a route-facing seam: it dispatches between the mock
 * fixture builder and the Sanity adapter based on
 * `getDeploymentConfig().contentSource`. These tests exercise that dispatch
 * directly. `getSiteSettings` and `getContentTrees` are stubbed with no
 * featured gallery configured, so `resolveFeaturedGalleryHref` short-circuits
 * without needing a real `ContentTree` fixture — its own correctness is
 * unchanged by this story and not what these tests are about.
 */
const deploymentConfig = vi.hoisted(() => ({
  contentSource: "mock" as "mock" | "sanity",
  localeRoutes: undefined as unknown as ReturnType<
    typeof buildLocaleRouteConfig
  >,
}));

const stubLabels = {
  pages: { home: "Etusivu", services: "Palvelut", portfolio: "Portfolio" },
  actions: { viewPortfolio: "Katso portfolio" },
} as unknown as ReturnType<
  (typeof import("@/lib/deployment-config"))["getDefaultLocaleLabels"]
>;

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => deploymentConfig,
  getDefaultLocaleLabels: () => stubLabels,
}));

const contentModule = vi.hoisted(() => ({
  getContentTrees: vi.fn(),
}));

vi.mock("@/lib/content", () => contentModule);

const siteSettingsModule = vi.hoisted(() => ({
  getSiteSettings: vi.fn(),
}));

vi.mock("@/lib/site-settings", () => siteSettingsModule);

const sanityHomeContent = vi.hoisted(() => ({
  readSanityHomeDocument: vi.fn(),
  projectHomeContent: vi.fn(),
}));

vi.mock("@/lib/sanity-home-content", () => sanityHomeContent);

const fakeSanityConfig = { projectId: "test-project", dataset: "test" };
const sanityConfigModule = vi.hoisted(() => ({
  getSanityConfig: vi.fn(),
}));

vi.mock("@/lib/sanity-config", () => sanityConfigModule);

const noFeaturedGallerySettings: SiteSettings = {
  siteName: "Studio Example",
  photographerName: "Jane Example",
  tagline: "x",
  navigation: [],
  contact: {
    email: "hello@example.test",
    privacyNotice: { collected: "x", purpose: "x", recipient: "x", retention: "x" },
  },
  socialLinks: [],
  footerLinks: [],
  copyrightHolder: "x",
  defaultSeo: { titleTemplate: "%s | x", description: "x" },
};

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
  contentModule.getContentTrees.mockReset().mockResolvedValue(new Map());
  siteSettingsModule.getSiteSettings
    .mockReset()
    .mockResolvedValue(noFeaturedGallerySettings);
  sanityHomeContent.readSanityHomeDocument.mockReset();
  sanityHomeContent.projectHomeContent.mockReset();
  sanityConfigModule.getSanityConfig.mockReset().mockReturnValue(fakeSanityConfig);
});

describe("getHomeContent", () => {
  it("returns the mock fixture content when contentSource is mock", async () => {
    const content = await getHomeContent();

    expect(content.intro).toContain("CMS");
    expect(sanityHomeContent.readSanityHomeDocument).not.toHaveBeenCalled();
    expect(sanityHomeContent.projectHomeContent).not.toHaveBeenCalled();
  });

  it("reads the Sanity home document and projects it, resolved against the default locale, when contentSource is sanity", async () => {
    deploymentConfig.contentSource = "sanity";
    const rawDocument = { heroMedia: { _id: "x" } };
    const fixture = {
      hero: { media: { type: "image" as const, mediaId: "x", alt: "x", rendition: { sourceKind: "public-web-derivative" as const, src: "/x.webp", version: "v1", width: 1, height: 1 } } },
      intro: "From Sanity",
      sections: [],
    };
    sanityHomeContent.readSanityHomeDocument.mockResolvedValue(rawDocument);
    sanityHomeContent.projectHomeContent.mockReturnValue(fixture);

    const content = await getHomeContent();

    expect(content).toEqual(fixture);
    expect(sanityHomeContent.readSanityHomeDocument).toHaveBeenCalledWith({});
    expect(sanityHomeContent.projectHomeContent).toHaveBeenCalledWith(rawDocument, {
      language: "fi",
      fallbackLanguage: "fi",
      locale: "fi-FI",
      routeConfig: deploymentConfig.localeRoutes,
      sanityConfig: fakeSanityConfig,
    });
  });

  it("reads the document and resolves the featured-gallery href concurrently, not one after the other", async () => {
    deploymentConfig.contentSource = "sanity";
    const order: string[] = [];
    sanityHomeContent.readSanityHomeDocument.mockImplementation(async () => {
      order.push("document-start");
      await Promise.resolve();
      order.push("document-end");
      return { heroMedia: { _id: "x" } };
    });
    siteSettingsModule.getSiteSettings.mockImplementation(async () => {
      order.push("settings-start");
      await Promise.resolve();
      order.push("settings-end");
      return noFeaturedGallerySettings;
    });
    sanityHomeContent.projectHomeContent.mockReturnValue({
      hero: { media: { type: "image" as const, mediaId: "x", alt: "x", rendition: { sourceKind: "public-web-derivative" as const, src: "/x.webp", version: "v1", width: 1, height: 1 } } },
      intro: "x",
      sections: [],
    });

    await getHomeContent();

    // Both start before either finishes — proof they ran concurrently rather
    // than the href being awaited to completion before the document read began.
    expect(order).toEqual(["document-start", "settings-start", "document-end", "settings-end"]);
  });

  it("propagates a classified Sanity failure rather than falling back to the fixture", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityHomeContent.readSanityHomeDocument.mockRejectedValue(
      new Error("classified sanity failure"),
    );

    await expect(getHomeContent()).rejects.toThrow("classified sanity failure");
  });
});
