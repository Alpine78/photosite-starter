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
 * The listing projection is deliberately narrow, and so is the query. A branch
 * page must never load an article body or a gallery's media collection to
 * render a card, and it must never read a category's whole content set to show
 * one page of it. So the adapter receives a query naming the candidate ids, the
 * ordering rule, and a hard row limit, and returns at most that many already
 * ordered records. A record it did not return is not an error: it is the query
 * doing its job.
 *
 * The limit is one row wider than the page. That extra row is how the listing
 * knows more content exists without asking for a count, and it is dropped
 * before rendering. Continuation past the page is the cursor contract's (AB#66,
 * AB#72); this module reports that the bound cut the list short and stops there
 * rather than inventing a second pagination shape.
 */

import {
  getCanonicalContent,
  getCanonicalContentPath,
  getPublicChildCategories,
  getSecondaryContent,
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
   * True when the page size cut the content list short. The continuation link
   * that will expose the rest is AB#66's and AB#72's; reporting the fact keeps
   * the listing from silently claiming to be complete.
   */
  readonly hasMoreContent: boolean;
};

/**
 * One bounded listing query. An adapter must apply `ordering` first and then
 * return at most `limit` records — limiting an unordered set would return an
 * arbitrary subset of the branch.
 */
export type ContentListingQuery = {
  readonly contentIds: readonly string[];
  readonly ordering: typeof CONTENT_LISTING_ORDERING;
  /** Hard row limit: one page plus the row that reveals a next page exists. */
  readonly limit: number;
};

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
 * Every published page a branch lists: the ones it owns canonically and the
 * ones placed there as secondary listings. `null` is the story root, which owns
 * no content of its own because a canonical placement is always a category.
 *
 * The adapter is given exactly these ids, so a branch page never queries the
 * whole content set to find its own.
 */
export function listCategoryContentIds(
  tree: ContentTree,
  categoryId: string | null,
): readonly string[] {
  if (categoryId === null) return [];

  return [
    ...getCanonicalContent(tree, categoryId),
    ...getSecondaryContent(tree, categoryId),
  ].map((placement) => placement.contentId);
}

/**
 * The bounded query for one branch. The extra row past the page size is what
 * answers "is there more" without a second count query.
 */
export function buildContentListingQuery({
  tree,
  categoryId,
  pageSize = MAX_CONTENT_LISTING_PAGE_SIZE,
}: {
  readonly tree: ContentTree;
  readonly categoryId: string | null;
  readonly pageSize?: number;
}): ContentListingQuery {
  assertPageSize(pageSize);

  return {
    contentIds: listCategoryContentIds(tree, categoryId),
    ordering: CONTENT_LISTING_ORDERING,
    limit: pageSize + 1,
  };
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

/** An entry with its ordering key resolved, so sorting never re-parses a date. */
type OrderedEntry<T> = {
  readonly value: T;
  readonly timestamp: number;
  readonly contentId: string;
};

/**
 * Reads the ordering key of one record.
 *
 * Every record passes through here, including the only one in a single-entry
 * listing: a date the listing cannot order by is an adapter defect whether or
 * not this particular branch happens to have a second page to compare it with.
 */
function toOrderingKey(record: ContentListingRecord): number {
  const timestamp = Date.parse(record.publishedAt);
  if (Number.isNaN(timestamp)) {
    throw new TypeError(
      `listing record for content "${record.contentId}" has an unparseable publishedAt: "${record.publishedAt}"`,
    );
  }
  return timestamp;
}

/**
 * Newest first, then by immutable content identifier.
 *
 * The tie-breaker is not cosmetic: two pages published on the same day must
 * still order identically on every request, or a continuation page would repeat
 * or skip entries once one exists.
 */
function compareEntries<T>(
  left: OrderedEntry<T>,
  right: OrderedEntry<T>,
): number {
  const difference = right.timestamp - left.timestamp;
  if (difference !== 0) return difference;
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
      timestamp: toOrderingKey(value),
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
}: {
  readonly tree: ContentTree;
  /** `null` lists the story root, which has only top-level categories. */
  readonly categoryId: string | null;
  /** At most `pageSize + 1` rows, as `buildContentListingQuery` asked for. */
  readonly records: readonly ContentListingRecord[];
  readonly pageSize?: number;
}): CategoryListing {
  assertPageSize(pageSize);

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

  return {
    childCategories,
    content: ordered.slice(0, pageSize),
    hasMoreContent: ordered.length > pageSize,
  };
}
