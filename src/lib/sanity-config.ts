/**
 * The customer-owned Sanity project this deployment reads, as validated
 * configuration.
 *
 * ADR-0004 §5 makes every external account customer-owned: each clone runs its
 * own Sanity organization, project, dataset, and billing, and no shared
 * cross-customer credential exists. So the connection is four deployment
 * settings rather than anything committed to the repository, and handing the
 * site to another photographer is a change of settings, not a change of code.
 *
 * Everything here is validated at the moment it is read, for the same reason
 * the deployment settings are: a project id with a typo produces a request to
 * a hostname that is not this deployment's project, and an unparsable API
 * version silently changes which Content Lake behavior the site is built on.
 * Both are configuration errors that should name themselves, not 404s to debug
 * later.
 *
 * ## Secrets
 *
 * The read token is optional and server-only. Three things keep it out of the
 * browser, at three different moments:
 *
 * - **The setting is not prefixed `NEXT_PUBLIC_`.** Next.js inlines only
 *   `NEXT_PUBLIC_`-prefixed values into client bundles, so an unprefixed value
 *   cannot be compiled into browser JavaScript. That is the guarantee about the
 *   secret itself, and `loadSanityConfig` refuses outright if it finds the
 *   token mirrored under a public name.
 * - **The `server-only` marker below fails the build.** ESLint stops `src/app`
 *   and `src/components` from importing this module directly, but it cannot see
 *   a Client Component reaching it through an adapter two hops away. The marker
 *   catches exactly that, at build time, where a boundary mistake is cheap.
 * - **`getSanityConfig` refuses to run in a browser.** The last tripwire, for
 *   whatever the first two did not catch.
 *
 * The token is never logged, never placed in a URL, and never returned to a
 * caller other than the client that authorizes a request with it.
 */

import "server-only";

const sanitySettingNames = {
  projectId: "SANITY_PROJECT_ID",
  dataset: "SANITY_DATASET",
  apiVersion: "SANITY_API_VERSION",
  readToken: "SANITY_READ_TOKEN",
} as const;

export type SanityConfig = {
  readonly projectId: string;
  readonly dataset: string;
  /** Dated API version including its leading `v`, e.g. `v2026-06-24`. */
  readonly apiVersion: string;
  /**
   * Optional server-only credential. Public reads of a public dataset need
   * none; a private dataset does. It widens which documents a request may
   * read — it does not, on its own, expose drafts, because the client always
   * asks for the published perspective.
   */
  readonly readToken?: string;
};

/**
 * Where uploaded assets are served from.
 *
 * A second Sanity host, and a different kind of thing from the query API in
 * `sanity-client.ts`: this one is addressed by the browser, not by the server.
 * It belongs here because the address is made of the connection settings this
 * module already owns and validates —
 * `https://cdn.sanity.io/images/<projectId>/<dataset>/…` — so a deployment
 * cannot end up allowing one project's assets while reading another's content.
 *
 * `next.config.ts` restates the host, because the optimizer's allow-list is
 * build configuration and cannot import a `server-only` module. A test pins the
 * two together rather than trusting them to stay equal.
 */
export const SANITY_ASSET_CDN_HOST = "cdn.sanity.io";

/**
 * The one path prefix under which this deployment's own images live. Anything
 * outside it is another project's asset, another dataset's asset, or not an
 * image at all.
 */
export function buildSanityImagePathPrefix(config: {
  readonly projectId: string;
  readonly dataset: string;
}): string {
  return `/images/${config.projectId}/${config.dataset}/`;
}

/** Raised when a deployment's Sanity settings are missing or unusable. */
export class SanityConfigurationError extends Error {
  constructor(message: string) {
    super(`[sanity-config] ${message}`);
    this.name = "SanityConfigurationError";
  }
}

type SanityEnvironment = Record<string, string | undefined>;

function requireSetting(
  environment: SanityEnvironment,
  settingName: string,
): string {
  const value = environment[settingName]?.trim();
  if (!value) {
    throw new SanityConfigurationError(
      `Missing required deployment setting: ${settingName}`,
    );
  }
  return value;
}

/**
 * The project id becomes the first label of `<projectId>.api.sanity.io`, so it
 * has to be a valid DNS label: lowercase letters, digits, and inner hyphens,
 * at most 63 characters. Validated on that ground rather than on a guess about
 * how Sanity mints ids — a value that fails this could not be addressed at all.
 */
function parseProjectId(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new SanityConfigurationError(
      `Invalid ${sanitySettingNames.projectId}: the project id is the hostname label in <projectId>.api.sanity.io, so it must be 1–63 lowercase letters, digits, or inner hyphens, received "${value}"`,
    );
  }
  return value;
}

