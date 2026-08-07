import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  CategoryBranch,
  type BranchLanguageLink,
} from "@/components/category-branch";
import type { BreadcrumbStep } from "@/components/breadcrumbs";
import {
  getCategoryListing,
  getContentRedirects,
  getContentTrees,
} from "@/lib/content";
import {
  getCategoryTrail,
  listStoryRootVersions,
  type StoryRoute,
} from "@/lib/content-routes";
import { getCategoryPath, type ContentTree } from "@/lib/content-tree";
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
 * public content tree — `<locale-base>/<story-namespace>/<category-path>` in
 * every configured locale — plus the paths that resolve to a permanent redirect
 * or to nothing at all. `locale-prefix-request.ts` makes that decision; this
 * file renders the branch it names.
 *
 * Content detail routes are not here yet: AB#104 owns the curated gallery route
 * and AB#124 the article migration. Until they land, a listing card links to
 * the canonical detail path it will always have, and that path 404s.
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

/** The branch's canonical path segments beneath the story namespace. */
function branchPath(tree: ContentTree, route: StoryRoute): readonly string[] {
  return route.kind === "story-root"
    ? []
    : getCategoryPath(tree, route.categoryId);
}

function branchTitle(
  tree: ContentTree,
  route: StoryRoute,
  storyRootLabel: string,
): string {
  if (route.kind === "story-root") return storyRootLabel;
  return tree.categories.get(route.categoryId)?.label ?? storyRootLabel;
}

/**
 * Every published locale version of this branch, which is what `hreflang` and
 * `x-default` name. A category is identified by its immutable id; the story
 * root is the namespace itself, so its versions are the locales publishing a
 * tree with something in it.
 */
function listBranchVersions(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
  route: StoryRoute,
): readonly LocaleVersion[] {
  return route.kind === "story-root"
    ? listStoryRootVersions(config, trees)
    : listPublishedLocaleVersions(config, trees, {
        kind: "category",
        categoryId: route.categoryId,
      });
}

/**
 * The language's own name, read in that language. `Intl` supplies it, so adding
 * a locale never means adding a translated label to the codebase; an ICU build
 * that has no name for it falls back to the tag itself rather than to ours.
 */
function languageName(locale: string): string {
  const { language } = new Intl.Locale(locale);
  return (
    new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? locale
  );
}

/**
 * Where an explicit language switch leads from this branch.
 *
 * Only locales that actually publish a usable tree are offered, and a target
 * that has no version of this exact branch says which nearer page it opens
 * instead — ADR-0003 decision 7 requires the switch to communicate that rather
 * than silently changing what the visitor is looking at.
 */
function buildLanguageLinks(
  { config, trees }: Pick<ResolvedRequest, "config" | "trees">,
  locale: string,
  route: StoryRoute,
  labels: ReturnType<typeof getBuiltInLabels>,
): readonly BranchLanguageLink[] {
  const publishing = listStoryRootVersions(config, trees);

  return publishing.flatMap((version) => {
    if (version.locale === locale) return [];
    if (route.kind === "story-root") {
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
      { locale, location: { kind: "category", categoryId: route.categoryId } },
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

  return getPageMetadata({
    path: buildStoryPath(config, locale, branchPath(tree, route)),
    title: branchTitle(tree, route, getBuiltInLabels(locale).pages.stories),
    locale,
    localeVersions: listBranchVersions(config, trees, route),
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
  const listing = await getCategoryListing(
    locale,
    route.kind === "category" ? route.categoryId : null,
  );

  const storyRoot: BreadcrumbStep = {
    label: labels.pages.stories,
    href: buildStoryPath(config, locale),
  };
  const trail =
    route.kind === "category" ? getCategoryTrail(tree, route.categoryId) : [];
  const breadcrumbs: readonly BreadcrumbStep[] = [
    storyRoot,
    ...trail.map((step, index) => ({
      label: step.label,
      // The last step is the page itself, so it is text rather than a link.
      ...(index === trail.length - 1
        ? {}
        : { href: buildStoryPath(config, locale, step.path) }),
    })),
  ];

  return (
    <CategoryBranch
      locale={locale}
      title={branchTitle(tree, route, labels.pages.stories)}
      breadcrumbs={route.kind === "category" ? breadcrumbs : undefined}
      languages={buildLanguageLinks({ config, trees }, locale, route, labels)}
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
      labels={labels}
    />
  );
}
