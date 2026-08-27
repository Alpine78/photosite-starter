/**
 * What a public category branch lists, and in which order.
 *
 * ADR-0003 decision 8 fixes the order: public child categories in sibling order
 * first, then content pages newest first with the immutable content identifier
 * as the tie-breaker. A page listed through a secondary placement takes part in
 * exactly that order and links to its one canonical detail route, so a category
 * that is public only because of secondary listings still has something to
 * show. What an entry *displays* is presentation; this module decides which
 * entries exist, in which order, and how many.
 *
 * A branch lists content from its whole descendant subtree, not only its own
 * direct placements (ADR-0003, 2026-08-27 amendment): a page whose canonical or
 * secondary placement is in this category or in any category beneath it takes
 * part in the one order above. Aggregation is downward only — a descendant's own
 * listing is unaffected. The story root keeps its own separate rule: every
 * published, routed, canonically placed page across the whole tree.
 *
 * The listing projection is deliberately narrow, and so is the query. A branch
 * page must never load an article body or a gallery's media collection to
 * render a card, and it must never read a category's whole content set to show
 * one page of it. So for a branch the adapter receives the in-scope subtree
 * category ids, the ordering rule, and a hard row limit, and answers with a
 * category-scoped query — its cost scales with the number of categories in the
 * subtree, not the amount of content in it. The story root query still names
 * its candidate content ids directly. Either way the adapter returns at most
 * `limit` already-ordered records; a record it did not return is not an error,
 * it is the query doing its job. (Paging past that first bounded page is the
 * category continuation contract's, added under AB#140 and recorded in
 * ADR-0013.)
 *
 * The limit is one row wider than the page. That extra row is how the listing
 * knows more content exists without asking for a count, and it is dropped
 * before rendering. Continuation past the page is the cursor contract's (AB#66,
 * AB#72); this module reports that the bound cut the list short and stops there
 * rather than inventing a second pagination shape.
 */

import {
  getCanonicalContentPath,
  getPublicChildCategories,
  listCategorySubtreeIds,
  type ContentTree,
  type ContentVariant,
} from "@/lib/content-tree";
import {
  isRoutedContentVariant,
  toCategoryLink,
  type CategoryLink,
} from "@/lib/content-routes";
import type { ImageMedia } from "@/lib/media";

/**
 * Upper bound on one listing request. A branch page is a browsing surface, not
 * an archive dump: the limit exists so a category holding hundreds of pages
 * cannot turn one request into an unbounded query or an unbounded payload.
 */
export const MAX_CONTENT_LISTING_PAGE_SIZE = 24;

/**
 * The ordering rule an adapter must apply before it limits, named and versioned
 * so a stored continuation can be checked against the order it was cut from.
 * `orderContentListingRecords` is the in-memory expression of it; a query-based
 * adapter expresses the same rule in its own query language.
 */
export const CONTENT_LISTING_ORDERING = "published-desc-v1";

/**
 * The listing fields an adapter supplies for one content page.
 *
 * Cover media is optional and already validated as a public rendition: a page
 * that has none renders as a text card rather than borrowing another page's
 * image or a placeholder, because an invented cover misrepresents the work.
 */
export type ContentListingRecord = {
  readonly contentId: string;
  readonly title: string;
  /** Short lead shown on the card; omitted when the page has none. */
  readonly summary?: string;
  /** ISO 8601 date. The listing order's primary key. */
  readonly publishedAt: string;
  readonly cover?: ImageMedia;
};

export type ContentListingEntry = ContentListingRecord & {
  readonly variant: ContentVariant;
  /**
   * Canonical detail path segments beneath the story namespace. One placement
   * owns the detail route, so a secondary listing entry carries the same path
   * as the canonical listing's and creates no second page.
   */
  readonly path: readonly string[];
};

