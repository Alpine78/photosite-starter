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

import {
  getContentPage,
  getContentRedirects,
  getContentTrees,
} from "@/lib/content";
import { asGalleryPage, type ContentPageSource } from "@/lib/content-page";
import { getStoryRoutePath } from "@/lib/content-routes";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getGalleryPage } from "@/lib/gallery";
import {
  resolveLocalePrefixRequest,
  type LocalePrefixRequestResolution,
  type LocalizedContentRedirects,
} from "@/lib/locale-prefix-request";
import {
  buildStoryPath,
  type LocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { defaultLocaleRouteExists } from "@/lib/public-routes";
import { isCarryableRequestPath } from "@/lib/request-path";

export type NotFoundReturn = {
  /** A parameter-free path in the locale whose route space was refused. */
  readonly href: string;
  /** That locale, so the caller can label the link in the right language. */
  readonly locale: string;
};

type GalleryReturnCandidate = NotFoundReturn & {
  readonly contentId: string;
};

type GalleryPageSource = typeof getGalleryPage;

export type NotFoundReturnSources = {
  readonly config: LocaleRouteConfig;
  readonly trees: LocalizedContentTrees;
  readonly redirects: LocalizedContentRedirects;
  readonly defaultLocaleRouteExists: (
    path: string,
  ) => boolean | Promise<boolean>;
  readonly contentPageSource: ContentPageSource;
  readonly galleryPageSource: GalleryPageSource;
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
 * This function receives an already-normalized story resolution. The caller
 * may follow one resolver-owned canonical redirect first: an invalid cursor at
 * a casing variant, redundant default prefix, or retired gallery path still
 * needs the same first-page link as one presented at the canonical spelling.
 */
function resolveGalleryReturnCandidate(
  config: LocaleRouteConfig,
  resolution: LocalePrefixRequestResolution,
  trees: LocalizedContentTrees,
): GalleryReturnCandidate | undefined {
  if (resolution.kind !== "story") return undefined;

  const { locale, route } = resolution;
  if (route.kind !== "content" || route.variant !== "gallery") return undefined;

  const tree = trees.get(locale);
  if (tree === undefined) return undefined;

  return {
    href: buildStoryPath(config, locale, getStoryRoutePath(tree, route)),
    locale,
    contentId: route.contentId,
  };
}

export function resolveGalleryReturn(
  config: LocaleRouteConfig,
  resolution: LocalePrefixRequestResolution,
  trees: LocalizedContentTrees,
): NotFoundReturn | undefined {
  const candidate = resolveGalleryReturnCandidate(config, resolution, trees);
  return candidate === undefined
    ? undefined
    : { href: candidate.href, locale: candidate.locale };
}

async function resolveRequestPath(
  requestPath: string,
  sources: NotFoundReturnSources,
): Promise<LocalePrefixRequestResolution | undefined> {
  if (!isCarryableRequestPath(requestPath)) return undefined;

  const segments = requestPath.split("/").filter((segment) => segment !== "");
  const [prefix, ...rest] = segments;
  if (prefix === undefined) return undefined;

  return resolveLocalePrefixRequest({
    config: sources.config,
    trees: sources.trees,
    redirects: sources.redirects,
    prefix,
    segments: rest,
    // The refused request's own parameters are deliberately not carried: the
    // question here is "which gallery is this", and the answer must not depend
    // on the token that was rejected.
    searchParams: {},
    defaultLocaleRouteExists: sources.defaultLocaleRouteExists,
  });
}

/**
 * Resolve and verify one honest destination for an invalid-cursor 404.
 *
 * One resolver-owned redirect may be followed because the original request can
 * be a non-canonical spelling that was refused only after its cursor failed
 * validation. The target still has to resolve to a gallery, and both the
 * content page and its parameter-free result must exist: a tree entry alone is
 * not proof that clicking the link will work.
 */
export async function resolveNotFoundReturn(
  requestPath: string,
  sources: NotFoundReturnSources,
): Promise<NotFoundReturn | undefined> {
  let resolution = await resolveRequestPath(requestPath, sources);
  if (resolution?.kind === "redirect") {
    resolution = await resolveRequestPath(resolution.location, sources);
  }

  if (resolution === undefined || resolution.kind === "redirect") {
    return undefined;
  }

  const candidate = resolveGalleryReturnCandidate(
    sources.config,
    resolution,
    sources.trees,
  );
  if (candidate === undefined) return undefined;

  const contentPage = asGalleryPage(
    candidate.contentId,
    // `resolveGalleryReturnCandidate` already checked `route.variant ===
    // "gallery"` before returning a candidate at all, so this is never a
    // guess: the hint lets a Sanity-backed source read one detail query
    // instead of both concurrently.
    await sources.contentPageSource(candidate.locale, candidate.contentId, "gallery"),
  );
  if (contentPage === undefined) return undefined;

  const firstPage = await sources.galleryPageSource(
    candidate.locale,
    candidate.contentId,
  );
  if (firstPage === undefined) return undefined;

  return { href: candidate.href, locale: candidate.locale };
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

  const { localeRoutes } = getDeploymentConfig();
  const [trees, redirects] = await Promise.all([
    getContentTrees(),
    getContentRedirects(),
  ]);

  return resolveNotFoundReturn(requestPath, {
    config: localeRoutes,
    trees,
    redirects,
    defaultLocaleRouteExists,
    contentPageSource: getContentPage,
    galleryPageSource: getGalleryPage,
  });
}
