import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Proxy reads `getDeploymentConfig()`, which resolves `process.env` and
 * memoizes. Each case here stubs the environment, resets the module graph, and
 * re-imports `proxy` so a custom `PRIVATE_GALLERY_ROUTE_PREFIX` is honoured.
 * The matcher itself is Next.js routing config and is exercised by the
 * production-build journey (`e2e/private-route-hygiene.spec.ts`), not here.
 */
const BASE_ENV: Record<string, string> = {
  SITE_LOCALE: "en-GB",
  SITE_LOCALE_ROUTES: "en-GB||stories",
  SITE_CANONICAL_BASE_URL: "https://proxy.test",
  SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
  SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536",
  SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
  SITE_CONTENT_SOURCE: "mock",
  SITE_DEPLOYMENT_STAGE: "development",
};

const HYGIENE = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

async function loadProxy(extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...extraEnv })) {
    vi.stubEnv(key, value);
  }
  const { proxy } = await import("@/proxy");
  const { NextRequest } = await import("next/server");
  return {
    proxy,
    request: (path: string) =>
      new NextRequest(new URL(path, "https://proxy.test")),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/legacy-redirects");
});

function headersOf(response: { headers: Headers }) {
  return Object.fromEntries(response.headers.entries());
}

describe("private route response hygiene (ADR-0014 §6)", () => {
  it.each(["/private", "/private/some-gallery-handle", "/private/a/b/c"])(
    "stamps no-store / noindex / no-referrer on a pass-through response for %s",
    async (path) => {
      const { proxy, request } = await loadProxy();
      const headers = headersOf(proxy(request(path)));
      expect(headers).toMatchObject(HYGIENE);
    },
  );

  it("stamps the hygiene headers on a private path's trailing-slash 308", async () => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request("/private/handle/"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toContain("/private/handle");
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });

  it("leaves an ordinary route's response untouched", async () => {
    const { proxy, request } = await loadProxy();
    const headers = headersOf(proxy(request("/services")));
    expect(headers["cache-control"]).toBeUndefined();
    expect(headers["x-robots-tag"]).toBeUndefined();
    // The Proxy sets no Referrer-Policy for a non-private path; the site-wide
    // one comes from next.config.ts and is not visible to this unit.
    expect(headers["referrer-policy"]).toBeUndefined();
  });

  it("honours a deployment-configured custom prefix", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
    });
    expect(headersOf(proxy(request("/clients/x")))).toMatchObject(HYGIENE);
    // The default prefix is now an ordinary path.
    expect(
      headersOf(proxy(request("/private/x")))["cache-control"],
    ).toBeUndefined();
  });

  it("does not treat a same-stem non-namespace path as private", async () => {
    const { proxy, request } = await loadProxy();
    expect(
      headersOf(proxy(request("/privateer")))["cache-control"],
    ).toBeUndefined();
  });

  it("skips the legacy-redirect lookup for a private path", async () => {
    vi.doMock("@/lib/legacy-redirects", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/legacy-redirects")
      >("@/lib/legacy-redirects");
      return {
        ...actual,
        resolveLegacyRedirect: () => ({
          kind: "redirect" as const,
          target: "/redirected-away",
          reservedQueryParams: new Set<string>(),
        }),
      };
    });
    const { proxy, request } = await loadProxy();

    // An ordinary path takes the (mocked) legacy redirect...
    expect(proxy(request("/anything")).status).toBe(301);
    // ...but a private path never consults it, so it passes through with hygiene.
    const privateResponse = proxy(request("/private/anything"));
    expect(privateResponse.status).not.toBe(301);
    expect(headersOf(privateResponse)).toMatchObject(HYGIENE);
  });
});
