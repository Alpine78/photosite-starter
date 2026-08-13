/**
 * The one request header the Proxy sets, and the rule for reading it.
 *
 * App Router renders a `not-found.tsx` boundary with no props — no `params`, no
 * `searchParams` — and renders it *before* the page that decided to refuse the
 * request, so neither route context nor a per-request `cache()` handoff can
 * reach it. The requested path therefore arrives the only way that is left: as
 * a request header the Proxy puts there.
 *
 * Kept in its own module so the header name, the bound, and the parse rule are
 * written once and testable without a running server. `proxy.ts` writes; the
 * 404 boundary reads; nothing else should do either.
 */

/**
 * Project-owned and deliberately not one of the `x-forwarded-*` names a host or
 * CDN may already set, so nothing upstream can collide with it.
 */
export const REQUEST_PATH_HEADER = "x-photosite-request-path";

/**
 * Whether the refused request carried a `cursor` parameter at all.
 *
 * A flag, never the token. The 404 needs to know *why* an address was refused,
 * not what was in it: a gallery path that resolves can 404 because its cursor
 * was refused, or because the content behind it could not be read. Only the
 * first has a first page worth offering — in the second, the link would lead
 * straight back to the address that just failed.
 *
 * Carrying one bit rather than the value keeps the signed token out of a layer
 * that has no business holding one, and keeps the Proxy O(1).
 */
export const REQUEST_HAS_CURSOR_HEADER = "x-photosite-request-has-cursor";

/** The only value the flag is ever set to, and the only one read back as true. */
export const REQUEST_HAS_CURSOR_VALUE = "1";

/**
 * Longest path the Proxy will copy.
 *
 * Request headers are a bounded resource — an oversized one produces a 431 —
 * and the only paths this exists to serve are public content routes, which
 * ADR-0003 caps at a story namespace plus five category levels and a slug. A
 * longer path is not one of those, so the header is omitted rather than
 * truncated: a truncated path could name a *different*, real route, and the 404
 * would then offer a link to a page the visitor never asked for.
 */
export const MAX_REQUEST_PATH_LENGTH = 512;

/**
 * An absolute, same-origin, single-line path.
 *
 * The second character matters as much as the first: `//example.com/x` is a
 * path by shape and a *protocol-relative URL* to a browser, so a link built
 * from one would leave the site. A backslash is refused anywhere for the same
 * reason — browsers normalize `/\example.com` the same way. Query and fragment
 * are excluded because the Proxy carries neither.
 */
const REQUEST_PATH_PATTERN = /^\/(?![/\\])[^\s?#\\]*$/;

/**
 * Whether this path may be carried in the header.
 *
 * The Proxy checks it before writing so a malformed or oversized value never
 * becomes a header, and the reader checks it again: the two run in different
 * runtimes, and the reader must not assume the writer was the only source.
 */
export function isCarryableRequestPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MAX_REQUEST_PATH_LENGTH &&
    REQUEST_PATH_PATTERN.test(path)
  );
}

/**
 * The requested path this header names, or `undefined` when it carries nothing
 * usable.
 *
 * A client may send this header name itself. The Proxy overwrites it on every
 * matched request, so what arrives here is the Proxy's value — but this
 * validates anyway, because a request that never matched the Proxy (an excluded
 * path, or a deployment whose Proxy did not run) would otherwise pass a
 * visitor-supplied string to whatever reads it.
 */
export function readRequestPath(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return isCarryableRequestPath(value) ? value : undefined;
}

/**
 * Whether the Proxy flagged this request as carrying a cursor.
 *
 * Exact-match on the single value the Proxy writes, so anything else — a
 * client's own guess at the header, an empty string, a truthy-looking word —
 * reads as absent.
 */
export function readRequestHasCursor(value: string | null | undefined): boolean {
  return value === REQUEST_HAS_CURSOR_VALUE;
}
