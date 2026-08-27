import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { CategoryBranch } from "@/components/category-branch";
import { ContentArticle } from "@/components/content-article";
import { ContentGallery } from "@/components/content-gallery";
import type { BreadcrumbStep } from "@/components/breadcrumbs";
import type { LanguageLink } from "@/components/language-switch";
import {
  getAdjacentContent,
  getCategoryListing,
  getContentPage,
  getContentRedirects,
  getContentTrees,
} from "@/lib/content";
import { ContentListingCursorError } from "@/lib/content-listing-cursor";
import {
  asArticlePage,
  asGalleryPage,
  type ContentPage,
} from "@/lib/content-page";
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
import {
  GalleryCursorError,
  UnknownGallerySectionError,
  getGalleryPage,
} from "@/lib/gallery";
import { buildGalleryHref } from "@/lib/gallery-slice";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import type { GallerySectionSummary } from "@/lib/gallery-sections";
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
import { REQUEST_PATH_HEADER, readRequestPath } from "@/lib/request-path";

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
 * Both content variants render here. They share the resolution, the breadcrumb,
 * the language switch, and the metadata, and differ in what they load: an
 * article is its body, while a gallery is a page plus one bounded page of the
 * shared AB#67 result read separately through `gallery.ts`. Which renderer runs
 * is decided by the variant the tree resolved, never by inspecting what the
 * source returned.
 */

type LocalePrefixPageProps = {
  params: Promise<{ localePrefix: string; segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResolvedRequest = Awaited<ReturnType<typeof resolveRequest>>;

async function resolveRequest({ params, searchParams }: LocalePrefixPageProps) {
  const [{ localePrefix, segments = [] }, resolvedSearchParams, requestHeaders] =
    await Promise.all([params, searchParams, headers()]);
  const requestPath = readRequestPath(requestHeaders.get(REQUEST_PATH_HEADER));
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
      galleryCursorNamesASlice,
      categoryListingCursorNamesASlice,
      gallerySectionExists,
      pathHasTrailingSlash:
        requestPath !== undefined &&
        requestPath.length > 1 &&
        requestPath.endsWith("/"),
    }),
  };
}

/**
 * The page a content route names, or `undefined` when this locale publishes no
 * version of it — a defect the fixture tests guard against rather than a state a
 * visitor should reach, so the route answers 404 rather than a blank page.
 *
 * The variant comes from the route rather than from the answer, and the
 * projection re-checks both variant and identity. The resolver already keeps
 * unrendered variants out of the route space, so this is the second lock: an
 * adapter that answered with a different page, or with an article where the tree
 * says gallery, must not publish it at this canonical URL.
 */
async function resolveContentPage(
  locale: string,
  route: StoryRoute,
): Promise<ContentPage | undefined> {
  if (route.kind !== "content") return undefined;

  const page = await getContentPage(locale, route.contentId, route.variant);
  return route.variant === "gallery"
    ? asGalleryPage(route.contentId, page)
    : asArticlePage(route.contentId, page);
}

/**
 * Whether a continuation token names a real slice of one gallery.
 *
 * The resolver asks this before it turns a non-canonical address into a
 * permanent redirect. A good token there deserves the redirect and keeps its
 * value — decision 8 makes the cursor case-sensitive and never normalized — and
 * only a token that names nothing answers 404 without creating a redirect. This
 * layer is the only one that can tell the two apart, because the signing key is
 * behind `gallery.ts`.
 */
async function galleryCursorNamesASlice(
  locale: string,
  contentId: string,
  cursor: string,
  sectionSlug?: string,
): Promise<boolean> {
  return (
    (await resolveGalleryPage(locale, contentId, cursor, sectionSlug)) !==
    undefined
  );
}

/**
 * Whether a section slug names a real, declared section of one gallery.
 *
 * Mirrors {@link galleryCursorNamesASlice} exactly, including its failure
 * mode: `resolveGalleryPage` answers `undefined` both when the section itself
 * is unknown and when this locale publishes no gallery result for the
 * identity at all (a content-tree record with no matching source row). Either
 * absence has to refuse here — checking only for a thrown
 * `UnknownGallerySectionError` would treat a genuinely missing gallery as an
 * existing section and let a casing or prefix variant redirect permanently
 * onto a canonical URL that then 404s on its own.
 */
async function gallerySectionExists(
  locale: string,
  contentId: string,
  sectionSlug: string,
): Promise<boolean> {
  return (
    (await resolveGalleryPage(locale, contentId, undefined, sectionSlug)) !==
    undefined
  );
}

/**
 * One bounded page of a category branch's aggregated listing, or `undefined`
 * when the request's `?cursor=` names no slice — malformed, tampered with,
 * scoped to another branch/locale, or stale (an in-scope date edit or a subtree
 * reshape has moved its boundary). ADR-0003 decision 8 answers that with a 404,
 * not a quiet fall back to the first page. The mirror of {@link resolveGalleryPage}.
 */
