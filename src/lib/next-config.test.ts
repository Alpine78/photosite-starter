import { AsyncLocalStorage } from "node:async_hooks";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YOUTUBE_NOCOOKIE_ORIGIN } from "@/lib/embed-origins";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "@/lib/image-delivery";
import { mockImages } from "@/lib/mock-media";
import {
  loadSanityConfig,
  SANITY_ASSET_CDN_HOST,
} from "@/lib/sanity-config";

const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

/**
 * A deployment reading the project's own fixtures, stated rather than inherited.
 *
 * The configuration is built from deployment settings, so importing it once at
 * the top of this file would make every assertion depend on the shell the suite
 * happens to run in — and a developer whose environment declares a CMS would see
 * this file fail to load at all, which reads as a broken test rather than as a
 * local setting.
 */
const FIXTURE_DEPLOYMENT = {
  SITE_CONTENT_SOURCE: "mock",
  SANITY_PROJECT_ID: "",
  SANITY_DATASET: "",
  SANITY_DATASET_VISIBILITY: "",
  SANITY_API_VERSION: "",
  SANITY_READ_TOKEN: "",
  NEXT_PUBLIC_SANITY_READ_TOKEN: "",
} as const;

const PUBLIC_SANITY_DEPLOYMENT = {
  SITE_CONTENT_SOURCE: "sanity",
  SANITY_PROJECT_ID: "zp7mbokg",
  SANITY_DATASET: "production",
  SANITY_DATASET_VISIBILITY: "public",
  SANITY_API_VERSION: "v2026-06-24",
} as const;

async function configuredWith(
  environment: Readonly<Record<string, string>>,
): Promise<NextConfig> {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    ...FIXTURE_DEPLOYMENT,
    ...environment,
  })) {
    vi.stubEnv(name, value);
  }

  return (await import("../../next.config")).default;
}

