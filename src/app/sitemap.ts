import type { MetadataRoute } from "next";

import { getDeploymentConfig } from "@/lib/deployment-config";
import { loadSitemapPaths } from "@/lib/sitemap";

/**
 * Next.js caches a metadata-route file like this one by default, generating
 * it once at build time. That is wrong here: `loadSitemapPaths` reads the
 * same content seam route pages do, and the AB#83 freshness target requires
 * this list to reflect a publish, unpublish, or slug change the same way
 * those pages do — not a frozen build-time snapshot. `force-dynamic` makes
 * this route re-derive on every request instead.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { canonicalBaseUrl } = getDeploymentConfig();
  const paths = await loadSitemapPaths();

  return paths.map((path) => ({
    url: new URL(path, canonicalBaseUrl).toString(),
  }));
}
