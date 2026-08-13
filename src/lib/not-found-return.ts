/**
 * Where a 404 can honestly offer to send the visitor.
 *
 * ADR-0003 decision 8 requires the 404 for an invalid gallery cursor to carry a
 * link to that gallery's parameter-free first page. The refused address arrives
 * as a request header (ADR-0007); this turns it into a link, or into nothing.
 *
 * "Or into nothing" is the important half. A link is offered only when the path
 * resolves, through the real route resolver, to a published gallery this
 * deployment serves. An address nothing knows anything about gets the bare 404
 * it already got, because a guessed destination is worse than none: it would
 * lead from one 404 to another.
 *
 * Why a gallery and nothing else: a gallery is the only route that issues a
 * continuation token, so it is the only one whose *resolvable* path can 404 at
 * all. A category or article path that resolves does not 404, so a link there
 * would never be reached; one that does not resolve is the unknown case above.
 */

import { getContentRedirects, getContentTrees } from "@/lib/content";
import { getStoryRoutePath } from "@/lib/content-routes";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  resolveLocalePrefixRequest,
  type LocalePrefixRequestResolution,
} from "@/lib/locale-prefix-request";
import {
  buildStoryPath,
  type LocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { defaultLocaleRouteExists } from "@/lib/public-routes";

export type NotFoundReturn = {
  /** A parameter-free path in the locale whose route space was refused. */
  readonly href: string;
  /** That locale, so the caller can label the link in the right language. */
  readonly locale: string;
};

/**
 * The gallery a refused path names, if it names one.
 *
 * The path is split the way the dynamic route receives it — first segment as
 * the locale prefix, the rest as segments — and handed to the same resolver the
 * route itself uses. Reusing it rather than reimplementing the walk is the point:
 * casing, the redundant default prefix, retired paths, and namespace reservation
 * all behave here exactly as they do when the page renders, and cannot drift
 * apart later.
 *
 * A path that resolves to a redirect rather than a page yields no link. It is
 * not a 404 in the first place, so arriving here with one means the request was
 * refused for some other reason, and the redirect target is not evidence about
 * that reason.
 */
export function resolveGalleryReturn(
  config: LocaleRouteConfig,
  resolution: LocalePrefixRequestResolution,
  trees: LocalizedContentTrees,
): NotFoundReturn | undefined {
  if (resolution.kind !== "story") return undefined;

  const { locale, route } = resolution;
  if (route.kind !== "content" || route.variant !== "gallery") return undefined;

  const tree = trees.get(locale);
  if (tree === undefined) return undefined;

  return {
    href: buildStoryPath(config, locale, getStoryRoutePath(tree, route)),
    locale,
  };
}

/**
 * The link this request's 404 should offer, resolved from the refused path.
 *
 * `requestPath` is what the Proxy carried, already validated by the reader in
 * `request-path.ts`. Absent — an excluded route, or a deployment whose Proxy did
 * not run — there is nothing to resolve and the 404 stays bare.
 */
export async function getNotFoundReturn(
  requestPath: string | undefined,
): Promise<NotFoundReturn | undefined> {
  if (requestPath === undefined) return undefined;

  const segments = requestPath.split("/").filter((segment) => segment !== "");
  const [prefix, ...rest] = segments;
  if (prefix === undefined) return undefined;

  const { localeRoutes } = getDeploymentConfig();
  const [trees, redirects] = await Promise.all([
    getContentTrees(),
    getContentRedirects(),
  ]);

  const resolution = await resolveLocalePrefixRequest({
    config: localeRoutes,
    trees,
    redirects,
    prefix,
    segments: rest,
    // The refused request's own parameters are deliberately not carried: the
    // question here is "which gallery is this", and the answer must not depend
    // on the token that was rejected.
    searchParams: {},
    defaultLocaleRouteExists,
  });

  return resolveGalleryReturn(localeRoutes, resolution, trees);
}
