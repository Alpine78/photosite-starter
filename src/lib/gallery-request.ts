/**
 * Which gallery a public path names.
 *
 * The continuation endpoint is addressed by the same canonical path the visitor
 * is already on, not by a content id. That keeps an internal identity out of the
 * browser, and it means the endpoint can only ever be pointed at a route this
 * deployment actually publishes: the path goes through the *same* resolver the
 * page render uses, so casing, locale prefixes, reserved namespaces, and retired
 * paths all behave identically in both places and cannot drift apart.
 *
 * Deliberately strict about spelling. Unlike the 404's return link, this follows
 * no redirect: the caller is the page itself, quoting the canonical address it
 * was rendered at, so anything else is a request the site never generated.
 */

import { getContentPage, getContentRedirects, getContentTrees } from "@/lib/content";
import { asGalleryPage, type ContentPageSource } from "@/lib/content-page";
import { getStoryRoutePath } from "@/lib/content-routes";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  resolveLocalePrefixRequest,
  type LocalizedContentRedirects,
} from "@/lib/locale-prefix-request";
import {
  buildStoryPath,
  type LocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { defaultLocaleRouteExists } from "@/lib/public-routes";
import { isCarryableRequestPath } from "@/lib/request-path";

export type GalleryRequestTarget = {
  readonly locale: string;
  readonly contentId: string;
};

export type GalleryRequestSources = {
  readonly config: LocaleRouteConfig;
  readonly trees: LocalizedContentTrees;
  readonly redirects: LocalizedContentRedirects;
  readonly defaultLocaleRouteExists: (
    path: string,
  ) => boolean | Promise<boolean>;
  readonly contentPageSource: ContentPageSource;
};

/**
 * The gallery this path publishes, or `undefined` when it publishes none.
 *
 * `undefined` covers every way a request can fail to name one — an unusable
 * path, an unknown route, a non-canonical spelling, a category, an article, or a
 * gallery whose page this locale does not serve. The caller answers all of them
 * the same way, because distinguishing them would tell an unauthenticated client
 * which internal state it had reached.
 */
export async function resolveGalleryRequestTargetFromSources(
  path: string,
  sources: GalleryRequestSources,
): Promise<GalleryRequestTarget | undefined> {
  if (!isCarryableRequestPath(path)) return undefined;

  const segments = path.split("/").filter((segment) => segment !== "");
  const [prefix, ...rest] = segments;
  if (prefix === undefined) return undefined;

  const resolution = await resolveLocalePrefixRequest({
    config: sources.config,
    trees: sources.trees,
    redirects: sources.redirects,
    prefix,
    segments: rest,
    // The continuation token travels in its own parameter and is validated by
    // the adapter, so the routing question here is only "which gallery".
    searchParams: {},
    defaultLocaleRouteExists: sources.defaultLocaleRouteExists,
  });

  if (resolution.kind !== "story") return undefined;

  const { locale, route } = resolution;
  if (route.kind !== "content" || route.variant !== "gallery") return undefined;

  const tree = sources.trees.get(locale);
  if (tree === undefined) return undefined;

  // Resolution alone is deliberately not enough. Empty path segments are not
  // identities, so the route resolver may collapse a trailing or repeated
  // slash while identifying the same content. The endpoint is called only by
  // a page quoting its own canonical path; comparing against the path rebuilt
  // from the resolved identity rejects every spelling the site never emitted.
  const canonicalPath = buildStoryPath(
    sources.config,
    locale,
    getStoryRoutePath(tree, route),
  );
  if (path !== canonicalPath) return undefined;

  // The same second lock the page render applies: the tree says gallery, and the
  // source has to agree before anything is served under that identity.
  const page = asGalleryPage(
    route.contentId,
    await sources.contentPageSource(locale, route.contentId),
  );
  if (page === undefined) return undefined;

  return { locale, contentId: route.contentId };
}

/** Resolves a gallery request against this deployment's real public sources. */
export async function resolveGalleryRequestTarget(
  path: string,
): Promise<GalleryRequestTarget | undefined> {
  const { localeRoutes } = getDeploymentConfig();
  const [trees, redirects] = await Promise.all([
    getContentTrees(),
    getContentRedirects(),
  ]);

  return resolveGalleryRequestTargetFromSources(path, {
    config: localeRoutes,
    trees,
    redirects,
    defaultLocaleRouteExists,
    contentPageSource: getContentPage,
  });
}
