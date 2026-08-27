import { describe, expect, it } from "vitest";
import {
  MAX_CATEGORY_DEPTH,
  buildContentTree,
  diffCanonicalPaths,
  getCanonicalContent,
  getCanonicalContentBySlug,
  getCanonicalContentPath,
  getCategoryAncestry,
  getCategoryDependants,
  getCategoryPath,
  getChildCategories,
  getPublicChildCategories,
  getSecondaryContent,
  isCategoryPublic,
  listCategorySubtreeIds,
  listPublicRoutePaths,
  validateContentTree,
  ContentTreeValidationError,
  type ContentCategoryInput,
  type ContentPlacementInput,
  type ContentTreeInput,
} from "@/lib/content-tree";
import {
  buildMockContentTree,
  mockContentTreeInput,
} from "@/lib/mock-content-tree";

/** Derives a fixture variant without mutating the shared mock input. */
function withCategories(
  input: ContentTreeInput,
  edit: (category: ContentCategoryInput) => ContentCategoryInput,
): ContentTreeInput {
  return { ...input, categories: input.categories.map(edit) };
}

function withPlacements(
  input: ContentTreeInput,
  edit: (placement: ContentPlacementInput) => ContentPlacementInput,
): ContentTreeInput {
  return { ...input, placements: input.placements.map(edit) };
}

const codesOf = (input: ContentTreeInput) =>
  validateContentTree(input).map((issue) => `${issue.subject}:${issue.code}`);

describe("category tree structure", () => {
  it("resolves depth from the implicit root and accepts the maximum depth", () => {
    const tree = buildMockContentTree();

    expect(tree.categories.get("cat-landscape")?.depth).toBe(1);
    expect(tree.categories.get("cat-coastal")?.depth).toBe(2);
    expect(tree.categories.get("cat-polar-night")?.depth).toBe(
      MAX_CATEGORY_DEPTH,
    );
  });

  it("keeps stable identity separate from label and slug", () => {
    const renamed = withCategories(mockContentTreeInput, (category) =>
      category.categoryId === "cat-coastal"
        ? { ...category, slug: "shoreline", label: "Shoreline" }
        : category,
    );

    const tree = buildContentTree(renamed);
    const category = tree.categories.get("cat-coastal");

    expect(category?.categoryId).toBe("cat-coastal");
    expect(category?.slug).toBe("shoreline");
    expect(category?.label).toBe("Shoreline");
  });

  it("orders siblings by author order and breaks ties by categoryId", () => {
    const tied = withCategories(mockContentTreeInput, (category) =>
      category.parentId === null ? { ...category, order: 0 } : category,
    );

    const topLevel = getChildCategories(buildContentTree(tied), null).map(
      (category) => category.categoryId,
    );

    expect(topLevel).toEqual([
      "cat-archive",
      "cat-behind-the-scenes",
      "cat-events",
      "cat-gear",
      "cat-landscape",
      "cat-portfolio",
      "cat-technique",
      "cat-travel",
    ]);
  });

  it("keeps authored sibling order when order values differ", () => {
    const topLevel = getChildCategories(buildMockContentTree(), null).map(
      (category) => category.slug,
    );

    expect(topLevel).toEqual([
      "portfolio",
      "landscape",
      "travel",
      "events",
      "archive",
      "gear",
      "technique",
      "behind-the-scenes",
    ]);
  });

  it("allows the same slug beneath different parents", () => {
    const input: ContentTreeInput = {
      categories: [
        { categoryId: "a", parentId: null, slug: "a", label: "A", order: 0 },
        { categoryId: "b", parentId: null, slug: "b", label: "B", order: 1 },
        { categoryId: "a-winter", parentId: "a", slug: "winter", label: "Winter", order: 0 },
        { categoryId: "b-winter", parentId: "b", slug: "winter", label: "Winter", order: 0 },
      ],
      placements: [],
    };

    expect(validateContentTree(input)).toEqual([]);
  });
});

