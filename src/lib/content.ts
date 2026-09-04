/**
 * Route-facing data-access seam for the public content tree. The CMS adapter
 * can replace the mock without changing route or component imports.
 *
 * One validated tree per configured locale, as ADR-0003 requires. A locale
 * whose content is still being authored is simply absent from the map: its
 * story routes 404 rather than falling back to another language's tree, because
 * showing Finnish categories at an English URL would claim a translation that
 * does not exist.
 *
 * No adapter yet records the previously published path history ADR-0003
 * decision 7's project-owned URL-change workflow is meant to persist (no
 * `sanity/schemas/*.ts` document carries a `previousPath`/redirect field). A
 * Sanity-backed deployment therefore publishes no recorded redirect history —
 * honestly empty, since nothing has recorded any yet, rather than a fixture
 * value borrowed from the mock.
 */

import { createHash } from "node:crypto";
import { cache } from "react";

import {
  MAX_CONTENT_LISTING_PAGE_SIZE,
  buildAdjacentContentQuery,
  buildCategoryListing,
  buildContentListingQuery,
  listContentIdsInCategories,
  orderContentListingRecords,
  resolveAdjacentContent,
  selectAdjacentRecords,
  selectContentListingAfterBoundary,
  type AdjacentContent,
  type AdjacentContentQuery,
  type AdjacentContentRecords,
  type CategoryListing,
  type ContentListingBoundary,
  type ContentListingQuery,
  type ContentListingRecord,
} from "@/lib/content-listing";
/**
 * `content-listing-cursor.ts` carries the `server-only` marker. Importing it at
 * the top level here would pull that marker into this seam's module graph
 * unconditionally — including from contexts (e2e Playwright specs, which reach
 * `content.ts` through `sitemap.ts`) that run outside Next's bundler and cannot
 * satisfy that package's build-time "react-server" export condition. So
 * `getCategoryListing` imports it dynamically, inside its own category branch,
 * for the same reason the Sanity adapters below are imported dynamically. A
 * route that needs the classified error type imports it from
 * `content-listing-cursor.ts` directly.
 */
import { isContentEnded, type ContentPageSource } from "@/lib/content-page";
import {
  buildContentRedirects,
  type ContentRedirects,
} from "@/lib/content-redirects";
import { dispatchContentSource } from "@/lib/content-source";
import {
  buildContentTree,
  listCategorySubtreeIds,
  type ContentPlacementInput,
  type ContentTree,
  type ContentTreeInput,
} from "@/lib/content-tree";
import { getDeploymentConfig } from "@/lib/deployment-config";
import type { LocaleRouteConfig, LocalizedContentTrees } from "@/lib/locale-routes";
import {
  mockAuthoredContentRecords,
  mockContentListingRecords,
} from "@/lib/mock-content-listing";
import { mockContentPages } from "@/lib/mock-content-pages";
import {
  mockContentRedirectInputs,
  mockContentTreeInputs,
} from "@/lib/mock-content-tree";

/**
 * `sanity-article.ts`, `sanity-content-tree.ts`, and `sanity-gallery.ts` each
 * carry the `server-only` marker. A static top-level import of any of them
 * would pull that marker into this seam's module graph unconditionally —
 * including from contexts (e2e Playwright specs, which run outside Next's
 * own bundler and cannot satisfy that package's build-time "react-server"
 * export condition) that only ever exercise the mock path. Every function
 * below imports them dynamically, inside its own `contentSource === "sanity"`
 * branch, so the mock path never touches them at all.
 */

