import { describe, expect, it } from "vitest";

import {
  buildCategoryListing,
  buildContentListingQuery,
  CONTENT_LISTING_ORDERING,
  listCategoryContentIds,
  MAX_CONTENT_LISTING_PAGE_SIZE,
  orderContentListingRecords,
  type ContentListingRecord,
} from "@/lib/content-listing";
import { buildContentTree, type ContentTreeInput } from "@/lib/content-tree";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import { mockContentTreeInputs } from "@/lib/mock-content-tree";
import { mockImages } from "@/lib/mock-media";

const english = buildContentTree(mockContentTreeInputs.en);
const englishRecords = mockContentListingRecords.en;

/** Runs the bounded query the route runs, then assembles what it returned. */
function listing(categoryId: string | null, pageSize?: number) {
  const tree = english;
  const query = buildContentListingQuery({
    tree,
    categoryId,
    ...(pageSize === undefined ? {} : { pageSize }),
  });
  const rows = orderContentListingRecords(
    query.contentIds.flatMap((id) => {
      const record = englishRecords.get(id);
      return record === undefined ? [] : [record];
    }),
  ).slice(0, query.limit);

  return buildCategoryListing({
    tree,
    categoryId,
    records: rows,
    ...(pageSize === undefined ? {} : { pageSize }),
  });
}

/**
 * Four pages in one category, two of them sharing a publication date, so the
 * order and the tie-breaker are both observable.
 */
const sameDayInput: ContentTreeInput = {
  categories: [
    { categoryId: "cat", parentId: null, slug: "cat", label: "Cat", order: 0 },
  ],
  placements: ["b-page", "a-page", "older", "newest"].map((contentId) => ({
    contentId,
    variant: "article" as const,
    slug: contentId,
    published: true,
    canonicalCategoryId: "cat",
  })),
};

const sameDayTree = buildContentTree(sameDayInput);
const sameDayRecords: readonly ContentListingRecord[] = [
  { contentId: "b-page", title: "B", publishedAt: "2024-05-01" },
  { contentId: "a-page", title: "A", publishedAt: "2024-05-01" },
  { contentId: "older", title: "Older", publishedAt: "2023-01-01" },
  { contentId: "newest", title: "Newest", publishedAt: "2025-02-02" },
];

describe("listCategoryContentIds", () => {
  it("lists canonically placed and secondarily listed content", () => {
    expect(listCategoryContentIds(english, "cat-coastal")).toEqual([
      "content-coastal-mornings",
    ]);
    expect(listCategoryContentIds(english, "cat-events")).toEqual([
      "content-coastal-mornings",
    ]);
  });

  it("leaves unpublished content out", () => {
    expect(listCategoryContentIds(english, "cat-archive")).toEqual([]);
  });

  it("asks for nothing at the story root, which owns no content", () => {
    expect(listCategoryContentIds(english, null)).toEqual([]);
  });
});

