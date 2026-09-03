/**
 * The bounded request facts Proxy carries, and the rules for reading them.
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

import {
  resolvePrefixedRoute,
  type LocaleRouteConfig,
} from "@/lib/locale-routes";

/**
 * Project-owned and deliberately not one of the `x-forwarded-*` names a host or
 * CDN may already set, so nothing upstream can collide with it.
 */
export const REQUEST_PATH_HEADER = "x-photosite-request-path";

/**
 * Whether the refused request carried a `cursor` parameter at all.
 *
 * A flag, never the token. Cursor presence is the first necessary fact for the
 * invalid-continuation case; the 404 then resolves the path and independently
 * verifies that the content page and parameter-free gallery result are served.
 * The bit alone never authorizes a link.
 *
 * Carrying one bit rather than the value keeps the signed token out of a layer
 * that has no business holding one, and keeps the Proxy O(1).
 */
export const REQUEST_HAS_CURSOR_HEADER = "x-photosite-request-has-cursor";

/** The only value the flag is ever set to, and the only one read back as true. */
export const REQUEST_HAS_CURSOR_VALUE = "1";

/**
 * Whether the refused request carried a `section` parameter at all.
 *
 * The same one-bit shape as {@link REQUEST_HAS_CURSOR_HEADER}, for the same
 * reason: an unknown gallery section also answers 404 (ADR-0003 decision 8),
 * and its 404 needs the same return link an invalid cursor's does. `section`
 * carries no signature and is not secret, but the Proxy still transports only
 * its presence — the value plays no part in the 404 boundary's decision, and
 * carrying it would be scope the boundary does not need.
 */
export const REQUEST_HAS_SECTION_HEADER = "x-photosite-request-has-section";

/** The only value the flag is ever set to, and the only one read back as true. */
export const REQUEST_HAS_SECTION_VALUE = "1";

/**
 * Whether a pathname is inside the reserved private client-gallery namespace
 * (ADR-0014 §9): the `<prefix>` segment itself, or anything beneath it.
 *
 * The Proxy uses this to stamp ADR-0014 §6's response-hygiene headers
 * (`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`,
 * `Referrer-Policy: no-referrer`) on every response for such a path — feature
 * on or off, since the prefix is reserved unconditionally and a request here is
 * a 404 today that still must not be indexed or cached.
 *
 * `prefix` is a validated single lowercase segment
 * (`readPrivateGalleryDeployment`), so no escaping is needed; `pathname` is
 * already normalized by the time the Proxy sees it.
 */
export function isPrivateRequestPath(pathname: string, prefix: string): boolean {
  return isPathInReservedNamespace(pathname, prefix);
}

/**
 * Whether a pathname is inside the reserved **administrator** namespace
 * (ADR-0015 §1): the `<adminPrefix>` segment itself, or anything beneath it.
 *
 * Separate from {@link isPrivateRequestPath} at the call site and identical in
 * rule, which is the point — ADR-0015 §1 gives the administrator routes "the
 * same response hygiene the private namespace already does", so the two share
 * one predicate rather than two that could drift. What must never be shared is
 * the *prefix*: `readPrivateGalleryDeployment` refuses a configuration where
 * they are equal, so a path can satisfy at most one of these.
 *
 * Like the customer namespace, this holds whether the feature is on or off: the
 * prefix is reserved unconditionally, and a request here is a 404 today that
 * still must not be indexed, cached, or leak a referrer.
 */
export function isPrivateAdminRequestPath(
  pathname: string,
  adminPrefix: string,
): boolean {
  return isPathInReservedNamespace(pathname, adminPrefix);
}

/**
 * The shared rule behind both reserved namespaces. `prefix` is a validated
 * single lowercase segment (`readPrivateGalleryDeployment`), so no escaping is
 * needed; `pathname` is already normalized by the time the Proxy sees it.
 */
function isPathInReservedNamespace(pathname: string, prefix: string): boolean {
  return pathname === `/${prefix}` || pathname.startsWith(`/${prefix}/`);
}

/**
 * The application-internal root segment a private-gallery request is rewritten
 * onto.
 *
 * The public prefix is deployment-configured (`PRIVATE_GALLERY_ROUTE_PREFIX`),
 * but a Next.js file-system route cannot be — so the Proxy, which already owns
 * the private prefix (ADR-0014 §9), reconciles the two with one rewrite onto
 * this literal segment. It is a reserved root segment (`public-routes.ts`), so
 * no clone can configure it as a prefix, locale prefix, or story namespace, and
 * the Proxy answers a *direct* request to it with a 404 — otherwise it would be
 * a second, unprefixed door into the private namespace, reachable without §6's
 * response hygiene.
 */
