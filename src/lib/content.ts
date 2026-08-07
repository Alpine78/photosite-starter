/**
 * Route-facing data-access seam for the public content tree. The CMS adapter
 * can replace the mock without changing route or component imports.
 *
 * One validated tree per configured locale, as ADR-0003 requires. A locale
 * whose content is still being authored is simply absent from the map: its
 * story routes 404 rather than falling back to another language's tree, because
 * showing Finnish categories at an English URL would claim a translation that
 * does not exist.
 */

import {
  buildCategoryListing,
  buildContentListingQuery,
  orderContentListingRecords,
  type CategoryListing,
  type ContentListingQuery,
  type ContentListingRecord,
} from "@/lib/content-listing";
import {
  buildContentRedirects,
  type ContentRedirects,
} from "@/lib/content-redirects";
import { buildContentTree, type ContentTree } from "@/lib/content-tree";
import { getDeploymentConfig } from "@/lib/deployment-config";
import type { LocaleRouteConfig, LocalizedContentTrees } from "@/lib/locale-routes";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import {
  mockContentRedirectInputs,
  mockContentTreeInputs,
} from "@/lib/mock-content-tree";

/**
 * Mock content is authored per language, while routes are configured per
 * locale: `en-GB` and `en-US` are different route spaces sharing one set of
 * English pages. The locale reached this point through the route config, so it
 * is already a validated BCP 47 tag.
 */
function languageOf(locale: string): string {
  return new Intl.Locale(locale).language;
}

/** One locale's public content: its validated tree and its path history. */
export type LocalizedContentRedirects = ReadonlyMap<string, ContentRedirects>;

type PublicContent = {
  readonly trees: LocalizedContentTrees;
  readonly redirects: LocalizedContentRedirects;
};

function buildPublicContent(config: LocaleRouteConfig): PublicContent {
  const trees = new Map<string, ContentTree>();
  const redirects = new Map<string, ContentRedirects>();

  for (const route of config.locales) {
    const language = languageOf(route.locale);
    const input = mockContentTreeInputs[language];
    if (input === undefined) continue;

    // Validation failures throw here, at startup of the first request that
    // needs the tree, rather than producing a half-resolved public route space.
    const tree = buildContentTree(input);
    trees.set(route.locale, tree);
    redirects.set(
      route.locale,
      buildContentRedirects(tree, mockContentRedirectInputs[language] ?? []),
    );
  }

  return { trees, redirects };
}

let cachedContent: PublicContent | undefined;

function getPublicContent(): PublicContent {
  cachedContent ??= buildPublicContent(getDeploymentConfig().localeRoutes);
  return cachedContent;
}

export async function getContentTrees(): Promise<LocalizedContentTrees> {
  return getPublicContent().trees;
}

/** Recorded path history per locale, for the route layer's permanent redirects. */
export async function getContentRedirects(): Promise<LocalizedContentRedirects> {
  return getPublicContent().redirects;
}

/**
 * Runs one bounded listing query.
 *
 * A fixture in memory is not a store, so the mock cannot demonstrate a pushed-
 * down limit — but it honors the same contract a CMS adapter must: it applies
 * the ordering rule first and returns no more than `limit` rows. The route never
 * sees a row past the page it asked for, and an adapter that answers the whole
 * query in the store satisfies this seam without changing a caller.
 */
async function queryListingRecords(
  locale: string,
  query: ContentListingQuery,
): Promise<readonly ContentListingRecord[]> {
  const authored = mockContentListingRecords[languageOf(locale)];
  const rows = query.contentIds.flatMap((contentId) => {
    const record = authored?.get(contentId);
    return record === undefined ? [] : [record];
  });

  return orderContentListingRecords(rows).slice(0, query.limit);
}

/** One branch listing: `null` lists the locale's story root. */
export async function getCategoryListing(
  locale: string,
  categoryId: string | null,
): Promise<CategoryListing> {
  const tree = (await getContentTrees()).get(locale);
  if (tree === undefined) {
    throw new TypeError(`locale "${locale}" publishes no content tree`);
  }

  const query = buildContentListingQuery({ tree, categoryId });

  return buildCategoryListing({
    tree,
    categoryId,
    records: await queryListingRecords(locale, query),
  });
}