export type CategoryListing = {
  readonly childCategories: readonly CategoryLink[];
  readonly content: readonly ContentListingEntry[];
  /**
   * True when the page size cut the content list short — i.e. a continuation
   * page exists past this one.
   */
  readonly hasMoreContent: boolean;
  /**
   * The opaque continuation token for the next page, present exactly when
   * `hasMoreContent` is true and `buildCategoryListing` was given an
   * `encodeCursor` (AB#140, ADR-0013). It names "continue strictly after the
   * last item on this page" in `(publishedAt DESC, contentId ASC)` order. The
   * story root issues none — it has no continuation contract.
   */
  readonly nextCursor?: string;
};

/**
 * A keyset boundary: the `(publishedAt, contentId)` of the last item on a page,
 * handed to `buildCategoryListing`'s `encodeCursor` to mint the next token.
 */
export type ContentListingBoundary = {
  readonly publishedAt: string;
  readonly contentId: string;
};

/**
 * One bounded listing query. An adapter must apply `ordering` first and then
 * return at most `limit` records — limiting an unordered set would return an
 * arbitrary subset of the branch.
 *
 * Two scopes, because a category branch and the story root bound their
 * candidates differently (ADR-0003, 2026-08-27 amendment):
 *
 * - `category-subtree` names the in-scope category ids — this category plus
 *   every category beneath it — and the adapter returns the published pages
 *   whose canonical or secondary placement is in one of them. The candidate
 *   set is expressed as categories, not content ids, so a store-backed adapter
 *   pages it with a category-scoped query whose cost tracks the number of
 *   subtree categories rather than the amount of content in them.
 * - `routed-content` names the candidate content ids directly, for the story
 *   root's cross-tree recent overview, whose membership is not a subtree.
 */
export type ContentListingQuery = {
  readonly ordering: typeof CONTENT_LISTING_ORDERING;
  /** Hard row limit: one page plus the row that reveals a next page exists. */
  readonly limit: number;
  /**
   * A keyset continuation boundary (AB#140, ADR-0013). When set, the adapter
   * returns only rows whose `(publishedAt, contentId)` sort key is strictly
   * after this one, still ordered and still capped at `limit`. A store
   * expresses it as `publishedAt < $afterPublishedAt || (publishedAt ==
   * $afterPublishedAt && contentId > $afterContentId)` — `publishedAt` is
   * compared as the stored string, so the boundary carries it verbatim.
   * Absent on a first page and always absent for the story root, which has no
   * continuation contract.
   */
  readonly after?: ContentListingBoundary;
} & (
  | { readonly scope: "category-subtree"; readonly categoryIds: readonly string[] }
  | { readonly scope: "routed-content"; readonly contentIds: readonly string[] }
);

/** A branch query, scoped by the subtree category ids the adapter pages over. */
export type CategorySubtreeListingQuery = Extract<
  ContentListingQuery,
  { scope: "category-subtree" }
>;

/** The story root's query, scoped by an explicit candidate content-id list. */
export type RoutedContentListingQuery = Extract<
  ContentListingQuery,
  { scope: "routed-content" }
>;

/** The data-access seam a branch route reads its listing rows through. */
export type ContentListingSource = (
  query: ContentListingQuery,
) => Promise<readonly ContentListingRecord[]>;

// ---------------------------------------------------------------------------
// Adjacent pages
// ---------------------------------------------------------------------------

/**
 * One page's neighbours in the variant's global publication order.
 * `previous` is the newer page and `next` the older one, matching the article
 * sequence the pre-migration detail route exposed.
 */
export type AdjacentContent = {
  readonly previous?: ContentListingEntry;
  readonly next?: ContentListingEntry;
};

/**
 * A bounded neighbour query: the candidates, the anchor to sit between, and the
 * two rows that can result.
 *
 * Two rows, not a page: an adapter answers this with a keyset comparison
 * against the anchor's `(publishedAt, contentId)` in `ordering` and a limit of
 * one in each direction. That is what keeps sibling navigation correct in an
 * archive of any size — a page deep in the sequence has neighbours just as a
 * recent one does, without the route ever reading the whole article set to find
 * them.
 */