async function resolveCategoryListing(
  locale: string,
  categoryId: string | null,
  cursor?: string,
) {
  try {
    return await getCategoryListing(locale, categoryId, cursor);
  } catch (error) {
    if (error instanceof ContentListingCursorError) return undefined;
    throw error;
  }
}

/**
 * Whether a continuation token names a real slice of one category branch.
 *
 * The resolver asks this before it turns a non-canonical category address into
 * a permanent redirect: a good token deserves the redirect and keeps its value
 * (decision 8 makes the cursor case-sensitive and never normalized), and only a
 * token that names nothing 404s without creating a redirect. This layer is the
 * only one that can tell the two apart, because the signing key is behind
 * `content.ts`. The mirror of {@link galleryCursorNamesASlice}.
 */
async function categoryListingCursorNamesASlice(
  locale: string,
  categoryId: string,
  cursor: string,
): Promise<boolean> {
  return (
    (await resolveCategoryListing(locale, categoryId, cursor)) !== undefined
  );
}

/**
 * One bounded page of a gallery, or `undefined` when this request names none.
 *
 * Three different absences collapse here on purpose, because the route
 * answers all of them the same way. Either the locale publishes no gallery
 * for that identity, or the cursor it carries names no slice of one —
 * malformed, tampered with, scoped to another query, or stale because the
 * boundary it named has moved — or the section it carries names no declared
 * section of this gallery. ADR-0003 decision 8 answers all three with a 404
 * rather than a quiet fall back to the first page: the URL promised a
 * particular slice, and serving a different one under it would be a claim a
 * crawler then indexes.
 */
