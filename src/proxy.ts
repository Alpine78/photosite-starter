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
  isPrivateGalleryInternalPath,
  isPrivateRequestPath,
  privateGalleryInternalPath,
  readRequestPath,
} from "@/lib/request-path";

/**
 * ADR-0014 §6's response-hygiene headers for the reserved private client-gallery
 * namespace. ADR-0014 §9 makes this the Proxy's rule, not `next.config.ts`'s:
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
const PRIVATE_HYGIENE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

function withPrivateHygieneHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(PRIVATE_HYGIENE_HEADERS)) {
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
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;
  const hasCursor = request.nextUrl.searchParams.has("cursor");
  const hasSection = request.nextUrl.searchParams.has("section");
  const hasTrailingSlash = pathname.length > 1 && pathname.endsWith("/");

  // The reserved private client-gallery namespace (ADR-0014 §9). Its prefix is
  // validated and reserved by `loadDeploymentConfig` — including against a
  // legacy-redirect root — so a private path is never also a legacy path, and
  // the legacy lookup below is skipped for it. Every response the Proxy returns
  // for such a path carries §6's hygiene headers.
  const privateRoutePrefix = getDeploymentConfig().privateGallery.routePrefix;

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
    // do not (see `PRIVATE_HYGIENE_HEADERS` above).
    return withPrivateHygieneHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
    );
  }

  const privatePath = isPrivateRequestPath(pathname, privateRoutePrefix);

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
  const legacyOutcome = privatePath
    ? undefined
    : resolveLegacyRedirect(LEGACY_REDIRECTS, pathname);
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
    const redirect = NextResponse.redirect(destination, 308);
    return privatePath ? withPrivateHygieneHeaders(redirect) : redirect;
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

  if (!privatePath) {
    return NextResponse.next({ request: { headers: requestHeaders } });
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
  return withPrivateHygieneHeaders(
    NextResponse.rewrite(target, { request: { headers: requestHeaders } }),
  );
}

/**
 * Routes that need the request boundary, restored slash normalization, or a
 * private-namespace response header (ADR-0014 §6).
 *
 * The negative lookahead excludes exactly the paths that need none of those:
 *
 * - `_next/` — Next's own build output and optimizer.
 * - `gallery/` — the only directory in `public/`; every real URL under it is a
 *   versioned image derivative served as a static file (`next.config.ts`).
 * - `[^/]+\.[^/]+$` — a **root-level** file with an extension (`favicon.ico`,
 *   `robots.txt`, `sitemap.xml`). The bound is deliberately a single segment:
 *   an earlier form excluded *any* dotted last segment, which also skipped a
 *   deep path like `/<private-prefix>/<handle>/preview.jpg` and left it without
 *   §6's headers. A Next.js matcher value must be a build-time constant, so the
 *   configurable `PRIVATE_GALLERY_ROUTE_PREFIX` cannot be named here; making the
 *   pattern prefix-independent — it matches every deep dotted path, then
 *   `isPrivateRequestPath` classifies it at request time — covers a custom
 *   prefix as well as the default.
 *
 * The widening only adds the Proxy's O(1) pass to deep dotted paths the
 * application defines no route for (they 404 either way); `public/` has no such
 * files. API routes stay matched so disabling Next's built-in slash redirect
 * does not turn `/api/x/` from a 308 into a 404.
 *
 * **Framework limitation, not this slice's:** a URL with a repeated separator
 * (`/private//handle`, `//private/x`) gets a bare `308` to the collapsed form
 * from `resolveRoutes` in Next 16.3.2 *before* the Proxy or this matcher runs,
 * so that one redirect carries neither §6's headers nor the site-wide security
 * headers. It is not decoratable at the application layer (`skipMiddlewareUrlNormalize`
 * does not move it, verified). The impact is bounded: the target is the clean,
 * fully-protected private URL, and `robots.txt`'s `Disallow: /<prefix>/` still
 * covers the malformed form. `/api/contact` — the existing endpoint that
 * handles PII, has the identical property today, so this is a project-wide
 * item, not a private-namespace regression. The concrete future fix is an
 * edge-level `vercel.json` `headers` rule (a different layer that also decorates
 * framework redirects), decided with the live-edge verification a later slice
 * runs (ADR-0011 §, ADR-0014 §6).
 */
export const config = {
  matcher: ["/((?!_next/|gallery/|[^/]+\\.[^/]+$).*)"],
};
