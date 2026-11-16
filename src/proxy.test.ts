import { afterEach, describe, expect, it, vi } from "vitest";

import { REQUEST_PATH_HEADER } from "@/lib/request-path";

/**
 * The Proxy reads `getDeploymentConfig()`, which resolves `process.env` and
 * memoizes. Each case here stubs the environment, resets the module graph, and
 * re-imports `proxy` so a custom `PRIVATE_GALLERY_ROUTE_PREFIX` is honoured.
 * The matcher itself is Next.js routing config and is exercised by the
 * production-build journey (`e2e/reserved-namespace-hygiene.spec.ts`), not here.
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
  SITE_MAINTENANCE_MODE: "off",
  NEXT_PUBLIC_SITE_MAINTENANCE_MODE: "",
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
    request: (path: string, headers?: Record<string, string>, method = "GET") =>
      new NextRequest(new URL(path, "https://proxy.test"), { headers, method }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/legacy-redirects");
});

function headersOf(response: { headers: Headers }) {
  return Object.fromEntries(response.headers.entries());
}

describe("retained-gallery redirect deployment failure (AB#295)", () => {
  const handle = "a".repeat(32);
  const fixtureEnv = {
    LEGACY_GALLERY_ADAPTER: "fixture",
    LEGACY_GALLERY_HANDLES: handle,
    LEGACY_GALLERY_REDIRECTS: JSON.stringify([["/retained-source", handle]]),
  };

  it("serves ordinary routes and issues no retained redirect from a malformed map", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { proxy, request } = await loadProxy({
        ...fixtureEnv,
        LEGACY_GALLERY_REDIRECTS: '{"private-path":"/retained-source"}',
      });
      for (const path of ["/", "/contact", "/retained-source"]) {
        const response = proxy(request(path));
        expect(response.status).toBe(200);
        expect(response.headers.get("location")).toBeNull();
      }
      expect(proxy(request("/retained-source", undefined, "POST")).status).not.toBe(405);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls.flat().join(" ")).not.toContain("private-path");
      expect(warning.mock.calls.flat().join(" ")).not.toContain("retained-source");
    } finally {
      warning.mockRestore();
    }
  });

  it("uses a non-cacheable temporary redirect for valid GET and HEAD links", async () => {
    const { proxy, request } = await loadProxy(fixtureEnv);
    for (const method of ["GET", "HEAD"]) {
      const response = proxy(request("/retained-source?password=obsolete&locale=fi", undefined, method));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://proxy.test/client-gallery/${handle}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const post = proxy(request("/retained-source", undefined, "POST"));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("legacy category-ancestry fallback notice (AB#19)", () => {
  it("adds its one fixed notice value without accepting a caller-supplied replacement", async () => {
    vi.doMock("@/lib/legacy-redirects", async () => {
      const actual = await vi.importActual<typeof import("@/lib/legacy-redirects")>(
        "@/lib/legacy-redirects",
      );
      return {
        ...actual,
        resolveLegacyRedirect: (_entries: unknown, pathname: string) =>
          pathname === "/retired-page"
            ? {
                kind: "redirect" as const,
                target: "/stories",
                reservedQueryParams: "preserve" as const,
                fallbackNotice: "content-unavailable" as const,
              }
            : undefined,
      };
    });
    const { proxy, request } = await loadProxy();

    const response = proxy(
      request("/retired-page?legacy-notice=forged&utm_source=newsletter"),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://proxy.test/stories?utm_source=newsletter&legacy-notice=content-unavailable",
    );
  });
});

describe("retired protected namespaces (AB#313)", () => {
  // The protected customer and administrator routes were removed. Their
  // prefixes stay reserved, and everything under them is one hygienic 404.
  it.each([
    "/private", "/private/some-gallery-handle", "/private/a/b/c", "/private/handle/", "/private/handle?a=1",
    "/admin", "/admin/login", "/admin/login/", "/admin/galleries/some-id",
    "/private-gallery", "/private-gallery/handle", "/private-gallery/handle/exchange",
    "/private-gallery-admin", "/private-gallery-admin/login",
  ])("answers a hygienic 404 without a rewrite or redirect for %s", async (path) => {
    const { proxy, request } = await loadProxy();
    for (const method of ["GET", "POST", "PUT", "PATCH"]) {
      const response = proxy(request(path, {}, method));
      expect(response.status).toBe(404);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("location")).toBeNull();
      expect(headersOf(response)).toMatchObject(HYGIENE);
    }
  });

  it("does not let a carried request path open the old internal segments", async () => {
    const { proxy, request } = await loadProxy();
    expect(proxy(request("/private-gallery/handle", { [REQUEST_PATH_HEADER]: "/private/handle" })).status).toBe(404);
    expect(proxy(request("/private-gallery-admin/login", { [REQUEST_PATH_HEADER]: "/admin/login" })).status).toBe(404);
  });

  it("leaves an ordinary route's response untouched", async () => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request("/services"));
    const headers = headersOf(response);
    expect(response.status).not.toBe(404);
    expect(headers["cache-control"]).toBeUndefined();
    expect(headers["x-robots-tag"]).toBeUndefined();
    // The Proxy sets no Referrer-Policy for an ordinary path; the site-wide
    // one comes from next.config.ts and is not visible to this unit.
    expect(headers["referrer-policy"]).toBeUndefined();
  });

  it("follows deployment-configured custom prefixes, and keeps the literal segments closed", async () => {
    const { proxy, request } = await loadProxy({
      PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
      PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "studio",
    });
    for (const path of ["/clients/x", "/studio/login", "/private-gallery/handle", "/private-gallery-admin/login"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(404);
      expect(headersOf(response)).toMatchObject(HYGIENE);
    }
    // The default prefixes are now ordinary paths.
    for (const path of ["/private/x", "/admin/login"]) {
      const response = proxy(request(path));
      expect(response.status).not.toBe(404);
      expect(headersOf(response)["cache-control"]).toBeUndefined();
    }
  });

  it.each(["/privateer", "/administrator", "/private-gallery-old"])("does not treat the same-stem path %s as reserved", async (path) => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request(path));
    expect(response.status).not.toBe(404);
    expect(headersOf(response)["cache-control"]).toBeUndefined();
  });

  it("answers before the legacy-redirect lookup", async () => {
    // The legacy registry would otherwise return a cacheable 301 or 410 from
    // inside a reserved namespace.
    vi.doMock("@/lib/legacy-redirects", async () => {
      const actual = await vi.importActual<typeof import("@/lib/legacy-redirects")>("@/lib/legacy-redirects");
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
    for (const path of ["/private/anything", "/admin/login"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(404);
      expect(headersOf(response)).toMatchObject(HYGIENE);
    }
  });
});



describe("restricted UI locale header ownership", () => {
  it.each(["/client-gallery/11111111111111111111111111111111", "/client-proof/77777777777777777777777777777777"])("overwrites spoofed headers from configured query on %s", async (path) => {
    const { proxy, request } = await loadProxy({ SITE_LOCALE_ROUTES: "en-GB||stories,fi|fi|tarinat" });
    const response = proxy(request(`${path}?locale=fi`, { "x-photosite-restricted-ui-locale": "en-GB" }));
    expect(response.headers.get("x-middleware-request-x-photosite-restricted-ui-locale")).toBe("fi");
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });
  it("defaults a repeated query instead of trusting a header", async () => {
    const { proxy, request } = await loadProxy({ SITE_LOCALE_ROUTES: "en-GB||stories,fi|fi|tarinat" });
    const response = proxy(request("/client-gallery/11111111111111111111111111111111?locale=fi&locale=fi", { "x-photosite-restricted-ui-locale": "fi" }));
    expect(response.headers.get("x-middleware-request-x-photosite-restricted-ui-locale")).toBe("en-GB");
  });
  it("removes client preferences outside the restricted namespace", async () => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request("/stories", { "x-photosite-restricted-ui-locale": "fi" }));
    expect(response.headers.get("x-middleware-request-x-photosite-restricted-ui-locale")).toBeNull();
  });
});

describe("percent-encoded spellings of reserved and unlisted namespaces (AB#420)", () => {
  it.each([
    "/priv%61te", "/priv%61te/some-handle", "/%61dmin/login", "/private-g%61llery/handle", "/private-gallery-%61dmin",
    `/client-gall%65ry/${"1".repeat(32)}`, `/client-pro%6Ff/${"7".repeat(32)}`,
  ])("answers %s with the namespace's hygienic 404", async (path) => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request(path));
    expect(response.status).toBe(404);
    expect(headersOf(response)).toMatchObject(HYGIENE);
  });

  it("leaves an undecodable or unrelated encoded path to the ordinary routes", async () => {
    const { proxy, request } = await loadProxy();
    for (const path of ["/priv%ZZte", "/stories/caf%C3%A9"]) {
      expect(headersOf(proxy(request(path)))["cache-control"]).toBeUndefined();
    }
  });
});

describe("project request headers on file-shaped paths (AB#420, ADR-0007)", () => {
  const spoofed = {
    "x-photosite-request-path": "/stories/forged",
    "x-photosite-request-has-cursor": "1",
    "x-photosite-request-has-section": "1",
    "x-photosite-restricted-ui-locale": "fi",
  };
  const forwarded = (response: { headers: Headers }) =>
    Object.keys(spoofed).filter((name) => response.headers.get(`x-middleware-request-${name}`) !== null);

  it.each(["/gallery/missing-image.000000000000.webp", "/x.html", "/_next/not-a-file", "/favicon.ico"])(
    "forwards none of them for %s",
    async (path) => {
      const { proxy, request } = await loadProxy();
      expect(forwarded(proxy(request(path, spoofed)))).toEqual([]);
    },
  );

  it("forwards none of them for a file-shaped path during maintenance", async () => {
    const { proxy, request } = await loadProxy({ SITE_MAINTENANCE_MODE: "on" });
    expect(forwarded(proxy(request("/gallery/missing-image.000000000000.webp", spoofed)))).toEqual([]);
  });
});

describe("proof gallery namespace (ADR-0038)", () => {
  const handle = "7".repeat(32);
  it("renders only the literal handle grammar, with the reserved-namespace hygiene", async () => {
    const { proxy, request } = await loadProxy({ SITE_LOCALE_ROUTES: "en-GB||stories,fi|fi|tarinat" });
    const page = proxy(request(`/client-proof/${handle}`));
    expect(page.status).toBe(200); expect(headersOf(page)).toMatchObject(HYGIENE);
    for (const path of ["/client-proof", "/client-proof/short", `/client-proof/${"A".repeat(32)}`, `/Client-Proof/${handle}`, `/fi/client-proof/${handle}`, `/client-proof/${handle}/extra`]) {
      const response = proxy(request(path));
      expect(response.status, path).toBe(404); expect(headersOf(response)).toMatchObject(HYGIENE);
    }
    const slash = proxy(request(`/client-proof/${handle}/?locale=fi`));
    expect(slash.status).toBe(308);
    expect(slash.headers.get("location")).toBe(`https://proxy.test/client-proof/${handle}?locale=fi`);
    expect(headersOf(slash)).toMatchObject(HYGIENE);
    // The delivery namespace shares the branch: its slash redirect must not point back at itself.
    const legacy = proxy(request(`/client-gallery/${"1".repeat(32)}/`));
    expect(legacy.status).toBe(308);
    expect(legacy.headers.get("location")).toBe(`https://proxy.test/client-gallery/${"1".repeat(32)}`);
  });
});

describe("per-request script nonce (AB#390)", () => {
  const scriptSources = (policy: string | null) =>
    (policy ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src ")) ?? "";

  it.each(["/", "/stories", "/contact", "/gallery/missing.1683eecb7e65.webp", "/client-gallery/11111111111111111111111111111111", "/client-proof/77777777777777777777777777777777"])(
    "gives a public %s response a nonce policy and forwards it to rendering",
    async (path) => {
      const { proxy, request } = await loadProxy();
      const response = proxy(request(path));
      const nonce = response.headers.get("x-middleware-request-x-nonce");
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      const policy = response.headers.get("content-security-policy");
      expect(scriptSources(policy)).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
      expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    },
  );

  it("tags a page rendered for a form POST too", async () => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request("/contact", undefined, "POST"));
    expect(response.headers.get("x-middleware-request-x-nonce")).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("issues a different nonce for every request", async () => {
    const { proxy, request } = await loadProxy();
    const first = proxy(request("/")).headers.get("x-middleware-request-x-nonce");
    const second = proxy(request("/")).headers.get("x-middleware-request-x-nonce");
    expect(first).not.toBe(second);
  });

  it("replaces a client-supplied nonce and policy", async () => {
    const { proxy, request } = await loadProxy();
    const forged = "AAAAAAAAAAAAAAAAAAAAAA==";
    const response = proxy(request("/", { "x-nonce": forged, "content-security-policy": "script-src *" }));
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe(forged);
    expect(response.headers.get("x-middleware-request-content-security-policy")).not.toContain("script-src *");
  });

  it.each([
    ["an API route", "/api/contact", "GET"],
    ["the inactive private namespace", "/private-gallery/handle", "GET"],
    ["the prerendered 404 page path", "/404", "GET"],
    ["the prerendered global error page path", "/_global-error", "GET"],
  ])("leaves %s on the static fallback without forwarding a nonce", async (_label, path, method) => {
    const { proxy, request } = await loadProxy();
    const response = proxy(request(path, { "x-nonce": "AAAAAAAAAAAAAAAAAAAAAA==" }, method));
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
