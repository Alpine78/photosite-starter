/**
 * The build-safe half of a deployment's private client-gallery configuration
 * (ADR-0014 §9).
 *
 * Three settings, none of them a secret, so this module is read during
 * `loadDeploymentConfig` like `SITE_*` — a misconfiguration fails the build,
 * not the first request:
 *
 * - **`PRIVATE_GALLERY_STORE`** — `off` (the default), `enabled`, or the
 *   development-only `memory`. The feature is post-MVP and un-provisioned on
 *   every deployment today, so `off` is the safe default and an operator opts in
 *   explicitly. Unlike `SITE_CONTENT_SOURCE` there is no "a default silently
 *   serves the wrong thing" hazard: `off` serves nothing.
 * - **`PRIVATE_GALLERY_ROUTE_PREFIX`** — the reserved root segment the private
 *   routes will live under (default `private`). It is validated and reserved
 *   **whether the feature is on or off**, so an `off` clone can never assign
 *   `/private` to a locale prefix or a story namespace and then be unable to
 *   turn the feature on without a public URL migration (ADR-0014 §9).
 * - **`PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX`** — the reserved root segment the
 *   administrator routes will live under (default `admin`, ADR-0015 §1).
 *   Reserved on the same terms and for the same reason, and additionally
 *   required to differ from the customer prefix: ADR-0015 §1 keeps the two
 *   namespaces from overlapping at all, so "isolated from the customer path" is
 *   verifiable by looking at the URL rather than by reasoning about cookie
 *   scoping.
 *
 * The secret-bearing settings — the database URL, the object-store verifier
 * credentials, the capability keyring, and the administrator secret hash — are
 * the request-time Sensitive half, read lazily in `private-gallery-config.ts`
 * and never required by `next build`
 * (the same posture as `GALLERY_CURSOR_SIGNING_KEY`). This module still refuses,
 * unconditionally, to let any of those be mirrored under a `NEXT_PUBLIC_` name:
 * `off` must not excuse a secret that is already on its way into the browser
 * bundle.
 */

import {
  readDeploymentStage,
  type DeploymentStage,
} from "@/lib/deployment-stage";


/**
 * `off` serves nothing. `enabled` reaches the deployment's own provisioned
 * private object store and Postgres. `memory` is a development-only fixture
 * store held in process memory — it is **refused outright in a production
 * deployment**, the same safeguard `SITE_CONTENT_SOURCE=mock` and
 * `CONTACT_DELIVERY_ADAPTER=sink` already carry, because a fixture gallery with
 * a published, non-secret capability is not a mode a real customer site may run.
 */
export type PrivateGalleryStoreMode = "off" | "enabled" | "memory";

export type PrivateGalleryDeployment = {
  readonly store: PrivateGalleryStoreMode;
  /** A single lowercase root path segment; reserved even when `store` is `off`. */
  readonly routePrefix: string;
  /**
   * The administrator namespace's own root segment (ADR-0015 §1). Reserved on
   * the same terms as {@link routePrefix}, never equal to it, and never nested
   * beneath it.
   */
  readonly adminRoutePrefix: string;
};

export const DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX = "private";

export const DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX = "admin";

/**
 * One lowercase path segment: a letter, then letters/digits/inner hyphens, no
 * trailing hyphen, at most 32 characters. Deliberately narrower than a URL path
 * segment — a private route prefix that needed escaping would be a mistake.
 */
const ROUTE_PREFIX_PATTERN = /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const settingNames = {
  store: "PRIVATE_GALLERY_STORE",
  routePrefix: "PRIVATE_GALLERY_ROUTE_PREFIX",
  adminRoutePrefix: "PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX",
} as const;

/**
 * Every request-time private-gallery setting — the ones `.env.example`
 * declares must never appear under a `NEXT_PUBLIC_` name. Kept here as data
 * because two callers need the list: this module's build-time refusal (which
 * checks all of them, so a mistyped mirror of a later slice's retention-worker
 * or upload-CLI credential still fails the build today), and
 * `private-gallery-config.ts`'s own defence-in-depth check on the ones it reads.
 *
 * Only the build-safe store enablement switch and route prefix are deliberately
 * absent.
 */
export const PRIVATE_GALLERY_SECRET_SETTING_NAMES = [
  "PRIVATE_GALLERY_DATABASE_URL",
  "PRIVATE_GALLERY_CAPABILITY_KEYS",
  "PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID",
  "PRIVATE_GALLERY_S3_ENDPOINT",
  "PRIVATE_GALLERY_S3_REGION",
  "PRIVATE_GALLERY_S3_BUCKET",
  "PRIVATE_GALLERY_S3_KEY_PREFIX",
  "PRIVATE_GALLERY_S3_VERIFIER_ACCESS_KEY_ID",
  "PRIVATE_GALLERY_S3_VERIFIER_SECRET_ACCESS_KEY",
  "PRIVATE_GALLERY_RETENTION_ACCESS_KEY_ID",
  "PRIVATE_GALLERY_RETENTION_SECRET_ACCESS_KEY",
  "PRIVATE_GALLERY_CLI_ACCESS_KEY_ID",
  "PRIVATE_GALLERY_CLI_SECRET_ACCESS_KEY",
  // A scrypt hash rather than the secret itself (ADR-0015 §4), and still listed
  // here: shipping it to every visitor would hand an attacker an offline target
  // and a salt, and there is no reason whatsoever for a browser to hold it.
  "PRIVATE_GALLERY_ADMIN_SECRET_HASH",
] as const;

