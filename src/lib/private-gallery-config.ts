/**
 * The request-time Sensitive half of a deployment's private client-gallery
 * configuration (ADR-0014 §9, Action Item 7): the private metadata-store
 * connection, the object-store verifier credentials, and the capability
 * keyring.
 *
 * ## Why this is not read at build time
 *
 * ADR-0014 resolves the capability keys lazily at request time, and this
 * repository's deployment contract delivers Sensitive values to a prebuilt
 * build only as `[SENSITIVE]` (`docs/deployment.md`). So — exactly like
 * `GALLERY_CURSOR_SIGNING_KEY` — these settings are never required by
 * `next build`: `getPrivateGalleryRuntimeConfig()` resolves them the first time
 * a private route actually needs one, and a deployment with the feature `off`
 * never reads them at all. The build-safe half (the `off | enabled` switch and
 * the reserved route prefix) lives in `private-gallery-deployment.ts` and *is*
 * validated during `loadDeploymentConfig`.
 *
 * A later owner-run provisioning gate (ADR-0014 §8a, §8b) verifies the live
 * services these settings point at — connectivity, TLS, least-privilege IAM,
 * signed-`GET` behaviour, lifecycle policy, a tested restore. This module
 * proves none of that. It proves only that the values are syntactically usable
 * and are not already leaking into the browser bundle.
 *
 * ## Boundary
 *
 * `import "server-only"` plus the `eslint.config.mjs` import rule keep `src/app`
 * and `src/components` out — the ADR-0006 pattern, with the ADR-0006 caveats
 * (the ESLint rule matches `@/lib/...` alias imports only). `getPrivateGalleryRuntimeConfig`
 * additionally refuses to run in a browser, and refuses to run at all unless
 * `PRIVATE_GALLERY_STORE` is `enabled`.
 */

import "server-only";

import {
  getPrivateGalleryDeployment,
  PRIVATE_GALLERY_SECRET_SETTING_NAMES,
} from "@/lib/private-gallery-deployment";

const CAPABILITY_KEY_BYTES = 32;
const MAX_CAPABILITY_KEYS = 16;

const settingNames = {
  databaseUrl: "PRIVATE_GALLERY_DATABASE_URL",
  s3Endpoint: "PRIVATE_GALLERY_S3_ENDPOINT",
  s3Region: "PRIVATE_GALLERY_S3_REGION",
  s3Bucket: "PRIVATE_GALLERY_S3_BUCKET",
  s3KeyPrefix: "PRIVATE_GALLERY_S3_KEY_PREFIX",
  s3VerifierAccessKeyId: "PRIVATE_GALLERY_S3_VERIFIER_ACCESS_KEY_ID",
  s3VerifierSecretAccessKey: "PRIVATE_GALLERY_S3_VERIFIER_SECRET_ACCESS_KEY",
  capabilityKeys: "PRIVATE_GALLERY_CAPABILITY_KEYS",
  capabilityActiveKeyId: "PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID",
} as const;

export type PrivateGalleryObjectStoreConfig = {
  /** Bare `https://host[:port]` origin — no path, query, fragment, or userinfo. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  /** The one key prefix the verifier credential is scoped to. */
  readonly keyPrefix: string;
  readonly verifierAccessKeyId: string;
  readonly verifierSecretAccessKey: string;
};

/**
 * The capability-envelope keyring (ADR-0014 §3). Key material is never handed
 * out as a shared mutable buffer: `getKey` returns a fresh copy each call, and
 * the id list is a frozen copy.
 */
export type PrivateGalleryCapabilityKeyring = {
  /** The key new envelopes are sealed with. Always one of `keyIds`. */
  readonly activeKeyId: string;
  /** Every configured key id, including retired keys kept for decryption. */
  readonly keyIds: readonly string[];
  /** A fresh 32-byte copy of the key for `id`, or `undefined` if `id` is unknown. */
  getKey(id: string): Uint8Array | undefined;
};

export type PrivateGalleryRuntimeConfig = {
  /** Validated `postgres://` / `postgresql://` connection string, verbatim. */
  readonly databaseUrl: string;
  readonly objectStore: PrivateGalleryObjectStoreConfig;
  readonly capabilityKeyring: PrivateGalleryCapabilityKeyring;
};

/** Raised when a deployment's request-time private-gallery settings are unusable. */
export class PrivateGalleryConfigurationError extends Error {
  constructor(message: string) {
    super(`[private-gallery-config] ${message}`);
    this.name = "PrivateGalleryConfigurationError";
  }
}

type Environment = Record<string, string | undefined>;

