import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { mockImages } from "@/lib/mock-media";

const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

async function getConfigResponse(pathname: string) {
  Object.assign(globalThis, { AsyncLocalStorage });
  const { unstable_getResponseFromNextConfig } = await import(
    "next/experimental/testing/server"
  );

  return unstable_getResponseFromNextConfig({
    url: `https://example.com${pathname}`,
    nextConfig,
  });
}

describe("public image Next.js configuration", () => {
  it("bounds current optimizer candidates to the 2048px presentation ceiling", () => {
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
