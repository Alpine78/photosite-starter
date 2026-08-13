import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 31_536_000;

type RemotePattern = NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
>[number];

/**
 * Restated from `src/lib/sanity-config.ts`, which owns it.
 *
 * The optimizer's allow-list is build configuration and is read before any
 * module graph exists, so it cannot import a module marked `server-only`. The
 * two constants are pinned to each other by a test instead of by an import.
 */
const SANITY_ASSET_CDN_HOST = "cdn.sanity.io";

/**
 * Which remote images this deployment's optimizer will fetch.
 *
 * Narrow on purpose. `/_next/image` is a public endpoint: whatever this list
 * allows, anyone can ask the deployment to download and re-encode. Scoped to
 * this deployment's own project and dataset, that is its own content; widened
 * to the whole asset CDN, it is every Sanity customer's content, at this
 * deployment's expense.
 *
 * `search: ""` allows no query string, because the source URL carries none:
 * width, quality, and format are chosen by the optimizer on its own endpoint,
 * and a rendition URL is byte-versioned by its path (ADR-0005 §2).
 *
 * A deployment reading fixtures gets no entry at all, so a stray remote URL
 * cannot be optimized by a site that has no CMS. One reading Sanity without the
 * settings to address it fails the build here rather than serving a page whose
 * every photograph is broken.
 */
function sanityImageRemotePatterns(
  environment: Record<string, string | undefined>,
): RemotePattern[] {
  if (environment.SITE_CONTENT_SOURCE?.trim() !== "sanity") return [];

  const projectId = environment.SANITY_PROJECT_ID?.trim();
  const dataset = environment.SANITY_DATASET?.trim();

  if (!projectId || !dataset) {
    throw new Error(
      "[next.config] SITE_CONTENT_SOURCE is \"sanity\", so SANITY_PROJECT_ID and SANITY_DATASET must be set at build time: the image optimizer's allow-list is scoped to this deployment's own project and dataset.",
    );
  }

  return [
    {
      protocol: "https",
      hostname: SANITY_ASSET_CDN_HOST,
      pathname: `/images/${projectId}/${dataset}/**`,
      search: "",
    },
  ];
}

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
    remotePatterns: sanityImageRemotePatterns(process.env),
    // Public presentation currently supports source widths through 2048px.
    //
    // Reviewed for the lightbox (AB#15) and deliberately left as it is. The
    // lightbox is the widest surface the site has, but the optimizer never
    // enlarges: against public derivatives that top out well below this
    // ceiling, wider candidates would return the same pixels under new cache
    // keys and new transformations.
    //
    // AB#82 revisited it with CMS derivative policy in hand and kept it, by
    // making the two numbers one: `MAX_PUBLIC_DELIVERY_DIMENSION` is the
    // largest public derivative a deployment may upload, and it is this
    // ceiling. A wider upload could never be delivered in full — every
    // candidate below is narrower — so it would be cost with no reader, and it
    // is refused at the media boundary. Raising the ceiling means raising the
    // export policy and verifying the lightbox (AB#15) in the same change.
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
