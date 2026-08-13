import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 31_536_000;

const nextConfig: NextConfig = {
  // Proxy owns trailing-slash normalization so a gallery cursor can be
  // validated before a permanent redirect is emitted. Without this flag,
  // Next.js redirects first and a malformed cursor creates the cached 308 that
  // ADR-0003 decision 8 explicitly forbids.
  skipTrailingSlashRedirect: true,
  images: {
    // Only the project-owned public derivative directory is eligible for local
    // optimization. Filename versioning is enforced by the domain projection;
    // future CMS hosts must be added as narrow remotePatterns.
    localPatterns: [{ pathname: "/gallery/**", search: "" }],
    // Public presentation currently supports source widths through 2048px.
    //
    // Reviewed for the lightbox (AB#15) and deliberately left as it is. The
    // lightbox is the widest surface the site has, but the optimizer never
    // enlarges: against public derivatives that top out well below this
    // ceiling, wider candidates would return the same pixels under new cache
    // keys and new transformations. The ceiling becomes worth raising when a
    // real derivative exceeds it, which is AB#82's call to make with CMS
    // derivative policy in hand rather than a guess made ahead of it.
    deviceSizes: [640, 750, 828, 1024, 1080, 1200, 1254, 1536, 2048],
    imageSizes: [256, 384],
    minimumCacheTTL: 2_678_400,
    qualities: [75],
  },
  async headers() {
    return [
      {
        source:
          "/gallery/:name([a-z0-9]+(?:-[a-z0-9]+)*).:version([0-9a-f]{12}).:extension(avif|jpg|jpeg|png|webp)",
        headers: [
          {
            key: "Cache-Control",
            value: `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
