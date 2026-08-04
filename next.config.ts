import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 31_536_000;

const nextConfig: NextConfig = {
  images: {
    // Only the project-owned public derivative directory is eligible for local
    // optimization. Filename versioning is enforced by the domain projection;
    // future CMS hosts must be added as narrow remotePatterns.
    localPatterns: [{ pathname: "/gallery/**", search: "" }],
    // Public presentation currently supports source widths through 2048px.
    // AB#15 or AB#82 must revise this list before introducing wider lightbox
    // or CMS derivatives.
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
