import { afterEach, describe, expect, it, vi } from "vitest";

import { REQUEST_PATH_HEADER } from "@/lib/request-path";

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
    request: (path: string, headers?: Record<string, string>) =>
      new NextRequest(new URL(path, "https://proxy.test"), { headers }),
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

describe("administrator route response hygiene (ADR-0015 §1)", () => {
  it.each(["/admin", "/admin/login", "/admin/galleries/some-id"])(
    "stamps no-store / noindex / no-referrer on a pass-through response for %s",
    async (path) => {
      const { proxy, request } = await loadProxy();
      expect(headersOf(proxy(request(path)))).toMatchObject(HYGIENE);
    },
  );

  it("stamps the hygiene headers on an admin path's trailing-slash 308", async () => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request("/admin/login/"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toContain("/admin/login");
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });

  it("honours a deployment-configured custom admin prefix", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
    });
    expect(headersOf(proxy(request("/studio/login")))).toMatchObject(HYGIENE);
    // The default prefix is now an ordinary path.
    expect(
      headersOf(proxy(request("/admin/login")))["cache-control"],
    ).toBeUndefined();
  });

  it("does not treat a same-stem non-namespace path as administrative", async () => {
    const { proxy, request } = await loadProxy();
    expect(
      headersOf(proxy(request("/administrator")))["cache-control"],
    ).toBeUndefined();
  });

  it("skips the legacy-redirect lookup for an admin path", async () => {
    // Same hazard the customer namespace has: the legacy registry answers
    // before the hygiene headers apply, so a match would return a cacheable
    // 410 from inside the administrator namespace.
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

    expect(proxy(request("/anything")).status).toBe(301);
    const adminResponse = proxy(request("/admin/login"));
    expect(adminResponse.status).not.toBe(301);
    expect(headersOf(adminResponse)).toMatchObject(HYGIENE);
  });

  it.each([
    ["/admin", "/private-gallery-admin"],
    ["/admin/login", "/private-gallery-admin/login"],
  ])("rewrites %s onto its own internal segment", async (path, expected) => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request(path));
    expect(
      new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname,
    ).toBe(expected);
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });

  it("keeps the two namespaces independent under custom prefixes", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
      PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
    });

    // Each rewrites onto its **own** internal segment. ADR-0015 §1's isolation
    // has to hold for the route tree behind the URL, not only for the URL.
    const customer = proxy(request("/clients/handle"));
    expect(
      new URL(customer.headers.get("x-middleware-rewrite") ?? "").pathname,
    ).toBe("/private-gallery/handle");
    expect(headersOf(customer)).toMatchObject(HYGIENE);

    const admin = proxy(request("/studio/login"));
    expect(
      new URL(admin.headers.get("x-middleware-rewrite") ?? "").pathname,
    ).toBe("/private-gallery-admin/login");
    expect(headersOf(admin)).toMatchObject(HYGIENE);
  });

  it("404s a direct request to the internal segment, and passes its own second pass", async () => {
    const { proxy, request } = await loadProxy();

    // A stranger guessing the internal shape gets nothing.
    expect(proxy(request("/private-gallery-admin/login")).status).toBe(404);

    // The Proxy's own second pass over the path it rewrote to is recognised by
    // the request path the first pass carried.
    const second = proxy(
      request("/private-gallery-admin/login", {
        [REQUEST_PATH_HEADER]: "/admin/login",
      }),
    );
    expect(second.status).not.toBe(404);
    expect(headersOf(second)).toMatchObject(HYGIENE);
  });

  it("refuses a second pass whose carried path names a different admin route", async () => {
    const { proxy, request } = await loadProxy();
    expect(
      proxy(
        request("/private-gallery-admin/login", {
          [REQUEST_PATH_HEADER]: "/admin/somewhere-else",
        }),
      ).status,
    ).toBe(404);
  });
});