export type AdjacentContentQuery = {
  readonly contentIds: readonly string[];
  readonly ordering: typeof CONTENT_LISTING_ORDERING;
  /** The page whose neighbours are wanted; never returned by the query. */
  readonly anchorContentId: string;
  readonly limit: 2;
};

/** The data-access seam a detail route reads its sibling links through. */
export type AdjacentContentSource = (
  locale: string,
  query: AdjacentContentQuery,
) => Promise<AdjacentContentRecords>;

export type AdjacentContentRecords = {
  readonly previous?: ContentListingRecord;
  readonly next?: ContentListingRecord;
};

/**
 * The neighbour query for one page. Its candidates are all published pages of
 * the same routed variant, wherever their canonical categories live. AB#124
 * migrated the old flat article route, whose previous/next links followed one
 * global article sequence; changing that sequence to category-local would be a
 * visitor-navigation regression rather than a route migration.
 *
 * A variant with no detail route is left out too. Unlike a listing card, which
 * keeps pointing at the one canonical address every published page owns, a
 * sibling link exists only to carry a reader onward — offering one that lands on
 * a 404 is worse than offering the next page they can actually open. The filter
 * disappears of its own accord once every variant has a route.
 */
export function buildAdjacentContentQuery(
  tree: ContentTree,
  contentId: string,
): AdjacentContentQuery | null {
  const anchor = tree.placements.get(contentId);
  if (
    anchor === undefined ||
    !anchor.published ||
    anchor.canonicalCategoryId === null ||
    !isRoutedContentVariant(anchor.variant)
  ) {
    return null;
  }

  const contentIds = [...tree.placements.values()]
    .filter(
      (placement) =>
        placement.published &&
        placement.canonicalCategoryId !== null &&
        placement.variant === anchor.variant &&
        isRoutedContentVariant(placement.variant),
    )
    .map((placement) => placement.contentId);

  // The anchor has to survive the filter, or the neighbour comparison has
  // nothing to sit between.
  if (!contentIds.includes(contentId)) return null;

  return {
    contentIds,
    ordering: CONTENT_LISTING_ORDERING,
    anchorContentId: contentId,
    limit: 2,
  };
}

/**
 * Applies `CONTENT_LISTING_ORDERING` to the candidates an in-memory adapter
 * already holds and picks the rows either side of the anchor. A store-backed
 * adapter expresses the same two comparisons as two `LIMIT 1` queries and
 * returns what they found.
 */
export function selectAdjacentRecords(
  records: readonly ContentListingRecord[],
  anchorContentId: string,
): AdjacentContentRecords {
  const ordered = order(records);
  const anchor = ordered.findIndex(
    (record) => record.contentId === anchorContentId,
  );
  if (anchor === -1) return {};

  const previous = ordered[anchor - 1];
  const next = ordered[anchor + 1];

  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  };
}

/**
 * Turns the rows an adapter returned into links, each carrying the one
 * canonical detail path its page owns. The source owns the keyset comparison
 * that selects the immediate rows; this boundary can still reject an anchor,
 * duplicate, out-of-sequence candidate, or row with no canonical path.
 */
export function resolveAdjacentContent({
  tree,
  contentId,
  records,
}: {
  readonly tree: ContentTree;
  readonly contentId: string;
  readonly records: AdjacentContentRecords;
}): AdjacentContent {
  const query = buildAdjacentContentQuery(tree, contentId);
  const candidates = new Set(query?.contentIds ?? []);

  if (
    records.previous !== undefined &&
    records.previous.contentId === records.next?.contentId
  ) {
    throw new TypeError(
      `adjacent query returned content "${records.previous.contentId}" in both directions`,
    );
  }

  const toEntry = (
    record: ContentListingRecord | undefined,
  ): ContentListingEntry | undefined => {
    if (record === undefined) return undefined;
    if (record.contentId === contentId || !candidates.has(record.contentId)) {
      throw new TypeError(
        `adjacent record "${record.contentId}" is not a candidate for "${contentId}"`,
      );
    }

    const placement = tree.placements.get(record.contentId);
    const path = getCanonicalContentPath(tree, record.contentId);
    if (placement === undefined || path === null) {
      throw new Error(
        `adjacent content "${record.contentId}" has no canonical detail path`,
      );
    }
    return { ...record, variant: placement.variant, path };
  };

  const previous = toEntry(records.previous);
  const next = toEntry(records.next);

  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  };
}