/**
 * Mock content is authored per language, while routes are configured per
 * locale: `en-GB` and `en-US` are different route spaces sharing one set of
 * English pages. The locale reached this point through the route config, so it
 * is already a validated BCP 47 tag.
 *
 * Deliberately not `sanity-values.ts#toLanguageSubtag`, even though it does
 * the same reduction more defensively: that module carries the `server-only`
 * marker (transitively, via its own `sanity-client.ts` import for the
 * chunking byte budget), and this function runs unconditionally on the mock
 * path too — including from contexts, like e2e Playwright specs, that run
 * outside Next's own bundler and cannot tolerate that marker at all.
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

/**
 * Folds the `endDate` gate (AB#150, ADR-0017 decision 5) into each
 * placement's effective `published` — the one thing this mock's "adapter"
 * boundary must do before the tree ever sees the input, so routing, listing
 * membership, sibling-nav candidacy, and `listPublicRoutePaths` all exclude an
 * ended page with no downstream code aware of `endDate` at all. A page whose
 * record carries no `endDate`, or whose `endDate` has not been reached, is
 * unaffected.
 *
 * `now` is fixed once per call rather than read per placement, since a mock
 * tree is built (and cached) once — see `buildMockPublicContent`'s own
 * comment on why the gate is therefore only as fresh as that cache. Mock
 * fixtures accordingly use a permanently-past `endDate` for the one gallery
 * and one article that exercise this state, never one meant to expire during
 * a running process.
 *
 * Exported so `e2e/sitemap-robots.spec.ts` can build the exact same gated
 * tree the running app serves when it computes its own expected route set —
 * that spec builds its "expected" list directly from `mockContentTreeInputs`,
 * and would otherwise include a page this gate excludes.
 */
export function applyMockEndDateGate(
  input: ContentTreeInput,
  language: string,
  now: Date,
): ContentTreeInput {
  const authored = mockAuthoredContentRecords[language];
  return {
    categories: input.categories,
    placements: input.placements.map((placement): ContentPlacementInput => {
      if (!placement.published) return placement;
      const endDate = authored?.get(placement.contentId)?.endDate;
      if (!isContentEnded(endDate, now)) return placement;
      return { ...placement, published: false };
    }),
  };
}

