import { describe, expect, it } from "vitest";

import { GALLERY_TYPE_NAME } from "./gallery";
import { validateGalleryPublication } from "./gallery-validation";
import type { SchemaValidationClient, SchemaValidationContext } from "./schema-types";

describe("validateGalleryPublication", () => {
  function harnessOf(answer: unknown) {
    const queries: { query: string; params?: Readonly<Record<string, unknown>> }[] = [];
    const client: SchemaValidationClient = {
      async fetch(query, params) {
        queries.push({ query, ...(params === undefined ? {} : { params }) });
        return answer as never;
      },
      withConfig() {
        return client;
      },
    };
    const context: SchemaValidationContext = { getClient: () => client };
    return { context, queries };
  }

  const landscapeCategoryRow = {
    _id: "doc-landscape",
    categoryId: "cat-landscape",
    slug: [{ language: "en", value: "landscape" }],
    label: [{ language: "en", value: "Landscape" }],
  };

  it("rejects local structural problems before any query runs", async () => {
    const { context, queries } = harnessOf(undefined);

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        sections: [
          { sectionId: "sec-a", slug: "dup" },
          { sectionId: "sec-b", slug: "dup" },
        ],
      },
      context,
      GALLERY_TYPE_NAME,
    );

    expect(result).toContain("Duplicate gallery section slug");
    expect(queries).toHaveLength(0);
  });

  it("blocks an ordinary edit that changes the published slug", async () => {
    const { context } = harnessOf({
      published: { language: "en", slug: "old-slug", canonicalCategoryRef: "doc-landscape" },
      categories: [landscapeCategoryRow],
      siblings: [],
    });

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "new-slug",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      GALLERY_TYPE_NAME,
    );

    expect(result).toContain("URL-change workflow");
  });

  it("rejects renaming a published section's slug", async () => {
    const { context } = harnessOf({
      published: {
        language: "en",
        slug: "northern-coast",
        canonicalCategoryRef: null,
        sections: [{ sectionId: "sec-a", slug: "old-slug" }],
      },
      categories: [],
      siblings: [],
    });

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "northern-coast",
        sections: [{ sectionId: "sec-a", slug: "new-slug" }],
      },
      context,
      GALLERY_TYPE_NAME,
    );

    expect(result).toContain("cannot be renamed");
  });

  it("passes a clean, unplaced draft with no siblings", async () => {
    const { context } = harnessOf({
      published: null,
      categories: [],
      siblings: [],
    });

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        sections: [],
      },
      context,
      GALLERY_TYPE_NAME,
    );

    expect(result).toBe(true);
  });

  it("refuses a slug an existing article already claims under the same category", async () => {
    const { context } = harnessOf({
      published: null,
      categories: [landscapeCategoryRow],
      siblings: [
        {
          contentId: "content-article-sibling",
          slug: "northern-coast",
          canonicalCategoryRef: "doc-landscape",
          secondaryCategoryRefs: [],
        },
      ],
    });

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "northern-coast",
        canonicalCategory: { _ref: "doc-landscape" },
      },
      context,
      GALLERY_TYPE_NAME,
    );

    expect(result).toContain("content-article-sibling");
  });
});
