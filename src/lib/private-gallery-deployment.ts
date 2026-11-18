/**
 * The build-time remainder of the retired protected client-gallery
 * configuration (ADR-0014 §9, ADR-0015 §1).
 *
 * The S3/Postgres protected gallery was removed under AB#313 (owner decision
 * 2026-11-15, ADR-0034). What stays is a small boundary read during
 * `loadDeploymentConfig`, so a misconfiguration fails the build rather than a
 * request:
 *
 * - **`PRIVATE_GALLERY_ROUTE_PREFIX`** and
 *   **`PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX`** — the two root segments the
 *   former customer and administrator namespaces lived under (defaults
 *   `private` and `admin`). They stay validated and reserved, and must differ,
 *   so public routing can never claim them and the Proxy keeps answering every
 *   path beneath them with one hygienic empty 404.
 * - **`PRIVATE_GALLERY_STORE`** — accepted only unset or `off`. Any other value
 *   (`enabled`, `memory`, anything else) is a stale setting from the removed
 *   implementation and is refused, never silently ignored: an operator who
 *   still sets it expects behaviour that no longer exists.
 * - A `NEXT_PUBLIC_` mirror of any of the formerly secret settings is still
 *   refused. Nothing reads those settings any more, but a `NEXT_PUBLIC_` value
 *   is compiled into the browser bundle whether or not anything reads it.
 */

export type PrivateGalleryDeployment = {
  /** A single lowercase root path segment, reserved and answered with 404. */
  readonly routePrefix: string;
  /**
   * The former administrator namespace's own root segment (ADR-0015 §1).
   * Reserved on the same terms as {@link routePrefix} and never equal to it.
   */
  readonly adminRoutePrefix: string;
};

export const DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX = "private";

export const DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX = "admin";

/**
 * One lowercase path segment: a letter, then letters/digits/inner hyphens, no
 * trailing hyphen, at most 32 characters. Deliberately narrower than a URL path
 * segment — a reserved prefix that needed escaping would be a mistake.
 */
const ROUTE_PREFIX_PATTERN = /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const settingNames = {
  store: "PRIVATE_GALLERY_STORE",
  routePrefix: "PRIVATE_GALLERY_ROUTE_PREFIX",
  adminRoutePrefix: "PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX",
} as const;

/**
 * The formerly secret settings of the removed implementation. None is read
 * any more; the list remains so a stale `NEXT_PUBLIC_` mirror of one still
 * fails the build instead of shipping in the browser bundle. The store switch
 * and the two route prefixes were never secret and are deliberately absent.
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
  "PRIVATE_GALLERY_ADMIN_SECRET_HASH",
] as const;

/** Raised when a deployment's reserved private-gallery settings are unusable. */
export class PrivateGalleryDeploymentError extends Error {
  constructor(message: string) {
    super(`[private-gallery-deployment] ${message}`);
    this.name = "PrivateGalleryDeploymentError";
  }
}

type Environment = Record<string, string | undefined>;

/**
 * Refuses any formerly credential-bearing private-gallery setting mirrored
 * under a `NEXT_PUBLIC_` name, because a `NEXT_PUBLIC_` value is compiled into
 * the browser bundle whether or not anything reads it.
 */
export function assertNoPublicPrivateGallerySecretMirror(
  environment: Environment,
): void {
  for (const name of PRIVATE_GALLERY_SECRET_SETTING_NAMES) {
    const publicName = `NEXT_PUBLIC_${name}`;
    if (environment[publicName]?.trim()) {
      throw new PrivateGalleryDeploymentError(
        `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so ${name} must never be set under that name. Remove it; the protected client gallery that read ${name} was removed (AB#313).`,
      );
    }
  }
}

/**
 * Refuses every `PRIVATE_GALLERY_STORE` value except unset or `off`. The
 * protected store modes were removed under AB#313; a deployment that still
 * names one is misconfigured, and the build says so.
 */
function assertStoreRemoved(value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "off") return;
  throw new PrivateGalleryDeploymentError(
    `Invalid ${settingNames.store}: "${trimmed}" is no longer supported. The protected client gallery was removed (AB#313), so the only accepted values are unset or "off". Remove ${settingNames.store} from this deployment's settings.`,
  );
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
 * Reads and validates the reserved private-gallery settings. The environment
 * is injected so the deployment configuration and its tests stay deterministic,
 * matching `readContentSource` / `loadSanityConfig`.
 */
export function readPrivateGalleryDeployment(
  environment: Environment,
): PrivateGalleryDeployment {
  assertNoPublicPrivateGallerySecretMirror(environment);
  // Checked before the prefixes so a stale store setting is reported first.
  assertStoreRemoved(environment[settingNames.store]);

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

  // ADR-0015 §1 kept the two namespaces from overlapping. Both are a single
  // segment, so equality is the only overlap available. The Proxy now answers
  // both with the same 404, but the rule stays so the set of accepted
  // configurations does not change with the removal.
  if (adminRoutePrefix === routePrefix) {
    throw new PrivateGalleryDeploymentError(
      `Invalid ${settingNames.adminRoutePrefix}: "${adminRoutePrefix}" is also ${settingNames.routePrefix}, but the administrator namespace must not overlap the customer one (ADR-0015 §1)`,
    );
  }

  return { routePrefix, adminRoutePrefix };
}
