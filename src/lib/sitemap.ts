/**
 * Every public, indexable, parameter-free route path this deployment serves,
 * for `src/app/sitemap.ts` to turn into absolute sitemap entries.
 *
 * `buildSitemapPaths` is pure and takes exactly the data route pages already
 * resolve through `content.ts`, `deployment-config.ts`, and `services.ts` —
 * so a route that is not public, renderable, and indexable there is not
 * public, renderable, and indexable here either. Cursor and section URLs
 * never enter this list because they are not category-tree or static-page
 * identities at all (ADR-0003 decision 8): the gallery/category route layer
 * is the only place those exist, and nothing here reads it.
 *
 * `loadSitemapPaths` is the thin, singleton-composing wrapper `sitemap.ts`
 * calls; like `content.ts`'s own accessors, it is exercised through the
 * production build rather than unit-tested directly.
 *
 * Only unprefixed static pages exist today (home, contact, services): no
 * configured locale has its own localized versions of them yet. The public
 * content tree is authored per locale, so it is walked once per configured
 * locale that actually publishes a tree — a configured locale may publish
 * none yet, and that locale's story routes 404 rather than existing, so
 * nothing is emitted for it. A tree that publishes no public category at all
 * gets the same treatment: `resolveStoryRoute` 404s that state too.
 *
 * A tree-canonical placement's underlying detail record could in principle
 * still be missing (`resolveGalleryPage`'s documented "a content-tree record
 * with no matching source row" case) — this module does not re-verify each
 * one through `getContentPage` or a gallery result before listing its path,
 * the same way `content.ts`'s own listing-record query does not: both trust
 * the tree's `published` + canonical-placement state as the boundary's single
 * source of truth, rather than loading a body (or a full gallery page) per
 * candidate just to confirm it. Fetching every canonical page's full record
 * to build a URL list would be the exact "a listing loads a body" pattern
 * `mock-content-pages.ts` and `content-listing.ts` deliberately reject
 * elsewhere; a genuine drift here is a data-integrity defect the Sanity
 * publish-time validators (`article-validation.ts` and friends) are the
 * intended place to catch, not a per-read sitemap check.
 */

import { getContentTrees } from "@/lib/content";
import { listPublicRoutePaths } from "@/lib/content-tree";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  buildStoryPath,
  type LocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { getServices, type Service } from "@/lib/services";

/** Static pages that exist only in the unprefixed default-locale route space. */
const STATIC_PATHS: readonly string[] = ["/", "/contact", "/services"];

export class SitemapPathCollisionError extends Error {
  constructor(path: string) {
    super(`sitemap path "${path}" was generated more than once`);
    this.name = "SitemapPathCollisionError";
  }
}

export type SitemapSourceData = {
  readonly localeRoutes: LocaleRouteConfig;
  readonly trees: LocalizedContentTrees;
  readonly services: readonly Pick<Service, "slug">[];
};

/**
 * Every relative, parameter-free path the sitemap should list, exactly once,
 * sorted for deterministic output.
 *
 * Throws rather than silently deduplicating: two inputs claiming the same
 * path is an upstream defect (e.g. a duplicate service slug) to surface, not
 * a normal state to paper over — the same posture `content-tree.ts` already
 * takes toward its own structural invariants.
 */
export function buildSitemapPaths(
  data: SitemapSourceData,
): readonly string[] {
  const paths: string[] = [...STATIC_PATHS];
  for (const service of data.services) {
    paths.push(`/services/${service.slug}`);
  }

  for (const route of data.localeRoutes.locales) {
    const tree = data.trees.get(route.locale);
    if (tree === undefined) continue;

    // A story root with no public category resolves to nothing:
    // `resolveStoryRoute` 404s a locale that publishes a tree with nothing in
    // it yet, the same normal, non-error authoring state a locale absent from
    // `trees` altogether is.
    if (tree.publicCategoryIds.size > 0) {
      paths.push(buildStoryPath(data.localeRoutes, route.locale));
    }
    for (const routePath of listPublicRoutePaths(tree)) {
      paths.push(
        buildStoryPath(data.localeRoutes, route.locale, routePath.segments),
      );
    }
  }

  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) throw new SitemapPathCollisionError(path);
    seen.add(path);
  }

  return [...paths].sort();
}

export async function loadSitemapPaths(): Promise<readonly string[]> {
  const { localeRoutes } = getDeploymentConfig();
  const [trees, services] = await Promise.all([
    getContentTrees(),
    getServices(),
  ]);

  return buildSitemapPaths({ localeRoutes, trees, services });
}
