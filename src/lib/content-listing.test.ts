import { describe, expect, it } from "vitest";

import {
  buildAdjacentContentQuery,
  buildCategoryListing,
  buildContentListingQuery,
  CONTENT_LISTING_ORDERING,
  listCategoryContentIds,
  listContentIdsInCategories,
  MAX_CONTENT_LISTING_PAGE_SIZE,
  orderContentListingRecords,
  resolveAdjacentContent,
  selectAdjacentRecords,
  selectContentListingAfterBoundary,
  type ContentListingBoundary,
  type ContentListingQuery,
  type ContentListingRecord,
} from "@/lib/content-listing";
import { buildContentTree, type ContentTreeInput } from "@/lib/content-tree";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import { mockContentTreeInputs } from "@/lib/mock-content-tree";
import {
  FIELDNOTE_NUMBERS,
  fieldnoteContentId,
} from "@/lib/mock-fieldnotes";
import { mockImages } from "@/lib/mock-media";

/**
 * The generated Gear "field note" articles, in aggregated (newest-first) order.
 * Every one is dated January 2023, so they sort after everything else in the
 * English fixture and every tree-wide id list simply ends with this suffix.
 */
const FIELDNOTE_IDS = FIELDNOTE_NUMBERS.map(fieldnoteContentId);

const english = buildContentTree(mockContentTreeInputs.en);
const finnish = buildContentTree(mockContentTreeInputs.fi);
const englishRecords = mockContentListingRecords.en;

/**
 * The candidate content ids the mock adapter resolves for a query, honoring
 * both scopes exactly as `content.ts#queryListingRecords` does.
 */
function candidateContentIds(query: ContentListingQuery): readonly string[] {
  return query.scope === "category-subtree"
    ? listContentIdsInCategories(english, query.categoryIds)
    : query.contentIds;
}

