import { NextResponse, type NextRequest } from "next/server";
import {
  CONTENT_SECURITY_POLICY_HEADER,
  SCRIPT_NONCE_HEADER,
  contentSecurityPolicy,
  createScriptNonce,
  readSanityImageScope,
} from "@/lib/content-security-policy";
import { REQUEST_UI_LOCALE_HEADER, restrictedLocaleFromSearch } from "@/lib/restricted-page-locale";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { isContentMetadataPath, isStaticAssetCandidate, MAINTENANCE_FALLBACK_HEADER } from "@/lib/maintenance-routing";
import { MAINTENANCE_HYGIENE_HEADERS, readSiteMaintenanceMode, siteMaintenanceResponse } from "@/lib/site-maintenance";
import {
  buildLegacyGoneHtml,
  legacyRedirectDestinationSearch,
  resolveLegacyGoneLanguage,
  resolveLegacyGoneRoute,
  resolveLegacyRedirect,
} from "@/lib/legacy-redirects";
import { LEGACY_REDIRECTS } from "@/lib/legacy-redirects-data";
import { isLegacyGalleryNamespace, legacyGalleryHandleFromPath } from "@/lib/legacy-gallery-path";
import { createLegacyGalleryRedirectResolver, InvalidLegacyGalleryRedirectConfiguration } from "@/lib/legacy-gallery-redirects";
import {
  REQUEST_HAS_CURSOR_HEADER,
  REQUEST_HAS_CURSOR_VALUE,
  REQUEST_HAS_SECTION_HEADER,
  REQUEST_HAS_SECTION_VALUE,
  REQUEST_PATH_HEADER,
  isCarryableRequestPath,
  isPotentialStoryRequestPath,
  isPrivateAdminRequestPath,
  isPrivateGalleryAdminInternalPath,
  isPrivateGalleryInternalPath,
  isPrivateRequestPath,
  privateGalleryAdminInternalPath,
  privateGalleryInternalPath,
  readRequestPath,
} from "@/lib/request-path";

/**
 * ADR-0014 §6's response-hygiene headers for the reserved private client-gallery
 * namespace, and — on ADR-0015 §1's instruction that the administrator routes
 * carry "the same response hygiene the private namespace already does" — for the
 * reserved administrator namespace too. One constant, so the two cannot drift.
 * ADR-0014 §9 makes this the Proxy's rule, not `next.config.ts`'s:
 * one owner, and a `NextResponse.next()` response's headers replace a same-named
 * `next.config.ts` value, so `Referrer-Policy` here overrides the site-wide
 * `strict-origin-when-cross-origin`. `Cache-Control` and `X-Robots-Tag` have no
 * site-wide entry, so there is nothing to override for those.
 *
 * That precedence holds for `next()` and **not** for `NextResponse.rewrite()`,
 * which is why the private rewrite below is followed by a `next()` pass rather
 * than being the response the client receives — see the internal-path branch.
 * Found by measuring a production build, not by reading: the rewrite silently
 * lost only `Referrer-Policy`, and `e2e/private-route-hygiene.spec.ts` is what
 * caught it.
 *
 * This is the namespace-level application response contract only. Dynamic
 * rendering, Data/tagged-cache bypass, a Route Handler not replacing
 * `Cache-Control`, the object store's own `no-store` metadata, and the CSP
 * `img-src` grant are each a later route/delivery slice's job (ADR-0014 §6, §5).
 */
const RESERVED_NAMESPACE_HYGIENE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

