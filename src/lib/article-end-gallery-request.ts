/** Strict canonical article target resolution for the AB#161 append endpoint. */

import { getContentPage, getContentRedirects, getContentTrees } from "@/lib/content";
import { asArticlePage, type ContentPageSource } from "@/lib/content-page";
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

export type ArticleEndGalleryRequestTarget = {
  readonly locale: string;
  readonly contentId: string;
  readonly endGalleryId: string;
};

export type ArticleEndGalleryRequestSources = {
  readonly config: LocaleRouteConfig;
  readonly trees: LocalizedContentTrees;
  readonly redirects: LocalizedContentRedirects;
  readonly defaultLocaleRouteExists: (path: string) => boolean | Promise<boolean>;
  readonly contentPageSource: ContentPageSource;
};

export async function resolveArticleEndGalleryRequestTargetFromSources(
  path: string,
  sources: ArticleEndGalleryRequestSources,
): Promise<ArticleEndGalleryRequestTarget | undefined> {
  if (!isCarryableRequestPath(path)) return undefined;
  const segments = path.split("/").filter(Boolean);
  const [prefix, ...rest] = segments;
  if (prefix === undefined) return undefined;
  const resolution = await resolveLocalePrefixRequest({
    config: sources.config,
    trees: sources.trees,
    redirects: sources.redirects,
    prefix,
    segments: rest,
    searchParams: {},
    defaultLocaleRouteExists: sources.defaultLocaleRouteExists,
  });
  if (
    resolution.kind !== "story" ||
    resolution.route.kind !== "content" ||
    resolution.route.variant !== "article"
  ) {
    return undefined;
  }
  const { locale, route } = resolution;
  const tree = sources.trees.get(locale);
  if (tree === undefined) return undefined;
  const canonicalPath = buildStoryPath(
    sources.config,
    locale,
    getStoryRoutePath(tree, route),
  );
  if (path !== canonicalPath) return undefined;
  const page = asArticlePage(
    route.contentId,
    await sources.contentPageSource(locale, route.contentId, "article"),
  );
  if (page?.endGalleryId === undefined) return undefined;
  return { locale, contentId: route.contentId, endGalleryId: page.endGalleryId };
}

export async function resolveArticleEndGalleryRequestTarget(
  path: string,
): Promise<ArticleEndGalleryRequestTarget | undefined> {
  const { localeRoutes } = getDeploymentConfig();
  const [trees, redirects] = await Promise.all([
    getContentTrees(),
    getContentRedirects(),
  ]);
  return resolveArticleEndGalleryRequestTargetFromSources(path, {
    config: localeRoutes,
    trees,
    redirects,
    defaultLocaleRouteExists,
    contentPageSource: getContentPage,
  });
}