/** Runs the bounded query the route runs, then assembles what it returned. */
function listing(categoryId: string | null, pageSize?: number) {
  const tree = english;
  const query = buildContentListingQuery({
    tree,
    categoryId,
    ...(pageSize === undefined ? {} : { pageSize }),
  });
  const rows = orderContentListingRecords(
    candidateContentIds(query).flatMap((id) => {
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
  { contentId: "b-page", title: "B", eventDate: "2024-05-01" },
  { contentId: "a-page", title: "A", eventDate: "2024-05-01" },
  { contentId: "older", title: "Older", eventDate: "2023-01-01" },
  { contentId: "newest", title: "Newest", eventDate: "2025-02-02" },
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

  it("aggregates content from the whole descendant subtree", () => {
    // `cat-europe` places nothing of its own, but its depth-5 descendant
    // `cat-polar-night` holds a gallery — the parent now surfaces it.
    expect(listCategoryContentIds(english, "cat-europe")).toEqual([
      "content-polar-night-sessions",
    ]);
    // `cat-landscape` has its own article plus a gallery in child `cat-coastal`.
    expect(listCategoryContentIds(english, "cat-landscape")).toEqual([
      "content-coastal-mornings",
      "content-reading-coastal-light",
    ]);
  });

  it("aggregates downward only — a descendant never shows a sibling's content", () => {
    // `cat-coastal` is a child of `cat-landscape`; it must not pick up
    // `cat-landscape`'s own `content-reading-coastal-light`.
    expect(listCategoryContentIds(english, "cat-coastal")).toEqual([
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
      "content-large-archive",
      "content-shuffled-showcase",
      "content-choosing-a-telephoto-lens",
      "content-understanding-exposure-triangle",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
      "content-ended-gallery",
      "content-ended-article",
      ...FIELDNOTE_IDS,
    ]);
    expect(listCategoryContentIds(finnish, null)).toEqual([
      "content-selected-work",
      "content-coastal-mornings",
      "content-reading-coastal-light",
      "content-polar-night-sessions",
      "content-awaiting-selection",
      "content-large-archive",
      "content-shuffled-showcase",
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
    // The story root is bounded to one page: the eleven newest routed pages
    // by *effective event date* (AB#150, ADR-0017) — `content-reading-coastal-
    // light` (eventDate 2025-03-15) and `content-polar-night-sessions`
    // (eventDate 2024-01-15) sort by that authored date rather than their
    // `publishedAt` — then the newest field notes fill the rest of the page
    // (all dated Jan 2023). `content-ended-gallery`/`content-ended-article`
    // (2019/2018) sort after all of these and never reach this bounded page.
    expect(listing(null).content.map((entry) => entry.contentId)).toEqual([
      "content-reading-coastal-light",
      "content-selected-work",
      "content-choosing-a-telephoto-lens",
      "content-understanding-exposure-triangle",
      "content-coastal-mornings",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
      "content-polar-night-sessions",
      "content-awaiting-selection",
      "content-large-archive",
      "content-shuffled-showcase",
      ...FIELDNOTE_IDS.slice(0, MAX_CONTENT_LISTING_PAGE_SIZE - 11),
    ]);
  });

  it("shows a branch category's own child links beside its aggregated subtree content", () => {
    const branch = listing("cat-europe");

    // `cat-europe` places nothing directly; the grid is its descendant
    // `cat-polar-night`'s gallery, and the child link into `cat-nordics` is
    // still listed alongside it.
    expect(branch.childCategories.map((child) => child.categoryId)).toEqual([
      "cat-nordics",
    ]);
    expect(branch.content.map((entry) => entry.contentId)).toEqual([
      "content-polar-night-sessions",
    ]);
  });

  it("lists both child categories and aggregated subtree content in one branch", () => {
    const branch = listing("cat-landscape");

    expect(branch.childCategories.map((child) => child.path)).toEqual([
      ["landscape", "coastal"],
    ]);
    // Its own article, newest first, then the child category's gallery.
    expect(branch.content.map((entry) => entry.contentId)).toEqual([
      "content-reading-coastal-light",
      "content-coastal-mornings",
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
      eventDate: "2024-06-18",
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
            eventDate: "2024-12-05",
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
            eventDate: "last summer",
          },
        ],
      }),
    ).toThrow(/unparseable eventDate/);
  });
});

describe("buildContentListingQuery", () => {
  it("scopes a branch by its subtree category ids, one page plus one row", () => {
    // `cat-europe` plus every category beneath it, so a store adapter pages the
    // subtree without an unbounded per-content-id candidate list.
    expect(
      buildContentListingQuery({
        tree: english,
        categoryId: "cat-europe",
        pageSize: 4,
      }),
    ).toEqual({
      scope: "category-subtree",
      categoryIds: ["cat-europe", "cat-nordics", "cat-winter", "cat-polar-night"],
      ordering: CONTENT_LISTING_ORDERING,
      limit: 5,
    });
  });

  it("scopes the story root by an explicit routed-content id list", () => {
    const query = buildContentListingQuery({ tree: english, categoryId: null });

    if (query.scope !== "routed-content") {
      throw new Error(`expected a routed-content query, got ${query.scope}`);
    }
    expect(query.ordering).toBe(CONTENT_LISTING_ORDERING);
    expect(query.limit).toBe(MAX_CONTENT_LISTING_PAGE_SIZE + 1);
    expect(query.contentIds).toEqual([
      "content-selected-work",
      "content-coastal-mornings",
      "content-reading-coastal-light",
      "content-polar-night-sessions",
      "content-awaiting-selection",
      "content-large-archive",
      "content-shuffled-showcase",
      "content-choosing-a-telephoto-lens",
      "content-understanding-exposure-triangle",
      "content-packing-for-a-photo-trip",
      "content-shooting-in-low-light",
      "content-ended-gallery",
      "content-ended-article",
      ...FIELDNOTE_IDS,
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

describe("subtree aggregation edge cases", () => {
  // Motorsport
  //   ├─ Formula   (holds `formula-gp` canonically)
  //   └─ Rally     (holds `rally-finland` canonically; `formula-gp` secondary)
  // plus `landscape-feature`, canonical outside Motorsport, secondary in Rally.
  const input: ContentTreeInput = {
    categories: [
      { categoryId: "motorsport", parentId: null, slug: "motorsport", label: "Motorsport", order: 0 },
      { categoryId: "formula", parentId: "motorsport", slug: "formula", label: "Formula", order: 0 },
      { categoryId: "rally", parentId: "motorsport", slug: "rally", label: "Rally", order: 1 },
      { categoryId: "landscape", parentId: null, slug: "landscape", label: "Landscape", order: 1 },
    ],
    placements: [
      {
        contentId: "formula-gp",
        variant: "gallery",
        slug: "formula-gp",
        published: true,
        canonicalCategoryId: "formula",
        secondaryCategoryIds: ["rally"],
      },
      {
        contentId: "rally-finland",
        variant: "gallery",
        slug: "rally-finland",
        published: true,
        canonicalCategoryId: "rally",
      },
      {
        contentId: "landscape-feature",
        variant: "article",
        slug: "landscape-feature",
        published: true,
        canonicalCategoryId: "landscape",
        secondaryCategoryIds: ["rally"],
      },
    ],
  };
  const tree = buildContentTree(input);

  it("lists a page placed in two descendants of the subtree exactly once", () => {
    // `formula-gp` is canonical in Formula and secondary in Rally, both under
    // Motorsport. It appears once, not twice.
    expect(listCategoryContentIds(tree, "motorsport")).toEqual([
      "formula-gp",
      "rally-finland",
      "landscape-feature",
    ]);
  });

  it("rolls a page up to an ancestor through a secondary placement inside the subtree", () => {
    // `landscape-feature` is canonical under Landscape — outside Motorsport —
    // but secondary-placed in Rally, so Motorsport surfaces it (AC1) while
    // Rally shows it directly and Formula does not.
    expect(listCategoryContentIds(tree, "rally")).toEqual([
      "formula-gp",
      "rally-finland",
      "landscape-feature",
    ]);
    expect(listCategoryContentIds(tree, "formula")).toEqual(["formula-gp"]);
    // Landscape's own listing is unaffected by the cross-branch secondary link.
    expect(listCategoryContentIds(tree, "landscape")).toEqual([
      "landscape-feature",
    ]);
  });

  it("keeps the mock adapter's candidate resolution in step with the query scope", () => {
    const query = buildContentListingQuery({ tree, categoryId: "motorsport" });
    if (query.scope !== "category-subtree") {
      throw new Error("expected a category-subtree query");
    }
    expect(listContentIdsInCategories(tree, query.categoryIds)).toEqual([
      "formula-gp",
      "rally-finland",
      "landscape-feature",
    ]);
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
      "content-ended-article",
      ...FIELDNOTE_IDS,
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
    // The neighbours cross canonical categories while retaining the
    // *effective event date* order (AB#150, ADR-0017): coastal light,
    // telephoto, exposure, packing, then low light — `content-reading-coastal-
    // light`'s authored `eventDate` (2025-03-15) moves it ahead of its own
    // `publishedAt` (2024-08-02) order.
    expect(adjacent("content-understanding-exposure-triangle")).toEqual({
      previous: expect.objectContaining({
        contentId: "content-choosing-a-telephoto-lens",
        path: ["gear", "choosing-a-telephoto-lens"],
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
      // The newest field note (Jan 2023) is now the older neighbour.
      next: expect.objectContaining({
        contentId: fieldnoteContentId(1),
        path: ["gear", "fieldnote-01"],
      }),
    });
  });

  it("gives the newest page only its older neighbour", () => {
    // `content-reading-coastal-light` is newest by effective event date
    // (2025-03-15), even though its `publishedAt` (2024-08-02) is not the
    // most recent (AB#150, ADR-0017).
    expect(adjacent("content-reading-coastal-light")).toEqual({
      next: expect.objectContaining({
        contentId: "content-choosing-a-telephoto-lens",
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
      { contentId: "c", title: "C", eventDate: "2024-01-01" },
      { contentId: "a", title: "A", eventDate: "2024-03-01" },
      { contentId: "b", title: "B", eventDate: "2024-02-01" },
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

describe("category listing continuation (AB#140, ADR-0013)", () => {
  // A plain in-memory codec stands in for the HMAC one — signing is
  // content-listing-cursor.test.ts's concern; here only the walk matters.
  const encodeCursor = (b: ContentListingBoundary) => JSON.stringify(b);
  const decodeCursor = (c: string): ContentListingBoundary => JSON.parse(c);

  const subtreeIds = () => {
    const q = buildContentListingQuery({ tree: english, categoryId: "cat-gear" });
    if (q.scope !== "category-subtree") throw new Error("expected subtree scope");
    return q.categoryIds;
  };

  const runPage = (pageSize: number, cursor?: string) => {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    const query = buildContentListingQuery({
      tree: english,
      categoryId: "cat-gear",
      pageSize,
      ...(after === undefined ? {} : { after }),
    });
    const inScope = listContentIdsInCategories(english, subtreeIds()).flatMap(
      (id) => {
        const record = englishRecords.get(id);
        return record === undefined ? [] : [record];
      },
    );
    const windowed =
      query.after === undefined
        ? inScope
        : selectContentListingAfterBoundary(inScope, query.after);
    const rows = orderContentListingRecords(windowed).slice(0, query.limit);
    return buildCategoryListing({
      tree: english,
      categoryId: "cat-gear",
      records: rows,
      pageSize,
      encodeCursor,
    });
  };

  it("walks the whole aggregated Gear subtree page by page with no gaps or duplicates", () => {
    const expected = orderContentListingRecords(
      listContentIdsInCategories(english, subtreeIds()).flatMap((id) => {
        const record = englishRecords.get(id);
        return record === undefined ? [] : [record];
      }),
    ).map((record) => record.contentId);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = runPage(3, cursor);
      seen.push(...result.content.map((entry) => entry.contentId));
      if (result.nextCursor === undefined) {
        expect(result.hasMoreContent).toBe(false);
        break;
      }
      expect(result.hasMoreContent).toBe(true);
      cursor = result.nextCursor;
    }

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(MAX_CONTENT_LISTING_PAGE_SIZE);
  });

  it("emits nextCursor only while a further page exists", () => {
    const first = runPage(MAX_CONTENT_LISTING_PAGE_SIZE);
    expect(first.hasMoreContent).toBe(true);
    expect(first.nextCursor).toBeDefined();

    const last = runPage(MAX_CONTENT_LISTING_PAGE_SIZE, first.nextCursor);
    expect(last.hasMoreContent).toBe(false);
    expect(last.nextCursor).toBeUndefined();
  });

  it("omits nextCursor when no encodeCursor is supplied, even with more content", () => {
    const result = buildCategoryListing({
      tree: english,
      categoryId: "cat-gear",
      records: orderContentListingRecords(
        listContentIdsInCategories(english, subtreeIds()).flatMap((id) => {
          const record = englishRecords.get(id);
          return record === undefined ? [] : [record];
        }),
      ).slice(0, MAX_CONTENT_LISTING_PAGE_SIZE + 1),
      pageSize: MAX_CONTENT_LISTING_PAGE_SIZE,
    });
    expect(result.hasMoreContent).toBe(true);
    expect(result.nextCursor).toBeUndefined();
  });

  it("selectContentListingAfterBoundary keeps only records strictly after the key", () => {
    const records: ContentListingRecord[] = [
      { contentId: "a", title: "A", eventDate: "2024-03-03" },
      { contentId: "b", title: "B", eventDate: "2024-01-01" },
      { contentId: "c", title: "C", eventDate: "2024-01-01" },
      { contentId: "d", title: "D", eventDate: "2023-12-31" },
    ];
    // Boundary at (2024-01-01, "b"): "a" is newer (before), "b" is the boundary
    // itself, "c" ties on date but sorts after by id, "d" is older.
    expect(
      selectContentListingAfterBoundary(records, {
        eventDate: "2024-01-01",
        contentId: "b",
      }).map((r) => r.contentId),
    ).toEqual(["c", "d"]);
  });

  it("orders and keyset-filters on the eventDate string, matching a store's own comparison", () => {
    // A date-only value and a same-day datetime are two strings, exactly as a
    // GROQ `order(eventDate desc)` and `eventDate < $after` see them — so a
    // full walk over the mix still visits every item once, with no dup or skip.
    const records: ContentListingRecord[] = [
      { contentId: "x", title: "X", eventDate: "2024-06-18T12:00:00.000Z" },
      { contentId: "y", title: "Y", eventDate: "2024-06-18" },
      { contentId: "z", title: "Z", eventDate: "2024-06-17" },
    ];
    const ordered = orderContentListingRecords(records).map((r) => r.contentId);
    expect(ordered).toEqual(["x", "y", "z"]);

    const walked: string[] = [];
    let remaining = records;
    for (let i = 0; i < 5 && remaining.length > 0; i += 1) {
      const [head] = orderContentListingRecords(remaining);
      walked.push(head.contentId);
      remaining = [
        ...selectContentListingAfterBoundary(records, {
          eventDate: head.eventDate,
          contentId: head.contentId,
        }),
      ];
    }
    expect(walked).toEqual(["x", "y", "z"]);
  });

  it("buildContentListingQuery refuses an `after` boundary at the story root", () => {
    expect(() =>
      buildContentListingQuery({
        tree: english,
        categoryId: null,
        after: { eventDate: "2024-01-01", contentId: "x" },
      }),
    ).toThrow(/story root/);
  });
});