describe("listCategorySubtreeIds", () => {
  const tree = buildMockContentTree();

  it("returns just the category itself for a leaf", () => {
    expect(listCategorySubtreeIds(tree, "cat-coastal")).toEqual(["cat-coastal"]);
  });

  it("walks the whole subtree, the category first, in sibling order", () => {
    expect(listCategorySubtreeIds(tree, "cat-travel")).toEqual([
      "cat-travel",
      "cat-europe",
      "cat-nordics",
      "cat-winter",
      "cat-polar-night",
    ]);
  });

  it("includes categories that are not themselves public", () => {
    // `cat-europe` is public only through its descendants, but it is still a
    // structural node of the walk.
    expect(listCategorySubtreeIds(tree, "cat-europe")).toEqual([
      "cat-europe",
      "cat-nordics",
      "cat-winter",
      "cat-polar-night",
    ]);
  });

  it("returns nothing for a category the tree does not contain", () => {
    expect(listCategorySubtreeIds(tree, "cat-nonexistent")).toEqual([]);
  });

  it("visits every category once when one parent has several branches", () => {
    const input: ContentTreeInput = {
      categories: [
        { categoryId: "root", parentId: null, slug: "root", label: "Root", order: 0 },
        { categoryId: "a", parentId: "root", slug: "a", label: "A", order: 0 },
        { categoryId: "b", parentId: "root", slug: "b", label: "B", order: 1 },
        { categoryId: "a1", parentId: "a", slug: "a1", label: "A1", order: 0 },
        { categoryId: "b1", parentId: "b", slug: "b1", label: "B1", order: 0 },
      ],
      placements: [],
    };

    expect(listCategorySubtreeIds(buildContentTree(input), "root")).toEqual([
      "root",
      "a",
      "b",
      "a1",
      "b1",
    ]);
  });
});

