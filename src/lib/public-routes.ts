/**
 * The default-locale routes this application serves, as data.
 *
 * Next.js resolves routes from the file system and cannot be asked whether a
 * path exists, so the two rules that need that answer read it here:
 *
 * - ADR-0003 reserves every configured locale prefix at the root, which
 *   requires knowing which root segments the application already owns; and
 * - a redundant default-locale prefix (`/fi/...`) redirects permanently only
 *   when the corresponding unprefixed route exists, and otherwise 404s.
 *
 * This registry is deliberately narrow: it answers "does this path resolve
 * today", not "how is it rendered", and it covers only the *static* routes. The
 * story namespace answers from the content tree instead, inside
 * `locale-prefix-request.ts`, because a category path and a canonical content
 * path are data rather than file-system routes. Each remaining route story
 * extends one of the two as it lands. A route missing from both is not a broken
 * page: it only means a redundantly prefixed request to it 404s instead of
 * redirecting.
 *
 * `/portfolio` is deliberately absent. AB#104 moved the curated gallery into the
 * content tree, and ADR-0003's 2026-08-10 amendment removes such a route rather
 * than redirecting it: it was never deployed, published, or indexed, so nobody
 * holds the URL, and only the verified production inventory (AB#19) earns a
 * redirect. The site chrome now reaches that gallery by its content identity.
 */

import { getDeploymentConfig } from "@/lib/deployment-config";
import { getService, getServiceRoute } from "@/lib/services";

/**
 * Root path segments owned by application routes, public assets, and metadata
 * files. A configured locale prefix may not claim one of these, because the
 * file-system route or public file would shadow the whole locale.
 */
export const RESERVED_ROOT_SEGMENTS: readonly string[] = [
  // The contact endpoint's own segment. It serves no page, but a locale prefix
  // that claimed it would shadow a route the contact form posts to.
  "api",
  "client-gallery",
  // The proof gallery namespace (ADR-0038), beside the delivery one.
  "client-proof",
  "contact",
  "favicon.ico",
  // The public directory the mock media is served from. It owns no page, but a
  // locale prefix that claimed it would shadow every image beneath it.
  "gallery",
  // Retired with the protected client-gallery routes (AB#313): the two literal
  // segments those routes lived under and the link bootstrap script beside
  // them. Nothing is served there now. They stay reserved so no locale prefix,
  // story namespace or configured prefix can take an address the protected
  // model once used; the Proxy answers the two segments with a hygienic 404.
  "private-gallery",
  "private-gallery-bootstrap.js",
  "private-gallery-admin",
  "services",
];

/**
 * Static visitor-facing route segments that repeat beneath every locale base.
 * Root-only compatibility routes, assets, and machine files stay out: they do
 * not compete with a story namespace beneath `/en` or another locale prefix.
 * Home occupies the empty path; contact occupies its fixed segment.
 */
export const RESERVED_LOCALE_ROUTE_SEGMENTS: readonly string[] = ["services", "contact", "client-gallery", "client-proof"];

/**
 * Whether the unprefixed default-locale route path resolves to a page today.
 * Only exact paths count: an unknown slug beneath a known listing is a 404 in
 * the default locale too, so it must not become a redirect target.
 */
export async function defaultLocaleRouteExists(path: string): Promise<boolean> {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    const { getStaticPageData } = await import("@/lib/static-pages");
    return await getStaticPageData("home", getDeploymentConfig().localeRoutes.defaultLocale) !== undefined;
  }

  const [first, second] = segments;
  const { localeRoutes } = getDeploymentConfig();
  const defaultRoute = localeRoutes.locales.find((route) => route.isDefault);
  if (defaultRoute === undefined) {
    throw new Error("the locale configuration has no default route");
  }

  if (first === defaultRoute.serviceNamespace) {
    const serviceSegments = segments.slice(1);
    return (
      serviceSegments.length === 0 ||
      (await getServiceRoute(serviceSegments, defaultRoute.locale)) !== undefined
    );
  }

  // The search page (ADR-0033) is a fixed page with no sub-paths: it exists
  // for exactly its own namespace, whatever the query string says.
  if (first === defaultRoute.searchNamespace) return segments.length === 1;

  if (segments.length > 2) return false;

  switch (first) {
    case "services":
      return second === undefined || (await getService(second)) !== undefined;
    case "contact": {
      if (second !== undefined) return false;
      const { getStaticPageData } = await import("@/lib/static-pages");
      return await getStaticPageData("contact", defaultRoute.locale) !== undefined;
    }
    default:
      return false;
  }
}
