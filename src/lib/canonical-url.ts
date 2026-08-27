/**
 * Absolute-URL rules shared by page metadata and structured data.
 *
 * Two rules that happen to share one base URL:
 *
 *   - `canonicalRouteUrl` builds the absolute URL of a route this site owns and
 *     applies ADR-0003's canonical path shape: no trailing slash, except the
 *     site root. It backs `<link rel="canonical">`, `og:url`, and a JSON-LD
 *     entity's `url` / `mainEntityOfPage`.
 *   - `absoluteAssetUrl` prepares a media rendition's `src` for a crawler or a
 *     social scraper that will not resolve a relative URL itself. A relative
 *     `src` resolves against this deployment's canonical base; an already
 *     absolute one — a public CDN derivative (ADR-0005) — is preserved exactly,
 *     origin and all. The trailing-slash rule never applies here: that is a
 *     route contract, not an asset one.
 *
 * `new URL(src, base)` already does the "resolve relative, preserve absolute"
 * split; naming the two cases keeps a caller from reaching for the route rule
 * on an asset or the reverse.
 */

export function canonicalRouteUrl(path: string, canonicalBaseUrl: URL): string {
  const url = new URL(path, canonicalBaseUrl);
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.href;
}

export function absoluteAssetUrl(src: string, canonicalBaseUrl: URL): string {
  return new URL(src, canonicalBaseUrl).href;
}
