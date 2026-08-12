/**
 * The public navigation model: deployment-owned static links composed with the
 * public content tree.
 *
 * ADR-0003 decides the split this module implements. Site settings own the
 * static links — home, services, contact — and nothing else; the tree is the
 * source of content navigation, and settings never restate it as a
 * hand-maintained link list. So a configured link whose *path* points inside
 * this locale's story namespace is not rendered as a link at all: it only marks
 * *where* the section belongs in the menu and what it is called, while the
 * route it leads to and everything beneath it come from the route config and
 * the tree. Two entries can therefore never claim the same route space.
 *
 * The featured gallery is the one exception, and it is a different thing: an
 * entry marked `featured` is a shortcut to the one gallery the deployment shows
 * as its portfolio, rather than a second claim on a branch. It owns no route
 * space, so it survives that rule, and its href is derived per locale from the
 * tree instead of written down. A move, a rename, or a translated slug therefore
 * changes the menu with the content, and a locale that has not published that
 * gallery simply does not show the entry.
 *
 * Which gallery that is stays out of the entry itself. The identity arrives once
 * as `featuredContentId`, from the single setting that owns it, so the header,
 * the footer, and the home page cannot drift onto different targets — an entry
 * decides only whether that gallery appears on its surface, and under what
 * label.
 *
 * What the navigation reads is deliberately narrow. `ContentTree` is the
 * project-owned category projection: labels, slugs, sibling order, and which
 * categories are public. No page body, cover, listing row, or gallery media is
 * involved, and none may be added here — a menu that had to load content to
 * render itself would load it on every page of the site.
 *
 * Depth is bounded, and that is a navigation decision rather than a route one.
 * The menu carries the first two category levels; ADR-0003 permits five, and
 * the rest stay reachable the way a visitor actually reaches them — through the
 * landing page of the branch above, which lists its own child categories. A
 * menu that unfolded all five levels would be the hardest thing on the page to
 * operate by keyboard or thumb, and the deepest branches are exactly the ones
 * fewest visitors want.
 *
 * Nothing here knows about React or the DOM: it maps route configuration and a
 * validated tree onto items, and answers where the current path sits relative
 * to one of them. The header component renders that.
 */

import { getPublicContentRoute } from "@/lib/content-routes";
import {
  getCategoryPath,
  getPublicChildCategories,
  MAX_CATEGORY_DEPTH,
  type ContentTree,
} from "@/lib/content-tree";
import { buildStoryPath, type LocaleRouteConfig } from "@/lib/locale-routes";

/**
 * Category levels the menu itself exposes. Levels beneath it are reached from
 * the branch landing page above them, which lists its public child categories.
 */
export const MAX_NAVIGATION_CATEGORY_DEPTH = 2;

/**
 * A deployment-owned menu entry, as authored in site settings: either a static
 * route path, or the deployment's featured gallery.
 *
 * A featured entry carries no target of its own. It says "the featured gallery
 * belongs here, under this label"; the identity comes from the one setting that
 * holds it, which is what stops two surfaces from featuring two different
 * galleries.
 */
export type StaticNavigationLink =
  | {
      readonly label: string;
      readonly href: string;
      readonly featured?: never;
    }
  | {
      readonly label: string;
      readonly featured: true;
      readonly href?: never;
    };

/** A menu entry with its route resolved, which is what a component renders. */
export type ResolvedNavigationLink = {
  readonly label: string;
  readonly href: string;
};

export type SiteNavigationItem = {
  /**
   * Stable render key: a static route path, or a category's immutable id. Never
   * the label or the slug, which is what a rename and a translation change.
   */
  readonly key: string;
  readonly label: string;
  /** Absolute route path in this locale's route space. */
  readonly href: string;
  /** Bounded by `MAX_NAVIGATION_CATEGORY_DEPTH`; empty for a static link. */
  readonly children: readonly SiteNavigationItem[];
};

export type SiteNavigationInput = {
  readonly staticLinks: readonly StaticNavigationLink[];
  readonly config: LocaleRouteConfig;
  /** The route space being rendered; the default locale outside a prefix. */
  readonly locale: string;
  /** This locale's validated tree, or `undefined` while it publishes none. */
  readonly tree: ContentTree | undefined;
  /**
   * Stable identity of the deployment's featured gallery, from site settings.
   * Absent when it features none, which drops every featured entry.
   */
  readonly featuredContentId?: string;
  /** Names the section when no configured link marks its place. */
  readonly storyLabel: string;
  readonly maxCategoryDepth?: number;
};