const STORE_MODES: readonly PrivateGalleryStoreMode[] = [
  "off",
  "enabled",
  "memory",
];

/** Raised when a deployment's build-safe private-gallery settings are unusable. */
export class PrivateGalleryDeploymentError extends Error {
  constructor(message: string) {
    super(`[private-gallery-deployment] ${message}`);
    this.name = "PrivateGalleryDeploymentError";
  }
}

type Environment = Record<string, string | undefined>;

/**
 * Refuses any credential-bearing private-gallery setting mirrored under a
 * `NEXT_PUBLIC_` name. Runs regardless of `PRIVATE_GALLERY_STORE`, because a
 * `NEXT_PUBLIC_` value is compiled into the browser bundle whether or not the
 * feature reads it.
 */
export function assertNoPublicPrivateGallerySecretMirror(
  environment: Environment,
): void {
  for (const name of PRIVATE_GALLERY_SECRET_SETTING_NAMES) {
    const publicName = `NEXT_PUBLIC_${name}`;
    if (environment[publicName]?.trim()) {
      throw new PrivateGalleryDeploymentError(
        `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so ${name} must never be set under that name. Remove it and set ${name} as a server-only Sensitive value.`,
      );
    }
  }
}

function parseStoreMode(
  value: string | undefined,
  stage: DeploymentStage,
): PrivateGalleryStoreMode {
  const trimmed = value?.trim();
  if (!trimmed) return "off";
  if (!STORE_MODES.includes(trimmed as PrivateGalleryStoreMode)) {
    throw new PrivateGalleryDeploymentError(
      `Invalid ${settingNames.store}: expected one of ${STORE_MODES.join(", ")}, received "${trimmed}"`,
    );
  }
  const mode = trimmed as PrivateGalleryStoreMode;

  // Fail while the deployment is being built, not when a visitor opens a
  // fixture gallery on a real photographer's site.
  //
  // `development` only, not "anything but production": Preview is a shared,
  // access-protected environment that stands in for Production, and a gallery
  // whose capability is published in this repository is not a private-namespace
  // surface anyone reviewed for it. Nothing loses anything — `npm run dev` and
  // the Playwright harness both declare `development` already.
  if (mode === "memory" && stage !== "development") {
    throw new PrivateGalleryDeploymentError(
      `Invalid ${settingNames.store}: the "memory" store is a development fixture with a published, non-secret capability, so it runs only where SITE_DEPLOYMENT_STAGE is development — not in a ${stage} deployment. Configure "enabled" instead.`,
    );
  }

  return mode;
}

function parseRoutePrefix(
  value: string | undefined,
  settingName: string,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (!ROUTE_PREFIX_PATTERN.test(trimmed)) {
    throw new PrivateGalleryDeploymentError(
      `Invalid ${settingName}: expected one lowercase path segment (a letter, then letters, digits, or inner hyphens, no trailing hyphen), at most 32 characters, received "${trimmed}"`,
    );
  }
  return trimmed;
}

/**
 * Reads and validates the build-safe private-gallery settings. The environment
 * is injected so the deployment configuration and its tests stay deterministic,
 * matching `readContentSource` / `loadSanityConfig`.
 *
 * The `NEXT_PUBLIC_` secret-mirror refusal runs here too, so a single
 * `loadDeploymentConfig` call catches it.
 */
export function readPrivateGalleryDeployment(
  environment: Environment,
  stage: DeploymentStage,
): PrivateGalleryDeployment {
  assertNoPublicPrivateGallerySecretMirror(environment);

  // Parsed before the prefixes so that a deployment getting several settings
  // wrong is told about the store switch first, exactly as it was before the
  // administrator prefix joined this function.
  const store = parseStoreMode(environment[settingNames.store], stage);
  const routePrefix = parseRoutePrefix(
    environment[settingNames.routePrefix],
    settingNames.routePrefix,
    DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
  );
  const adminRoutePrefix = parseRoutePrefix(
    environment[settingNames.adminRoutePrefix],
    settingNames.adminRoutePrefix,
    DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX,
  );

  // ADR-0015 §1: the administrator namespace is not nested under the customer
  // one, and the two do not overlap at all. Both are a single segment, so
  // equality is the only overlap available — and it would be a real one: the
  // customer session cookie is `Path`-scoped to `/<prefix>/<handle>`, so a
  // shared root would put an administrator route inside the scope of a
  // customer credential.
  if (adminRoutePrefix === routePrefix) {
    throw new PrivateGalleryDeploymentError(
      `Invalid ${settingNames.adminRoutePrefix}: "${adminRoutePrefix}" is also ${settingNames.routePrefix}, but the administrator namespace must not overlap the customer one (ADR-0015 §1)`,
    );
  }

  return { store, routePrefix, adminRoutePrefix };
}

let cached: PrivateGalleryDeployment | undefined;

/**
 * The process-wide build-safe private-gallery settings, memoized. Used by the
 * request-time `private-gallery-config.ts` to answer "is the feature on" without
 * importing the whole `deployment-config.ts` graph.
 */
export function getPrivateGalleryDeployment(): PrivateGalleryDeployment {
  cached ??= readPrivateGalleryDeployment(
    process.env,
    readDeploymentStage(process.env),
  );
  return cached;
}