/**
 * Every published page a branch lists: the ones canonically or secondarily
 * placed in this category or in any category within its descendant subtree
 * (ADR-0003, 2026-08-27 amendment). Aggregation is downward only, so a
 * descendant's own call returns only its own subtree's pages.
 *
 * `null` is the story root, whose recent-content overview instead draws from
 * every published, routed, canonically placed page across the whole tree. It
 * does not create a root placement or a second canonical path: every overview
 * card still links to the page's category-owned route.
 *
 * One pass over `tree.placements` (keyed by content identity, so the result is
 * naturally de-duplicated when a page is placed more than once inside the
 * subtree). Used to build the branch's membership set for validation and by the
 * mock adapter, which holds its rows in memory; a store-backed adapter is
 * instead handed the subtree category ids and pages them itself.
 */
export function listCategoryContentIds(
  tree: ContentTree,
  categoryId: string | null,
): readonly string[] {
  if (categoryId === null) {
    return [...tree.placements.values()]
      .filter(
        (placement) =>
          placement.published &&
          placement.canonicalCategoryId !== null &&
          isRoutedContentVariant(placement.variant),
      )
      .map((placement) => placement.contentId);
  }

  return listContentIdsInCategories(
    tree,
    listCategorySubtreeIds(tree, categoryId),
  );
}

/**
 * Every published page whose canonical or secondary placement is in one of
 * `categoryIds`, in `tree.placements` iteration order.
 *
 * One pass over `tree.placements`, which is keyed by content identity, so a
 * page placed more than once inside the set appears exactly once. This is the
 * in-memory expression of the `category-subtree` scope: the mock adapter and
 * the branch-membership guard use it directly, while a store-backed adapter
 * runs the equivalent category-scoped query against `categoryIds` itself.
 */
export function listContentIdsInCategories(
  tree: ContentTree,
  categoryIds: readonly string[],
): readonly string[] {
  const scope = new Set(categoryIds);
  const ids: string[] = [];
  for (const placement of tree.placements.values()) {
    if (!placement.published) continue;
    const inScope =
      (placement.canonicalCategoryId !== null &&
        scope.has(placement.canonicalCategoryId)) ||
      placement.secondaryCategoryIds.some((id) => scope.has(id));
    if (inScope) ids.push(placement.contentId);
  }
  return ids;
}

/**
 * The bounded query for one branch. The extra row past the page size is what
 * answers "is there more" without a second count query.
 *
 * A category branch is scoped by its subtree category ids so a store-backed
 * adapter pages it without an unbounded per-content-id candidate list; the
 * story root keeps its explicit candidate id list, its membership not being a
 * subtree (ADR-0003, 2026-08-27 amendment).
 */
export function buildContentListingQuery({
  tree,
  categoryId,
  pageSize = MAX_CONTENT_LISTING_PAGE_SIZE,
  after,
}: {
  readonly tree: ContentTree;
  readonly categoryId: string | null;
  readonly pageSize?: number;
  /**
   * A keyset continuation boundary (AB#140). The story root has no continuation
   * contract, so passing one with `categoryId === null` is a caller error.
   */
  readonly after?: ContentListingBoundary;
}): ContentListingQuery {
  assertPageSize(pageSize);
  if (after !== undefined && categoryId === null) {
    throw new TypeError(
      "the story root listing has no continuation contract, so it takes no `after` boundary",
    );
  }

  const common = {
    ordering: CONTENT_LISTING_ORDERING,
    limit: pageSize + 1,
    ...(after === undefined ? {} : { after }),
  } as const;

  if (categoryId === null) {
    return {
      ...common,
      scope: "routed-content",
      contentIds: listCategoryContentIds(tree, null),
    };
  }

  return {
    ...common,
    scope: "category-subtree",
    categoryIds: listCategorySubtreeIds(tree, categoryId),
  };
}