describe("private namespace rewrite (ADR-0014 §9)", () => {
  /** `NextResponse.rewrite`'s own wire signal, read back as the rewrite target. */
  const rewriteTarget = (response: { headers: Headers }) =>
    response.headers.get("x-middleware-rewrite");

  it.each([
    ["/private", "/private-gallery"],
    ["/private/handle", "/private-gallery/handle"],
    ["/private/handle/exchange", "/private-gallery/handle/exchange"],
  ])("rewrites %s onto the internal segment", async (path, expected) => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request(path));

    expect(new URL(rewriteTarget(response) ?? "").pathname).toBe(expected);
    // The rewrite is invisible to the browser, so §6's headers still apply.
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });

  it("rewrites a custom prefix onto the same fixed internal segment", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
    });
    const response = proxy(request("/clients/handle"));

    expect(new URL(rewriteTarget(response) ?? "").pathname).toBe(
      "/private-gallery/handle",
    );
  });

  it("preserves the query string across the rewrite", async () => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request("/private/handle?a=1&b=2"));

    expect(new URL(rewriteTarget(response) ?? "").search).toBe("?a=1&b=2");
  });

  it("rewrites nothing for a non-private path", async () => {
    const { proxy, request } = await loadProxy();
    expect(rewriteTarget(proxy(request("/stories")))).toBeNull();
  });

  it.each([
    "/private-gallery",
    "/private-gallery/handle",
    "/private-gallery/handle/exchange",
  ])("answers 404 for a direct request to %s", async (path) => {
    // The internal segment is the rewrite *target*, never a public door: a
    // request that arrived there on its own carries no rewrite source, so
    // nothing links it to a configured-prefix request.
    const { proxy, request } = await loadProxy();
    expect(proxy(request(path)).status).toBe(404);
  });

  it("passes the Proxy's own second pass through with the hygiene headers", async () => {
    // Next.js runs this Proxy again on the path it rewrote to (verified against
    // a production build in `e2e/private-gallery-link.spec.ts`), carrying the
    // request headers the first pass set. That second pass must reach the
    // route, and must answer with §6's headers — as a `next()`, which is what
    // makes `Referrer-Policy: no-referrer` replace the site-wide value.
    const { proxy, request } = await loadProxy();
    const response = proxy(
      request("/private-gallery/handle", {
        [REQUEST_PATH_HEADER]: "/private/handle",
      }),
    );

    expect(response.status).not.toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });

  it.each([
    ["names a different gallery", "/private/other-handle"],
    ["is not a private path at all", "/stories/portfolio"],
    ["is the internal path itself", "/private-gallery/handle"],
    ["is unusable as a path", "https://elsewhere.test/private/handle"],
  ])(
    "still answers 404 when the carried source path %s",
    async (_case, carried) => {
      // The header is client-settable, so it is checked for consistency rather
      // than trusted: it must be a private path under *this* deployment's
      // prefix whose rewrite is exactly the path being served.
      const { proxy, request } = await loadProxy();
      const response = proxy(
        request("/private-gallery/handle", {
          [REQUEST_PATH_HEADER]: carried,
        }),
      );

      expect(response.status).toBe(404);
    },
  );

  it("does not accept a source path under a prefix this deployment does not use", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
    });

    expect(
      proxy(
        request("/private-gallery/handle", {
          [REQUEST_PATH_HEADER]: "/private/handle",
        }),
      ).status,
    ).toBe(404);
    expect(
      proxy(
        request("/private-gallery/handle", {
          [REQUEST_PATH_HEADER]: "/clients/handle",
        }),
      ).status,
    ).not.toBe(404);
  });

  it("does not 404 a path that merely starts with the internal segment", async () => {
    const { proxy, request } = await loadProxy();
    // The bootstrap script itself lives at this root path.
    expect(proxy(request("/private-gallery-bootstrap.js")).status).not.toBe(404);
  });

  it("refuses the internal segment even when a deployment renames the prefix", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
    });
    expect(proxy(request("/private-gallery/handle")).status).toBe(404);
  });
});
