/**
 * Resolving the administrator credential from server-only configuration
 * (ADR-0015 §4).
 *
 * The format itself — encoding, parsing, bounds, verification, and the session
 * generation digest — is `private-gallery-admin-credential-format.ts`, which is
 * pure so the owner-run generator can share it. This module is the half that
 * touches a deployment: it reads `PRIVATE_GALLERY_ADMIN_SECRET_HASH`, refuses a
 * `NEXT_PUBLIC_` mirror, and reports a missing value as its own classified
 * reason so a route can tell "administration is not provisioned" from "this
 * credential is malformed".
 *
 * Resolution is **lazy** — nothing at build time verifies a credential, so a
 * deployment with administration unprovisioned still builds. That is the posture
 * `GALLERY_CURSOR_SIGNING_KEY` already has.
 *
 * `import "server-only"` plus the `eslint.config.mjs` import boundary keep
 * `src/app` and `src/components` from reaching this directly.
 */

import "server-only";

import {
  PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING,
  PrivateGalleryAdminCredentialError,
  parsePrivateGalleryAdminCredential,
  type PrivateGalleryAdminCredential,
} from "@/lib/private-gallery-admin-credential-format";

export * from "@/lib/private-gallery-admin-credential-format";

// A function declaration rather than a `const` arrow: TypeScript's control-flow
// analysis only treats a `never`-returning call as unreachable-after for a
// declaration or an explicitly annotated const, and the narrowing is what lets
// the caller below use `encoded` as a string.
function fail(
  reason: "missing" | "invalid-parameter",
  message: string,
): never {
  throw new PrivateGalleryAdminCredentialError(reason, message);
}

/**
 * Parses and validates `PRIVATE_GALLERY_ADMIN_SECRET_HASH`.
 *
 * The environment is injected so this stays deterministic and a test can pass a
 * value directly, matching `loadKeysetCursorSigningKey` and
 * `loadPrivateGalleryConfig`.
 */
export function loadPrivateGalleryAdminCredential(
  environment: Record<string, string | undefined>,
): PrivateGalleryAdminCredential {
  const setting = PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING;

  const publicName = `NEXT_PUBLIC_${setting}`;
  if (environment[publicName] !== undefined) {
    fail(
      "invalid-parameter",
      `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so the administrator credential must never be set under that name. Remove it and set ${setting} as a server-only Sensitive value.`,
    );
  }

  const encoded = environment[setting]?.trim();
  if (encoded === undefined || encoded.length === 0) {
    fail(
      "missing",
      `Missing ${setting}: administration is unavailable until this deployment configures a generated administrator secret. Run "npm run admin:secret" to produce one.`,
    );
  }

  return parsePrivateGalleryAdminCredential(encoded);
}

