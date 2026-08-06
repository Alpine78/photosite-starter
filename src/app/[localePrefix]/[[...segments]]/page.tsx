import { notFound, permanentRedirect } from "next/navigation";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { resolveLocalePrefixRequest } from "@/lib/locale-prefix-request";
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

export default async function LocalePrefixPage({
  params,
  searchParams,
}: LocalePrefixPageProps) {
  const [{ localePrefix, segments = [] }, resolvedSearchParams] =
    await Promise.all([params, searchParams]);
  const { localeRoutes } = getDeploymentConfig();
  const resolution = await resolveLocalePrefixRequest({
    config: localeRoutes,
    prefix: localePrefix,
    segments,
    searchParams: resolvedSearchParams,
    defaultLocaleRouteExists,
  });

  if (resolution.kind === "redirect") {
    permanentRedirect(resolution.location);
  }

  notFound();
}
