/**
 * Where the public content tree meets the route contract.
 *
 * `content-tree.ts` owns the tree and knows nothing about URLs;
 * `locale-routes.ts` owns the locale base and story namespace and knows nothing
 * about categories. This module joins them: it turns the segments beneath a
 * locale's story namespace into the branch they identify, and turns a branch
 * back into the paths a breadcrumb, a listing link, and alternate-language
 * metadata need.
 *
 * Only public branches resolve. ADR-0003 decision 4 keeps an empty leaf out of
 * public routes, and decision 8 answers an unknown path with a 404 rather than
 * a redirect to an ancestor, so a segment that names no public child simply
 * fails to resolve — this module never guesses a nearer branch.
 */

import {
  getCategoryAncestry,
  getCategoryPath,
  getPublicChildCategories,
  type ContentCategory,
  type ContentTree,
} from "@/lib/content-tree";
import {
  buildStoryPath,
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
  | { readonly kind: "category"; readonly categoryId: string };

/**
 * Resolves the path segments *beneath* one locale's story namespace, or `null`
 * when the public tree owns no such branch.
 *
 * Content detail slugs do not resolve here: their routes belong to AB#104 and
 * AB#124, and this resolver never guesses whether a final segment names a
 * category or a content page — the tree's local slug namespace already
 * guarantees only one of them can claim it.
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

  for (const segment of segments) {
    const match: ContentCategory | undefined = getPublicChildCategories(
      tree,
      parentId,
    ).find((category) => category.slug === segment);
    if (match === undefined) return null;
    resolved = match;
    parentId = match.categoryId;
  }

  return resolved === undefined
    ? null
    : { kind: "category", categoryId: resolved.categoryId };
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