async function getConfigResponse(
  pathname: string,
  environment: Readonly<Record<string, string>> = FIXTURE_DEPLOYMENT,
) {
  Object.assign(globalThis, { AsyncLocalStorage });
  const nextConfig = await configuredWith(environment);
  const { unstable_getResponseFromNextConfig } = await import(
    "next/experimental/testing/server"
  );

  return unstable_getResponseFromNextConfig({
    url: `https://example.com${pathname}`,
    nextConfig,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public image Next.js configuration", () => {
  it("leaves trailing-slash normalization to the cursor-aware Proxy", async () => {
    const nextConfig = await configuredWith(FIXTURE_DEPLOYMENT);

    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });

  it("bounds current optimizer candidates to the 2048px presentation ceiling", async () => {
    const nextConfig = await configuredWith(FIXTURE_DEPLOYMENT);
    const deviceSizes = nextConfig.images?.deviceSizes ?? [];
    const imageSizes = nextConfig.images?.imageSizes ?? [];

    expect(deviceSizes).toEqual([
      640, 750, 828, 1024, 1080, 1200, 1254, 1536, 2048,
    ]);
    expect(imageSizes).toEqual([256, 384]);
    expect([...new Set(deviceSizes)]).toEqual(deviceSizes);
    expect([...deviceSizes].sort((left, right) => left - right)).toEqual(
      deviceSizes,
    );
    expect(Math.max(...imageSizes)).toBeLessThan(Math.min(...deviceSizes));
    expect(
      Math.max(
        ...Object.values(mockImages).map((image) => image.rendition.width),
      ),
    ).toBeLessThanOrEqual(Math.max(...deviceSizes));
  });

  it("bounds a deployment's own derivatives to the widest candidate it emits", async () => {
    // One number, not two. A derivative wider than the widest candidate could
    // never be delivered in full, so the export policy and the optimizer's
    // ceiling are pinned to each other rather than drifting apart.
    const nextConfig = await configuredWith(FIXTURE_DEPLOYMENT);

    expect(MAX_PUBLIC_DELIVERY_DIMENSION).toBe(
      Math.max(...(nextConfig.images?.deviceSizes ?? [])),
    );
  });

  it("optimizes no remote image for a deployment reading fixtures", async () => {
    const nextConfig = await configuredWith(FIXTURE_DEPLOYMENT);

    expect(nextConfig.images?.remotePatterns ?? []).toEqual([]);
  });

  it("allows only this deployment's own project and dataset on the asset CDN", async () => {
    const config = await configuredWith(PUBLIC_SANITY_DEPLOYMENT);

    expect(config.images?.remotePatterns).toEqual([
      {
        protocol: "https",
        // Pinned to the module that owns the address, which build
        // configuration cannot import because it is marked `server-only`.
        hostname: SANITY_ASSET_CDN_HOST,
        port: "",
        pathname: "/images/zp7mbokg/production/**",
        search: "",
      },
    ]);
  });

  it("fails the build when a CMS deployment cannot name its own assets", async () => {
    await expect(
      configuredWith({
        ...PUBLIC_SANITY_DEPLOYMENT,
        SANITY_DATASET: "",
      }),
    ).rejects.toThrow(/SANITY_DATASET/);
  });

  it.each(["SANITY_DATASET_VISIBILITY", "SANITY_API_VERSION"])(
    "fails the build when a CMS deployment omits %s",
    async (settingName) => {
      await expect(
        configuredWith({
          ...PUBLIC_SANITY_DEPLOYMENT,
          [settingName]: "",
        }),
      ).rejects.toThrow(new RegExp(settingName));
    },
  );

  it("refuses an unknown dataset visibility during configuration", async () => {
    await expect(
      configuredWith({
        ...PUBLIC_SANITY_DEPLOYMENT,
        SANITY_DATASET_VISIBILITY: "restricted",
      }),
    ).rejects.toThrow(/SANITY_DATASET_VISIBILITY/);
  });

  it.each(["latest", "v2026-02-31", "v2099-01-01"])(
    "refuses an API version the runtime configuration would reject: %s",
    async (apiVersion) => {
      await expect(
        configuredWith({
          ...PUBLIC_SANITY_DEPLOYMENT,
          SANITY_API_VERSION: apiVersion,
        }),
      ).rejects.toThrow(/SANITY_API_VERSION/);

      // Pinned to the application's own rule rather than to a copy of the
      // regular expression and the date logic: whatever the deployment
      // configuration refuses to run with, the optimizer refuses to build
      // with too. Restating the check without pinning it is how the two
      // silently drift apart the day one of them is edited alone.
      expect(() =>
        loadSanityConfig({
          SANITY_PROJECT_ID: "zp7mbokg",
          SANITY_DATASET: "production",
          SANITY_DATASET_VISIBILITY: "public",
          SANITY_API_VERSION: apiVersion,
        }),
      ).toThrow();
    },
  );

  it("accepts the same API version the runtime configuration would", async () => {
    const config = await configuredWith(PUBLIC_SANITY_DEPLOYMENT);

    expect(config.images?.remotePatterns).toHaveLength(1);
    expect(() =>
      loadSanityConfig({
        SANITY_PROJECT_ID: "zp7mbokg",
        SANITY_DATASET: "production",
        SANITY_DATASET_VISIBILITY: "public",
        SANITY_API_VERSION: PUBLIC_SANITY_DEPLOYMENT.SANITY_API_VERSION,
      }),
    ).not.toThrow();
  });

  it.each(["", "[SENSITIVE]", "$(SANITY_READ_TOKEN)"])(
    "fails the build when a private dataset receives no usable build credential: %s",
    async (token) => {
      await expect(
        configuredWith({
          ...PUBLIC_SANITY_DEPLOYMENT,
          SANITY_DATASET_VISIBILITY: "private",
          SANITY_READ_TOKEN: token,
        }),
      ).rejects.toThrow(/SANITY_READ_TOKEN/);
    },
  );

  it("accepts a private dataset with a build-scoped credential", async () => {
    const config = await configuredWith({
      ...PUBLIC_SANITY_DEPLOYMENT,
      SANITY_DATASET_VISIBILITY: "private",
      SANITY_READ_TOKEN: "sk-fixture-build-token",
    });

    expect(config.images?.remotePatterns).toHaveLength(1);
  });

  it("refuses a read token under a public browser setting", async () => {
    await expect(
      configuredWith({
        ...PUBLIC_SANITY_DEPLOYMENT,
        NEXT_PUBLIC_SANITY_READ_TOKEN: "sk-fixture-token",
      }),
    ).rejects.toThrow(/NEXT_PUBLIC_SANITY_READ_TOKEN/);
  });

  it.each([
    ["a path traversal", "zp7mbokg/../..", "production"],
    ["a glob", "zp7mbokg", "*"],
    ["a second path segment", "zp7mbokg", "production/drafts"],
    ["an uppercase project id", "ZP7MBOKG", "production"],
  ])(
    "refuses to widen the allow-list with %s",
    async (_case, projectId, dataset) => {
      // These values reach a *path* in the allow-list at build time, before the
      // application's own configuration is ever loaded, so they are validated
      // here too rather than trusted to fail later.
      await expect(
        configuredWith({
          ...PUBLIC_SANITY_DEPLOYMENT,
          SANITY_PROJECT_ID: projectId,
          SANITY_DATASET: dataset,
        }),
      ).rejects.toThrow(/SANITY_PROJECT_ID or SANITY_DATASET/);

      // Pinned to the application's own rules rather than to a copy of the
      // regular expressions: whatever the deployment refuses to run with, the
      // optimizer refuses to allow.
      expect(() =>
        loadSanityConfig({
          SANITY_PROJECT_ID: projectId,
          SANITY_DATASET: dataset,
          SANITY_DATASET_VISIBILITY: "public",
          SANITY_API_VERSION: "v2026-06-24",
        }),
      ).toThrow();
    },
  );

  it("adds immutable caching only to a content-versioned gallery path", async () => {
    const response = await getConfigResponse(
      "/gallery/coastal-landscape.1683eecb7e65.webp",
    );

    expect(response.headers.get("cache-control")).toBe(
      IMMUTABLE_CACHE_CONTROL,
    );
  });

  it.each([
    "/gallery/coastal-landscape.final.webp",
    "/gallery/coastal-landscape.1683EECB7E65.webp",
    "/gallery/coastal-landscape.1683eecb7e65.gif",
    "/gallery/coastal.landscape.1683eecb7e65.webp",
  ])("does not cache a non-versioned source as immutable: %s", async (src) => {
    const response = await getConfigResponse(src);

    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("carries both its own immutable Cache-Control and the site-wide security headers, not one instead of the other", async () => {
    const response = await getConfigResponse(
      "/gallery/coastal-landscape.1683eecb7e65.webp",
    );

    expect(response.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });
});

describe("security response headers", () => {
  it.each(["/", "/contact", "/services/portrait-sessions", "/api/contact"])(
    "applies the fixed security headers to every path: %s",
    async (pathname) => {
      const response = await getConfigResponse(pathname);

      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
    },
  );

  it("never sets Strict-Transport-Security, leaving it to Vercel's platform default", async () => {
    const response = await getConfigResponse("/");

    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("denies features this application never uses", async () => {
    const response = await getConfigResponse("/");
    const permissionsPolicy = response.headers.get("permissions-policy") ?? "";

    for (const feature of [
      "camera",
      "geolocation",
      "microphone",
      "midi",
      "payment",
      "usb",
    ]) {
      expect(permissionsPolicy).toContain(`${feature}=()`);
    }
  });

  it("scopes the YouTube embed's own features to self and its origin, matching the iframe's allow attribute", async () => {
    const response = await getConfigResponse("/");
    const permissionsPolicy = response.headers.get("permissions-policy") ?? "";

    for (const feature of [
      "accelerometer",
      "autoplay",
      "clipboard-write",
      "encrypted-media",
      "fullscreen",
      "gyroscope",
      "picture-in-picture",
    ]) {
      expect(permissionsPolicy).toContain(
        `${feature}=(self "${YOUTUBE_NOCOOKIE_ORIGIN}")`,
      );
    }
  });

  it("ships a CSP with no unsafe-eval, a denied frame-ancestors, and no wildcard sources", async () => {
    const response = await getConfigResponse("/");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain(`frame-src ${YOUTUBE_NOCOOKIE_ORIGIN}`);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("*");
  });

  it("allows unsafe-eval only in development, where React's own debugging eval() calls need it", async () => {
    const devResponse = await getConfigResponse("/", {
      ...FIXTURE_DEPLOYMENT,
      NODE_ENV: "development",
    });
    const prodResponse = await getConfigResponse("/", {
      ...FIXTURE_DEPLOYMENT,
      NODE_ENV: "production",
    });

    expect(devResponse.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(prodResponse.headers.get("content-security-policy")).not.toContain(
      "unsafe-eval",
    );
  });

  it("allows no remote image source for a deployment reading fixtures", async () => {
    const response = await getConfigResponse("/");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain(`img-src 'self' data:;`);
  });

  it("scopes img-src to this deployment's own Sanity project and dataset path, not the whole asset CDN host", async () => {
    const response = await getConfigResponse("/", PUBLIC_SANITY_DEPLOYMENT);
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain(
      `img-src 'self' data: https://${SANITY_ASSET_CDN_HOST}/images/${PUBLIC_SANITY_DEPLOYMENT.SANITY_PROJECT_ID}/${PUBLIC_SANITY_DEPLOYMENT.SANITY_DATASET}/;`,
    );
    // The bare host with no path must never appear as its own source — that
    // would grant every other Sanity customer's project on the same CDN host.
    expect(csp).not.toContain(`img-src 'self' data: https://${SANITY_ASSET_CDN_HOST};`);
  });
});
