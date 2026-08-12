import { describe, expect, it } from "vitest";

import {
  buildAdjacentContentQuery,
  buildCategoryListing,
  buildContentListingQuery,
  CONTENT_LISTING_ORDERING,
  listCategoryContentIds,
  MAX_CONTENT_LISTING_PAGE_SIZE,
  orderContentListingRecords,
  resolveAdjacentContent,
  selectAdjacentRecords,
  type ContentListingRecord,
} from "@/lib/content-listing";
import { buildContentTree, type ContentTreeInput } from "@/lib/content-tree";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import { mockContentTreeInputs } from "@/lib/mock-content-tree";
import { mockImages } from "@/lib/mock-media";

const english = buildContentTree(mockContentTreeInputs.en);
const finnish = buildContentTree(mockContentTreeInputs.fi);
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

  it("collects published routed content for the story-root overview", () => {
    // Both variants have a detail route now, so the overview draws from both.
    expect(listCategoryContentIds(english, null)).toEqual([
      "content-selected-work",
      "content-coastal-mornings",
      "content-reading-coastal-light",
      "content-polar-night-sessions",
      "content-awaiting-selection",
      "content-choosing-a-telephoto-lens",
      "content-understanding-exposure-triangle",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
    ]);
    expect(listCategoryContentIds(finnish, null)).toEqual([
      "content-selected-work",
      "content-coastal-mornings",
      "content-reading-coastal-light",
      "content-polar-night-sessions",
      "content-awaiting-selection",
      "content-understanding-exposure-triangle",
      "content-shooting-in-low-light",
    ]);
  });
});