function refusePublicMirror(environment: Environment, name: string): void {
  if (!(PRIVATE_GALLERY_SECRET_SETTING_NAMES as readonly string[]).includes(name)) {
    return;
  }
  const publicName = `NEXT_PUBLIC_${name}`;
  if (environment[publicName]?.trim()) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so ${name} must never be set under that name.`,
    );
  }
}

function requireSetting(environment: Environment, name: string): string {
  refusePublicMirror(environment, name);
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new PrivateGalleryConfigurationError(
      `Missing required deployment setting: ${name}`,
    );
  }
  if (/\s/.test(value)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${name}: the value contains whitespace, which usually means a quote or line break was pasted with it`,
    );
  }
  return value;
}

function parseDatabaseUrl(environment: Environment): string {
  const value = requireSetting(environment, settingNames.databaseUrl);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.databaseUrl}: expected a postgres:// or postgresql:// connection URL`,
    );
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.databaseUrl}: expected a postgres:// or postgresql:// URL, received scheme "${url.protocol.replace(/:$/, "")}"`,
    );
  }
  if (url.hostname.length === 0) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.databaseUrl}: the connection URL has no host`,
    );
  }
  return value;
}

const REGION_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// A portable lower-case subset of S3 bucket naming. The deferred provider
// (ADR-0014 §8a) may be stricter; this rejects the shapes every S3-compatible
// store rejects, and no more.
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const KEY_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9/_-]{0,126}[a-z0-9])?$/;
const OPAQUE_CREDENTIAL_PATTERN = /^[\x21-\x7e]{1,256}$/;

function parseObjectStore(
  environment: Environment,
): PrivateGalleryObjectStoreConfig {
  const rawEndpoint = requireSetting(environment, settingNames.s3Endpoint);
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3Endpoint}: expected an https:// origin`,
    );
  }
  // Error messages name the setting and the shape rule, never echo the value:
  // an endpoint pasted with userinfo (`https://key:secret@host`) would put a
  // credential in a build or request log otherwise. Only the parsed scheme is
  // safe to quote, matching `parseDatabaseUrl`.
  if (endpoint.protocol !== "https:") {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3Endpoint}: expected an https:// origin, received scheme "${endpoint.protocol.replace(/:$/, "")}"`,
    );
  }
  if (
    (endpoint.pathname !== "" && endpoint.pathname !== "/") ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    endpoint.username !== "" ||
    endpoint.password !== ""
  ) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3Endpoint}: expected a bare origin with no path, query, fragment, or credentials`,
    );
  }

  const region = requireSetting(environment, settingNames.s3Region);
  if (!REGION_PATTERN.test(region)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3Region}: expected a short lowercase region token, received "${region}"`,
    );
  }

  const bucket = requireSetting(environment, settingNames.s3Bucket);
  if (!BUCKET_PATTERN.test(bucket) || bucket.includes("..") || IPV4_PATTERN.test(bucket)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3Bucket}: expected 3–63 characters of lowercase letters, digits, hyphens, or dots, starting and ending alphanumeric, and not an IPv4 address, received "${bucket}"`,
    );
  }

  const keyPrefix = requireSetting(environment, settingNames.s3KeyPrefix);
  if (!KEY_PREFIX_PATTERN.test(keyPrefix) || keyPrefix.includes("//")) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3KeyPrefix}: expected a bounded key prefix of lowercase letters, digits, "/", "_", or "-", with no leading, trailing, or doubled "/", received "${keyPrefix}"`,
    );
  }

  const verifierAccessKeyId = requireSetting(
    environment,
    settingNames.s3VerifierAccessKeyId,
  );
  if (!OPAQUE_CREDENTIAL_PATTERN.test(verifierAccessKeyId)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3VerifierAccessKeyId}: expected 1–256 printable ASCII characters`,
    );
  }

  const verifierSecretAccessKey = requireSetting(
    environment,
    settingNames.s3VerifierSecretAccessKey,
  );
  if (!OPAQUE_CREDENTIAL_PATTERN.test(verifierSecretAccessKey)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.s3VerifierSecretAccessKey}: expected 1–256 printable ASCII characters`,
    );
  }

  return {
    endpoint: endpoint.origin,
    region,
    bucket,
    keyPrefix,
    verifierAccessKeyId,
    verifierSecretAccessKey,
  };
}

