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
 * Home and contact still exist only in the unprefixed default-locale space.
 * Services are different: each configured locale contributes its own service
 * namespace and only its published service documents. The public content tree
 * is likewise authored per locale, so it is walked once per configured locale
 * that actually publishes a tree — a configured locale may publish none yet,
 * and that locale's story routes 404 rather than existing, so nothing is
 * emitted for it. A tree with no public category gets the same treatment:
 * `resolveStoryRoute` 404s that state too.
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
  buildServicePath,
  buildStoryPath,
  type LocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { getServiceRoutes } from "@/lib/services";
import type { ResolvedService } from "@/lib/service-routes";

/** Static pages that exist only in the unprefixed default-locale route space. */
const STATIC_PATHS: readonly string[] = ["/", "/contact"];

export class SitemapPathCollisionError extends Error {
  constructor(path: string) {
    super(`sitemap path "${path}" was generated more than once`);
    this.name = "SitemapPathCollisionError";
  }
}

export type SitemapSourceData = {
  readonly localeRoutes: LocaleRouteConfig;
  readonly trees: LocalizedContentTrees;
  /** Resolved, same-language service paths by configured locale. */
  readonly serviceRoutes: ReadonlyMap<string, readonly ResolvedService[]>;
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

  for (const route of data.localeRoutes.locales) {
    const services = data.serviceRoutes.get(route.locale) ?? [];
    if (services.length > 0) {
      paths.push(buildServicePath(data.localeRoutes, route.locale));
      for (const service of services) {
        paths.push(
          buildServicePath(data.localeRoutes, route.locale, service.path),
        );
      }
    }

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
  const [trees, serviceEntries] = await Promise.all([
    getContentTrees(),
    Promise.all(
      localeRoutes.locales.map(async (route) => [
        route.locale,
        await getServiceRoutes(route.locale),
      ] as const),
    ),
  ]);

  return buildSitemapPaths({
    localeRoutes,
    trees,
    serviceRoutes: new Map(serviceEntries),
  });
}
