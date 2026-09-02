import type { NextConfig } from "next";
import {
  YOUTUBE_EMBED_ALLOW_FEATURES,
  YOUTUBE_NOCOOKIE_ORIGIN,
} from "@/lib/embed-origins";
import { readPrivateObjectStoreOrigin } from "@/lib/private-object-store-origin";

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

/**
 * Restates `parseApiVersion` from `src/lib/sanity-config.ts` for the same
 * reason `SANITY_PROJECT_ID` and `SANITY_DATASET` are restated above: build
 * configuration cannot import a `server-only` module. A version this deployment
 * could not run with must not let a build succeed, so the rule is duplicated
 * rather than skipped — and pinned by a test that runs the same values through
 * `loadSanityConfig`, so the two cannot silently drift apart.
 */
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
  settings: SanityBuildSettings | null,
): RemotePattern[] {
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

/**
 * Features this application's own pages never use, denied outright, and the
 * handful the one opt-in third-party embed (`youtube-embed.tsx`) needs,
 * scoped to `self` plus that embed's own known origin so the click-to-load
 * video still plays. `fullscreen` covers the iframe's `allowFullScreen` prop
 * (not part of its `allow` attribute); the rest is
 * `YOUTUBE_EMBED_ALLOW_FEATURES`, the exact list the component's own `allow`
 * attribute renders, so the two cannot drift from each other by hand-edit.
 */
function permissionsPolicy(): string {
  const denied = [
    "camera",
    "geolocation",
    "microphone",
    "midi",
    "payment",
    "usb",
  ];
  const scopedToEmbed = [...YOUTUBE_EMBED_ALLOW_FEATURES, "fullscreen"];

  return [
    ...denied.map((feature) => `${feature}=()`),
    ...scopedToEmbed.map(
      (feature) => `${feature}=(self "${YOUTUBE_NOCOOKIE_ORIGIN}")`,
    ),
  ].join(", ");
}

/**
 * `default-src 'self'` plus every directive that has a real answer for a
 * self-hosted Next.js app with no client-side third-party requests: images
 * come from this origin (plus this deployment's own validated Sanity project
 * and dataset *path* on the asset CDN when configured — not the bare host,
 * the same `/images/{projectId}/{dataset}/` prefix
 * `sanityImageRemotePatterns` scopes the image optimizer's own allow-list to,
 * so this grant cannot reach another Sanity customer's project on the same
 * shared CDN host), the one opt-in video embed frames from its known origin,
 * and nothing else is ever fetched, framed, or submitted cross-origin.
 *
 * `script-src`/`style-src` carry `'unsafe-inline'` as documented, accepted
 * residual risk rather than an oversight — see
 * `docs/adr/0011-security-response-headers.md`. Next.js's App Router injects
 * an inline RSC hydration bootstrap script and inline style attributes
 * (`next/image` sizing, `next/font` fallback) on every request; closing that
 * with per-request nonces requires converting the whole site to dynamic
 * rendering, which conflicts with the static-generation and tagged-caching
 * architecture ADR-0004 and AB#83 already committed to. No inline HTML is
 * ever rendered from unescaped input anywhere in this codebase (no
 * `dangerouslySetInnerHTML`, no raw-HTML content block), so the realistic
 * injection surface this would otherwise close is already effectively empty.
 *
 * `script-src` additionally carries `'unsafe-eval'` in development only
 * (`process.env.NODE_ENV === "development"`, true for `npm run dev`, false
 * for every built/started/deployed response). Next.js's own CSP guide
 * documents this exact conditional: React uses `eval()` in development for
 * reconstructing server-side error stacks and other debugging aids, and
 * "`unsafe-eval` is not required for production. Neither React nor Next.js
 * use `eval` in production by default." Confirmed against a real
 * `npm run dev` server, not just the docs: without this, every dev-mode
 * response's CSP blocked React's debugging `eval()` calls.
 */
function contentSecurityPolicy(
  settings: SanityBuildSettings | null,
  privateObjectStoreOrigin?: string,
): string {
  const sanityImageOrigin =
    settings === null
      ? ""
      : ` https://${SANITY_ASSET_CDN_HOST}/images/${settings.projectId}/${settings.dataset}/`;
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${sanityImageOrigin}${
      privateObjectStoreOrigin === undefined ? "" : ` ${privateObjectStoreOrigin}`
    }`,
    `frame-src ${YOUTUBE_NOCOOKIE_ORIGIN}`,
    "connect-src 'self'",
    "font-src 'self'",
  ].join("; ");
}

/**
 * Applied to every response. Deliberately does not set
 * `Strict-Transport-Security`: Vercel's own edge already sends
 * `max-age=63072000` on every deployment response
 * (https://vercel.com/docs/headers/response-headers), and this project's
 * hard rule of staying generic means it cannot assume every clone's own
 * subdomains are HTTPS-ready, which `includeSubDomains`/`preload` would
 * silently commit a customer's whole domain to. See
 * `docs/adr/0011-security-response-headers.md`.
 *
 * Takes the already-computed `SanityBuildSettings` rather than raw
 * environment variables: `images.remotePatterns` below computes the same
 * settings from the same source once at module-evaluation time, and passing
 * that one result into both places means the CMS-configured question is
 * answered once per build, not re-derived (and potentially re-thrown) by two
 * independent call sites that must otherwise be trusted to agree.
 */
function securityHeaders(
  sanitySettings: SanityBuildSettings | null,
  privateObjectStoreOrigin?: string,
): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissionsPolicy() },
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(sanitySettings, privateObjectStoreOrigin),
    },
  ];
}

/**
 * Computed once at module-evaluation time (build start / dev-server start),
 * the same point `images.remotePatterns` below always ran this at. Both that
 * allow-list and the CSP's `img-src` answer "is this a Sanity deployment, and
 * if so which project/dataset" from this one result, rather than each
 * re-deriving (and re-validating, and potentially re-throwing) it separately.
 */
const sanitySettings = sanityBuildSettings(process.env);
const privateObjectStoreOrigin = readPrivateObjectStoreOrigin(process.env);

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
    remotePatterns: sanityImageRemotePatterns(sanitySettings),
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
        source: "/:path*",
        headers: securityHeaders(sanitySettings),
      },
      // ADR-0011 action item 4 / ADR-0014 §6: the private routes, and only they,
      // may load images from the private object store. `img-src` is widened by
      // exactly that origin and nothing else is — in particular no `connect-src`
      // grant, because a preview is delivered by an `<img>` and never by a script
      // `fetch` (§8c), which is also why the bucket needs no CORS policy at all.
      //
      // Sourced at the internal rewrite target rather than the configured public
      // prefix, because that segment is a build-time constant while the prefix is
      // not. Measured against a production build rather than assumed: a
      // `headers()` rule matches both the original request path and the path the
      // Proxy rewrote to, and among matching rules the **last** one wins for a
      // given header name — which is why these sit after the site-wide entry.
      // `e2e/private-route-hygiene.spec.ts` is what would notice if either
      // behaviour changed.
      ...(privateObjectStoreOrigin === undefined
        ? []
        : [
            {
              source: "/private-gallery",
              headers: securityHeaders(sanitySettings, privateObjectStoreOrigin),
            },
            {
              source: "/private-gallery/:path*",
              headers: securityHeaders(sanitySettings, privateObjectStoreOrigin),
            },
          ]),
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