describe("category tree rejection", () => {
  it("rejects self-parenting", () => {
    const input = withCategories(mockContentTreeInput, (category) =>
      category.categoryId === "cat-coastal"
        ? { ...category, parentId: "cat-coastal" }
        : category,
    );

    expect(codesOf(input)).toContain("cat-coastal:self-parenting");
  });

  it("rejects an indirect cycle for every category in it", () => {
    const input: ContentTreeInput = {
      categories: [
        { categoryId: "a", parentId: "c", slug: "a", label: "A", order: 0 },
        { categoryId: "b", parentId: "a", slug: "b", label: "B", order: 0 },
        { categoryId: "c", parentId: "b", slug: "c", label: "C", order: 0 },
      ],
      placements: [],
    };

    expect(codesOf(input)).toEqual([
      "a:category-cycle",
      "b:category-cycle",
      "c:category-cycle",
    ]);
  });

  it("rejects an orphan whose parent is missing from the tree", () => {
    const input = withCategories(mockContentTreeInput, (category) =>
      category.categoryId === "cat-coastal"
        ? { ...category, parentId: "cat-not-published" }
        : category,
    );

    expect(codesOf(input)).toContain("cat-coastal:missing-parent");
  });

  it("rejects depth beyond the authored maximum", () => {
    const input: ContentTreeInput = {
      categories: [
        ...mockContentTreeInput.categories,
        {
          categoryId: "cat-too-deep",
          parentId: "cat-polar-night",
          slug: "too-deep",
          label: "Too deep",
          order: 0,
        },
      ],
      placements: mockContentTreeInput.placements,
    };

    expect(codesOf(input)).toContain("cat-too-deep:max-depth-exceeded");
  });

  it("reports a sibling slug collision against every participant", () => {
    const colliding: ContentCategoryInput[] = [
      { categoryId: "cat-b", parentId: null, slug: "same", label: "B", order: 1 },
      { categoryId: "cat-a", parentId: null, slug: "same", label: "A", order: 0 },
    ];

    const issues = validateContentTree({
      categories: colliding,
      placements: [],
    });

    expect(issues).toEqual([
      {
        code: "sibling-slug-collision",
        subject: "cat-a",
        message: 'slug "same" is claimed by sibling categories "cat-a", "cat-b"',
      },
      {
        code: "sibling-slug-collision",
        subject: "cat-b",
        message: 'slug "same" is claimed by sibling categories "cat-a", "cat-b"',
      },
    ]);
  });

  it("reports the same sibling collision whatever order the input arrives in", () => {
    const colliding: ContentCategoryInput[] = [
      { categoryId: "cat-a", parentId: null, slug: "same", label: "A", order: 0 },
      { categoryId: "cat-b", parentId: null, slug: "same", label: "B", order: 1 },
    ];

    expect(
      validateContentTree({ categories: colliding, placements: [] }),
    ).toEqual(
      validateContentTree({
        categories: [...colliding].reverse(),
        placements: [],
      }),
    );
  });

  it("rejects a non-finite sibling order", () => {
    const input = withCategories(mockContentTreeInput, (category) =>
      category.categoryId === "cat-travel"
        ? { ...category, order: Number.NaN }
        : category,
    );

    expect(codesOf(input)).toContain("cat-travel:invalid-category-order");
  });

  it("rejects duplicate category ids and non-canonical slug spelling", () => {
    const input: ContentTreeInput = {
      categories: [
        { categoryId: "a", parentId: null, slug: "Winter Nights", label: "A", order: 0 },
        { categoryId: "a", parentId: null, slug: "a", label: "A", order: 1 },
      ],
      placements: [],
    };

    expect(codesOf(input)).toEqual([
      "a:duplicate-category-id",
      "a:invalid-category-slug",
    ]);
  });

  it("reports every issue in one deterministic pass", () => {
    const input = withCategories(mockContentTreeInput, (category) =>
      category.categoryId === "cat-coastal"
        ? { ...category, parentId: "cat-coastal", label: "  " }
        : category,
    );

    expect(codesOf(input)).toEqual([
      "cat-coastal:empty-category-label",
      "cat-coastal:self-parenting",
      "content-coastal-mornings:missing-canonical-category",
    ]);
    // Reversing the input must not change the diagnostics.
    expect(codesOf(input)).toEqual(
      codesOf({
        categories: [...input.categories].reverse(),
        placements: [...input.placements].reverse(),
      }),
    );
  });

  it("blames the self-parenting category, not its descendants", () => {
    const input: ContentTreeInput = {
      categories: [
        { categoryId: "cat-loop", parentId: "cat-loop", slug: "loop", label: "Loop", order: 0 },
        { categoryId: "cat-child", parentId: "cat-loop", slug: "child", label: "Child", order: 0 },
      ],
      placements: [],
    };

    expect(codesOf(input)).toEqual([
      "cat-child:category-cycle",
      "cat-loop:self-parenting",
    ]);
  });

  it("throws a validation error carrying the issues", () => {
    const input = withCategories(mockContentTreeInput, (category) =>
      category.categoryId === "cat-coastal"
        ? { ...category, parentId: "cat-coastal" }
        : category,
    );

    try {
      buildContentTree(input);
      expect.unreachable("invalid tree must not build");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentTreeValidationError);
      expect((error as ContentTreeValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: "self-parenting",
          subject: "cat-coastal",
        }),
      );
    }
  });
});