describe("buildCategoryListing", () => {
  it("lists public child categories in sibling order at the story root", () => {
    expect(listing(null).childCategories).toEqual([
      { categoryId: "cat-portfolio", label: "Portfolio", path: ["portfolio"] },
      { categoryId: "cat-landscape", label: "Landscape", path: ["landscape"] },
      { categoryId: "cat-travel", label: "Travel", path: ["travel"] },
      { categoryId: "cat-events", label: "Events", path: ["events"] },
      { categoryId: "cat-gear", label: "Gear", path: ["gear"] },
      { categoryId: "cat-technique", label: "Technique", path: ["technique"] },
      {
        categoryId: "cat-behind-the-scenes",
        label: "Behind the scenes",
        path: ["behind-the-scenes"],
      },
    ]);
  });

  it("lists recent routed content across the tree at the story root", () => {
    expect(listing(null).content.map((entry) => entry.contentId)).toEqual([
      "content-selected-work",
      "content-polar-night-sessions",
      "content-choosing-a-telephoto-lens",
      "content-reading-coastal-light",
      "content-understanding-exposure-triangle",
      "content-coastal-mornings",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
      "content-awaiting-selection",
    ]);
  });

  it("renders a branch category as its children, with no content of its own", () => {
    const branch = listing("cat-europe");

    expect(branch.childCategories.map((child) => child.categoryId)).toEqual([
      "cat-nordics",
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
    // An article has no images of its own to stand in for a missing cover, so
    // its card is a text card rather than one borrowing somebody else's image.
    const entry = listing("cat-travel").content.find(
      (candidate) => candidate.contentId === "content-packing-for-a-photo-trip",
    );

    expect(entry?.cover).toBeUndefined();
  });

  it("covers a gallery with no authored cover from its own first item", () => {
    const [entry] = listing("cat-polar-night").content;

    expect(entry.contentId).toBe("content-polar-night-sessions");
    // The fallback is the gallery's opening photograph, so the card and the
    // page it leads to show the same image.
    expect(entry.cover?.mediaId).toBe("misty-birch");
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
    expect(query.contentIds).toEqual([
      "content-selected-work",
      "content-coastal-mornings",
      "content-reading-coastal-light",
      "content-polar-night-sessions",
      "content-awaiting-selection",
      "content-choosing-a-telephoto-lens",
      "content-understanding-exposure-triangle",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
    ]);
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

/** Runs the bounded neighbour query the detail route runs. */
function adjacent(contentId: string) {
  const query = buildAdjacentContentQuery(english, contentId);
  if (query === null) return {};

  const rows = query.contentIds.flatMap((id) => {
    const record = englishRecords.get(id);
    return record === undefined ? [] : [record];
  });

  return resolveAdjacentContent({
    tree: english,
    contentId,
    records: selectAdjacentRecords(rows, query.anchorContentId),
  });
}

describe("buildAdjacentContentQuery", () => {
  it("asks for two rows around the anchor, never a page of them", () => {
    const query = buildAdjacentContentQuery(
      english,
      "content-shooting-in-low-light",
    );

    expect(query?.limit).toBe(2);
    expect(query?.ordering).toBe(CONTENT_LISTING_ORDERING);
    expect(query?.anchorContentId).toBe("content-shooting-in-low-light");
  });

  it("preserves the global article sequence across canonical categories", () => {
    // The old article detail route navigated the flat article publication
    // order. Canonical placement changes URLs, not that visitor sequence.
    expect(
      buildAdjacentContentQuery(english, "content-shooting-in-low-light")
        ?.contentIds,
    ).toEqual([
      "content-reading-coastal-light",
      "content-choosing-a-telephoto-lens",
      "content-understanding-exposure-triangle",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
    ]);
  });

  it("has nothing to ask for a page with no canonical placement", () => {
    expect(buildAdjacentContentQuery(english, "content-unplaced-draft")).toBeNull();
    expect(buildAdjacentContentQuery(english, "content-missing")).toBeNull();
  });

  it("keeps a page's neighbours within its own variant", () => {
    // Sibling navigation carries a reader onward through one sequence. A
    // gallery is not the next article, so the two variants never appear in each
    // other's neighbour query even though they share the tree.
    const mixed = buildContentTree({
      categories: [
        { categoryId: "cat", parentId: null, slug: "cat", label: "Cat", order: 0 },
      ],
      placements: [
        {
          contentId: "an-article",
          variant: "article",
          slug: "an-article",
          published: true,
          canonicalCategoryId: "cat",
        },
        {
          contentId: "a-gallery",
          variant: "gallery",
          slug: "a-gallery",
          published: true,
          canonicalCategoryId: "cat",
        },
      ],
    });

    expect(buildAdjacentContentQuery(mixed, "an-article")?.contentIds).toEqual([
      "an-article",
    ]);
    expect(buildAdjacentContentQuery(mixed, "a-gallery")?.contentIds).toEqual([
      "a-gallery",
    ]);
  });
});

describe("adjacent content", () => {
  it("links the newer page as previous and the older as next", () => {
    // The neighbours cross canonical categories while retaining publication
    // order: telephoto, coastal light, exposure, packing, then low light.
    expect(adjacent("content-understanding-exposure-triangle")).toEqual({
      previous: expect.objectContaining({
        contentId: "content-reading-coastal-light",
        path: ["landscape", "reading-coastal-light"],
      }),
      next: expect.objectContaining({
        contentId: "content-packing-for-a-photo-trip",
        path: ["travel", "packing-for-a-photo-trip"],
      }),
    });
    expect(adjacent("content-shooting-in-low-light")).toEqual({
      previous: expect.objectContaining({
        contentId: "content-packing-for-a-photo-trip",
        path: ["travel", "packing-for-a-photo-trip"],
      }),
    });
  });

  it("gives the newest page only its older neighbour", () => {
    expect(adjacent("content-choosing-a-telephoto-lens")).toEqual({
      next: expect.objectContaining({
        contentId: "content-reading-coastal-light",
      }),
    });
  });

  it("carries the one canonical detail path of each neighbour", () => {
    const { previous } = adjacent("content-shooting-in-low-light");

    expect(previous?.path).toEqual([
      "travel",
      "packing-for-a-photo-trip",
    ]);
  });

  it("refuses a row that is not a candidate for this sequence", () => {
    expect(() =>
      resolveAdjacentContent({
        tree: english,
        contentId: "content-shooting-in-low-light",
        records: {
          next: englishRecords.get("content-coastal-mornings"),
        },
      }),
    ).toThrow(/not a candidate/);
  });

  it("refuses the anchor returned as its own neighbour", () => {
    expect(() =>
      resolveAdjacentContent({
        tree: english,
        contentId: "content-shooting-in-low-light",
        records: {
          previous: englishRecords.get("content-shooting-in-low-light"),
        },
      }),
    ).toThrow(/not a candidate/);
  });

  it("refuses the same row returned in both directions", () => {
    const duplicate = englishRecords.get("content-packing-for-a-photo-trip");

    expect(() =>
      resolveAdjacentContent({
        tree: english,
        contentId: "content-understanding-exposure-triangle",
        records: { previous: duplicate, next: duplicate },
      }),
    ).toThrow(/both directions/);
  });
});

describe("selectAdjacentRecords", () => {
  it("orders before it picks, so input order cannot change the answer", () => {
    const rows = [
      { contentId: "c", title: "C", publishedAt: "2024-01-01" },
      { contentId: "a", title: "A", publishedAt: "2024-03-01" },
      { contentId: "b", title: "B", publishedAt: "2024-02-01" },
    ] satisfies ContentListingRecord[];

    expect(selectAdjacentRecords(rows, "b")).toEqual({
      previous: rows[1],
      next: rows[0],
    });
    expect(selectAdjacentRecords([...rows].reverse(), "b")).toEqual({
      previous: rows[1],
      next: rows[0],
    });
  });

  it("finds nothing when the anchor is not among the candidates", () => {
    expect(selectAdjacentRecords([], "content-missing")).toEqual({});
  });
});