function assertCategoryDepth(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_CATEGORY_DEPTH) {
    throw new RangeError(
      `navigation category depth must be an integer between 1 and ${MAX_CATEGORY_DEPTH}`,
    );
  }
}

/**
 * Compares route paths without letting a trailing slash decide the answer.
 * Next.js serves parameter-free paths without one, but a link authored in
 * settings, or a path arriving from elsewhere, may carry it.
 */
function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

/** Whether a configured link points into the route space the tree owns. */
function isInsideStoryNamespace(href: string, storyRoot: string): boolean {
  return href === storyRoot || href.startsWith(`${storyRoot}/`);
}

/**
 * Whether this locale's story root resolves at all. ADR-0003 rejects an empty
 * public destination, so a locale with no public top-level category has no story
 * root — and no link in the site chrome may point at one.
 */
function publishesStoryRoot(tree: ContentTree | undefined): boolean {
  return tree !== undefined && getPublicChildCategories(tree, null).length > 0;
}

function toCategoryItems({
  tree,
  config,
  locale,
  parentId,
  depth,
  maxDepth,
}: {
  readonly tree: ContentTree;
  readonly config: LocaleRouteConfig;
  readonly locale: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly maxDepth: number;
}): readonly SiteNavigationItem[] {
  if (depth > maxDepth) return [];

  return getPublicChildCategories(tree, parentId).map((category) => ({
    key: category.categoryId,
    label: category.label,
    href: buildStoryPath(
      config,
      locale,
      getCategoryPath(tree, category.categoryId),
    ),
    children: toCategoryItems({
      tree,
      config,
      locale,
      parentId: category.categoryId,
      depth: depth + 1,
      maxDepth,
    }),
  }));
}

/**
 * The content section of the menu: this locale's public top-level categories
 * and, beneath each, its public children, in authored sibling order.
 *
 * Only public categories appear. ADR-0003 decision 4 keeps a category with
 * neither published content nor a public descendant out of public navigation,
 * and its route 404s, so listing it would be a menu entry leading nowhere.
 */
export function buildCategoryNavigation({
  tree,
  config,
  locale,
  maxCategoryDepth = MAX_NAVIGATION_CATEGORY_DEPTH,
}: {
  readonly tree: ContentTree;
  readonly config: LocaleRouteConfig;
  readonly locale: string;
  readonly maxCategoryDepth?: number;
}): readonly SiteNavigationItem[] {
  assertCategoryDepth(maxCategoryDepth);

  return toCategoryItems({
    tree,
    config,
    locale,
    parentId: null,
    depth: 1,
    maxDepth: maxCategoryDepth,
  });
}

/**
 * Where one configured entry leads in this locale, and the stable key it renders
 * under, or `undefined` when it leads nowhere here.
 *
 * The featured gallery resolves through the tree, so an entry is dropped rather
 * than rendered as a link into the site's own 404 when this locale has not
 * published it, has unpublished it, or has left it unplaced — and equally when
 * the configured identity turns out not to be a gallery at all, because an entry
 * labelled as the portfolio must not open an article. Its key is the content
 * identity, which no rename or translation changes.
 */
function resolveLinkTarget(
  link: StaticNavigationLink,
  {
    config,
    locale,
    tree,
    featuredContentId,
  }: {
    readonly config: LocaleRouteConfig;
    readonly locale: string;
    readonly tree: ContentTree | undefined;
    readonly featuredContentId: string | undefined;
  },
): { readonly href: string; readonly key: string } | undefined {
  if (link.featured === undefined) {
    return { href: normalizePath(link.href), key: normalizePath(link.href) };
  }
  if (featuredContentId === undefined) return undefined;

  const href = getPublicContentRoute(
    config,
    tree,
    locale,
    featuredContentId,
    "gallery",
  );
  return href === undefined
    ? undefined
    : { href: normalizePath(href), key: `content:${featuredContentId}` };
}

/**
 * The configured entries a plain link list renders — the footer's, today.
 *
 * Unlike the menu, this composes no content section: a footer lists the links it
 * was given. What it shares with the menu is which of them are alive. A featured
 * page this locale does not publish is dropped, and so is a link into a story
 * namespace with nothing in it — the menu drops that one by having no section to
 * mark, and the two would otherwise disagree, with the footer left pointing at a
 * story root that answers 404.
 */