function buildMockPublicContent(config: LocaleRouteConfig): PublicContent {
  const trees = new Map<string, ContentTree>();
  const redirects = new Map<string, ContentRedirects>();
  const now = new Date();

  for (const route of config.locales) {
    const language = languageOf(route.locale);
    const authoredInput = mockContentTreeInputs[language];
    if (authoredInput === undefined) continue;

    const input = applyMockEndDateGate(authoredInput, language, now);

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

/**
 * Static demo data never changes at runtime, so caching it in a module-level
 * variable is safe and keeps every request from rebuilding it. This cache must
 * never hold Sanity-sourced content — see `buildSanityPublicContent`'s own
 * comment for why.
 */
let cachedMockContent: PublicContent | undefined;

/**
 * Builds this deployment's public content tree fresh from Sanity: one read
 * per configured locale, never kept in a module-level variable across
 * requests.
 *
 * That absence of a *persistent* cache is deliberate, not an oversight.
 * AB#83's webhook revalidation invalidates Next's own tagged fetch Data Cache
 * (`revalidateTag`, driven by `sanity-cache.ts`'s query-tag map) — it has no
 * way to reach into an arbitrary JS-level variable living for the process's
 * whole lifetime. A plain module-level cache on top would mean a Sanity
 * publish stays invisible until the server process restarts, which is
 * exactly the failure AB#83 exists to prevent.
 *
 * It is, however, wrapped in React's `cache()`: several independent seams
 * within one request all need this same result — the catch-all route's own
 * `resolveRequest` reads both `getContentTrees()` and `getContentRedirects()`,
 * and `getCategoryListing()`/`getAdjacentContent()` each read `getContentTrees()`
 * again — and without request-scoped memoization, one page render would repeat
 * the whole per-locale category-and-placement walk several times over.
 * `cache()` dedupes calls carrying the same `config` reference *only within
 * one request/render* (React's documented per-request-scope contract) and
 * never persists anything across requests, so it adds nothing a fresh
 * deployment-config read on the next request wouldn't already recompute —
 * unlike the module-level cache above, it cannot go stale across a
 * `revalidateTag`. Every read below still goes through `sanity-client.ts`'s
 * own tagged `fetch` too, so cross-request, tag-scoped caching still happens
 * at the layer that can actually be invalidated.
 *
 * A locale with no categories, articles, or galleries in its language is
 * omitted from the result entirely, matching the mock's own "absent from the
 * map" contract this module's header comment describes. Checking all three
 * sources matters: an article or gallery whose localized category is missing
 * is invalid tree input, not an unauthored locale, and `buildContentTree` must
 * be allowed to classify that defect instead of this seam silently hiding it.
 */
const buildSanityPublicContent = cache(
  async (config: LocaleRouteConfig): Promise<PublicContent> => {
    const [{ readPublicCategoryInputs }, { readPublicArticlePlacements }, { readPublicGalleryPlacements }] =
      await Promise.all([
        import("@/lib/sanity-content-tree"),
        import("@/lib/sanity-article"),
        import("@/lib/sanity-gallery"),
      ]);

    const trees = new Map<string, ContentTree>();
    const redirects = new Map<string, ContentRedirects>();

    await Promise.all(
      config.locales.map(async (route) => {
        const language = languageOf(route.locale);
        const [categories, articlePlacements, galleryPlacements] = await Promise.all([
          readPublicCategoryInputs({ language }),
          readPublicArticlePlacements({ language }),
          readPublicGalleryPlacements({ language }),
        ]);
        if (
          categories.length === 0 &&
          articlePlacements.length === 0 &&
          galleryPlacements.length === 0
        ) {
          return;
        }

        const tree = buildContentTree({
          categories,
          placements: [...articlePlacements, ...galleryPlacements],
        });
        trees.set(route.locale, tree);
        redirects.set(route.locale, buildContentRedirects(tree, []));
      }),
    );

    return { trees, redirects };
  },
);

async function getPublicContent(): Promise<PublicContent> {
  const { contentSource, localeRoutes } = getDeploymentConfig();
  return dispatchContentSource(contentSource, {
    sanity: async () => buildSanityPublicContent(localeRoutes),
    mock: async () => {
      cachedMockContent ??= buildMockPublicContent(localeRoutes);
      return cachedMockContent;
    },
  });
}

export async function getContentTrees(): Promise<LocalizedContentTrees> {
  return (await getPublicContent()).trees;
}

/** Recorded path history per locale, for the route layer's permanent redirects. */
export async function getContentRedirects(): Promise<LocalizedContentRedirects> {
  return (await getPublicContent()).redirects;
}

/**
 * Runs one bounded listing query.
 *
 * The mock fixture in memory is not a store, so it cannot demonstrate a
 * pushed-down limit — but it honors the same contract a CMS adapter must: it
 * applies the ordering rule first and returns no more than `limit` rows. For a
 * `category-subtree` query it resolves the in-scope content ids from the tree
 * it already holds; for a `routed-content` query it uses the ids the query
 * names.
 *
 * The Sanity path splits the request by variant (a category can list galleries
 * and articles side by side) and runs both bounded reads concurrently, then
 * re-orders and re-bounds the merged result exactly as `content-listing.ts`
 * orders a single page — the same "each side contributes its own top
 * candidates" reasoning the per-variant readers already apply across their own
 * byte-budget chunks. A `category-subtree` query reaches the category-scoped
 * readers, which page the store by the subtree category ids rather than by an
 * unbounded per-content-id list; a `routed-content` query reaches the
 * content-id readers. The route never sees a row past the page it asked for.
 */
async function queryListingRecords(
  locale: string,
  tree: ContentTree,
  query: ContentListingQuery,
): Promise<readonly ContentListingRecord[]> {
  const { contentSource } = getDeploymentConfig();

  return dispatchContentSource(contentSource, {
    // See dispatchContentSource's own doc comment for why these imports are dynamic.
    sanity: async () => {
      const language = languageOf(locale);

      if (query.scope === "category-subtree") {
        const [
          { readPublicArticleListingRecordsInCategories },
          { readPublicGalleryListingRecordsInCategories },
        ] = await Promise.all([
          import("@/lib/sanity-article"),
          import("@/lib/sanity-gallery"),
        ]);

        const [articleRecords, galleryRecords] = await Promise.all([
          readPublicArticleListingRecordsInCategories(query, { language }),
          readPublicGalleryListingRecordsInCategories(query, { language }),
        ]);

        return orderContentListingRecords([
          ...articleRecords,
          ...galleryRecords,
        ]).slice(0, query.limit);
      }

      const [{ readPublicArticleListingRecords }, { readPublicGalleryListingRecords }] =
        await Promise.all([
          import("@/lib/sanity-article"),
          import("@/lib/sanity-gallery"),
        ]);

      const articleIds: string[] = [];
      const galleryIds: string[] = [];
      for (const contentId of query.contentIds) {
        if (tree.placements.get(contentId)?.variant === "gallery") {
          galleryIds.push(contentId);
        } else {
          articleIds.push(contentId);
        }
      }

      const [articleRecords, galleryRecords] = await Promise.all([
        readPublicArticleListingRecords(
          { ...query, contentIds: articleIds },
          { language },
        ),
        readPublicGalleryListingRecords(
          { ...query, contentIds: galleryIds },
          { language },
        ),
      ]);

      return orderContentListingRecords([
        ...articleRecords,
        ...galleryRecords,
      ]).slice(0, query.limit);
    },
    mock: async () => {
      const authored = mockContentListingRecords[languageOf(locale)];
      const contentIds =
        query.scope === "category-subtree"
          ? listContentIdsInCategories(tree, query.categoryIds)
          : query.contentIds;
      const rows = contentIds.flatMap((contentId) => {
        const record = authored?.get(contentId);
        return record === undefined ? [] : [record];
      });

      // The mock is not a store, so it applies the keyset boundary and the
      // limit here — the same contract a `?cursor=` store query must honour.
      const windowed =
        query.after === undefined
          ? rows
          : selectContentListingAfterBoundary(rows, query.after);

      return orderContentListingRecords(windowed).slice(0, query.limit);
    },
  });
}

/**
 * The conservative `visibilityVersion` for one category branch's continuation
 * cursor (AB#140, ADR-0013).
 *
 * Two halves, so both hazards a keyset cursor over `(eventDate, contentId)`
 * cannot otherwise survive are covered:
 *
 * - a digest of the in-scope subtree category id list — recomputed from the
 *   tree every request, so a category re-parent that reshapes membership
 *   changes it with no query; and
 * - a content-mutation signal: for the mock, a digest of every in-scope
 *   record's `(contentId, eventDate)` — the already-resolved effective event
 *   date (AB#150, ADR-0017) — so editing either authored date changes it; for
 *   Sanity, the most recently updated in-scope document's `_updatedAt`, which
 *   an edit to either always bumps (`sanity-content-tree.ts`).
 */
async function computeCategoryListingVisibilityVersion(
  locale: string,
  tree: ContentTree,
  subtreeCategoryIds: readonly string[],
): Promise<string> {
  const subtreeDigest = digest(
    JSON.stringify([...subtreeCategoryIds].sort()),
  );
  const { contentSource } = getDeploymentConfig();

  const contentVersion = await dispatchContentSource(contentSource, {
    sanity: async () => {
      const { readPublicCategoryListingContentVersion } = await import(
        "@/lib/sanity-content-tree"
      );
      return readPublicCategoryListingContentVersion({
        subtreeCategoryIds,
        language: languageOf(locale),
      });
    },
    mock: async () => {
      const authored = mockContentListingRecords[languageOf(locale)];
      const pairs = listContentIdsInCategories(tree, subtreeCategoryIds)
        .flatMap((contentId) => {
          const record = authored?.get(contentId);
          return record === undefined
            ? []
            : [`${contentId} ${record.eventDate}`];
        })
        .sort();
      return digest(JSON.stringify(pairs));
    },
  });

  return `${subtreeDigest}:${contentVersion}`;
}

/** A short, bounded, URL-safe digest for a cursor scope field. */
function digest(input: string): string {
  return createHash("sha256").update(input).digest("base64url").slice(0, 32);
}

/**
 * Why a content-page-seam Sanity read failed to answer at all: either a
 * `contentId` did not resolve to one unambiguous content page, or a caller
 * asked for something no reader is wired for yet (a content variant with no
 * Sanity-backed reader).
 */
export type SanityContentPageRejection =
  | "ambiguous-content-identity"
  | "unsupported-variant";

/**
 * Raised by `getContentPage`'s Sanity path, matching the classified-error
 * convention every other Sanity adapter in this codebase follows
 * (`SanityArticleError`, `SanityGalleryError`, `SanityContentTreeError`, each
 * carrying a `.rejection` discriminant) — this seam's own composition of two
 * of them deserves the same, rather than an unclassified `TypeError` a
 * route-level error boundary or log pattern-matching on `Sanity*Error` would
 * never recognize.
 */
export class SanityContentPageError extends Error {
  readonly rejection: SanityContentPageRejection;
  readonly contentId: string;

  constructor(rejection: SanityContentPageRejection, detail: string, contentId: string) {
    super(`[content] ${detail} (contentId "${contentId}")`);
    this.name = "SanityContentPageError";
    this.rejection = rejection;
    this.contentId = contentId;
  }
}

/**
 * One content page in one locale, or `undefined` when that locale publishes no
 * version of it.
 *
 * Read only by a detail route, and only after the tree has resolved the path to
 * this `contentId`: the body is exactly what a listing query must never load.
 *
 * `variant`, when the caller has it, lets the Sanity path read exactly one
 * per-variant document instead of both concurrently — the route always has
 * it, having just resolved this `contentId`'s placement from the tree. A
 * caller with no hint (an existence check reached from a redirect or
 * not-found boundary) gets both variants read concurrently and a thrown error
 * if a content id somehow resolves to both, which would be a defect no
 * current Studio validation can produce for an ordinary publish but which an
 * API write bypassing it still could.
 */
export const getContentPage: ContentPageSource = async (
  locale,
  contentId,
  variant,
) => {
  const { contentSource } = getDeploymentConfig();

  return dispatchContentSource(contentSource, {
    // See dispatchContentSource's own doc comment for why these imports are
    // dynamic. The variant-hint branch below is a second, unrelated axis of
    // dispatch — which reader to call, not which source — left as its own
    // if/else rather than folded into dispatchContentSource, which only ever
    // decides between exactly two source handlers.
    sanity: async () => {
      const language = languageOf(locale);

      if (variant === "article") {
        const { readPublicArticlePage } = await import("@/lib/sanity-article");
        return readPublicArticlePage(contentId, { language });
      }
      if (variant === "gallery") {
        const { readPublicGalleryPage } = await import("@/lib/sanity-gallery");
        return readPublicGalleryPage(contentId, { language });
      }

      const [{ readPublicArticlePage }, { readPublicGalleryPage }] =
        await Promise.all([
          import("@/lib/sanity-article"),
          import("@/lib/sanity-gallery"),
        ]);
      const [articlePage, galleryPage] = await Promise.all([
        readPublicArticlePage(contentId, { language }),
        readPublicGalleryPage(contentId, { language }),
      ]);
      if (articlePage !== undefined && galleryPage !== undefined) {
        throw new SanityContentPageError(
          "ambiguous-content-identity",
          `this content identity resolves to both an article and a gallery in locale "${locale}"`,
          contentId,
        );
      }
      return articlePage ?? galleryPage;
    },
    mock: async () => {
      const page = mockContentPages[languageOf(locale)]?.get(contentId);
      // Belt-and-suspenders repeat of the tree-build gate above (AB#150,
      // ADR-0017 decision 5): the tree already keeps an ended page's
      // placement out of routing, but this source is also reachable directly
      // by contentId (a redirect or not-found existence check), so it applies
      // the same `now >= endDate` check rather than trusting the caller
      // always resolved through a gated placement first.
      if (page !== undefined && isContentEnded(page.endDate, new Date())) {
        return undefined;
      }
      return page;
    },
  });
};

/**
 * Runs one bounded neighbour query against the mock's in-memory rows.
 *
 * The mock holds its rows in memory, so it orders and picks in memory here.
 * `querySanityAdjacentRecords` below is the store-backed counterpart.
 */
async function queryMockAdjacentRecords(
  locale: string,
  query: AdjacentContentQuery,
): Promise<AdjacentContentRecords> {
  const authored = mockContentListingRecords[languageOf(locale)];
  const rows = query.contentIds.flatMap((contentId) => {
    const record = authored?.get(contentId);
    return record === undefined ? [] : [record];
  });

  return selectAdjacentRecords(rows, query.anchorContentId);
}

/**
 * Runs one bounded neighbour query against Sanity: the two keyset
 * comparisons the query describes, returning at most one row from each
 * direction — never the whole candidate set.
 *
 * Only the article variant has a real reader today
 * (`readPublicArticleAdjacentRecords`): the one current caller of
 * `getAdjacentContent` (the catch-all route's article branch) never requests
 * gallery neighbours, and building an unreachable, untested reader ahead of
 * any route that would call it is exactly the speculative capability this
 * project's own MVP-first rule argues against. A gallery anchor reaching
 * here — which no current route or caller does — fails loudly rather than
 * silently answering `{}`, so a future caller that starts requesting it
 * cannot mistake "not built yet" for "this gallery has no neighbours."
 */
async function querySanityAdjacentRecords(
  locale: string,
  tree: ContentTree,
  contentId: string,
): Promise<AdjacentContentRecords> {
  const variant = tree.placements.get(contentId)?.variant;
  if (variant === "article") {
    const { readPublicArticleAdjacentRecords } = await import(
      "@/lib/sanity-article"
    );
    return readPublicArticleAdjacentRecords(contentId, {
      language: languageOf(locale),
    });
  }

  // Classified (AB#139), not a plain Error: this file's own convention is
  // that every Sanity-seam failure carries a `.rejection` discriminant a
  // route-level error boundary or log filter can pattern-match on. Currently
  // unreachable from production — every caller resolves a variant before
  // requesting adjacent content — but a future caller hitting this should
  // still fail through the same recognizable family as every other content-
  // page error, not surface as a generic unhandled exception.
  throw new SanityContentPageError(
    "unsupported-variant",
    `getAdjacentContent has no Sanity-backed sibling-navigation reader for variant ${JSON.stringify(variant)}; only "article" is wired, matching every current caller`,
    contentId,
  );
}

function requireTree(
  trees: LocalizedContentTrees,
  locale: string,
): ContentTree {
  const tree = trees.get(locale);
  if (tree === undefined) {
    throw new TypeError(`locale "${locale}" publishes no content tree`);
  }
  return tree;
}

/**
 * One branch listing: `null` lists the locale's story root.
 *
 * `cursor` is an opaque category-listing continuation token (AB#140, ADR-0013),
 * meaningful only for a category branch — the story root has no continuation
 * contract, so the route never carries one there. A token that is malformed,
 * tampered with, scoped to another branch/locale, or stale (an in-scope date
 * edit or a subtree reshape has moved its boundary) throws
 * `ContentListingCursorError`, which the route answers with a 404 rather than
 * quietly serving the first page under a URL that promised a later slice.
 */
export async function getCategoryListing(
  locale: string,
  categoryId: string | null,
  cursor?: string,
): Promise<CategoryListing> {
  const tree = requireTree(await getContentTrees(), locale);

  if (categoryId === null) {
    // No continuation contract here; any `cursor` the route failed to reject is
    // ignored rather than turned into a story-root continuation.
    const query = buildContentListingQuery({ tree, categoryId });
    return buildCategoryListing({
      tree,
      categoryId,
      records: await queryListingRecords(locale, tree, query),
    });
  }

  const { contentListingCursorCodec } = await import(
    "@/lib/content-listing-cursor"
  );

  const subtreeCategoryIds = listCategorySubtreeIds(tree, categoryId);
  const scope = {
    locale,
    categoryId,
    visibilityVersion: await computeCategoryListingVisibilityVersion(
      locale,
      tree,
      subtreeCategoryIds,
    ),
    pageSize: MAX_CONTENT_LISTING_PAGE_SIZE,
  };

  let after: ContentListingBoundary | undefined;
  if (cursor !== undefined) {
    // Throws ContentListingCursorError on an unspendable token; the route 404s.
    const decoded = contentListingCursorCodec.decode(cursor, scope);
    after = {
      eventDate: decoded.afterEventDate,
      contentId: decoded.afterContentId,
    };
  }

  const query = buildContentListingQuery({ tree, categoryId, after });

  return buildCategoryListing({
    tree,
    categoryId,
    records: await queryListingRecords(locale, tree, query),
    encodeCursor: (boundary) =>
      contentListingCursorCodec.encode(scope, {
        afterEventDate: boundary.eventDate,
        afterContentId: boundary.contentId,
      }),
  });
}

/**
 * The pages either side of one page in its variant's global publication order.
 * Empty when the page has no canonical placement or stands alone in that
 * sequence.
 */
export async function getAdjacentContent(
  locale: string,
  contentId: string,
): Promise<AdjacentContent> {
  const tree = requireTree(await getContentTrees(), locale);
  const query = buildAdjacentContentQuery(tree, contentId);
  if (query === null) return {};

  const { contentSource } = getDeploymentConfig();
  const records = await dispatchContentSource(contentSource, {
    sanity: async () => querySanityAdjacentRecords(locale, tree, contentId),
    mock: async () => queryMockAdjacentRecords(locale, query),
  });

  return resolveAdjacentContent({
    tree,
    contentId,
    records,
  });
}
