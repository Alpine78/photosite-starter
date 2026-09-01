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

import { getService } from "@/lib/services";

/**
 * Root path segments owned by application routes, public assets, and metadata
 * files. A configured locale prefix may not claim one of these, because the
 * file-system route or public file would shadow the whole locale.
 */
export const RESERVED_ROOT_SEGMENTS: readonly string[] = [
  // The contact endpoint's own segment. It serves no page, but a locale prefix
  // that claimed it would shadow a route the contact form posts to.
  "api",
  "contact",
  "favicon.ico",
  // The public directory the mock media is served from. It owns no page, but a
  // locale prefix that claimed it would shadow every image beneath it.
  "gallery",
  // The Proxy's internal rewrite target for the private client-gallery
  // namespace (`request-path.ts`). It owns real routes, so nothing else may
  // claim it — including `PRIVATE_GALLERY_ROUTE_PREFIX` itself, which
  // `deployment-config.ts` already refuses to set to a reserved segment.
  "private-gallery",
  // The link bootstrap script, served as a same-origin static file so it needs
  // no CSP grant beyond `script-src 'self'`. It carries nothing secret — the
  // capability it reads lives in the visitor's own URL fragment — and it sits
  // beside the private namespace rather than inside it, so the Proxy's
  // internal-path 404 never has to make an exception for it.
  "private-gallery-bootstrap.js",
  "services",
];

/**
 * Static visitor-facing route segments that repeat beneath every locale base.
 * Root-only compatibility routes, assets, and machine files stay out: they do
 * not compete with a story namespace beneath `/en` or another locale prefix.
 * Add `contact` here when its localized public route lands.
 */
export const RESERVED_LOCALE_ROUTE_SEGMENTS: readonly string[] = ["services"];

/**
 * Whether the unprefixed default-locale route path resolves to a page today.
 * Only exact paths count: an unknown slug beneath a known listing is a 404 in
 * the default locale too, so it must not become a redirect target.
 */
export async function defaultLocaleRouteExists(path: string): Promise<boolean> {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return true;
  if (segments.length > 2) return false;

  const [first, second] = segments;

  switch (first) {
    case "services":
      return second === undefined || (await getService(second)) !== undefined;
    case "contact":
      return second === undefined;
    default:
      return false;
  }
}