function withReservedNamespaceHygieneHeaders(
  response: NextResponse,
): NextResponse {
  for (const [key, value] of Object.entries(RESERVED_NAMESPACE_HYGIENE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

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
const retainedGalleryRedirect = createLegacyGalleryRedirectResolver();
const RETAINED_GALLERY_REDIRECT_STATUS = 307;
let warnedInvalidRetainedRedirects = false;

const sanityImageScope = readSanityImageScope(process.env);

/**
 * Next.js's own error-page paths answer with the build's prerendered HTML,
 * which carries no nonce, so they keep the static fallback policy. Measured on
 * a production build: `/404` (a retained Joomla error-page URL) loaded the
 * static not-found page and a nonce policy blocked every one of its scripts.
 */
const PRERENDERED_ERROR_PAGE_PATHS = new Set(["/404", "/500", "/_not-found", "/_global-error"]);

/**
 * A public page or file-path pass-through with a fresh script nonce (ADR-0011
 * amendment 2026-10-22, AB#390). Next.js reads the policy from the request
 * header and tags its own scripts while rendering; the theme bootstrap reads
 * `x-nonce`. The response header replaces `next.config.ts`'s static fallback,
 * which holds for `next()` and not for a rewrite (see
 * `RESERVED_NAMESPACE_HYGIENE_HEADERS`), so this is only ever used with
 * `next()`. Every method gets it: Next.js also renders a page for a form POST.
 * The prerendered error pages above keep the static policy.
 */
function nextWithScriptNonce(request: NextRequest, requestHeaders: Headers): NextResponse {
  if (PRERENDERED_ERROR_PAGE_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  const scriptNonce = createScriptNonce();
  const policy = contentSecurityPolicy({
    sanityImageScope,
    scriptNonce,
    development: process.env.NODE_ENV === "development",
  });
  requestHeaders.set(CONTENT_SECURITY_POLICY_HEADER, policy);
  requestHeaders.set(SCRIPT_NONCE_HEADER, scriptNonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CONTENT_SECURITY_POLICY_HEADER, policy);
  return response;
}

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;
  // This must precede even normal deployment configuration. A broken content
  // source must not prevent the maintenance response. Clients cannot select a
  // bypass: their marker is always removed or replaced by this request's fact.
  requestHeaders.delete(MAINTENANCE_FALLBACK_HEADER);
  // A client can never choose the policy or nonce a page renders with.
  requestHeaders.delete(CONTENT_SECURITY_POLICY_HEADER);
  requestHeaders.delete(SCRIPT_NONCE_HEADER);
  const assetCandidate = isStaticAssetCandidate(pathname);
  if (readSiteMaintenanceMode(process.env) !== "off") {
    if (!assetCandidate || isContentMetadataPath(pathname)) {
      // Negotiation only changes the fixed failure representation, never access.
      // This also serves JSON clients behind custom reserved private prefixes.
      const json = pathname === "/api" || pathname.startsWith("/api/") ||
        request.headers.get("accept")?.includes("application/json") === true ||
        request.headers.get("content-type")?.includes("application/json") === true;
      return siteMaintenanceResponse(request.method, json);
    }
    // Let Next serve actual static bytes. If the candidate is missing, the
    // afterFiles rewrite terminates before the dynamic content catch-all.
    requestHeaders.set(MAINTENANCE_FALLBACK_HEADER, "1");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    // A later Route Handler cannot replace existing next.config response
    // headers. Override here so a missing versioned asset cannot cache a503.
    // Real static bytes remain200, with conservative hygiene during maintenance.
    for (const [name, value] of Object.entries(MAINTENANCE_HYGIENE_HEADERS)) response.headers.set(name, value);
    return response;
  }
  // Preserve the old matcher exclusions' ordinary behavior, including metadata.
  // A missing file-shaped path can still render an HTML 404, so it gets the nonce too.
  if (assetCandidate) return nextWithScriptNonce(request, requestHeaders);
  const hasCursor = request.nextUrl.searchParams.has("cursor");
  const hasSection = request.nextUrl.searchParams.has("section");
  const hasTrailingSlash = pathname.length > 1 && pathname.endsWith("/");

  const routes = getDeploymentConfig().localeRoutes;
  const privateConfig = getDeploymentConfig().privateGallery;
  // Always replace a client value, including on the rewrite's second pass.
  requestHeaders.delete(REQUEST_UI_LOCALE_HEADER);
  if (isLegacyGalleryNamespace(pathname, []) ||
    isPrivateRequestPath(pathname, privateConfig.routePrefix) ||
    isPrivateAdminRequestPath(pathname, privateConfig.adminRoutePrefix) ||
    isPrivateGalleryInternalPath(pathname) || isPrivateGalleryAdminInternalPath(pathname)) {
    requestHeaders.set(REQUEST_UI_LOCALE_HEADER, restrictedLocaleFromSearch(request.nextUrl.searchParams, routes));
  }
  const galleryPrefixes = routes.locales.flatMap((route) => [route.prefix, route.locale.split("-")[0]]).filter((value): value is string => typeof value === "string" && value.length > 0);
  if (isLegacyGalleryNamespace(pathname, galleryPrefixes)) {
    if (legacyGalleryHandleFromPath(pathname) === undefined) {
      return withReservedNamespaceHygieneHeaders(new NextResponse(null, { status: 404 }));
    }
    if (hasTrailingSlash) {
      const destination = request.nextUrl.clone();
      destination.pathname = pathname.slice(0, -1);
      return withReservedNamespaceHygieneHeaders(NextResponse.redirect(destination, 308));
    }
    requestHeaders.delete(REQUEST_PATH_HEADER);
    requestHeaders.delete(REQUEST_HAS_CURSOR_HEADER);
    requestHeaders.delete(REQUEST_HAS_SECTION_HEADER);
    return withReservedNamespaceHygieneHeaders(nextWithScriptNonce(request, requestHeaders));
  }

  // The two reserved namespaces: the private client-gallery one (ADR-0014 §9)
  // and the administrator one (ADR-0015 §1). Both prefixes are validated and
  // reserved by `loadDeploymentConfig` — including against each other and
  // against a legacy-redirect root — so neither is ever also a legacy path, and
  // the legacy lookup below is skipped for both. Every response the Proxy
  // returns for such a path carries §6's hygiene headers.
  const { routePrefix: privateRoutePrefix, adminRoutePrefix } =
    getDeploymentConfig().privateGallery;

  // The internal rewrite target (`privateGalleryInternalPath`). **This Proxy
  // runs again on the path it rewrote to** — verified against a production
  // build, not assumed — so this branch is both the second pass of a genuine
  // private request and the door a stranger might try directly.
  //
  // The two are told apart by the request path the first pass carried, which is
  // this exact rewrite's source. A client can send that header itself, and this
  // does not pretend otherwise: it is a namespace-hygiene rule, not an
  // authorization one. What it buys is that no crawler, link, or ordinary
  // client ever reaches a second URL shape for a private gallery — and what a
  // forged header would reach is a bootstrap page that looks nothing up and an
  // exchange that still demands the real capability and answers with a cookie
  // scoped to the *public* path, which no browser would then send here.
  // Authorization is the capability and the session, never the URL shape.
  if (isPrivateGalleryInternalPath(pathname)) {
    const carried = readRequestPath(request.headers.get(REQUEST_PATH_HEADER));
    const isOwnRewrite =
      carried !== undefined &&
      isPrivateRequestPath(carried, privateRoutePrefix) &&
      privateGalleryInternalPath(carried, privateRoutePrefix) === pathname;
    if (!isOwnRewrite) return new NextResponse(null, { status: 404 });

    // A pass-through, not a second rewrite — and that is also what makes §6's
    // `Referrer-Policy: no-referrer` stick: a `next()` response's headers
    // replace `next.config.ts`'s site-wide value, while a `rewrite()` response's
    // do not (see `RESERVED_NAMESPACE_HYGIENE_HEADERS` above).
    return withReservedNamespaceHygieneHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
    );
  }

  // The administrator namespace's own second pass, told from a direct request
  // exactly as the customer one is: by the request path the first pass carried,
  // which is this rewrite's own source. Namespace hygiene, not authorization —
  // a forged header reaches a login form that still demands the credential.
  if (isPrivateGalleryAdminInternalPath(pathname)) {
    const carried = readRequestPath(request.headers.get(REQUEST_PATH_HEADER));
    const isOwnRewrite =
      carried !== undefined &&
      isPrivateAdminRequestPath(carried, adminRoutePrefix) &&
      privateGalleryAdminInternalPath(carried, adminRoutePrefix) === pathname;
    if (!isOwnRewrite) return new NextResponse(null, { status: 404 });

    return withReservedNamespaceHygieneHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
    );
  }

  const privatePath = isPrivateRequestPath(pathname, privateRoutePrefix);

  // The reserved administrator namespace (ADR-0015 §1).
  //
  // `readPrivateGalleryDeployment` refuses a configuration where the two
  // prefixes are equal, so `privatePath` and `adminPath` are mutually exclusive.
  const adminPath = isPrivateAdminRequestPath(pathname, adminRoutePrefix);
  const reservedNamespacePath = privatePath || adminPath;

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
  const legacyOutcome = reservedNamespacePath
    ? undefined
    : resolveLegacyRedirect(LEGACY_REDIRECTS, pathname);
  if (legacyOutcome !== undefined) {
    if (legacyOutcome.kind === "redirect") {
      const destination = new URL(legacyOutcome.target, request.url);
      destination.search = legacyRedirectDestinationSearch(
        request.nextUrl.search,
        legacyOutcome.reservedQueryParams,
        legacyOutcome.fallbackNotice,
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

  // Owner-local retained links follow reserved namespaces and the public registry.
  // Drop all historical query values; only the validated UI locale can survive.
  let retainedTarget: string | undefined;
  if (!reservedNamespacePath) {
    try {
      retainedTarget = retainedGalleryRedirect(pathname, process.env);
    } catch (error) {
      if (!(error instanceof InvalidLegacyGalleryRedirectConfiguration)) throw error;
      if (!warnedInvalidRetainedRedirects) {
        console.warn("Retained-gallery redirects disabled: invalid deployment configuration");
        warnedInvalidRetainedRedirects = true;
      }
    }
  }
  if (retainedTarget !== undefined) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withReservedNamespaceHygieneHeaders(new NextResponse(null, { status: 405, headers: { allow: "GET, HEAD" } }));
    }
    const locale = restrictedLocaleFromSearch(request.nextUrl.searchParams, routes);
    const search = request.nextUrl.searchParams.has("locale") && locale !== routes.defaultLocale
      ? `?locale=${encodeURIComponent(locale)}` : "";
    const destination = new URL(retainedTarget, request.url);
    destination.search = search;
    return withReservedNamespaceHygieneHeaders(NextResponse.redirect(destination, RETAINED_GALLERY_REDIRECT_STATUS));
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
    const redirect = NextResponse.redirect(destination, 308);
    return reservedNamespacePath
      ? withReservedNamespaceHygieneHeaders(redirect)
      : redirect;
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

  // One rewrite reconciles the configured administrator prefix with its literal
  // file-system route, the same way the customer namespace's does.
  if (adminPath) {
    const adminTarget = request.nextUrl.clone();
    adminTarget.pathname = privateGalleryAdminInternalPath(
      pathname,
      adminRoutePrefix,
    );
    return withReservedNamespaceHygieneHeaders(
      NextResponse.rewrite(adminTarget, {
        request: { headers: requestHeaders },
      }),
    );
  }

  if (!privatePath) {
    return nextWithScriptNonce(request, requestHeaders);
  }

  // One rewrite reconciles the deployment-configured public prefix with the
  // literal file-system route (`src/app/private-gallery/...`). The browser keeps
  // the address it asked for, which is also what the session cookie's own
  // `Path` is scoped to.
  //
  // `nextUrl.clone()` is the framework's own idiom for an internal rewrite, and
  // the trailing-slash hazard that made the 308 above avoid `clone()` cannot
  // arise here: a private path with a trailing slash is never a potential story
  // path, so it was already redirected.
  const target = request.nextUrl.clone();
  target.pathname = privateGalleryInternalPath(pathname, privateRoutePrefix);
  return withReservedNamespaceHygieneHeaders(
    NextResponse.rewrite(target, { request: { headers: requestHeaders } }),
  );
}

/**
 * Match every path so dynamic metadata and missing file-shaped paths cannot
 * escape maintenance. With the mode off, the old excluded asset paths return
 * immediately before normal configuration or route logic. With it on, exact
 * static files still pass through; afterFiles handles only missing candidates
 * before the dynamic catch-all. See maintenance-routing.ts and next.config.ts.
 *
 * Next's repeated/backslash-separator canonicalization may still precede Proxy;
 * its redirect destination must be gated too (production journey coverage).
 */
export const config = { matcher: ["/:path*"] };