describe("canonical and secondary placement", () => {
  it("gives a published page exactly one canonical detail path", () => {
    const tree = buildMockContentTree();

    expect(getCanonicalContentPath(tree, "content-coastal-mornings")).toEqual([
      "landscape",
      "coastal",
      "coastal-mornings",
    ]);
  });

  it("resolves both variants through the same path contract", () => {
    const tree = buildMockContentTree();

    expect(tree.placements.get("content-coastal-mornings")?.variant).toBe(
      "gallery",
    );
    expect(tree.placements.get("content-reading-coastal-light")?.variant).toBe(
      "article",
    );
    expect(
      getCanonicalContentPath(tree, "content-reading-coastal-light"),
    ).toEqual(["landscape", "reading-coastal-light"]);
  });

  it("gives a secondary listing no detail path of its own", () => {
    const tree = buildMockContentTree();

    expect(
      getSecondaryContent(tree, "cat-events").map((p) => p.contentId),
    ).toEqual(["content-coastal-mornings"]);
    expect(
      getCanonicalContent(tree, "cat-events").map((p) => p.contentId),
    ).toEqual([]);
  });

  it("resolves ancestry for breadcrumbs from canonical placement only", () => {
    const tree = buildMockContentTree();
    const placement = tree.placements.get("content-coastal-mornings");

    const ancestry = getCategoryAncestry(
      tree,
      placement?.canonicalCategoryId ?? "",
    ).map((category) => category.label);

    expect(ancestry).toEqual(["Landscape", "Coastal"]);
  });

  it("leaves unpublished content unplaced without a path", () => {
    const tree = buildMockContentTree();

    expect(getCanonicalContentPath(tree, "content-unplaced-draft")).toBeNull();
  });

  it("rejects published content with no canonical category", () => {
    const input = withPlacements(mockContentTreeInput, (placement) =>
      placement.contentId === "content-unplaced-draft"
        ? { ...placement, published: true }
        : placement,
    );

    expect(codesOf(input)).toContain(
      "content-unplaced-draft:unplaced-published-content",
    );
  });

  it("rejects a canonical category that also appears as secondary", () => {
    const input = withPlacements(mockContentTreeInput, (placement) =>
      placement.contentId === "content-coastal-mornings"
        ? { ...placement, secondaryCategoryIds: ["cat-coastal"] }
        : placement,
    );

    expect(codesOf(input)).toContain(
      "content-coastal-mornings:canonical-category-in-secondary",
    );
  });

  it("rejects unknown canonical and secondary categories", () => {
    const input = withPlacements(mockContentTreeInput, (placement) =>
      placement.contentId === "content-coastal-mornings"
        ? {
            ...placement,
            canonicalCategoryId: "cat-missing",
            secondaryCategoryIds: ["cat-also-missing", "cat-events", "cat-events"],
          }
        : placement,
    );

    expect(codesOf(input)).toEqual([
      "content-coastal-mornings:duplicate-secondary-category",
      "content-coastal-mornings:missing-canonical-category",
      "content-coastal-mornings:missing-secondary-category",
    ]);
  });

  it("rejects a content slug colliding with a public child category slug", () => {
    const input = withPlacements(mockContentTreeInput, (placement) =>
      placement.contentId === "content-reading-coastal-light"
        ? { ...placement, slug: "coastal" }
        : placement,
    );

    expect(validateContentTree(input)).toEqual([
      {
        code: "local-slug-collision",
        subject: "content-reading-coastal-light",
        message:
          'slug "coastal" is claimed beneath one category by "cat-coastal", "content-reading-coastal-light"',
      },
    ]);
  });

  it("lets a content page take the slug of an empty private child category", () => {
    // The empty child owns no public route, so it reserves nothing.
    const input: ContentTreeInput = {
      categories: [
        ...mockContentTreeInput.categories,
        {
          categoryId: "cat-empty-notes",
          parentId: "cat-landscape",
          slug: "notes",
          label: "Notes",
          order: 9,
        },
      ],
      placements: mockContentTreeInput.placements.map((placement) =>
        placement.contentId === "content-reading-coastal-light"
          ? { ...placement, slug: "notes" }
          : placement,
      ),
    };

    const tree = buildContentTree(input);

    expect(isCategoryPublic(tree, "cat-empty-notes")).toBe(false);
    expect(
      getCanonicalContentPath(tree, "content-reading-coastal-light"),
    ).toEqual(["landscape", "notes"]);
  });

  it("rejects that same slug once the private child becomes public", () => {
    const input: ContentTreeInput = {
      categories: [
        ...mockContentTreeInput.categories,
        {
          categoryId: "cat-empty-notes",
          parentId: "cat-landscape",
          slug: "notes",
          label: "Notes",
          order: 9,
        },
      ],
      placements: [
        ...mockContentTreeInput.placements.map((placement) =>
          placement.contentId === "content-reading-coastal-light"
            ? { ...placement, slug: "notes" }
            : placement,
        ),
        {
          contentId: "content-fills-the-child",
          variant: "article",
          slug: "fills-the-child",
          published: true,
          canonicalCategoryId: "cat-empty-notes",
        },
      ],
    };

    expect(codesOf(input)).toContain(
      "content-reading-coastal-light:local-slug-collision",
    );
  });

  it("reports two canonical pages sharing a slug against both, in any order", () => {
    const extra: ContentPlacementInput = {
      contentId: "content-duplicate-slug",
      variant: "article",
      slug: "reading-coastal-light",
      published: true,
      canonicalCategoryId: "cat-landscape",
    };
    const input: ContentTreeInput = {
      categories: mockContentTreeInput.categories,
      placements: [...mockContentTreeInput.placements, extra],
    };

    expect(codesOf(input)).toEqual([
      "content-duplicate-slug:local-slug-collision",
      "content-reading-coastal-light:local-slug-collision",
    ]);
    expect(codesOf(input)).toEqual(
      codesOf({
        categories: input.categories,
        placements: [extra, ...mockContentTreeInput.placements],
      }),
    );
  });

  it("rejects a duplicate contentId even when the first copy is invalid", () => {
    const invalidFirst: ContentPlacementInput = {
      contentId: "content-twice",
      variant: "article",
      slug: "Not A Slug",
      published: true,
      canonicalCategoryId: "cat-landscape",
    };
    const validSecond: ContentPlacementInput = {
      contentId: "content-twice",
      variant: "article",
      slug: "second-copy",
      published: true,
      canonicalCategoryId: "cat-landscape",
    };

    const expected = [
      "content-twice:duplicate-content-id",
      "content-twice:invalid-content-slug",
    ];

    for (const placements of [
      [invalidFirst, validSecond],
      [validSecond, invalidFirst],
    ]) {
      expect(
        codesOf({ categories: mockContentTreeInput.categories, placements }),
      ).toEqual(expected);
    }
  });
});

