import { afterEach, describe, expect, it, vi } from "vitest";
import { readSiteMaintenanceMode, siteMaintenanceResponse } from "./site-maintenance";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/deployment-config");
  vi.resetModules();
});

describe("server-only maintenance configuration", () => {
  it.each([undefined, "", " ", "off", " off "])("keeps %s disabled", (value) => {
    expect(readSiteMaintenanceMode({ SITE_MAINTENANCE_MODE: value })).toBe("off");
  });
  it("enables only the explicit on value", () => {
    expect(readSiteMaintenanceMode({ SITE_MAINTENANCE_MODE: "on" })).toBe("on");
  });
  it.each(["ON", "true", "false", "0", "$(SITE_MAINTENANCE_MODE)", "x".repeat(33)])("fails closed for %s", (value) => {
    expect(readSiteMaintenanceMode({ SITE_MAINTENANCE_MODE: value })).toBe("invalid");
  });
  it("refuses a public mirror even when the server setting is off", () => {
    expect(readSiteMaintenanceMode({ SITE_MAINTENANCE_MODE: "off", NEXT_PUBLIC_SITE_MAINTENANCE_MODE: "off" })).toBe("invalid");
  });
});

describe("maintenance response boundary", () => {
  it("has bounded bilingual scriptless recovery text and no internal state", async () => {
    const response = siteMaintenanceResponse("GET", false);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.has("set-cookie")).toBe(false);
    const body = await response.text();
    expect(body).toContain('<html lang="fi">');
    expect(body).toContain('<section lang="en"');
    expect(body).not.toMatch(/<script|<link|<img|<form|SITE_|Sanity|identityAlias/i);
  });
  it("preserves the existing generic retryable API failure shape", async () => {
    expect(await siteMaintenanceResponse("POST", true).json()).toEqual({ status: "failed", retryable: true });
  });
  it.each([false, true])("sends no HEAD bytes (api=%s)", async (api) => {
    expect(await siteMaintenanceResponse("HEAD", api).text()).toBe("");
  });
  it.each(["on", "typo"])("preempts normal deployment reads when mode=%s", async (mode) => {
    vi.resetModules();
    const normalRead = vi.fn(() => { throw new Error("normal content configuration must not be read"); });
    vi.doMock("@/lib/deployment-config", () => ({ getDeploymentConfig: normalRead }));
    vi.stubEnv("SITE_MAINTENANCE_MODE", mode);
    vi.stubEnv("NEXT_PUBLIC_SITE_MAINTENANCE_MODE", "");
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    for (const path of ["/", "/fi/tarinat", "/unknown", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/private/test", "/admin/login", "/client-gallery/test", "/api/poll-vote"]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const response = proxy(new NextRequest(`https://maintenance.test${path}?maintenance=off`, {
          method,
          headers: { "x-photosite-maintenance-fallback": "0", cookie: "maintenance=off", "x-middleware-subrequest": "proxy" },
        }));
        expect(response.status, `${method} ${path}`).toBe(503);
      }
    }
    expect(normalRead).not.toHaveBeenCalled();
  });
  it("strips forged fallback headers while disabled and overwrites them while enabled", async () => {
    vi.resetModules();
    vi.doMock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => { throw new Error("asset passthrough must not read config"); } }));
    vi.stubEnv("NEXT_PUBLIC_SITE_MAINTENANCE_MODE", "");
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    for (const path of ["/gallery/not-a-file", "/_next/static/not-a-file.js", "/x.html"]) {
      const request = new NextRequest(`https://maintenance.test${path}`, { headers: { "x-photosite-maintenance-fallback": "forged" } });
      vi.stubEnv("SITE_MAINTENANCE_MODE", "off");
      expect(proxy(request).headers.get("x-middleware-request-x-photosite-maintenance-fallback")).toBeNull();
      vi.stubEnv("SITE_MAINTENANCE_MODE", "on");
      expect(proxy(request).headers.get("x-middleware-request-x-photosite-maintenance-fallback")).toBe("1");
    }
  });
  it.each(["/%72obots.txt", "/%73itemap.xml", "/%66avicon.ico"])("gates encoded metadata before Next's exact filesystem match: %s", async (path) => {
    vi.resetModules();
    const normalRead = vi.fn(() => { throw new Error("metadata must not read normal configuration"); });
    vi.doMock("@/lib/deployment-config", () => ({ getDeploymentConfig: normalRead }));
    vi.stubEnv("SITE_MAINTENANCE_MODE", "on");
    vi.stubEnv("NEXT_PUBLIC_SITE_MAINTENANCE_MODE", "");
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const response = proxy(new NextRequest(`https://maintenance.test${path}`));
    expect(response.status).toBe(503);
    expect(normalRead).not.toHaveBeenCalled();
  });
  it("the fallback route itself stays content-free and default-disabled", async () => {
    const route = await import("@/app/api/site-maintenance/route");
    vi.stubEnv("NEXT_PUBLIC_SITE_MAINTENANCE_MODE", "");
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
      const request = new Request("https://maintenance.test/api/site-maintenance", { method });
      vi.stubEnv("SITE_MAINTENANCE_MODE", "off");
      expect(route[method](request).status).toBe(404);
      vi.stubEnv("SITE_MAINTENANCE_MODE", "on");
      expect(route[method](request).status).toBe(503);
    }
  });
});