describe("buildCategoryListing", () => {
  it("lists public child categories in sibling order at the story root", () => {
    expect(listing(null).childCategories).toEqual([
      { categoryId: "cat-landscape", label: "Landscape", path: ["landscape"] },
      { categoryId: "cat-travel", label: "Travel", path: ["travel"] },
      { categoryId: "cat-events", label: "Events", path: ["events"] },
      { categoryId: "cat-gear", label: "Gear", path: ["gear"] },
      { categoryId: "cat-technique", label: "Technique", path: ["technique"] },
    ]);
  });

  it("renders a branch category as its children, with no content of its own", () => {
    const branch = listing("cat-travel");

    expect(branch.childCategories.map((child) => child.categoryId)).toEqual([
      "cat-europe",
    ]);
    expect(branch.content).toEqual([]);
  });

  it("lists both child categories and canonical content in one branch", () => {
    const branch = listing("cat-landscape");

    expect(branch.childCategories.map((child) => child.path)).toEqual([
      ["landscape", "coastal"],
    ]);
    expect(branch.content.map((entry) => entry.contentId)).toEqual([
      "content-reading-coastal-light",
    ]);
  });

  it("gives a secondary listing entry the one canonical detail path", () => {
    const [canonical] = listing("cat-coastal").content;
    const [secondary] = listing("cat-events").content;

    expect(secondary.contentId).toBe(canonical.contentId);
    expect(secondary.path).toEqual([
      "landscape",
      "coastal",
      "coastal-mornings",
    ]);
    expect(secondary.path).toEqual(canonical.path);
  });

  it("carries the variant and the projected listing fields", () => {
    const [entry] = listing("cat-coastal").content;

    expect(entry).toEqual({
      contentId: "content-coastal-mornings",
      variant: "gallery",
      title: "Coastal mornings",
      summary: expect.any(String),
      publishedAt: "2024-06-18",
      cover: mockImages.coastalLandscape,
      path: ["landscape", "coastal", "coastal-mornings"],
    });
  });

  it("leaves a page without a cover without one", () => {
    const [entry] = listing("cat-polar-night").content;

    expect(entry.contentId).toBe("content-polar-night-sessions");
    expect(entry.cover).toBeUndefined();
  });

  it("orders content newest first, breaking ties by content id", () => {
    const result = buildCategoryListing({
      tree: sameDayTree,
      categoryId: "cat",
      records: sameDayRecords,
    });

    expect(result.content.map((entry) => entry.contentId)).toEqual([
      "newest",
      "a-page",
      "b-page",
      "older",
    ]);
    expect(result.hasMoreContent).toBe(false);
  });

  it("bounds the listing and reports that more content exists", () => {
    // Exactly what the query asked for: one page plus the row that reveals a
    // next page. The rest of the branch is never fetched.
    const result = buildCategoryListing({
      tree: sameDayTree,
      categoryId: "cat",
      records: orderContentListingRecords(sameDayRecords).slice(0, 3),
      pageSize: 2,
    });

    expect(result.content.map((entry) => entry.contentId)).toEqual([
      "newest",
      "a-page",
    ]);
    expect(result.hasMoreContent).toBe(true);
  });

  it("treats a row the limit cut as absent, not as a defect", () => {
    const result = buildCategoryListing({
      tree: sameDayTree,
      categoryId: "cat",
      records: orderContentListingRecords(sameDayRecords).slice(0, 2),
      pageSize: 2,
    });

    expect(result.content.map((entry) => entry.contentId)).toEqual([
      "newest",
      "a-page",
    ]);
    expect(result.hasMoreContent).toBe(false);
  });

  it("re-applies the order to rows an adapter returned out of order", () => {
    const result = buildCategoryListing({
      tree: sameDayTree,
      categoryId: "cat",
      records: sameDayRecords,
    });

    expect(result.content.map((entry) => entry.contentId)).toEqual([
      "newest",
      "a-page",
      "b-page",
      "older",
    ]);
  });

  it.each([[0], [-1], [1.5], [MAX_CONTENT_LISTING_PAGE_SIZE + 1]])(
    "rejects the unbounded or invalid page size %j",
    (pageSize) => {
      expect(() =>
        buildCategoryListing({
          tree: sameDayTree,
          categoryId: "cat",
          records: [],
          pageSize,
        }),
      ).toThrow(RangeError);
    },
  );

  it("rejects more rows than the query's limit allowed", () => {
    expect(() =>
      buildCategoryListing({
        tree: sameDayTree,
        categoryId: "cat",
        records: sameDayRecords,
        pageSize: 2,
      }),
    ).toThrow(/returned 4 records for a limit of 3/);
  });

  it("rejects a row for content this branch does not list", () => {
    expect(() =>
      buildCategoryListing({
        tree: english,
        categoryId: "cat-coastal",
        records: [
          {
            contentId: "content-polar-night-sessions",
            title: "Polar night sessions",
            publishedAt: "2024-12-05",
          },
        ],
      }),
    ).toThrow(/does not belong to this branch/);
  });

  it("rejects the same content returned twice", () => {
    const record = englishRecords.get("content-coastal-mornings");
    expect(record).toBeDefined();

    expect(() =>
      buildCategoryListing({
        tree: english,
        categoryId: "cat-coastal",
        records: [record!, record!],
      }),
    ).toThrow(/more than once/);
  });

  it("rejects a publication date it cannot order by", () => {
    expect(() =>
      buildCategoryListing({
        tree: english,
        categoryId: "cat-coastal",
        records: [
          {
            contentId: "content-coastal-mornings",
            title: "Coastal mornings",
            publishedAt: "last summer",
          },
        ],
      }),
    ).toThrow(/unparseable publishedAt/);
  });
});

describe("buildContentListingQuery", () => {
  it("asks for one page plus the row that reveals a next page", () => {
    expect(
      buildContentListingQuery({
        tree: english,
        categoryId: "cat-coastal",
        pageSize: 4,
      }),
    ).toEqual({
      contentIds: ["content-coastal-mornings"],
      ordering: CONTENT_LISTING_ORDERING,
      limit: 5,
    });
  });

  it("names the ordering the adapter must apply before limiting", () => {
    const query = buildContentListingQuery({ tree: english, categoryId: null });

    expect(query.ordering).toBe(CONTENT_LISTING_ORDERING);
    expect(query.limit).toBe(MAX_CONTENT_LISTING_PAGE_SIZE + 1);
    expect(query.contentIds).toEqual([]);
  });

  it("rejects an unbounded page size before a query is issued", () => {
    expect(() =>
      buildContentListingQuery({
        tree: english,
        categoryId: "cat-coastal",
        pageSize: MAX_CONTENT_LISTING_PAGE_SIZE + 1,
      }),
    ).toThrow(RangeError);
  });
});