/**
 * Sanity's own rule, not a guess at one: a dataset name is 1–64 characters of
 * lowercase letters, digits, hyphens, and underscores, and must begin and end
 * with a lowercase letter or digit (Sanity, Content Lake → Datasets, verified
 * 2026-08-10).
 *
 * Enforced in full rather than loosened to "characters that survive a URL path
 * segment". A looser rule accepts `Production` and `production-`, which the
 * service rejects — and the point of validated configuration is that a typo
 * names itself here, not in the first content fetch of a deployed site.
 */
function parseDataset(value: string): string {
  if (!/^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(value)) {
    throw new SanityConfigurationError(
      `Invalid ${sanitySettingNames.dataset}: expected 1–64 characters of lowercase letters, digits, hyphens, or underscores, beginning and ending with a lowercase letter or digit, received "${value}"`,
    );
  }
  return value;
}

/**
 * Requires the dated form `vYYYY-MM-DD`.
 *
 * Sanity's API version is the first path segment of every request, and a dated
 * version pins the Content Lake behavior the deployment was built and tested
 * against. Pinning is the whole point: an undated or floating version would let
 * the API change underneath a running site between one request and the next,
 * which is precisely the class of surprise a clone cannot debug.
 *
 * The calendar date is checked too, so `v2026-02-31` fails here rather than
 * becoming a rejected request at the first content fetch.
 *
 * A future date is refused as well. That one is this project's rule rather than
 * a documented Sanity constraint — their documentation recommends today's UTC
 * date and a static pinned value, and says nothing about rejecting a later one.
 * It is refused anyway because a version dated after today pins nothing: it
 * names API behavior that does not exist yet, so the deployment cannot have
 * been built or tested against it, and a typo like `v2099-01-01` would silently
 * opt into every future breaking change instead of freezing one.
 *
 * Dates are compared in UTC, matching the timezone Sanity versions in.
 */
function parseApiVersion(value: string, now: Date): string {
  const match = /^v(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    throw new SanityConfigurationError(
      `Invalid ${sanitySettingNames.apiVersion}: expected a dated API version of the form vYYYY-MM-DD, e.g. v2026-06-24, received "${value}"`,
    );
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isRealDate =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);

  if (!isRealDate) {
    throw new SanityConfigurationError(
      `Invalid ${sanitySettingNames.apiVersion}: "${value}" is not a date on the calendar`,
    );
  }

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  if (date.getTime() > today) {
    throw new SanityConfigurationError(
      `Invalid ${sanitySettingNames.apiVersion}: "${value}" is in the future, so it pins no API behavior the deployment could have been built against. Use today's UTC date or an earlier one.`,
    );
  }

  return value;
}

/**
 * Reads the optional credential.
 *
 * A value mirrored under a `NEXT_PUBLIC_` name is refused rather than ignored:
 * that variable is compiled into the browser bundle, so its presence means the
 * token is already on its way to every visitor, and quietly preferring the
 * server-only copy would leave the leak in place.
 *
 * Whitespace inside a token is a paste accident — a wrapping quote, a line
 * break kept by a secrets UI — and produces a 401 that looks like a revoked
 * credential. Cheaper to name it here.
 */
function parseReadToken(environment: SanityEnvironment): string | undefined {
  const publicName = `NEXT_PUBLIC_${sanitySettingNames.readToken}`;
  if (environment[publicName]?.trim()) {
    throw new SanityConfigurationError(
      `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so the read token must never be set under that name. Remove it and set ${sanitySettingNames.readToken} instead.`,
    );
  }

  const value = environment[sanitySettingNames.readToken]?.trim();
  if (value === undefined || value.length === 0) return undefined;

  if (/\s/.test(value)) {
    throw new SanityConfigurationError(
      `Invalid ${sanitySettingNames.readToken}: the token contains whitespace, which usually means a quote or line break was pasted with it`,
    );
  }

  return value;
}

/**
 * Builds and validates the Sanity connection settings. Passing the environment
 * in keeps validation deterministic in tests while production uses
 * `process.env`; `now` is injectable for the same reason, so the API version's
 * future-date check can be asserted against a fixed clock.
 */
export function loadSanityConfig(
  environment: SanityEnvironment,
  { now = new Date() }: { now?: Date } = {},
): SanityConfig {
  const readToken = parseReadToken(environment);

  return {
    projectId: parseProjectId(
      requireSetting(environment, sanitySettingNames.projectId),
    ),
    dataset: parseDataset(
      requireSetting(environment, sanitySettingNames.dataset),
    ),
    apiVersion: parseApiVersion(
      requireSetting(environment, sanitySettingNames.apiVersion),
      now,
    ),
    ...(readToken === undefined ? {} : { readToken }),
  };
}

let cachedSanityConfig: SanityConfig | undefined;

export function getSanityConfig(): SanityConfig {
  if (typeof window !== "undefined") {
    throw new SanityConfigurationError(
      "Sanity configuration was read in a browser. It carries a server-only credential and must be reached from a Server Component, Route Handler, or another server module.",
    );
  }

  cachedSanityConfig ??= loadSanityConfig(process.env);
  return cachedSanityConfig;
}
