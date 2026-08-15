import { describe, expect, it } from "vitest";

import {
  changesPublishedUrlFields,
  findProspectiveLocalSlugCollision,
  parseProspectiveCategories,
  resolveProspectivePublicCategoryIds,
  validateArticlePublication,
  validateProspectiveArticlePlacement,
  type ProspectiveArticleFields,
  type ProspectiveCategoryNode,
  type ProspectivePlacement,
} from "./article-validation";
import { ARTICLE_TYPE_NAME } from "./article";
import type { SchemaValidationClient, SchemaValidationContext } from "./schema-types";

const current: ProspectiveArticleFields = {
  documentId: "abc",
  contentId: "content-reading-coastal-light",
  language: "en",
  slug: "reading-coastal-light",
  canonicalCategoryId: "cat-landscape",
  secondaryCategoryIds: [],
};

function categoriesOf(
  ...nodes: readonly ProspectiveCategoryNode[]
): ReadonlyMap<string, ProspectiveCategoryNode> {
  return new Map(nodes.map((node) => [node.categoryId, node]));
}

describe("changesPublishedUrlFields", () => {
  it("is false when nothing that owns the canonical URL changed", () => {
    expect(
      changesPublishedUrlFields(
        { language: "en", slug: "reading-coastal-light", canonicalCategoryId: "cat-landscape" },
        current,
      ),
    ).toBe(false);
  });

  it.each([
    ["language", { language: "fi", slug: current.slug, canonicalCategoryId: current.canonicalCategoryId }],
    ["slug", { language: current.language, slug: "renamed", canonicalCategoryId: current.canonicalCategoryId }],
    ["canonicalCategoryId", { language: current.language, slug: current.slug, canonicalCategoryId: "cat-technique" }],
  ])("is true when %s changes", (_field, published) => {
    expect(changesPublishedUrlFields(published, current)).toBe(true);
  });
});

describe("parseProspectiveCategories", () => {
  it("resolves parentRef by Sanity document id, not categoryId", () => {
    const categories = parseProspectiveCategories(
      [
        { _id: "doc-landscape", categoryId: "cat-landscape", slug: [{ language: "en", value: "landscape" }], label: [{ language: "en", value: "Landscape" }] },
        { _id: "doc-coastal", categoryId: "cat-coastal", parentRef: "doc-landscape", slug: [{ language: "en", value: "coastal" }], label: [{ language: "en", value: "Coastal" }] },
      ],
      "en",
    );

    expect(categories.get("cat-coastal")?.parentId).toBe("cat-landscape");
    expect(categories.get("cat-landscape")?.parentId).toBeNull();
  });

  it("marks a dangling parentRef so it cannot alias a real categoryId", () => {
    // A dangling parentRef whose raw Sanity document id happens to equal
    // another category's real categoryId must not silently resolve ancestry
    // to that unrelated category.
    const categories = parseProspectiveCategories(
      [
        { _id: "doc-landscape", categoryId: "cat-landscape", slug: [{ language: "en", value: "landscape" }], label: [{ language: "en", value: "Landscape" }] },
        { _id: "doc-coastal", categoryId: "cat-coastal", parentRef: "cat-landscape", slug: [{ language: "en", value: "coastal" }], label: [{ language: "en", value: "Coastal" }] },
      ],
      "en",
    );

    const parentId = categories.get("cat-coastal")?.parentId;
    expect(parentId).toBe("unresolved-ref:cat-landscape");
    expect(parentId).not.toBe("cat-landscape");
  });

  it("omits slugInLanguage when the category has no slug or no label in that language", () => {
    const categories = parseProspectiveCategories(
      [
        { _id: "doc-a", categoryId: "cat-a", slug: [{ language: "fi", value: "maisemat" }], label: [{ language: "fi", value: "Maisemat" }] },
        { _id: "doc-b", categoryId: "cat-b", slug: [{ language: "en", value: "gear" }] },
      ],
      "en",
    );

    expect(categories.get("cat-a")?.slugInLanguage).toBeUndefined();
    // Has an English slug but no English label — ADR-0003 requires both.
    expect(categories.get("cat-b")?.slugInLanguage).toBeUndefined();
  });
});

