/**
 * The private object store's origin, as a leaf module with no imports.
 *
 * It lives apart from `private-gallery-config.ts`, which owns the rest of the
 * request-time settings, for the same mechanical reason
 * `private-gallery-object-key.ts` is separate: `next.config.ts` needs this value
 * — it is interpolated into the private routes' `img-src` (ADR-0014 §6, ADR-0011
 * action item 4) — and Next.js's config transpiler resolves a config file's
 * `@/` imports only one level deep. A module that imports anything else is
 * unreachable from there. One definition beats the restatement-plus-pinning-test
 * pattern the Sanity ids next to it had to settle for.
 *
 * ## Why this one value is read at build time
 *
 * ADR-0014 §9 keeps the private settings request-time so `next build` never
 * needs a *credential*. An endpoint origin is not one, and a Content-Security-
 * Policy is a static response header: there is no request-time layer that could
 * supply it without rebuilding the whole policy somewhere else. This follows the
 * precedent already in `next.config.ts`, where `SANITY_PROJECT_ID` and
 * `SANITY_DATASET` are read at build for exactly the same reason — a non-secret
 * identifier that a build-time response policy and an allow-list depend on.
 *
 * The consequence is deliberate and documented: a deployment that sets
 * `PRIVATE_GALLERY_STORE=enabled` must also supply `PRIVATE_GALLERY_S3_ENDPOINT`
 * at build. That is the same fail-closed shape `SITE_CONTENT_SOURCE=sanity`
 * already has, and the alternative — silently emitting no grant — would ship a
 * gallery whose every photograph is blocked by the browser with no build error
 * to explain it.
 */

/**
 * A bare `https://` origin: no path, query, fragment, credentials, or trailing
 * slash. Restated as a check rather than a regular expression because `URL`
 * answers the same question more exactly than a pattern over a URL can.
 */
export function isPrivateObjectStoreOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === "" &&
    // `new URL` tolerates a trailing slash and normalizes it away; the CSP
    // source must be exactly what was configured, so a value that only round
    // trips by being rewritten is refused rather than quietly corrected.
    (value === url.origin || value === `${url.origin}/`)
  );
}

export class PrivateObjectStoreOriginError extends Error {
  constructor(message: string) {
    super(`[private-object-store-origin] ${message}`);
    this.name = "PrivateObjectStoreOriginError";
  }
}

/**
 * The origin to grant, or `undefined` when this deployment has no object store.
 *
 * `off` and `memory` return `undefined` on purpose: neither has an object store,
 * so neither may widen the browser's image policy. A grant that appeared in
 * every build would be a permanent hole for a feature most deployments never
 * turn on.
 */
export function readPrivateObjectStoreOrigin(
  environment: Record<string, string | undefined>,
): string | undefined {
  if (environment.PRIVATE_GALLERY_STORE?.trim() !== "enabled") return undefined;

  const endpoint = environment.PRIVATE_GALLERY_S3_ENDPOINT?.trim();
  if (!endpoint) {
    throw new PrivateObjectStoreOriginError(
      'PRIVATE_GALLERY_STORE is "enabled", so PRIVATE_GALLERY_S3_ENDPOINT must be set at build time: the private routes\' img-src grant is a static response header and cannot be derived later.',
    );
  }
  if (!isPrivateObjectStoreOrigin(endpoint)) {
    throw new PrivateObjectStoreOriginError(
      "PRIVATE_GALLERY_S3_ENDPOINT must be a bare https:// origin with no path, query, fragment, or credentials. An unvalidated value would be interpolated into a Content-Security-Policy source, where a stray space or semicolon widens the whole policy.",
    );
  }
  // Normalized so a configured trailing slash cannot produce a CSP source the
  // browser reads differently from the origin the signer actually addresses.
  return new URL(endpoint).origin;
}
