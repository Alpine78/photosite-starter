import { NextResponse, type NextRequest } from "next/server";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  buildLegacyGoneHtml,
  legacyRedirectDestinationSearch,
  resolveLegacyGoneLanguage,
  resolveLegacyGoneRoute,
  resolveLegacyRedirect,
} from "@/lib/legacy-redirects";
import { LEGACY_REDIRECTS } from "@/lib/legacy-redirects-data";
import {
  REQUEST_HAS_CURSOR_HEADER,
  REQUEST_HAS_CURSOR_VALUE,
  REQUEST_HAS_SECTION_HEADER,
  REQUEST_HAS_SECTION_VALUE,
  REQUEST_PATH_HEADER,
  isCarryableRequestPath,
  isPotentialStoryRequestPath,
} from "@/lib/request-path";

/**
 * The project's Proxy (Next.js 16's name for what was Middleware).
 *
 * It carries three bounded request facts to a `not-found.tsx` boundary and owns
 * trailing-slash normalization now that a cursor must be validated before a
 * permanent redirect. App Router gives that boundary no props and renders it
 * before the page, so there is no in-tree way to tell it (ADR-0007).
 *
 * It also answers the deployment's legacy-URL registry (AB#19,
 * `legacy-redirects.ts`) directly, terminating the request here rather than
 * letting it reach the route tree — and *before* its own trailing-slash
 * normalization below, since a legacy source may itself carry a trailing
 * slash. That is not a stylistic choice: a Server Component page in this
 * Next.js version can only emit 404/403/401 through its built-in error APIs,
 * so a genuine `410 Gone` is only reachable from this layer, and a literal
 * `301` (rather than the route tree's own `permanentRedirect()`, hardcoded
 * to 308) is too. The lookup is a static deployment-config map, not a
 * content or adapter read, so it costs nothing this file's own O(1) budget
 * does not already allow.
 *
 * ## What it deliberately does not do
 *
 * This runs on every matched request, so its cost is the site's cost. It is
 * O(1) and stays that way:
 *
 * - **No query string, and no cursor or section value.** A continuation token
 *   is a signed value whose only legitimate reader is the gallery adapter, and
 *   copying it into a header would spread it across a layer with no business
 *   holding it. What is carried instead is one bit each for `cursor` and
 *   `section` — whether the parameter was present — because the 404 needs
 *   that first gate before it resolves and verifies a possible return
 *   destination. Presence alone authorizes nothing.
 * - **No content or adapter reads.** A trailing-slash request consults only the
 *   cached locale route configuration to distinguish a possible story path
 *   from an ordinary route. Whether the path exists remains the route's job.
 * - **No secrets.** The signing key is server-only and lazily resolved; nothing
 *   here touches it.
 *
 * ## Trust
 *
 * The header is unconditionally overwritten, never merged or defaulted. A
 * visitor may send `x-photosite-request-path` themselves; `Headers.set` replaces
 * any such value (case-insensitively, per the Headers contract), so what reaches
 * the application is this function's value and not the client's. The reader
 * validates it a second time, because paths excluded by the matcher below never
 * pass through here at all.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;
  const hasCursor = request.nextUrl.searchParams.has("cursor");
  const hasSection = request.nextUrl.searchParams.has("section");
  const hasTrailingSlash = pathname.length > 1 && pathname.endsWith("/");

  // Checked against the exact requested pathname, trailing slash and all,
  // and *before* the generic trailing-slash normalization below — a legacy
  // source may itself carry one (the crawl recorded at least one real
  // directory-style URL with no slash-free equivalent, `/en/`; see
  // `legacy-redirects.ts`'s own comment on `isCanonicalLegacyPath`), and
  // stripping the slash first would turn one hop into a 308-then-redirect
  // chain for exactly the sources this registry exists to answer cleanly.
  // Applied for every request method — this file does not branch on method
  // anywhere else, and a 301/410 is a meaningful answer to a HEAD or a stray
  // POST the same way it is to a GET. The lookup key is the pathname only
  // (ADR-0003 decision 9: a query string is never part of a row's identity),
  // so a request that only differs from a decided row by its query still
  // gets that row's outcome; what the query string itself does about it is
  // decided below, per outcome kind.
  const legacyOutcome = resolveLegacyRedirect(LEGACY_REDIRECTS, pathname);
  if (legacyOutcome !== undefined) {
    if (legacyOutcome.kind === "redirect") {
      const destination = new URL(legacyOutcome.target, request.url);
      destination.search = legacyRedirectDestinationSearch(
        request.nextUrl.search,
        legacyOutcome.reservedQueryParams,
      );
      return NextResponse.redirect(destination, 301);
    }

    const goneRoute = resolveLegacyGoneRoute(getDeploymentConfig().localeRoutes, pathname);
    return new NextResponse(buildLegacyGoneHtml(goneRoute), {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-language": resolveLegacyGoneLanguage(goneRoute.locale),
        "cache-control": "public, max-age=3600, must-revalidate",
      },
    });
  }

  // Next's built-in slash redirect runs before the route can validate a cursor.
  // Keep its ordinary 308 for every other request, but let a possible story
  // path reach the route. That collapses casing/prefix/slash defects in one hop,
  // and only the gallery adapter can distinguish a good bookmark from a
  // malformed, tampered, wrong-scope, or stale token.
  if (
    hasTrailingSlash &&
    !isPotentialStoryRequestPath(
      getDeploymentConfig().localeRoutes,
      pathname,
    )
  ) {
    // Use the platform URL rather than NextURL.clone(): the latter retains the
    // incoming trailing-slash formatting policy and can serialize the removed
    // slash back into Location, producing a self-redirect.
    const destination = new URL(request.url);
    destination.pathname = pathname.slice(0, -1);
    return NextResponse.redirect(destination, 308);
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    // API routes consume neither project header. Delete any client attempt at
    // those names before the ordinary pass-through, while preserving the slash
    // redirect above that Next.js used to provide itself.
    requestHeaders.delete(REQUEST_PATH_HEADER);
    requestHeaders.delete(REQUEST_HAS_CURSOR_HEADER);
    requestHeaders.delete(REQUEST_HAS_SECTION_HEADER);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (isCarryableRequestPath(pathname)) {
    requestHeaders.set(REQUEST_PATH_HEADER, pathname);
  } else {
    // An unusable path leaves no header rather than a partial one, so the
    // boundary sees "nothing was carried" instead of a truncated path that
    // could name a different real route.
    requestHeaders.delete(REQUEST_PATH_HEADER);
  }

  // Presence only, never the value, and always overwritten for the same reason
  // the path is.
  if (hasCursor) {
    requestHeaders.set(REQUEST_HAS_CURSOR_HEADER, REQUEST_HAS_CURSOR_VALUE);
  } else {
    requestHeaders.delete(REQUEST_HAS_CURSOR_HEADER);
  }

  if (hasSection) {
    requestHeaders.set(REQUEST_HAS_SECTION_HEADER, REQUEST_HAS_SECTION_VALUE);
  } else {
    requestHeaders.delete(REQUEST_HAS_SECTION_HEADER);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Routes that need the request boundary or restored slash normalization.
 *
 * Next's own build output, image optimizer, and static assets are excluded.
 * API routes remain matched so disabling Next's built-in slash redirect does
 * not silently change `/api/x/` from its former 308 into a 404; ordinary API
 * requests still take the O(1) pass-through and read none of these headers.
 */
export const config = {
  matcher: ["/((?!_next/|.*\\.[^/]*$).*)"],
};
