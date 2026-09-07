/**
 * The Preview integration alias that the application itself must mark
 * non-indexable (AB#136), as a leaf module with no imports.
 *
 * It lives apart from the rest of the deployment configuration for the same
 * mechanical reason `private-object-store-origin.ts` next to it does:
 * `next.config.ts` needs this value — it is the `has: [{ type: "host" }]`
 * condition on a `headers()` rule that adds `X-Robots-Tag: noindex` — and
 * Next.js's config transpiler resolves a config file's `@/` imports only one
 * level deep, so a module that imports anything else is unreachable from there.
 *
 * ## Why the application supplies this header at all
 *
 * Vercel adds `X-Robots-Tag: noindex` to a Preview deployment's *generated*
 * `<hash>.vercel.app` URL automatically, but **omits it once a domain or alias
 * is assigned** to a non-production deployment
 * (`vercel.com/docs/headers/response-headers`, and the KB guide
 * "Are Vercel Preview Deployments indexed by search engines?", both checked
 * 2026-09-06). The stable Preview integration alias (`PREVIEW_STABLE_ALIAS`)
 * is exactly such an assigned host, so it inherits the project's Standard
 * Protection (the SSO challenge) but *not* the automatic `noindex`. The
 * 2026-09-06 pipeline run of AB#136's AC5 exercise proved this against the real
 * platform: the alias host answered the SSO challenge and carried no
 * `X-Robots-Tag` header. ADR-0004 §3's 2026-08-31 amendment assumed the alias
 * inherited both; that clause is corrected by its 2026-09-06 amendment, and
 * this module is the fix.
 *
 * ## Why `VERCEL_ENV`, and why it is read at build time
 *
 * `VERCEL_ENV === "preview"` is Vercel's own signal for "this build is a
 * Preview deployment" — it is `"production"` for a `--prod` build and unset for
 * a plain `next build` (the CI quality gate, the Playwright e2e build) or
 * `next dev`. `SITE_DEPLOYMENT_STAGE` is a different axis (it defaults to
 * `production` so the contact-form and `robots.txt` safeguards fail closed) and
 * is not the right question here. A `headers()` rule is a static response
 * header baked into the build output, so the gate has to be answered at build
 * time; `vercel build --target=preview` exposes `VERCEL_ENV=preview` and the
 * pipeline additionally passes `PREVIEW_STABLE_ALIAS` into the build step's
 * environment (it is an Azure DevOps variable-group value, not a Vercel
 * project env var, so `vercel pull` does not write it). This is the same
 * build-time-input shape the Sanity project id and dataset already have for the
 * image optimizer's allow-list.
 *
 * The consequence is deliberate and fail-closed: a Preview build
 * (`VERCEL_ENV=preview`) with no usable `PREVIEW_STABLE_ALIAS` throws rather
 * than shipping a Preview deployment whose integration alias is silently
 * indexable — the exact regression AB#136 exists to prevent. The pipeline's
 * "Check deployment configuration" step already refuses a missing value before
 * the build runs, so in CI this only fires on a genuinely malformed host.
 */

const DEPLOYMENT_HOST_SUFFIX = ".vercel.app";

/** DNS limits: a label is at most 63 octets, a hostname at most 253. */
const MAX_DNS_LABEL_LENGTH = 63;
const MAX_DNS_HOSTNAME_LENGTH = 253;
const DNS_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export class PreviewNoindexAliasError extends Error {
  constructor(message: string) {
    super(`[preview-noindex-alias] ${message}`);
    this.name = "PreviewNoindexAliasError";
  }
}

/**
 * Whether `value` is a bare `*.vercel.app` host that
 * `readPreviewNoindexAliasHost` can normalize and use: no surrounding or inner
 * whitespace, no scheme, port, path, credentials, query, or fragment, no
 * unexpanded pipeline macro, and a syntactically valid subdomain. Case is not
 * significant — a host is compared and returned lower-cased, matching
 * `scripts/preview-verification.mts`'s `parsePreviewAliasHost`, so the one
 * `PREVIEW_STABLE_ALIAS` value the repoint tooling accepts is the one this
 * accepts. Restated here rather than shared because `scripts/` is outside the
 * application bundle and this leaf module may import nothing.
 */
export function isPreviewAliasHost(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) return false;
  if (trimmed.startsWith("$(")) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[:/@?#]/.test(trimmed)) return false;

  const host = trimmed.toLowerCase();
  if (!host.endsWith(DEPLOYMENT_HOST_SUFFIX)) return false;
  if (host.length > MAX_DNS_HOSTNAME_LENGTH) return false;

  const subdomain = host.slice(0, -DEPLOYMENT_HOST_SUFFIX.length);
  if (!subdomain) return false;

  return subdomain
    .split(".")
    .every(
      (label) =>
        label.length <= MAX_DNS_LABEL_LENGTH && DNS_LABEL_PATTERN.test(label),
    );
}

/**
 * Escapes a validated host for use as Next.js's `has: [{ type: "host", value }]`
 * pattern, which is a regular expression. A host that passed `isPreviewAliasHost`
 * contains only `[a-z0-9-]` and `.`, so in practice this only escapes the dots,
 * but the full escape keeps the function honest if the validator ever loosens.
 */
export function previewNoindexAliasHostPattern(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The alias host to mark non-indexable, or `undefined` when this build is not a
 * Vercel Preview deployment and therefore has nothing to do.
 *
 * Throws when it *is* a Preview build but `PREVIEW_STABLE_ALIAS` is missing or
 * not a bare `*.vercel.app` host: a Preview deployment whose integration alias
 * is not covered is the regression this exists to prevent, so it fails the
 * build rather than shipping one.
 */
export function readPreviewNoindexAliasHost(
  environment: Record<string, string | undefined>,
): string | undefined {
  if (environment.VERCEL_ENV?.trim() !== "preview") return undefined;

  // Not pre-trimmed: `isPreviewAliasHost` rejects surrounding whitespace
  // itself, matching `parsePreviewAliasHost` so the repoint tooling and this
  // reader accept exactly the same `PREVIEW_STABLE_ALIAS` value.
  const alias = environment.PREVIEW_STABLE_ALIAS;
  if (!alias || !alias.trim()) {
    throw new PreviewNoindexAliasError(
      'VERCEL_ENV is "preview", so PREVIEW_STABLE_ALIAS must be set at build time: Vercel omits its automatic X-Robots-Tag: noindex for an assigned alias, and the application supplies it as a static response header that cannot be derived later. See docs/deployment.md.',
    );
  }
  if (!isPreviewAliasHost(alias)) {
    throw new PreviewNoindexAliasError(
      `PREVIEW_STABLE_ALIAS must be a bare "${DEPLOYMENT_HOST_SUFFIX}" host — no scheme, port, path, credentials, query, fragment, or whitespace (received "${alias}"). The value is compiled into a next.config headers() host condition.`,
    );
  }

  return alias.toLowerCase();
}