async function resolveGalleryPage(
  locale: string,
  contentId: string,
  cursor?: string,
  sectionSlug?: string,
) {
  try {
    return await getGalleryPage(locale, contentId, cursor, sectionSlug);
  } catch (error) {
    if (
      error instanceof GalleryCursorError ||
      error instanceof UnknownGallerySectionError
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The canonical path this request claims.
 *
 * A named section, cursored or not, canonicalizes to the gallery's own
 * parameter-free path (decision 8: it is an alternate filter of the same
 * curated result, not a distinct indexable view). Otherwise the existing rule
 * applies unchanged: the gallery's own path, plus the cursor when this is an
 * unfiltered continuation, which decision 8 makes indexable and self-canonical
 * because it is a distinct sequential slice. The token is emitted exactly as
 * it arrived — it is case-sensitive and never normalized.
 */
function toCanonicalPath(
  path: string,
  cursor: string | undefined,
  activeSectionSlug: string | undefined,
): string {
  if (activeSectionSlug !== undefined) return path;
  return cursor === undefined ? path : buildGalleryHref(path, { cursor });
}

/**
 * The active section, resolved from the request's slug against the catalog
 * every slice carries — not from `result.selectedSection`, which the shared
 * gallery contract populates only for the first, uncursored slice of a named
 * section (`gallery-sections.ts`). The controls' selected state and a
 * continuation's own section scoping need the active section on *every*
 * slice, cursored or not; `selectedSection` remains reserved for deciding
 * whether the first-page heading and introduction render.
 */
function resolveActiveSection(
  sections: readonly GallerySectionSummary[],
  slug: string | undefined,
): GallerySectionSummary | undefined {
  if (slug === undefined) return undefined;
  return sections.find((section) => section.slug === slug);
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
  const page = await resolveContentPage(locale, route);
  if (route.kind === "content" && page === undefined) return {};

  const galleryResult =
    page?.variant === "gallery"
      ? await resolveGalleryPage(
          locale,
          page.contentId,
          resolution.cursor,
          resolution.section,
        )
      : undefined;
  // A gallery the source cannot answer for renders a 404 below, and a 404 must
  // not carry a canonical URL, a social image, and alternates for a page nobody
  // can open. The same reason the article path returns early above, and this
  // now covers a cursor that names no slice, or a section that names no
  // declared section, as well as a missing gallery.
  if (page?.variant === "gallery" && galleryResult === undefined) {
    return {};
  }

  const path = buildStoryPath(config, locale, getStoryRoutePath(tree, route));
  const localeVersions = listRouteVersions(config, trees, route);

  if (page === undefined) {
    const title = branchTitle(
      tree,
      route,
      getBuiltInLabels(locale).pages.stories,
    );

    // A category branch continuation (AB#140, ADR-0003 decision 8): validate
    // the token first so metadata is never emitted for what will 404, then
    // self-canonicalize to the `?cursor=` URL and name no `hreflang`
    // alternates — the cursor is scoped to one locale's ordering, so no other
    // locale holds an equivalent slice, exactly as for a gallery continuation.
    if (resolution.cursor !== undefined && route.kind === "category") {
      const continued = await resolveCategoryListing(
        locale,
        route.categoryId,
        resolution.cursor,
      );
      if (continued === undefined) return {};
      return getPageMetadata({
        path: buildGalleryHref(path, { cursor: resolution.cursor }),
        title,
        locale,
      });
    }

    return getPageMetadata({ path, title, locale, localeVersions });
  }

  const activeSection =
    galleryResult === undefined
      ? undefined
      : resolveActiveSection(galleryResult.sections, resolution.section);

  // Both variants are dated published pages, and a gallery's cover is the
  // resolved one its card shows — its own opening photograph when none was
  // authored — so neither invents a social image it does not have.
  //
  // A continuation page, and every named-section view (cursored or not), name
  // no alternate languages. A continuation's token is scoped to one gallery's
  // ordering in one locale, so no other locale holds an equivalent slice to
  // point at; a named section is a non-canonical alternate filter of the same
  // curated result (decision 8), so an `hreflang` set on it would assert a
  // reciprocal relationship its own canonical tag already disclaims. The
  // visible language switch still leads somewhere useful either way: decision
  // 7 has it drop cursor and section state and open the target locale's first
  // page. A named section is also `noindex`, with or without a cursor and
  // including its empty state — canonicalizing to the parameter-free page is
  // not sufficient on its own, since a crawler may still index a non-canonical
  // URL despite the hint.
  return getPageMetadata({
    path: toCanonicalPath(path, resolution.cursor, activeSection?.slug),
    title: page.title,
    ...(page.summary === undefined ? {} : { description: page.summary }),
    ...(page.cover === undefined ? {} : { image: page.cover }),
    publishedTime: page.publishedAt,
    locale,
    ...(resolution.cursor === undefined && activeSection === undefined
      ? { localeVersions }
      : {}),
    ...(activeSection === undefined ? {} : { noindex: true }),
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
    const page = await resolveContentPage(locale, route);
    if (page === undefined) {
      notFound();
    }

    if (page.variant === "gallery") {
      // One bounded page of the gallery, read by the identity the tree resolved
      // and positioned by whatever cursor and section the request carried. It
      // is a separate read from the page above because the two have different
      // costs: a card projects the page's fields and never this.
      const result = await resolveGalleryPage(
        locale,
        page.contentId,
        resolution.cursor,
        resolution.section,
      );
      const storyPath = buildStoryPath(
        config,
        locale,
        getStoryRoutePath(tree, route),
      );

      if (result === undefined) {
        // The 404 that follows carries the link back to this gallery that
        // decision 8 requires. It is not passed from here — App Router renders
        // a not-found boundary with no props, and renders it before this page —
        // so the boundary reconstructs it from the requested path the Proxy
        // carried (ADR-0007), and shows it only when a cursor or an unknown
        // section was refused.
        notFound();
      }

      // Resolved from the catalog every slice carries, not from
      // `result.selectedSection` — see `resolveActiveSection`'s own comment.
      const activeSection = resolveActiveSection(
        result.sections,
        resolution.section,
      );
      const sectionKey = activeSection?.slug ?? "all";

      return (
        <ContentGallery
          locale={locale}
          page={page}
          slice={projectGallerySlice(result)}
          initialSliceKey={
            resolution.cursor === undefined
              ? `first:${storyPath}:${sectionKey}`
              : `cursor:${resolution.cursor}:${sectionKey}`
          }
          galleryPath={storyPath}
          sections={result.sections}
          {...(activeSection === undefined ? {} : { activeSection })}
          {...(result.selectedSection === undefined
            ? {}
            : { selectedSection: result.selectedSection })}
          {...(resolution.cursor === undefined
            ? {}
            : {
                firstPageHref: buildGalleryHref(storyPath, {
                  section: activeSection?.slug,
                }),
                isContinuation: true,
              })}
          breadcrumbs={buildBreadcrumbs(
            config,
            tree,
            locale,
            route,
            labels,
            page.title,
          )}
          languages={languages}
          labels={labels}
        />
      );
    }

    const article = page;

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

  const isStoryRoot = route.kind === "story-root";
  const categoryId = route.kind === "category" ? route.categoryId : null;

  // A category continuation only exists for a real category branch; the story
  // root has no continuation contract, so it never carries a cursor.
  const isContinuation = !isStoryRoot && resolution.cursor !== undefined;

  const listing = await resolveCategoryListing(
    locale,
    categoryId,
    isContinuation ? resolution.cursor : undefined,
  );
  if (listing === undefined) {
    // A cursor that names no slice — the 404 that follows carries the way back
    // to this branch, reconstructed by the not-found boundary from the Proxy's
    // request-path header (ADR-0007), exactly as an invalid gallery cursor's does.
    notFound();
  }

  const branchPath = buildStoryPath(config, locale, getStoryRoutePath(tree, route));

  return (
    <CategoryBranch
      locale={locale}
      title={branchTitle(tree, route, labels.pages.stories)}
      {...(isStoryRoot && !isContinuation
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
      {...(isContinuation
        ? { isContinuation: true, firstPageHref: branchPath }
        : {})}
      {...(listing.nextCursor === undefined
        ? {}
        : {
            continuation: {
              moreHref: buildGalleryHref(branchPath, {
                cursor: listing.nextCursor,
              }),
            },
          })}
      labels={labels}
    />
  );
}
