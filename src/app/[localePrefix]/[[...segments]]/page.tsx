import { notFound, permanentRedirect } from "next/navigation";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { resolvePrefixedRoute } from "@/lib/locale-routes";
import { defaultLocaleRouteExists } from "@/lib/public-routes";

/**
 * The locale-prefixed route space.
 *
 * Static routes win over this dynamic segment, so it only sees paths the
 * default locale's own routes did not claim. Three outcomes, all decided by
 * the locale route contract:
 *
 * - the redundant default-locale prefix (`/fi/...`) redirects permanently to
 *   the unprefixed canonical path, but only when that exact route exists;
 * - a configured non-default locale prefix (`/en/...`) opens that locale's
 *   route space, which currently publishes no pages; and
 * - anything else is an ordinary unknown path.
 *
 * The last two both end in an accessible 404: an unresolved localized path
 * says so rather than redirecting a visitor into another language.
 */

type LocalePrefixPageProps = {
  params: Promise<{ localePrefix: string; segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Carries the incoming query across the redirect unchanged. A visitor's
 * campaign parameters, and later a gallery's section and cursor state, are
 * part of the request they made; normalizing the path is not a reason to drop
 * them.
 */
function buildQueryString(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) {
      params.append(name, single);
    }
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

export default async function LocalePrefixPage({
  params,
  searchParams,
}: LocalePrefixPageProps) {
  const { localePrefix, segments = [] } = await params;
  const { localeRoutes } = getDeploymentConfig();
  const resolution = resolvePrefixedRoute(localeRoutes, localePrefix, segments);

  if (
    resolution.kind === "redundant-default-prefix" &&
    (await defaultLocaleRouteExists(resolution.canonicalPath))
  ) {
    permanentRedirect(
      `${resolution.canonicalPath}${buildQueryString(await searchParams)}`,
    );
  }

  notFound();
}