const KEY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const STANDARD_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeCapabilityKey(id: string, encoded: string): Uint8Array {
  if (encoded.length === 0 || !STANDARD_BASE64_PATTERN.test(encoded)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.capabilityKeys}: key "${id}" is not standard base64`,
    );
  }
  const decoded = Buffer.from(encoded, "base64");
  // Node's base64 decoder is lenient about padding and stray characters that a
  // regex can still miss; re-encoding and comparing rejects a non-canonical
  // value outright rather than silently accepting a truncated key.
  if (decoded.toString("base64") !== encoded) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.capabilityKeys}: key "${id}" is not canonically encoded`,
    );
  }
  if (decoded.length !== CAPABILITY_KEY_BYTES) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.capabilityKeys}: key "${id}" decodes to ${decoded.length} bytes, expected ${CAPABILITY_KEY_BYTES}`,
    );
  }
  return new Uint8Array(decoded);
}

function parseCapabilityKeyring(
  environment: Environment,
): PrivateGalleryCapabilityKeyring {
  const raw = requireSetting(environment, settingNames.capabilityKeys);

  const entries = raw.split(",");
  const keys = new Map<string, Uint8Array>();
  // Errors report an entry's position, never its text: an entry with a missing
  // colon is otherwise raw key material interpolated into a log line.
  for (const [index, entry] of entries.entries()) {
    if (entry.length === 0) {
      throw new PrivateGalleryConfigurationError(
        `Invalid ${settingNames.capabilityKeys}: expected comma-separated "id:base64" entries with no empty entry (a leading, trailing, or doubled comma)`,
      );
    }
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new PrivateGalleryConfigurationError(
        `Invalid ${settingNames.capabilityKeys}: entry at position ${index + 1} is not "id:base64"`,
      );
    }
    const id = entry.slice(0, separator);
    const encoded = entry.slice(separator + 1);
    if (!KEY_ID_PATTERN.test(id)) {
      throw new PrivateGalleryConfigurationError(
        `Invalid ${settingNames.capabilityKeys}: key id "${id}" must be 1–64 lowercase letters, digits, or inner hyphens`,
      );
    }
    if (keys.has(id)) {
      throw new PrivateGalleryConfigurationError(
        `Invalid ${settingNames.capabilityKeys}: key id "${id}" appears more than once`,
      );
    }
    keys.set(id, decodeCapabilityKey(id, encoded));
  }

  if (keys.size === 0) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.capabilityKeys}: at least one key is required`,
    );
  }
  if (keys.size > MAX_CAPABILITY_KEYS) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.capabilityKeys}: ${keys.size} keys configured, at most ${MAX_CAPABILITY_KEYS} allowed`,
    );
  }

  const activeKeyId = requireSetting(
    environment,
    settingNames.capabilityActiveKeyId,
  );
  if (!keys.has(activeKeyId)) {
    throw new PrivateGalleryConfigurationError(
      `Invalid ${settingNames.capabilityActiveKeyId}: "${activeKeyId}" is not one of the configured ${settingNames.capabilityKeys} ids`,
    );
  }

  const keyIds = Object.freeze([...keys.keys()]);
  return {
    activeKeyId,
    keyIds,
    getKey(id: string): Uint8Array | undefined {
      const stored = keys.get(id);
      return stored === undefined ? undefined : Uint8Array.from(stored);
    },
  };
}

/**
 * Builds and validates the request-time private-gallery settings. The
 * environment is injected so this stays deterministic in tests; production
 * passes `process.env` through `getPrivateGalleryRuntimeConfig`.
 */
export function loadPrivateGalleryRuntimeConfig(
  environment: Environment,
): PrivateGalleryRuntimeConfig {
  return {
    databaseUrl: parseDatabaseUrl(environment),
    objectStore: parseObjectStore(environment),
    capabilityKeyring: parseCapabilityKeyring(environment),
  };
}

let cached: PrivateGalleryRuntimeConfig | undefined;

/**
 * The process-wide request-time private-gallery settings, memoized.
 *
 * Refuses to run in a browser (it carries credentials), and refuses to run at
 * all unless `PRIVATE_GALLERY_STORE` is `enabled` — a caller reaching here with
 * the feature `off` is a wiring mistake, not a reason to parse secrets that a
 * disabled feature has no use for.
 */
export function getPrivateGalleryRuntimeConfig(): PrivateGalleryRuntimeConfig {
  if (typeof window !== "undefined") {
    throw new PrivateGalleryConfigurationError(
      "private-gallery configuration was read in a browser. It carries server-only credentials and must be reached from a Server Component, Route Handler, or another server module.",
    );
  }
  if (getPrivateGalleryDeployment().store !== "enabled") {
    throw new PrivateGalleryConfigurationError(
      'PRIVATE_GALLERY_STORE is "off"; the private client-gallery feature is not enabled for this deployment (ADR-0014 §9).',
    );
  }
  cached ??= loadPrivateGalleryRuntimeConfig(process.env);
  return cached;
}