describe("resolveProspectivePublicCategoryIds", () => {
  const categories = categoriesOf(
    { categoryId: "cat-root", parentId: null, slugInLanguage: "root" },
    { categoryId: "cat-child", parentId: "cat-root", slugInLanguage: "child" },
    { categoryId: "cat-unrelated", parentId: null, slugInLanguage: "unrelated" },
  );

  it("propagates publicity from a canonical placement up through every ancestor", () => {
    const placements: readonly ProspectivePlacement[] = [
      { contentId: "content-x", slug: "x", canonicalCategoryId: "cat-child", secondaryCategoryIds: [] },
    ];
    const publicIds = resolveProspectivePublicCategoryIds(categories, placements);
    expect(publicIds.has("cat-child")).toBe(true);
    expect(publicIds.has("cat-root")).toBe(true);
    expect(publicIds.has("cat-unrelated")).toBe(false);
  });

  it("also propagates from a secondary placement", () => {
    const placements: readonly ProspectivePlacement[] = [
      { contentId: "content-x", slug: "x", canonicalCategoryId: null, secondaryCategoryIds: ["cat-child"] },
    ];
    expect(resolveProspectivePublicCategoryIds(categories, placements).has("cat-root")).toBe(true);
  });

  it("does not hang on a cyclic parent chain", () => {
    const cyclic = categoriesOf(
      { categoryId: "cat-a", parentId: "cat-b" },
      { categoryId: "cat-b", parentId: "cat-a" },
    );
    const placements: readonly ProspectivePlacement[] = [
      { contentId: "content-x", slug: "x", canonicalCategoryId: "cat-a", secondaryCategoryIds: [] },
    ];
    expect(() => resolveProspectivePublicCategoryIds(cyclic, placements)).not.toThrow();
  });
});

