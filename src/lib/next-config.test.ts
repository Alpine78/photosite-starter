import { AsyncLocalStorage } from "node:async_hooks";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
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
} as const;

async function configuredWith(
  environment: Readonly<Record<string, string>>,
): Promise<NextConfig> {
  vi.resetModules();
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }

  return (await import("../../next.config")).default;
}

async function getConfigResponse(pathname: string) {
  Object.assign(globalThis, { AsyncLocalStorage });
  const nextConfig = await configuredWith(FIXTURE_DEPLOYMENT);
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
    const config = await configuredWith({
      SITE_CONTENT_SOURCE: "sanity",
      SANITY_PROJECT_ID: "zp7mbokg",
      SANITY_DATASET: "production",
    });

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
        SITE_CONTENT_SOURCE: "sanity",
        SANITY_PROJECT_ID: "zp7mbokg",
        SANITY_DATASET: "",
      }),
    ).rejects.toThrow(/SANITY_PROJECT_ID and SANITY_DATASET/);
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
          SITE_CONTENT_SOURCE: "sanity",
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
});
