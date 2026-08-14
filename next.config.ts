import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 31_536_000;

type RemotePattern = NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
>[number];

/**
 * Restated from `src/lib/sanity-config.ts`, which owns them.
 *
 * The optimizer's allow-list is build configuration and is read before any
 * module graph exists, so it cannot import a module marked `server-only`. A
 * test pins these to the validated settings instead of an import doing it.
 *
 * The two patterns are Sanity's own rules for a project id and a dataset name.
 * They are applied here, not just in the application, because these values are
 * interpolated into an allow-list *path*: an unvalidated value containing a
 * slash or a glob would widen what the optimizer is willing to fetch, and it
 * would do so at build time, before the application's own validation ever runs.
 */
const SANITY_ASSET_CDN_HOST = "cdn.sanity.io";
const SANITY_PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SANITY_DATASET = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const SANITY_API_VERSION = /^v(\d{4})-(\d{2})-(\d{2})$/;

type SanityBuildSettings = {
  readonly projectId: string;
  readonly dataset: string;
};

function requiredSanityBuildSetting(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(
      `[next.config] SITE_CONTENT_SOURCE is "sanity", so ${name} must be set at build time.`,
    );
  }
  return value;
}

function assertSanityApiVersion(apiVersion: string): void {
  const match = SANITY_API_VERSION.exec(apiVersion);
  if (match === null) {
    throw new Error(
      "[next.config] SANITY_API_VERSION must be a dated version of the form vYYYY-MM-DD.",
    );
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isRealDate =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  if (!isRealDate || date.getTime() > today) {
    throw new Error(
      "[next.config] SANITY_API_VERSION must name a real UTC date that is not in the future.",
    );
  }
}

/**
 * Validates every setting a Sanity build depends on, before any route happens
 * to import an adapter.
 *
 * A private dataset has two separately scoped credentials: the trusted build
 * job supplies a read-only build token, while Vercel supplies another Sensitive
 * token to the running deployment. Vercel's pull command represents a Sensitive
 * value as `[SENSITIVE]`, and an undefined Azure variable as `$(NAME)`; neither
 * is a credential, so both fail here rather than producing a green but unusable
 * release candidate.
 */
function sanityBuildSettings(
  environment: Record<string, string | undefined>,
): SanityBuildSettings | null {
  if (environment.SITE_CONTENT_SOURCE?.trim() !== "sanity") return null;

  if (environment.NEXT_PUBLIC_SANITY_READ_TOKEN?.trim()) {
    throw new Error(
      "[next.config] NEXT_PUBLIC_SANITY_READ_TOKEN must never be set: a NEXT_PUBLIC_ value is compiled into the browser bundle.",
    );
  }

  const projectId = requiredSanityBuildSetting(
    environment,
    "SANITY_PROJECT_ID",
  );
  const dataset = requiredSanityBuildSetting(environment, "SANITY_DATASET");
  const visibility = requiredSanityBuildSetting(
    environment,
    "SANITY_DATASET_VISIBILITY",
  );
  const apiVersion = requiredSanityBuildSetting(
    environment,
    "SANITY_API_VERSION",
  );

  if (!SANITY_PROJECT_ID.test(projectId) || !SANITY_DATASET.test(dataset)) {
    throw new Error(
      "[next.config] SANITY_PROJECT_ID or SANITY_DATASET is not a value Sanity would accept, so it must not be interpolated into the image optimizer's allow-list.",
    );
  }
  if (visibility !== "public" && visibility !== "private") {
    throw new Error(
      '[next.config] SANITY_DATASET_VISIBILITY must be either "public" or "private".',
    );
  }
  assertSanityApiVersion(apiVersion);

  if (visibility === "private") {
    const token = environment.SANITY_READ_TOKEN?.trim();
    const isPlaceholder =
      token === "[SENSITIVE]" || /^\$\([A-Za-z0-9_]+\)$/.test(token ?? "");
    if (!token || isPlaceholder || /\s/.test(token)) {
      throw new Error(
        "[next.config] SANITY_DATASET_VISIBILITY is private, so the trusted build job must supply a usable SANITY_READ_TOKEN. The running deployment uses a separate environment-scoped token.",
      );
    }
  }

  return { projectId, dataset };
}

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
  const settings = sanityBuildSettings(environment);
  if (settings === null) return [];
  const { projectId, dataset } = settings;

  return [
    {
      protocol: "https",
      hostname: SANITY_ASSET_CDN_HOST,
      // Every field is stated. Next.js treats an omitted field as a wildcard,
      // so leaving the port out would allow any port on this host.
      port: "",
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