describe("findProspectiveLocalSlugCollision", () => {
  it("finds a collision between the article's own claim and a sibling article", () => {
    const categories = categoriesOf({ categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" });
    const publicIds = new Set(["cat-landscape"]);
    const placements: readonly ProspectivePlacement[] = [
      { contentId: "content-other", slug: current.slug, canonicalCategoryId: "cat-landscape", secondaryCategoryIds: [] },
      { contentId: current.contentId, slug: current.slug, canonicalCategoryId: current.canonicalCategoryId, secondaryCategoryIds: [] },
    ];

    expect(
      findProspectiveLocalSlugCollision(
        current,
        categories,
        publicIds,
        placements,
      ),
    ).toMatchObject({
      checkedKind: "content",
      checkedId: current.contentId,
      conflictingKind: "content",
      conflictingId: "content-other",
      slug: current.slug,
    });
  });

  it("finds a collision between the article's own claim and a public child category", () => {
    // The gap the first review round found: an article's slug matching a
    // sibling *category*'s slug beneath the same parent, not just another
    // article's.
    const categories = categoriesOf(
      { categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" },
      { categoryId: "cat-child", parentId: "cat-landscape", slugInLanguage: current.slug },
    );
    const publicIds = new Set(["cat-landscape", "cat-child"]);
    const placements: readonly ProspectivePlacement[] = [
      { contentId: current.contentId, slug: current.slug, canonicalCategoryId: current.canonicalCategoryId, secondaryCategoryIds: [] },
    ];

    expect(
      findProspectiveLocalSlugCollision(
        current,
        categories,
        publicIds,
        placements,
      ),
    ).toMatchObject({
      checkedKind: "content",
      conflictingKind: "category",
      conflictingId: "cat-child",
      slug: current.slug,
    });
  });

  it("finds a collision exposed only because this article's own publish makes an ancestor category newly public", () => {
    // cat-child was private (no content of its own) until this article's
    // placement makes it public. Once public, its own slug collides with
    // "content-sibling", which already claims that slug beneath cat-parent.
    const categories = categoriesOf(
      { categoryId: "cat-parent", parentId: null, slugInLanguage: "parent" },
      { categoryId: "cat-child", parentId: "cat-parent", slugInLanguage: "shared-slug" },
    );
    const article: ProspectiveArticleFields = {
      ...current,
      contentId: "content-into-child",
      slug: "own-page-slug",
      canonicalCategoryId: "cat-child",
    };
    const placements: readonly ProspectivePlacement[] = [
      { contentId: "content-sibling", slug: "shared-slug", canonicalCategoryId: "cat-parent", secondaryCategoryIds: [] },
      { contentId: article.contentId, slug: article.slug, canonicalCategoryId: article.canonicalCategoryId, secondaryCategoryIds: [] },
    ];
    const publicIds = resolveProspectivePublicCategoryIds(categories, placements);
    expect(publicIds.has("cat-child")).toBe(true);

    expect(
      findProspectiveLocalSlugCollision(
        article,
        categories,
        publicIds,
        placements,
      ),
    ).toMatchObject({
      checkedKind: "category",
      checkedId: "cat-child",
      conflictingKind: "content",
      conflictingId: "content-sibling",
      slug: "shared-slug",
    });
  });

  it("checks an ancestry chain made public only by this article's secondary placement", () => {
    const categories = categoriesOf(
      { categoryId: "cat-canonical", parentId: null, slugInLanguage: "canonical" },
      { categoryId: "cat-parent", parentId: null, slugInLanguage: "parent" },
      { categoryId: "cat-secondary", parentId: "cat-parent", slugInLanguage: "shared-slug" },
    );
    const article: ProspectiveArticleFields = {
      ...current,
      canonicalCategoryId: "cat-canonical",
      secondaryCategoryIds: ["cat-secondary"],
    };
    const placements: readonly ProspectivePlacement[] = [
      {
        contentId: "content-sibling",
        slug: "shared-slug",
        canonicalCategoryId: "cat-parent",
        secondaryCategoryIds: [],
      },
      {
        contentId: article.contentId,
        slug: article.slug,
        canonicalCategoryId: article.canonicalCategoryId,
        secondaryCategoryIds: article.secondaryCategoryIds,
      },
    ];
    const publicIds = resolveProspectivePublicCategoryIds(
      categories,
      placements,
    );

    expect(
      findProspectiveLocalSlugCollision(
        article,
        categories,
        publicIds,
        placements,
      ),
    ).toMatchObject({
      checkedKind: "category",
      checkedId: "cat-secondary",
      conflictingKind: "content",
      conflictingId: "content-sibling",
      slug: "shared-slug",
    });
  });

  it("keeps category and content identities separate when their ids match", () => {
    const categories = categoriesOf(
      { categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" },
      {
        categoryId: current.contentId,
        parentId: "cat-landscape",
        slugInLanguage: current.slug,
      },
    );
    const publicIds = new Set(["cat-landscape", current.contentId]);
    const placements: readonly ProspectivePlacement[] = [
      {
        contentId: current.contentId,
        slug: current.slug,
        canonicalCategoryId: current.canonicalCategoryId,
        secondaryCategoryIds: [],
      },
    ];

    expect(
      findProspectiveLocalSlugCollision(
        current,
        categories,
        publicIds,
        placements,
      ),
    ).toMatchObject({
      checkedKind: "content",
      checkedId: current.contentId,
      conflictingKind: "category",
      conflictingId: current.contentId,
      slug: current.slug,
    });
  });

  it("ignores a same-slug claim beneath a different parent", () => {
    const categories = categoriesOf({ categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" });
    const publicIds = new Set(["cat-landscape"]);
    const placements: readonly ProspectivePlacement[] = [
      { contentId: "content-other", slug: current.slug, canonicalCategoryId: "cat-technique", secondaryCategoryIds: [] },
      { contentId: current.contentId, slug: current.slug, canonicalCategoryId: current.canonicalCategoryId, secondaryCategoryIds: [] },
    ];

    expect(findProspectiveLocalSlugCollision(current, categories, publicIds, placements)).toBeUndefined();
  });

  it("ignores a private (not yet public) sibling category", () => {
    const categories = categoriesOf(
      { categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" },
      { categoryId: "cat-private", parentId: "cat-landscape", slugInLanguage: current.slug },
    );
    // cat-private is deliberately excluded from publicIds: it has no content.
    const publicIds = new Set(["cat-landscape"]);
    const placements: readonly ProspectivePlacement[] = [
      { contentId: current.contentId, slug: current.slug, canonicalCategoryId: current.canonicalCategoryId, secondaryCategoryIds: [] },
    ];

    expect(findProspectiveLocalSlugCollision(current, categories, publicIds, placements)).toBeUndefined();
  });
});

describe("validateProspectiveArticlePlacement", () => {
  it("has nothing to check for an unplaced draft", () => {
    expect(
      validateProspectiveArticlePlacement({ ...current, canonicalCategoryId: null }, categoriesOf(), []),
    ).toBe(true);
  });

  it("refuses a canonical category with no published version in this language", () => {
    expect(validateProspectiveArticlePlacement(current, categoriesOf(), [])).toContain(
      "no published",
    );
  });

  it("refuses a secondary category with no published version in this language", () => {
    const categories = categoriesOf({
      categoryId: "cat-landscape",
      parentId: null,
      slugInLanguage: "landscape",
    });
    const article: ProspectiveArticleFields = {
      ...current,
      secondaryCategoryIds: ["cat-unlocalized"],
    };

    expect(
      validateProspectiveArticlePlacement(article, categories, []),
    ).toContain('Secondary category "cat-unlocalized"');
  });

  it("refuses a slug another article already claims in the same category and language", () => {
    const categories = categoriesOf({ categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" });
    const siblings: readonly ProspectivePlacement[] = [
      { contentId: "content-other", slug: current.slug, canonicalCategoryId: current.canonicalCategoryId, secondaryCategoryIds: [] },
    ];
    expect(validateProspectiveArticlePlacement(current, categories, siblings)).toContain(
      "content-other",
    );
  });

  it("refuses a slug a public sibling category already claims", () => {
    const categories = categoriesOf(
      { categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" },
      { categoryId: "cat-child", parentId: "cat-landscape", slugInLanguage: current.slug },
    );
    // cat-child is public because some other placement already sits beneath it.
    const siblings: readonly ProspectivePlacement[] = [
      { contentId: "content-under-child", slug: "anything", canonicalCategoryId: "cat-child", secondaryCategoryIds: [] },
    ];
    expect(validateProspectiveArticlePlacement(current, categories, siblings)).toContain(
      "cat-child",
    );
  });

  it("reports the actual collision exposed by a secondary category ancestry", () => {
    const categories = categoriesOf(
      { categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" },
      { categoryId: "cat-parent", parentId: null, slugInLanguage: "parent" },
      {
        categoryId: "cat-secondary",
        parentId: "cat-parent",
        slugInLanguage: "shared-slug",
      },
    );
    const article: ProspectiveArticleFields = {
      ...current,
      secondaryCategoryIds: ["cat-secondary"],
    };
    const siblings: readonly ProspectivePlacement[] = [
      {
        contentId: "content-sibling",
        slug: "shared-slug",
        canonicalCategoryId: "cat-parent",
        secondaryCategoryIds: [],
      },
    ];

    const result = validateProspectiveArticlePlacement(
      article,
      categories,
      siblings,
    );
    expect(result).toContain("content-sibling");
    expect(result).toContain('slug "shared-slug"');
    expect(result).not.toContain(`slug "${article.slug}"`);
  });

  it("passes when the category is published in this language and no slug collides", () => {
    const categories = categoriesOf({ categoryId: "cat-landscape", parentId: null, slugInLanguage: "landscape" });
    expect(validateProspectiveArticlePlacement(current, categories, [])).toBe(true);
  });
});

describe("validateArticlePublication", () => {
  function harnessOf(answer: unknown) {
    const queries: { query: string; params?: Readonly<Record<string, unknown>> }[] = [];
    const clientSettings: { perspective: string; useCdn?: boolean }[] = [];
    const client: SchemaValidationClient = {
      async fetch(query, params) {
        queries.push({ query, ...(params === undefined ? {} : { params }) });
        return answer as never;
      },
      withConfig(settings) {
        clientSettings.push(settings);
        return client;
      },
    };
    const context: SchemaValidationContext = { getClient: () => client };
    return { context, queries, clientSettings };
  }

  const landscapeCategoryRow = {
    _id: "doc-landscape",
    categoryId: "cat-landscape",
    slug: [{ language: "en", value: "landscape" }],
    label: [{ language: "en", value: "Landscape" }],
  };

  it("queries with a perspective that sees the published tree", async () => {
    const { context, clientSettings } = harnessOf({
      published: null,
      categories: [landscapeCategoryRow],
      siblings: [],
    });

    await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(clientSettings).toEqual([{ perspective: "published", useCdn: false }]);
  });

  it("defers to field-level validation when required fields are missing", async () => {
    const { context, queries } = harnessOf(undefined);

    const result = await validateArticlePublication(
      { _id: "abc" },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it("blocks an ordinary edit that changes the published slug", async () => {
    const { context } = harnessOf({
      published: { language: "en", slug: "old-slug", canonicalCategoryRef: "doc-landscape" },
      categories: [landscapeCategoryRow],
      siblings: [],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "new-slug",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toContain("URL-change workflow");
  });

  it("allows re-publishing an article whose URL fields are unchanged", async () => {
    const { context } = harnessOf({
      published: { language: "en", slug: "reading-coastal-light", canonicalCategoryRef: "doc-landscape" },
      categories: [landscapeCategoryRow],
      siblings: [],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-reading-coastal-light",
        language: "en",
        slug: "reading-coastal-light",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toBe(true);
  });

  it("refuses a first publish into a category with no published version in this language", async () => {
    const { context } = harnessOf({
      published: null,
      categories: [],
      siblings: [],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toContain("no published");
  });

  it("refuses a slug a public sibling category already claims, end to end", async () => {
    const { context } = harnessOf({
      published: null,
      categories: [
        landscapeCategoryRow,
        {
          _id: "doc-coastal",
          categoryId: "cat-coastal",
          parentRef: "doc-landscape",
          slug: [{ language: "en", value: "reading-coastal-light" }],
          label: [{ language: "en", value: "Coastal" }],
        },
      ],
      siblings: [
        {
          contentId: "content-under-coastal",
          slug: "anything",
          canonicalCategoryRef: "doc-coastal",
          secondaryCategoryRefs: [],
        },
      ],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "reading-coastal-light",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toContain("cat-coastal");
  });
});