export const PRIVATE_GALLERY_INTERNAL_SEGMENT = "private-gallery";

export function isPrivateGalleryInternalPath(pathname: string): boolean {
  return (
    pathname === `/${PRIVATE_GALLERY_INTERNAL_SEGMENT}` ||
    pathname.startsWith(`/${PRIVATE_GALLERY_INTERNAL_SEGMENT}/`)
  );
}

/** `/<prefix>/rest` → `/private-gallery/rest`; `/<prefix>` → `/private-gallery`. */
export function privateGalleryInternalPath(
  pathname: string,
  prefix: string,
): string {
  return `/${PRIVATE_GALLERY_INTERNAL_SEGMENT}${pathname.slice(prefix.length + 1)}`;
}

/**
 * The application-internal root segment an administrator request is rewritten
 * onto (ADR-0015 §1), for the reason {@link PRIVATE_GALLERY_INTERNAL_SEGMENT}
 * gives: the public prefix is deployment-configured and a Next.js file-system
 * route cannot be.
 *
 * A **different** segment from the customer namespace's, not a subtree of it.
 * ADR-0015 §1 keeps the two from overlapping at all, and that has to hold for
 * the internal shape as much as the public one — otherwise the isolation would
 * be true of the URL a visitor sees and false of the route tree behind it.
 */
export const PRIVATE_GALLERY_ADMIN_INTERNAL_SEGMENT = "private-gallery-admin";

export function isPrivateGalleryAdminInternalPath(pathname: string): boolean {
  return (
    pathname === `/${PRIVATE_GALLERY_ADMIN_INTERNAL_SEGMENT}` ||
    pathname.startsWith(`/${PRIVATE_GALLERY_ADMIN_INTERNAL_SEGMENT}/`)
  );
}

/** `/<adminPrefix>/rest` → `/private-gallery-admin/rest`. */
export function privateGalleryAdminInternalPath(
  pathname: string,
  adminPrefix: string,
): string {
  return `/${PRIVATE_GALLERY_ADMIN_INTERNAL_SEGMENT}${pathname.slice(
    adminPrefix.length + 1,
  )}`;
}

const ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

function matchesRouteSegment(value: string | undefined, expected: string): boolean {
  return (
    value !== undefined &&
    ROUTE_SEGMENT_PATTERN.test(value) &&
    value.toLowerCase() === expected
  );
}

/**
 * Whether a pathname could belong to one configured public story route space.
 *
 * Proxy needs this one routing fact only for a trailing-slash request. Story
 * routes perform their own normalization so a cursor can be validated before a
 * 308 and multiple spelling defects collapse in one hop; every other route
 * keeps Next.js's ordinary slash normalization. This does not resolve content
 * and cannot say whether the path actually exists.
 */
export function isPotentialStoryRequestPath(
  config: LocaleRouteConfig,
  pathname: string,
): boolean {
  if (!isCarryableRequestPath(pathname)) return false;

  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [prefix, ...rest] = segments;
  if (prefix === undefined) return false;

  const defaultRoute = config.byLocale.get(config.defaultLocale);
  if (defaultRoute === undefined) return false;

  const resolution = resolvePrefixedRoute(config, prefix, rest);
  if (resolution.kind === "localized") {
    const localeRoute = config.byLocale.get(resolution.locale);
    return (
      localeRoute !== undefined &&
      matchesRouteSegment(resolution.segments[0], localeRoute.storyNamespace)
    );
  }

  if (resolution.kind === "redundant-default-prefix") {
    return matchesRouteSegment(rest[0], defaultRoute.storyNamespace);
  }

  return matchesRouteSegment(prefix, defaultRoute.storyNamespace);
}

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

/**
 * Whether the Proxy flagged this request as carrying a `section` parameter.
 *
 * Exact-match on the single value the Proxy writes, same as
 * {@link readRequestHasCursor} and for the same reason.
 */
export function readRequestHasSection(value: string | null | undefined): boolean {
  return value === REQUEST_HAS_SECTION_VALUE;
}