export function resolveStaticNavigationLinks({
  links,
  config,
  locale,
  tree,
  featuredContentId,
}: {
  readonly links: readonly StaticNavigationLink[];
  readonly config: LocaleRouteConfig;
  readonly locale: string;
  readonly tree: ContentTree | undefined;
  readonly featuredContentId?: string;
}): readonly ResolvedNavigationLink[] {
  const storyRoot = buildStoryPath(config, locale);
  const hasStories = publishesStoryRoot(tree);

  return links.flatMap((link) => {
    const target = resolveLinkTarget(link, {
      config,
      locale,
      tree,
      featuredContentId,
    });
    if (target === undefined) return [];
    if (!hasStories && isInsideStoryNamespace(target.href, storyRoot)) return [];

    return [{ label: link.label, href: target.href }];
  });
}

/**
 * The whole menu for one locale's route space.
 *
 * The content section appears only while this locale actually publishes
 * something: no tree, or a tree with no public top-level category, means the
 * story root itself does not resolve, and an entry pointing at it would be a
 * permanent 404 in the site chrome. A configured link into that namespace is
 * dropped either way, so a deployment cannot restore the dead link by authoring
 * one.
 */
export function buildSiteNavigation({
  staticLinks,
  config,
  locale,
  tree,
  featuredContentId,
  storyLabel,
  maxCategoryDepth = MAX_NAVIGATION_CATEGORY_DEPTH,
}: SiteNavigationInput): readonly SiteNavigationItem[] {
  assertCategoryDepth(maxCategoryDepth);

  const storyRoot = buildStoryPath(config, locale);
  const items: SiteNavigationItem[] = [];
  const claimed = new Set<string>();
  let storyIndex: number | undefined;
  let authoredStoryLabel: string | undefined;

  for (const link of staticLinks) {
    const target = resolveLinkTarget(link, {
      config,
      locale,
      tree,
      featuredContentId,
    });
    if (target === undefined) continue;

    const { href, key } = target;

    // Only a configured *path* competes with the tree for a route space. A
    // featured page names one address inside it and claims no branch, so it is
    // rendered rather than absorbed into the section marker.
    if (link.featured === undefined && isInsideStoryNamespace(href, storyRoot)) {
      // The first such link marks the section's place and supplies its name; a
      // second one is the hand-maintained list ADR-0003 rules out.
      if (storyIndex === undefined) {
        storyIndex = items.length;
        authoredStoryLabel = link.label;
      }
      continue;
    }

    // Two entries leading to one route are a menu defect rather than a choice,
    // and the second would duplicate the first's current-page state.
    if (claimed.has(href)) continue;
    claimed.add(href);

    items.push({ key, label: link.label, href, children: [] });
  }

  const categories =
    tree === undefined
      ? []
      : buildCategoryNavigation({ tree, config, locale, maxCategoryDepth });

  if (categories.length > 0) {
    const section: SiteNavigationItem = {
      key: storyRoot,
      label: authoredStoryLabel ?? storyLabel,
      href: storyRoot,
      children: categories,
    };
    items.splice(storyIndex ?? items.length, 0, section);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Current route
// ---------------------------------------------------------------------------

/** Where the current route sits relative to one navigation item. */
export type NavigationItemState = "current" | "ancestor" | "elsewhere";

/**
 * Whether an item is the page a visitor is on, an ancestor of it, or neither.
 *
 * The comparison is by whole path segment, so `/services` is not an ancestor of
 * `/services-for-agencies`. The site root is the prefix of every path and is
 * therefore only ever the current page: marking it an ancestor everywhere would
 * make the marking mean nothing.
 */
export function resolveNavigationItemState(
  href: string,
  pathname: string,
): NavigationItemState {
  const target = normalizePath(href);
  const current = normalizePath(pathname);

  if (target === current) return "current";
  if (target === "/") return "elsewhere";
  return current.startsWith(`${target}/`) ? "ancestor" : "elsewhere";
}

/**
 * The `aria-current` value a state earns.
 *
 * `page` is the page itself. An ancestor gets `location`, which ARIA defines as
 * the current position within a containing structure — exactly what a branch
 * holding the open page is. Reusing `page` for both would tell assistive
 * technology the site has several current pages.
 */
export function toAriaCurrent(
  state: NavigationItemState,
): "page" | "location" | undefined {
  switch (state) {
    case "current":
      return "page";
    case "ancestor":
      return "location";
    case "elsewhere":
      return undefined;
  }
}
