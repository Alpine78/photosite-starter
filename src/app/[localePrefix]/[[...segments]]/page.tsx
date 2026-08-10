import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { CategoryBranch } from "@/components/category-branch";
import { ContentArticle } from "@/components/content-article";
import type { BreadcrumbStep } from "@/components/breadcrumbs";
import type { LanguageLink } from "@/components/language-switch";
import {
  getAdjacentContent,
  getCategoryListing,
  getContentPage,
  getContentRedirects,
  getContentTrees,
} from "@/lib/content";
import { asArticlePage, type ArticleContentPage } from "@/lib/content-page";
import {
  getStoryRoutePath,
  getStoryRouteTrail,
  listStoryRootVersions,
  toContentLocation,
  type StoryRoute,
} from "@/lib/content-routes";
import type { ContentTree } from "@/lib/content-tree";
import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { resolveLocalePrefixRequest } from "@/lib/locale-prefix-request";
import {
  buildStoryPath,
  listPublishedLocaleVersions,
  resolveLanguageSwitch,
  type LocaleRouteConfig,
  type LocaleVersion,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";
import { getPageMetadata } from "@/lib/page-metadata";
import { defaultLocaleRouteExists } from "@/lib/public-routes";

/**
 * The locale-prefixed route space and everything the unprefixed static routes
 * did not claim.
 *
 * Static routes win over this dynamic segment, so what arrives here is the
 * public content tree — `<locale-base>/<story-namespace>/<category-path>` and
 * the canonical `.../<content-slug>` detail beneath it, in every configured
 * locale — plus the paths that resolve to a permanent redirect or to nothing at
 * all. `locale-prefix-request.ts` makes that decision; this file renders the
 * branch or page it names.
 *
 * Only the `article` variant renders so far. AB#104 owns the curated gallery
 * route, which needs the shared paginated result contract rather than a body
 * alone, so `content-routes.ts` keeps a gallery's canonical path outside the
 * route space entirely and it answers 404 — the same answer it gave before this
 * route existed, and no redirect ever points at it.
 */

type LocalePrefixPageProps = {
  params: Promise<{ localePrefix: string; segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResolvedRequest = Awaited<ReturnType<typeof resolveRequest>>;

async function resolveRequest({ params, searchParams }: LocalePrefixPageProps) {
  const [{ localePrefix, segments = [] }, resolvedSearchParams] =
    await Promise.all([params, searchParams]);
  const { localeRoutes } = getDeploymentConfig();
  const [trees, redirects] = await Promise.all([
    getContentTrees(),
    getContentRedirects(),
  ]);

  return {
    config: localeRoutes,
    trees,
    resolution: await resolveLocalePrefixRequest({
      config: localeRoutes,
      trees,
      redirects,
      prefix: localePrefix,
      segments,
      searchParams: resolvedSearchParams,
      defaultLocaleRouteExists,
    }),
  };
}

/**
 * The article a content route names, or `undefined` when this locale publishes
 * no body for it — a defect the fixture tests guard against rather than a state
 * a visitor should reach, so the route answers 404 rather than a blank page.
 *
 * `asArticlePage` also re-checks the variant and identity of what the source
 * returned. The resolver already keeps unrendered variants out of the route
 * space, so this is the second lock: an adapter that answered with a different
 * page must not publish it at this canonical URL.
 */
async function resolveArticle(
  locale: string,
  route: StoryRoute,
): Promise<ArticleContentPage | undefined> {
  if (route.kind !== "content") return undefined;
  return asArticlePage(
    route.contentId,
    await getContentPage(locale, route.contentId),
  );
}

function branchTitle(
  tree: ContentTree,
  route: StoryRoute,
  storyRootLabel: string,
): string {
  if (route.kind !== "category") return storyRootLabel;
  return tree.categories.get(route.categoryId)?.label ?? storyRootLabel;
}

/**
 * Every published locale version of this route, which is what `hreflang` and
 * `x-default` name. A category or content page is identified by its immutable
 * id; the story root is the namespace itself, so its versions are the locales
 * publishing a tree with something in it.
 */
function listRouteVersions(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
  route: StoryRoute,
): readonly LocaleVersion[] {
  const location = toContentLocation(route);
  return location === null
    ? listStoryRootVersions(config, trees)
    : listPublishedLocaleVersions(config, trees, location);
}

/**
 * The language's own name, read in that language. `Intl` supplies it, so adding
 * a locale never means adding a translated label to the codebase; an ICU build
 * that has no name for it falls back to the tag itself rather than to ours.
 */
function languageName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}

/**
 * Where an explicit language switch leads from this route.
 *
 * Only locales that actually publish a usable tree are offered, and a target
 * that has no version of this exact page says which nearer one it opens
 * instead — ADR-0003 decision 7 requires the switch to communicate that rather
 * than silently changing what the visitor is looking at.
 */
function buildLanguageLinks(
  { config, trees }: Pick<ResolvedRequest, "config" | "trees">,
  locale: string,
  route: StoryRoute,
  labels: ReturnType<typeof getBuiltInLabels>,
): readonly LanguageLink[] {
  const publishing = listStoryRootVersions(config, trees);
  const location = toContentLocation(route);

  return publishing.flatMap((version) => {
    if (version.locale === locale) return [];
    if (location === null) {
      return [
        {
          locale: version.locale,
          label: languageName(version.locale),
          href: version.path,
        },
      ];
    }

    const target = resolveLanguageSwitch(
      config,
      trees,
      { locale, location },
      version.locale,
    );
    if (target.kind === "unknown-locale") return [];

    return [
      {
        locale: target.locale,
        label: languageName(target.locale),
        href: target.path,
        ...(target.kind === "parent-category"
          ? { note: labels.contentTree.parentCategoryFallback }
          : target.kind === "story-root"
            ? { note: labels.contentTree.storyRootFallback }
            : {}),
      },
    ];
  });
}

/**
 * Story root first, then canonical ancestry, then the page itself. The last
 * step is the current page and carries no link.
 */
function buildBreadcrumbs(
  config: LocaleRouteConfig,
  tree: ContentTree,
  locale: string,
  route: StoryRoute,
  labels: ReturnType<typeof getBuiltInLabels>,
  pageTitle?: string,
): readonly BreadcrumbStep[] {
  const trail = getStoryRouteTrail(tree, route);
  const steps: BreadcrumbStep[] = [
    { label: labels.pages.stories, href: buildStoryPath(config, locale) },
    ...trail.map((step) => ({
      label: step.label,
      href: buildStoryPath(config, locale, step.path),
    })),
  ];

  if (pageTitle !== undefined) {
    steps.push({ label: pageTitle });
  } else {
    // A category is its own last step, so it links nowhere.
    const last = steps[steps.length - 1];
    steps[steps.length - 1] = { label: last.label };
  }

  return steps;
}

export async function generateMetadata(
  props: LocalePrefixPageProps,
): Promise<Metadata> {
  const { config, trees, resolution } = await resolveRequest(props);
  // A redirect or an unknown path claims no canonical URL of its own and keeps
  // the site-level defaults.
  if (resolution.kind !== "story") return {};

  const tree = trees.get(resolution.locale);
  if (tree === undefined) return {};

  const { locale, route } = resolution;
  const article = await resolveArticle(locale, route);
  if (route.kind === "content" && article === undefined) return {};

  const path = buildStoryPath(config, locale, getStoryRoutePath(tree, route));
  const localeVersions = listRouteVersions(config, trees, route);

  if (article === undefined) {
    return getPageMetadata({
      path,
      title: branchTitle(tree, route, getBuiltInLabels(locale).pages.stories),
      locale,
      localeVersions,
    });
  }

  return getPageMetadata({
    path,
    title: article.title,
    ...(article.summary === undefined ? {} : { description: article.summary }),
    ...(article.cover === undefined ? {} : { image: article.cover }),
    publishedTime: article.publishedAt,
    locale,
    localeVersions,
  });
}

export default async function LocalePrefixPage(props: LocalePrefixPageProps) {
  const { config, trees, resolution } = await resolveRequest(props);

  if (resolution.kind === "redirect") {
    permanentRedirect(resolution.location);
  }
  if (resolution.kind !== "story") {
    notFound();
  }

  const { locale, route } = resolution;
  const tree = trees.get(locale);
  if (tree === undefined) {
    notFound();
  }

  const labels = getBuiltInLabels(locale);
  const languages = buildLanguageLinks(
    { config, trees },
    locale,
    route,
    labels,
  );

  if (route.kind === "content") {
    const article = await resolveArticle(locale, route);
    if (article === undefined) {
      notFound();
    }

    // Two bounded rows, not the article set: `getAdjacentContent` asks the
    // adapter for the neighbours either side of this page in the global
    // publication order the pre-migration article route already used.
    const { previous, next } = await getAdjacentContent(locale, route.contentId);

    return (
      <ContentArticle
        locale={locale}
        page={article}
        breadcrumbs={buildBreadcrumbs(
          config,
          tree,
          locale,
          route,
          labels,
          article.title,
        )}
        languages={languages}
        {...(previous === undefined
          ? {}
          : {
              previous: {
                title: previous.title,
                href: buildStoryPath(config, locale, previous.path),
              },
            })}
        {...(next === undefined
          ? {}
          : {
              next: {
                title: next.title,
                href: buildStoryPath(config, locale, next.path),
              },
            })}
        labels={labels}
      />
    );
  }

  const listing = await getCategoryListing(
    locale,
    route.kind === "category" ? route.categoryId : null,
  );
  const isStoryRoot = route.kind === "story-root";

  return (
    <CategoryBranch
      locale={locale}
      title={branchTitle(tree, route, labels.pages.stories)}
      {...(isStoryRoot
        ? { introduction: labels.contentTree.storyRootIntroduction }
        : {})}
      breadcrumbs={
        route.kind === "category"
          ? buildBreadcrumbs(config, tree, locale, route, labels)
          : undefined
      }
      languages={languages}
      childCategories={listing.childCategories.map((category) => ({
        categoryId: category.categoryId,
        label: category.label,
        href: buildStoryPath(config, locale, category.path),
      }))}
      content={listing.content.map((entry) => ({
        contentId: entry.contentId,
        title: entry.title,
        ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        publishedAt: entry.publishedAt,
        ...(entry.cover === undefined ? {} : { cover: entry.cover }),
        href: buildStoryPath(config, locale, entry.path),
      }))}
      contentHeading={
        isStoryRoot
          ? labels.contentTree.latestContent
          : labels.contentTree.content
      }
      labels={labels}
    />
  );
}
