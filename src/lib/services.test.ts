import { beforeEach, describe, expect, it, vi } from "vitest";

import { getService, getServices, getServicesIntro } from "@/lib/services";

/**
 * `services.ts` is a route-facing seam: it dispatches between the mock
 * fixture layer and the Sanity adapters based on
 * `getDeploymentConfig().contentSource`. These tests exercise that dispatch
 * directly — the Sanity adapters' own internals are covered by
 * `sanity-services.test.ts` and are stubbed here.
 */
const deploymentConfig = vi.hoisted(() => ({
  contentSource: "mock" as "mock" | "sanity",
  locale: "fi-FI",
}));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => deploymentConfig,
}));

const sanityServices = vi.hoisted(() => ({
  readPublicServices: vi.fn(),
  readPublicServiceBySlug: vi.fn(),
}));

vi.mock("@/lib/sanity-services", () => sanityServices);

const siteSettingsModule = vi.hoisted(() => ({
  getSiteSettings: vi.fn(),
}));

vi.mock("@/lib/site-settings", () => siteSettingsModule);

beforeEach(() => {
  deploymentConfig.contentSource = "mock";
  deploymentConfig.locale = "fi-FI";
  sanityServices.readPublicServices.mockReset();
  sanityServices.readPublicServiceBySlug.mockReset();
  siteSettingsModule.getSiteSettings.mockReset();
});

describe("getServices", () => {
  it("returns the mock fixture catalog when contentSource is mock", async () => {
    const services = await getServices();

    expect(services.length).toBeGreaterThan(0);
    expect(sanityServices.readPublicServices).not.toHaveBeenCalled();
  });

  it("reads Sanity's public services catalog when contentSource is sanity", async () => {
    deploymentConfig.contentSource = "sanity";
    const fixture = [
      {
        slug: "portraits",
        name: "Portraits",
        shortDescription: "Relaxed sessions.",
        description: ["Relaxed sessions."],
      },
    ];
    sanityServices.readPublicServices.mockResolvedValue(fixture);

    const services = await getServices();

    expect(services).toEqual(fixture);
    expect(sanityServices.readPublicServices).toHaveBeenCalledWith({
      language: "fi",
    });
  });

  it("propagates a classified Sanity failure rather than falling back to the fixture", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityServices.readPublicServices.mockRejectedValue(
      new Error("classified sanity failure"),
    );

    await expect(getServices()).rejects.toThrow("classified sanity failure");
  });
});

describe("getService", () => {
  it("looks up the mock fixture by slug when contentSource is mock", async () => {
    const service = await getService("portrait-sessions");

    expect(service?.slug).toBe("portrait-sessions");
    expect(sanityServices.readPublicServiceBySlug).not.toHaveBeenCalled();
  });

  it("returns undefined for an unknown mock slug", async () => {
    await expect(getService("no-such-service")).resolves.toBeUndefined();
  });

  it("reads Sanity by slug when contentSource is sanity", async () => {
    deploymentConfig.contentSource = "sanity";
    sanityServices.readPublicServiceBySlug.mockResolvedValue({
      slug: "portraits",
      name: "Portraits",
      shortDescription: "Relaxed sessions.",
      description: ["Relaxed sessions."],
    });

    const service = await getService("portraits");

    expect(service?.slug).toBe("portraits");
    expect(sanityServices.readPublicServiceBySlug).toHaveBeenCalledWith(
      "portraits",
      { language: "fi" },
    );
  });
});

describe("getServicesIntro", () => {
  it("proxies whatever getSiteSettings answers, present or absent", async () => {
    siteSettingsModule.getSiteSettings.mockResolvedValue({
      servicesIntro: "An overview of what we offer.",
    });
    await expect(getServicesIntro()).resolves.toBe(
      "An overview of what we offer.",
    );

    siteSettingsModule.getSiteSettings.mockResolvedValue({});
    await expect(getServicesIntro()).resolves.toBeUndefined();
  });
});