describe("public visibility", () => {
  it("keeps a branch category public through its descendants", () => {
    const tree = buildMockContentTree();

    expect(getCanonicalContent(tree, "cat-europe")).toEqual([]);
    expect(isCategoryPublic(tree, "cat-europe")).toBe(true);
    expect(isCategoryPublic(tree, "cat-polar-night")).toBe(true);
  });

  it("omits an empty leaf from the public tree and navigation", () => {
    const tree = buildMockContentTree();

    expect(isCategoryPublic(tree, "cat-archive")).toBe(false);
    expect(getPublicChildCategories(tree, null).map((c) => c.slug)).toEqual([
      "portfolio",
      "landscape",
      "travel",
      "events",
      "gear",
      "technique",
      "behind-the-scenes",
    ]);
    expect(getChildCategories(tree, null)).toHaveLength(8);
  });

  it("keeps a category public when it only holds a secondary listing", () => {
    const tree = buildMockContentTree();

    expect(isCategoryPublic(tree, "cat-events")).toBe(true);
  });

  it("drops a category from the public tree when its content unpublishes", () => {
    const input = withPlacements(mockContentTreeInput, (placement) => ({
      ...placement,
      published: false,
    }));

    const tree = buildContentTree(input);

    expect(tree.publicCategoryIds.size).toBe(0);
  });
});

describe("public route paths", () => {
  it("lists a path for every public category and every canonically placed page, and nothing else", () => {
    const tree = buildMockContentTree();
    const paths = listPublicRoutePaths(tree);

    const categoryIds = paths
      .filter((path) => path.kind === "category")
      .map((path) => path.id);
    const contentIds = paths
      .filter((path) => path.kind === "content")
      .map((path) => path.id);

    expect(categoryIds).toEqual([...tree.publicCategoryIds]);
    expect(categoryIds).not.toContain("cat-archive");

    // A canonically placed, published page appears once, at its full path.
    expect(
      paths.find((path) => path.id === "content-coastal-mornings"),
    ).toEqual({
      kind: "content",
      id: "content-coastal-mornings",
      segments: ["landscape", "coastal", "coastal-mornings"],
    });

    // A secondary-only listing (cat-events) owns no content path of its own.
    expect(contentIds).not.toContain("cat-events");
    // An unpublished, unplaced draft owns no path.
    expect(contentIds).not.toContain("content-unplaced-draft");

    // Every path is unique: the local-slug-namespace guarantee holds across
    // categories and content together.
    const joined = paths.map((path) => path.segments.join("/"));
    expect(new Set(joined).size).toBe(joined.length);
  });

  it("returns nothing for a tree with no public categories", () => {
    const tree = buildContentTree({
      categories: [
        { categoryId: "cat-draft", parentId: null, slug: "draft", label: "Draft", order: 0 },
      ],
      placements: [],
    });

    expect(listPublicRoutePaths(tree)).toEqual([]);
  });
});

