/**
 * The one builder for this site's `Content-Security-Policy` (ADR-0011).
 *
 * Two callers, one directive list. `next.config.ts` applies the static policy
 * to every response as the fallback; the Proxy replaces it on public page and
 * file-path responses with the nonce variant (ADR-0011 amendment 2026-10-22,
 * AB#390). A `NextResponse.next()` response header replaces the same-named
 * `next.config.ts` value — measured on a production build, see
 * `RESERVED_NAMESPACE_HYGIENE_HEADERS` in `src/proxy.ts` — and every public
 * page leaves the Proxy through `next()`, never a rewrite.
 *
 * No `server-only` import: build configuration evaluates this before any
 * module graph exists, the same reason `next.config.ts` restates the Sanity
 * patterns.
 */
import { YOUTUBE_NOCOOKIE_ORIGIN } from "./embed-origins";

/**
 * Request header carrying this request's nonce to Server Components. The
 * Proxy always deletes a client-supplied value before setting its own.
 */
export const SCRIPT_NONCE_HEADER = "x-nonce";

export const CONTENT_SECURITY_POLICY_HEADER = "content-security-policy";

const SANITY_ASSET_CDN_HOST = "cdn.sanity.io";
const SANITY_PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SANITY_DATASET = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
/** Base64 of 16 random bytes: 22 characters plus `==` padding. */
const SCRIPT_NONCE = /^[A-Za-z0-9+/]{22}==$/;

export type SanityImageScope = {
  readonly projectId: string;
  readonly dataset: string;
};

export type ContentSecurityPolicyOptions = {
  readonly sanityImageScope: SanityImageScope | null;
  readonly privateObjectStoreOrigin?: string;
  /** Present only on responses whose HTML is rendered with this nonce. */
  readonly scriptNonce?: string;
  readonly development: boolean;
};

export function isScriptNonce(value: string): boolean {
  return SCRIPT_NONCE.test(value);
}

/** 128 bits from the platform CSPRNG, base64-encoded for the CSP source. */
export function createScriptNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The image scope for the Proxy at request time. Unlike the build-time
 * validation in `next.config.ts`, this never throws: the build already refused
 * an invalid Sanity configuration, and a request-time throw would turn every
 * page into an error. A value that does not match Sanity's own rules is left
 * out, so it can never widen `img-src`.
 */
export function readSanityImageScope(
  environment: Record<string, string | undefined>,
): SanityImageScope | null {
  if (environment.SITE_CONTENT_SOURCE?.trim() !== "sanity") return null;
  const projectId = environment.SANITY_PROJECT_ID?.trim() ?? "";
  const dataset = environment.SANITY_DATASET?.trim() ?? "";
  if (!SANITY_PROJECT_ID.test(projectId) || !SANITY_DATASET.test(dataset)) return null;
  return { projectId, dataset };
}

/**
 * `script-src` is the only directive the nonce changes. With a nonce, Next.js
 * tags its own scripts during dynamic rendering and `'strict-dynamic'` lets
 * those scripts load the chunks they need; `'unsafe-inline'` is gone.
 * `style-src` keeps `'unsafe-inline'`: server-rendered `style` attributes
 * cannot carry a nonce. `'unsafe-eval'` stays development-only, as Next.js's
 * CSP guide documents for React's debugging `eval()`.
 */
export function contentSecurityPolicy({
  sanityImageScope,
  privateObjectStoreOrigin,
  scriptNonce,
  development,
}: ContentSecurityPolicyOptions): string {
  if (scriptNonce !== undefined && !isScriptNonce(scriptNonce)) {
    throw new TypeError("script nonce must be base64 of 16 bytes");
  }
  const sanityImageOrigins =
    sanityImageScope === null
      ? ""
      : ` https://${SANITY_ASSET_CDN_HOST}/images/${sanityImageScope.projectId}/${sanityImageScope.dataset}/ https://${SANITY_ASSET_CDN_HOST}/files/${sanityImageScope.projectId}/${sanityImageScope.dataset}/`;
  const scriptSources =
    scriptNonce === undefined
      ? "'self' 'unsafe-inline'"
      : `'self' 'nonce-${scriptNonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `script-src ${scriptSources}${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${sanityImageOrigins}${
      privateObjectStoreOrigin === undefined ? "" : ` ${privateObjectStoreOrigin}`
    }`,
    `frame-src ${YOUTUBE_NOCOOKIE_ORIGIN}`,
    "connect-src 'self'",
    "font-src 'self'",
  ].join("; ");
}
