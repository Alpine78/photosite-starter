/**
 * Where the public content tree meets the route contract.
 *
 * `content-tree.ts` owns the tree and knows nothing about URLs;
 * `locale-routes.ts` owns the locale base and story namespace and knows nothing
 * about categories. This module joins them: it turns the segments beneath a
 * locale's story namespace into the branch or page they identify, and turns
 * either back into the paths a breadcrumb, a listing link, and
 * alternate-language metadata need.
 *
 * Only public branches and canonically placed pages resolve. ADR-0003 decision
 * 4 keeps an empty leaf out of public routes, and decision 8 answers an unknown
 * path with a 404 rather than a redirect to an ancestor, so a segment that
 * names nothing public simply fails to resolve — this module never guesses a
 * nearer branch.
 */

import {
  getCanonicalContentBySlug,
  getCanonicalContentPath,
  getCategoryAncestry,
  getCategoryPath,
  getPublicChildCategories,
  type ContentCategory,
  type ContentTree,
  type ContentVariant,
} from "@/lib/content-tree";
import {
  buildStoryPath,
  type ContentLocation,
  type LocaleRouteConfig,
  type LocaleVersion,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";

/** A public category as a link target: its label and its canonical path. */
export type CategoryLink = {
  readonly categoryId: string;
  readonly label: string;
  /** Canonical path segments beneath the story namespace. */
  readonly path: readonly string[];
};

export function toCategoryLink(
  tree: ContentTree,
  category: ContentCategory,
): CategoryLink {
  return {
    categoryId: category.categoryId,
    label: category.label,
    path: getCategoryPath(tree, category.categoryId),
  };
}

export type StoryRoute =
  /** The story namespace itself: the public content-tree root. */
  | { readonly kind: "story-root" }
  | { readonly kind: "category"; readonly categoryId: string }
  /** A canonically placed content page. */
  | { readonly kind: "content"; readonly contentId: string };

/**
 * Variants whose canonical detail route the application actually serves.
 *
 * A gallery needs the shared paginated result contract to render, which AB#104
 * owns, so its canonical path is not part of the public route space yet and
 * resolves to nothing at all. That is deliberate rather than incidental: a path
 * that resolves here also earns the casing and redundant-prefix normalization
 * redirects, and a permanent redirect onto a page that cannot render would
 * teach browsers and crawlers a dead address. AB#104 adds `gallery` here.
 */
const ROUTED_CONTENT_VARIANTS: ReadonlySet<ContentVariant> = new Set([
  "article",
]);

/**
 * Whether a page of this variant has a detail route to link to.
 *
 * Anything that builds a link to a *detail* page asks this, not just the
 * resolver: a breadcrumb, a sibling link, or a sitemap entry pointing at a
 * variant with no renderer would be an internal link the site's own 404 answers.
 * Listing cards are the deliberate exception — ADR-0003 gives every published
 * page one canonical address, and a card keeps pointing at it so the listing
 * does not quietly hide content while its route is being built.
 */
export function isRoutedContentVariant(variant: ContentVariant): boolean {
  return ROUTED_CONTENT_VARIANTS.has(variant);
}

/**
 * Resolves the path segments *beneath* one locale's story namespace, or `null`
 * when the public tree owns no such branch or page.
 *
 * Every segment but the last names a public category. The last may name either
 * a category or a canonically placed page whose variant this application
 * routes, and no guessing is involved: the tree's local slug namespace
 * guarantees at most one of them can claim a slug beneath one parent, so trying
 * the category first and the page second reaches the same answer whichever it
 * is. A secondary placement owns no detail route and is never matched —
 * ADR-0003 decision 5 gives a page exactly one address.
 *
 * The story root resolves only while the tree has something to show, because
 * ADR-0003 rejects empty public destinations.
 */
export function resolveStoryRoute(
  tree: ContentTree,
  segments: readonly string[],
): StoryRoute | null {
  if (segments.length === 0) {
    return getPublicChildCategories(tree, null).length === 0
      ? null
      : { kind: "story-root" };
  }

  let parentId: string | null = null;
  let resolved: ContentCategory | undefined;

  for (const [index, segment] of segments.entries()) {
    const match: ContentCategory | undefined = getPublicChildCategories(
      tree,
      parentId,
    ).find((category) => category.slug === segment);

    if (match === undefined) {
      // A canonical placement is always a category, so no page is reachable
      // directly beneath the story root, and only the final segment can name
      // one. Anything else is an unknown path.
      if (parentId === null || index !== segments.length - 1) return null;

      const placement = getCanonicalContentBySlug(tree, parentId, segment);
      return placement === undefined ||
        !ROUTED_CONTENT_VARIANTS.has(placement.variant)
        ? null
        : { kind: "content", contentId: placement.contentId };
    }

    resolved = match;
    parentId = match.categoryId;
  }

  return resolved === undefined
    ? null
    : { kind: "category", categoryId: resolved.categoryId };
}

/**
 * Canonical path segments of a resolved route, beneath the story namespace. The
 * story root is the namespace itself and therefore has none.
 */
export function getStoryRoutePath(
  tree: ContentTree,
  route: StoryRoute,
): readonly string[] {
  switch (route.kind) {
    case "story-root":
      return [];
    case "category":
      return getCategoryPath(tree, route.categoryId);
    case "content":
      return getCanonicalContentPath(tree, route.contentId) ?? [];
  }
}

/**
 * Canonical ancestry of a branch, top-level category first, as link targets.
 *
 * ADR-0003 decision 5 makes this the breadcrumb trail for content as well: it
 * follows canonical placement, never the secondary listing a visitor arrived
 * through. The story root is not included — the caller prepends it, because
 * only the route layer knows the namespace label.
 */
export function getCategoryTrail(
  tree: ContentTree,
  categoryId: string,
): readonly CategoryLink[] {
  return getCategoryAncestry(tree, categoryId).map((category) => ({
    categoryId: category.categoryId,
    label: category.label,
    path: getCategoryPath(tree, category.categoryId),
  }));
}

/**
 * The categories a route's breadcrumb links, top-level first.
 *
 * A content page's trail is its *canonical* ancestry, never the secondary
 * listing a visitor arrived through (ADR-0003 decision 5), and it stops at the
 * canonical category: the page itself is the current step, and only the caller
 * knows its title. The story root has no trail — the caller prepends it,
 * because only the route layer knows the namespace label.
 */
export function getStoryRouteTrail(
  tree: ContentTree,
  route: StoryRoute,
): readonly CategoryLink[] {
  if (route.kind === "story-root") return [];
  if (route.kind === "category") return getCategoryTrail(tree, route.categoryId);

  const canonicalCategoryId =
    tree.placements.get(route.contentId)?.canonicalCategoryId;
  return canonicalCategoryId === undefined || canonicalCategoryId === null
    ? []
    : getCategoryTrail(tree, canonicalCategoryId);
}

/**
 * What a visitor is looking at, by the stable identity that associates its
 * language versions. The story root has no such identity — it is the namespace
 * itself — so `listStoryRootVersions` answers for it instead.
 */
export function toContentLocation(route: StoryRoute): ContentLocation | null {
  switch (route.kind) {
    case "story-root":
      return null;
    case "category":
      return { kind: "category", categoryId: route.categoryId };
    case "content":
      return { kind: "content", contentId: route.contentId };
  }
}

/**
 * Published locale versions of the story root itself.
 *
 * `listPublishedLocaleVersions` answers this for a category or content page,
 * which are identified by a stable id. The root has no such id — it is the
 * namespace — so its versions are the locales that actually publish a tree with
 * something in it. A locale whose content is still being authored is left out
 * rather than linked to an empty destination.
 */
export function listStoryRootVersions(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
): readonly LocaleVersion[] {
  return config.locales.flatMap((route) => {
    const tree = trees.get(route.locale);
    if (tree === undefined) return [];
    if (getPublicChildCategories(tree, null).length === 0) return [];
    return [{ locale: route.locale, path: buildStoryPath(config, route.locale) }];
  });
}