describe("moves, renames, and removal", () => {
  it("reports a rename as one redirect resolved by stable identity", () => {
    const previous = buildMockContentTree();
    const current = buildContentTree(
      withCategories(mockContentTreeInput, (category) =>
        category.categoryId === "cat-coastal"
          ? { ...category, slug: "shoreline" }
          : category,
      ),
    );

    expect(diffCanonicalPaths(previous, current).redirects).toEqual([
      {
        kind: "category",
        id: "cat-coastal",
        previousPath: ["landscape", "coastal"],
        currentPath: ["landscape", "shoreline"],
      },
      {
        kind: "content",
        id: "content-coastal-mornings",
        previousPath: ["landscape", "coastal", "coastal-mornings"],
        currentPath: ["landscape", "shoreline", "coastal-mornings"],
      },
    ]);
  });

  it("reports a category move for the category and its dependent content", () => {
    const previous = buildMockContentTree();
    const current = buildContentTree(
      withCategories(mockContentTreeInput, (category) =>
        category.categoryId === "cat-coastal"
          ? { ...category, parentId: "cat-travel" }
          : category,
      ),
    );

    expect(diffCanonicalPaths(previous, current).redirects).toEqual([
      {
        kind: "category",
        id: "cat-coastal",
        previousPath: ["landscape", "coastal"],
        currentPath: ["travel", "coastal"],
      },
      {
        kind: "content",
        id: "content-coastal-mornings",
        previousPath: ["landscape", "coastal", "coastal-mornings"],
        currentPath: ["travel", "coastal", "coastal-mornings"],
      },
    ]);
  });

  it("reports a canonical placement change as a content redirect", () => {
    const previous = buildMockContentTree();
    const current = buildContentTree(
      withPlacements(mockContentTreeInput, (placement) =>
        placement.contentId === "content-coastal-mornings"
          ? {
              ...placement,
              canonicalCategoryId: "cat-events",
              secondaryCategoryIds: [],
            }
          : placement,
      ),
    );

    expect(diffCanonicalPaths(previous, current).redirects).toEqual([
      {
        kind: "content",
        id: "content-coastal-mornings",
        previousPath: ["landscape", "coastal", "coastal-mornings"],
        currentPath: ["events", "coastal-mornings"],
      },
    ]);
  });

  it("never reports a redirect for secondary placement changes", () => {
    const previous = buildMockContentTree();
    const current = buildContentTree(
      withPlacements(mockContentTreeInput, (placement) =>
        placement.contentId === "content-coastal-mornings"
          ? { ...placement, secondaryCategoryIds: [] }
          : placement,
      ),
    );

    expect(diffCanonicalPaths(previous, current).redirects).toEqual([]);
  });

  it("invents no redirect when content leaves publication", () => {
    const previous = buildMockContentTree();
    const current = buildContentTree(
      withPlacements(mockContentTreeInput, (placement) =>
        placement.contentId === "content-coastal-mornings"
          ? { ...placement, published: false }
          : placement,
      ),
    );

    expect(
      diffCanonicalPaths(previous, current).redirects.filter(
        (change) => change.id === "content-coastal-mornings",
      ),
    ).toEqual([]);
  });

  it("refuses to turn a slug swap into a redirect loop", () => {
    const swap = (input: ContentTreeInput): ContentTreeInput =>
      withPlacements(input, (placement) => {
        if (placement.contentId === "content-coastal-mornings") {
          return { ...placement, slug: "reading-coastal-light" };
        }
        if (placement.contentId === "content-reading-coastal-light") {
          return { ...placement, slug: "coastal-mornings" };
        }
        return placement;
      });

    // Both pages must sit in one category for their paths to trade places.
    const sameCategory = withPlacements(mockContentTreeInput, (placement) =>
      placement.contentId === "content-coastal-mornings"
        ? { ...placement, canonicalCategoryId: "cat-landscape" }
        : placement,
    );

    const previous = buildContentTree(sameCategory);
    const current = buildContentTree(swap(sameCategory));
    const diff = diffCanonicalPaths(previous, current);

    expect(diff.redirects).toEqual([]);
    expect(diff.conflicts).toEqual([
      {
        kind: "content",
        id: "content-coastal-mornings",
        previousPath: ["landscape", "coastal-mornings"],
        currentPath: ["landscape", "reading-coastal-light"],
        claimedBy: "content-reading-coastal-light",
      },
      {
        kind: "content",
        id: "content-reading-coastal-light",
        previousPath: ["landscape", "reading-coastal-light"],
        currentPath: ["landscape", "coastal-mornings"],
        claimedBy: "content-coastal-mornings",
      },
    ]);
  });

  it("reports a plain rename as a redirect, not a conflict", () => {
    const previous = buildMockContentTree();
    const current = buildContentTree(
      withPlacements(mockContentTreeInput, (placement) =>
        placement.contentId === "content-coastal-mornings"
          ? { ...placement, slug: "quiet-coast" }
          : placement,
      ),
    );

    expect(diffCanonicalPaths(previous, current).conflicts).toEqual([]);
    expect(diffCanonicalPaths(previous, current).redirects).toHaveLength(1);
  });

  it("reports the dependants that block hiding a category", () => {
    const tree = buildMockContentTree();

    expect(getCategoryDependants(tree, "cat-landscape")).toEqual({
      childCategoryIds: ["cat-coastal"],
      canonicalContentIds: ["content-reading-coastal-light"],
    });
    expect(getCategoryDependants(tree, "cat-events")).toEqual({
      childCategoryIds: [],
      canonicalContentIds: [],
    });
  });
});

