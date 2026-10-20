import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SiteRoot } from "@/components/site-root";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { SanityHomeContentError } from "@/lib/sanity-home-content";
import { SanitySiteSettingsError } from "@/lib/sanity-site-settings";
import type { SiteSettings } from "@/lib/site-settings";

const seams = vi.hoisted(() => ({ staticPage: vi.fn(), settings: vi.fn() }));
const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi-FI", prefix: null, storyNamespace: "tarinat" },
    { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
});

vi.mock("@/lib/deployment-config", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/deployment-config")>(),
  getDeploymentConfig: () => ({
    localeRoutes: config,
    canonicalBaseUrl: new URL("https://example.test"),
    privateGallery: { routePrefix: "private", adminRoutePrefix: "studio-admin" },
  }),
}));
vi.mock("@/lib/static-pages", () => ({ getStaticPageData: seams.staticPage }));
vi.mock("@/lib/site-settings", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/site-settings")>(),
  getSiteSettings: seams.settings,
}));
vi.mock("@/lib/content", () => ({ getContentTrees: async () => new Map() }));
// The real server composition is exercised; browser hooks/fonts are outside
// this fault-isolation test and replaced by inert link renderers.
vi.mock("@/components/document-root", () => ({
  DocumentRoot: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/components/site-header", () => ({
  SiteHeader: ({ homeHref, navigation }: {
    homeHref?: string;
    navigation: readonly { href: string; label: string }[];
  }) => createElement("header", null,
    homeHref === undefined ? "Brand" : createElement("a", { href: homeHref }, "Brand"),
    ...navigation.map((link) => createElement("a", { key: link.href, href: link.href }, link.label)),
  ),
}));
vi.mock("@/components/site-analytics", () => ({
  SiteAnalytics: ({ policy }: { policy: unknown }) =>
    createElement("aside", { "data-analytics": JSON.stringify(policy) }),
}));
vi.mock("@/components/site-speed-insights", () => ({
  SiteSpeedInsights: ({ policy }: { policy: unknown }) =>
    createElement("aside", { "data-speed-insights": JSON.stringify(policy) }),
}));
vi.mock("@/components/site-footer", () => ({
  SiteFooter: ({ footerLinks }: { footerLinks: readonly { href: string; label: string }[] }) =>
    createElement("footer", null, ...footerLinks.map((link) =>
      createElement("a", { key: link.href, href: link.href }, link.label))),
}));

const settings: SiteSettings = {
  siteName: "Example",
  siteNames: { fi: "Example", en: "Example" },
  brandDescriptors: {},
  photographerName: "Example Photographer",
  tagline: "Example",
  navigation: [{ label: "Home", href: "/" }, { label: "Contact", href: "/contact" }, { label: "Services", href: "/services" }],
  contact: { email: "hello@example.test", privacyNotice: { collected: "Example", purpose: "Example", recipient: "Example", retention: "Example" } },
  socialLinks: [],
  footerLinks: [{ label: "Home", href: "/" }, { label: "Contact", href: "/contact" }],
  copyrightHolder: "Example",
  defaultSeo: { titleTemplate: "%s | Example", titleTemplates: { fi: "%s | Example", en: "%s | Example" }, description: "Example" },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  seams.staticPage.mockReset().mockResolvedValue({ settings });
  seams.settings.mockReset().mockResolvedValue(settings);
});

for (const locale of ["fi-FI", "en-GB"]) {
  const base = locale === "fi-FI" ? "" : "/en";
  it.each([
    new SanityHomeContentError("incomplete-document", "Invalid hero"),
    new SanityHomeContentError("missing-translation", "Default intro missing"),
    new Error("Home provider unavailable"),
  ])(`keeps other pages readable without advertising a defective home (${locale})`, async (failure) => {
    seams.staticPage.mockImplementation(async (kind) => {
      if (kind === "home") throw failure;
      return { settings };
    });
    const html = renderToStaticMarkup(await SiteRoot({ locale, children: createElement("main", null, "Existing story content") }));
    expect(html).toContain("Existing story content");
    expect(html).toContain(`href="${base}/contact"`);
    expect(html).toContain(`href="${base}/services"`);
    expect(html).not.toContain(`href="${base || "/"}"`);
  });

  it(`still fails for defective shared settings (${locale})`, async () => {
    const failure = new SanitySiteSettingsError("incomplete-document", "Invalid contact settings");
    seams.staticPage.mockRejectedValue(failure);
    await expect(SiteRoot({ locale, children: "Existing story content" })).rejects.toBe(failure);
  });
}

it("renders no analytics markup unless a provider is enabled (ADR-0037)", async () => {
  vi.stubEnv("SITE_DEPLOYMENT_STAGE", "production");
  const html = renderToStaticMarkup(await SiteRoot({ locale: "fi-FI", children: "Content" }));
  expect(html).not.toContain("data-analytics");
});

it("renders no analytics markup outside production even when the setting is inherited", async () => {
  vi.stubEnv("SITE_DEPLOYMENT_STAGE", "preview");
  vi.stubEnv("SITE_ANALYTICS", "vercel");
  const html = renderToStaticMarkup(await SiteRoot({ locale: "fi-FI", children: "Content" }));
  expect(html).not.toContain("data-analytics");
});

it("hands the enabled analytics script the deployment's reserved prefixes and locale prefixes", async () => {
  vi.stubEnv("SITE_DEPLOYMENT_STAGE", "production");
  vi.stubEnv("SITE_ANALYTICS", "vercel");
  const html = renderToStaticMarkup(await SiteRoot({ locale: "en-GB", children: "Content" }));
  const policy = /data-analytics="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"');
  expect(JSON.parse(policy ?? "null")).toEqual({
    excludedRootSegments: ["client-gallery", "api", "private", "studio-admin"],
    localePrefixes: ["en"],
  });
});

it("loads Speed Insights only when its own setting is on in production (AB#376)", async () => {
  vi.stubEnv("SITE_DEPLOYMENT_STAGE", "production");
  vi.stubEnv("SITE_ANALYTICS", "vercel");
  let html = renderToStaticMarkup(await SiteRoot({ locale: "fi-FI", children: "Content" }));
  expect(html).not.toContain("data-speed-insights");

  vi.stubEnv("SITE_SPEED_INSIGHTS", "vercel");
  html = renderToStaticMarkup(await SiteRoot({ locale: "en-GB", children: "Content" }));
  const policy = /data-speed-insights="([^"]*)"/.exec(html)?.[1]?.replaceAll("&quot;", '"');
  expect(JSON.parse(policy ?? "null")).toEqual({
    excludedRootSegments: ["client-gallery", "api", "private", "studio-admin"],
    localePrefixes: ["en"],
  });

  vi.stubEnv("SITE_DEPLOYMENT_STAGE", "preview");
  html = renderToStaticMarkup(await SiteRoot({ locale: "fi-FI", children: "Content" }));
  expect(html).not.toContain("data-speed-insights");
});