/**
 * The in-memory expression of `ContentListingQuery.after`: keep only the
 * records whose `(publishedAt, contentId)` sort key is strictly after the
 * boundary, in `CONTENT_LISTING_ORDERING`. The mock adapter applies this before
 * it limits; a store expresses the same comparison in its own query language.
 */
export function selectContentListingAfterBoundary(
  records: readonly ContentListingRecord[],
  after: ContentListingBoundary,
): readonly ContentListingRecord[] {
  if (Number.isNaN(Date.parse(after.publishedAt))) {
    throw new TypeError(
      `content listing cursor boundary has an unparseable publishedAt: "${after.publishedAt}"`,
    );
  }

  // The same comparison a store expresses as `publishedAt < $afterPublishedAt ||
  // (publishedAt == $afterPublishedAt && contentId > $afterContentId)` — on the
  // `publishedAt` string, not a parsed timestamp, so it agrees exactly with
  // `compareEntries` and with the GROQ keyset filter.
  return records.filter((record) => {
    const publishedAt = toOrderingKey(record);
    if (publishedAt !== after.publishedAt) return publishedAt < after.publishedAt;
    return record.contentId > after.contentId;
  });
}

function assertPageSize(pageSize: number): void {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > MAX_CONTENT_LISTING_PAGE_SIZE
  ) {
    throw new RangeError(
      `content listing page size must be an integer between 1 and ${MAX_CONTENT_LISTING_PAGE_SIZE}`,
    );
  }
}

/** An entry with its ordering key resolved, so sorting never re-reads a field. */
type OrderedEntry<T> = {
  readonly value: T;
  readonly publishedAt: string;
  readonly contentId: string;
};

/**
 * The ordering key of one record: its `publishedAt` **verbatim**.
 *
 * The comparison below sorts on this string, not on a parsed timestamp,
 * precisely so the in-memory order is byte-for-byte identical to a store's
 * `order(publishedAt desc, contentId asc)` and to the keyset continuation
 * filter's `publishedAt < $afterPublishedAt` string comparison
 * (`sanity-article.ts`, `sanity-gallery.ts`, ADR-0013). Parsing to a timestamp
 * here would let two representations of one instant (`2024-06-18` and
 * `2024-06-18T00:00:00.000Z`) compare equal in memory while the store treats
 * them as distinct, so a cursor cut between them could skip or repeat an item.
 * `publishedAt` values must therefore be stored in a form whose lexical order
 * is their chronological order — ISO 8601, same offset — which the schema's own
 * `Date.UTC` round-trip validation already enforces.
 *
 * `Date.parse` is still used, but only to reject an unorderable value as an
 * adapter defect. Every record passes through here, including the only one in a
 * single-entry listing.
 */
function toOrderingKey(record: ContentListingRecord): string {
  if (Number.isNaN(Date.parse(record.publishedAt))) {
    throw new TypeError(
      `listing record for content "${record.contentId}" has an unparseable publishedAt: "${record.publishedAt}"`,
    );
  }
  return record.publishedAt;
}

/**
 * Newest first (descending `publishedAt` string), then by immutable content
 * identifier ascending.
 *
 * The tie-breaker is not cosmetic: two pages published on the same date must
 * still order identically on every request, or a continuation page would repeat
 * or skip entries once one exists.
 */
function compareEntries<T>(
  left: OrderedEntry<T>,
  right: OrderedEntry<T>,
): number {
  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt < right.publishedAt ? 1 : -1;
  }
  return left.contentId < right.contentId
    ? -1
    : left.contentId > right.contentId
      ? 1
      : 0;
}

function order<T extends ContentListingRecord>(
  records: readonly T[],
): readonly T[] {
  return records
    .map((value) => ({
      value,
      publishedAt: toOrderingKey(value),
      contentId: value.contentId,
    }))
    .sort(compareEntries)
    .map(({ value }) => value);
}

