import { beforeEach, expect, it, vi } from "vitest";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { SanityHomeContentError } from "@/lib/sanity-home-content";
import { SanitySiteSettingsError } from "@/lib/sanity-site-settings";
import { getStaticPageData, getStaticPageVersions } from "@/lib/static-pages";

const seams = vi.hoisted(() => ({ settings: vi.fn(), home: vi.fn() }));
vi.mock("@/lib/site-settings", () => ({ getSiteSettings: seams.settings }));
vi.mock("@/lib/home-content", () => ({ getHomeContent: seams.home }));
const config = buildLocaleRouteConfig({locales: [{locale:"fi",prefix:null,storyNamespace:"tarinat"},{locale:"en",prefix:"en",storyNamespace:"stories"}],reservedRootSegments:["contact"],reservedLocaleRouteSegments:["contact"]});
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => ({contentSource:"sanity",localeRoutes:config}) }));
beforeEach(() => { seams.settings.mockReset().mockResolvedValue({siteName:"Example"}); seams.home.mockReset().mockResolvedValue({intro:"Example"}); });

it("withholds an untranslated home from alternates while contact remains available", async () => {
  seams.home.mockImplementation(async (locale) => {
    if (locale === "en") throw new SanityHomeContentError("missing-translation", "intro has no English text");
    return {intro:"Esimerkki"};
  });
  await expect(getStaticPageData("home", "en")).resolves.toBeUndefined();
  await expect(getStaticPageVersions("home")).resolves.toEqual([{locale:"fi",path:"/"}]);
  await expect(getStaticPageVersions("contact")).resolves.toEqual([{locale:"fi",path:"/contact"},{locale:"en",path:"/en/contact"}]);
});

it("withholds both pages when required contact/settings translation is missing", async () => {
  seams.settings.mockImplementation(async (locale) => {
    if (locale === "en") throw new SanitySiteSettingsError("missing-translation", "privacy notice missing");
    return {};
  });
  await expect(getStaticPageVersions("contact")).resolves.toEqual([{locale:"fi",path:"/contact"}]);
  await expect(getStaticPageData("home", "en")).resolves.toBeUndefined();
});

it.each(["home", "contact"] as const)("propagates missing default settings for %s instead of dropping its canonical page", async (kind) => {
  const failure = new SanitySiteSettingsError("missing-translation", "default privacy notice missing");
  seams.settings.mockImplementation(async (locale) => {
    if (locale === "fi") throw failure;
    return {};
  });
  await expect(getStaticPageData(kind, "fi")).rejects.toBe(failure);
  await expect(getStaticPageVersions(kind)).rejects.toBe(failure);
});

it("propagates a missing default home intro while contact remains available", async () => {
  const failure = new SanityHomeContentError("missing-translation", "default intro missing");
  seams.home.mockImplementation(async (locale) => {
    if (locale === "fi") throw failure;
    return { intro: "English intro" };
  });
  await expect(getStaticPageData("home", "fi")).rejects.toBe(failure);
  await expect(getStaticPageVersions("home")).rejects.toBe(failure);
  await expect(getStaticPageVersions("contact")).resolves.toEqual([{locale:"fi",path:"/contact"},{locale:"en",path:"/en/contact"}]);
});

it.each([new SanityHomeContentError("incomplete-document", "invalid media"), new Error("provider unavailable")])("propagates malformed content and infrastructure failures", async (failure) => {
  seams.home.mockRejectedValue(failure);
  await expect(getStaticPageVersions("home")).rejects.toBe(failure);
});