describe("path resolution boundary", () => {
  it("returns namespace-free segments the route layer prefixes", () => {
    const tree = buildMockContentTree();

    expect(getCategoryPath(tree, "cat-polar-night")).toEqual([
      "travel",
      "europe",
      "nordics",
      "winter",
      "polar-night",
    ]);
    expect(getCanonicalContentPath(tree, "content-polar-night-sessions")).toEqual(
      ["travel", "europe", "nordics", "winter", "polar-night", "polar-night-sessions"],
    );
  });

  it("resolves an unknown category and content to nothing", () => {
    const tree = buildMockContentTree();

    expect(getCategoryPath(tree, "cat-missing")).toEqual([]);
    expect(getCanonicalContentPath(tree, "content-missing")).toBeNull();
  });

  it("finds a page by the slug its canonical category gave it", () => {
    const tree = buildMockContentTree();

    expect(
      getCanonicalContentBySlug(tree, "cat-coastal", "coastal-mornings")
        ?.contentId,
    ).toBe("content-coastal-mornings");
  });

  it("finds nothing by slug beneath a category that only lists the page", () => {
    const tree = buildMockContentTree();

    // A secondary placement owns no detail route, so its slug claims nothing
    // there and cannot collide with a page that category owns canonically.
    expect(
      getCanonicalContentBySlug(tree, "cat-events", "coastal-mornings"),
    ).toBeUndefined();
  });

  it("finds nothing by slug for unpublished or unknown content", () => {
    const tree = buildMockContentTree();

    expect(
      getCanonicalContentBySlug(tree, "cat-landscape", "unplaced-draft"),
    ).toBeUndefined();
    expect(
      getCanonicalContentBySlug(tree, "cat-landscape", "no-such-page"),
    ).toBeUndefined();
  });
});