/**
 * `CONTENT_LISTING_ORDERING` applied in memory. An adapter holding its rows
 * already — the mock, a cache, a fixture — reuses this instead of restating the
 * rule; one that queries a store expresses the same order there and returns the
 * rows it got.
 */
export function orderContentListingRecords(
  records: readonly ContentListingRecord[],
): readonly ContentListingRecord[] {
  return order(records);
}

/**
 * Assembles one branch listing from the validated tree and the rows the adapter
 * returned for `buildContentListingQuery`.
 *
 * The rows are re-ordered here rather than trusted: the order is the contract's,
 * and re-applying it to one bounded page costs nothing while keeping a
 * misbehaving adapter from silently reshuffling a listing. What cannot be
 * re-derived is which rows the limit cut, so a row the adapter did not return is
 * simply absent — that is the query working, not a defect. A row it returned
 * that this branch does not list is a defect, and says so.
 */
export function buildCategoryListing({
  tree,
  categoryId,
  records,
  pageSize = MAX_CONTENT_LISTING_PAGE_SIZE,
  encodeCursor,
}: {
  readonly tree: ContentTree;
  /** `null` lists the story root's categories and recent routed content. */
  readonly categoryId: string | null;
  /** At most `pageSize + 1` rows, as `buildContentListingQuery` asked for. */
  readonly records: readonly ContentListingRecord[];
  readonly pageSize?: number;
  /**
   * Mints the continuation token for the next page from the last on-page
   * item's keyset boundary (AB#140, ADR-0013). Supplied only for a category
   * branch — the story root has no continuation contract — and only when a
   * signing key is available. When it is absent, `hasMoreContent` can still be
   * true; `nextCursor` is simply omitted.
   */
  readonly encodeCursor?: (boundary: ContentListingBoundary) => string;
}): CategoryListing {
  assertPageSize(pageSize);
  if (encodeCursor !== undefined && categoryId === null) {
    throw new TypeError(
      "the story root listing has no continuation contract, so it takes no `encodeCursor`",
    );
  }

  if (records.length > pageSize + 1) {
    throw new TypeError(
      `listing query returned ${records.length} records for a limit of ${pageSize + 1}`,
    );
  }

  const childCategories = getPublicChildCategories(tree, categoryId).map(
    (category) => toCategoryLink(tree, category),
  );

  const listed = new Set(listCategoryContentIds(tree, categoryId));
  const seen = new Set<string>();

  const entries = records.map((record) => {
    if (!listed.has(record.contentId)) {
      throw new TypeError(
        `listing record for content "${record.contentId}" does not belong to this branch`,
      );
    }
    if (seen.has(record.contentId)) {
      throw new TypeError(
        `listing query returned content "${record.contentId}" more than once`,
      );
    }
    seen.add(record.contentId);

    const placement = tree.placements.get(record.contentId);
    const path = getCanonicalContentPath(tree, record.contentId);
    if (placement === undefined || path === null) {
      throw new Error(
        `listed content "${record.contentId}" has no canonical detail path`,
      );
    }

    return { ...record, variant: placement.variant, path };
  });

  const ordered = order(entries);
  const hasMoreContent = ordered.length > pageSize;
  const content = ordered.slice(0, pageSize);

  // The boundary for the next page is the last item that made *this* page, so
  // the continuation resumes strictly after it. `content` is non-empty whenever
  // `hasMoreContent` is true (there is a `pageSize + 1`th row only if there are
  // at least `pageSize` before it).
  const lastOnPage = content[content.length - 1];
  const nextCursor =
    hasMoreContent && encodeCursor !== undefined && lastOnPage !== undefined
      ? encodeCursor({
          publishedAt: lastOnPage.publishedAt,
          contentId: lastOnPage.contentId,
        })
      : undefined;

  return {
    childCategories,
    content,
    hasMoreContent,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}
