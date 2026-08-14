import { describe, expect, it } from "vitest";

import {
  changesPublishedUrlFields,
  validateArticlePublication,
  validateProspectiveArticlePlacement,
  type ArticleSibling,
  type ProspectiveArticleFields,
} from "./article-validation";
import { ARTICLE_TYPE_NAME } from "./article";
import type { SchemaValidationClient, SchemaValidationContext } from "./schema-types";

const current: ProspectiveArticleFields = {
  documentId: "abc",
  contentId: "content-reading-coastal-light",
  language: "en",
  slug: "reading-coastal-light",
  canonicalCategoryId: "cat-landscape",
};

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

describe("validateProspectiveArticlePlacement", () => {
  it("has nothing to check for an unplaced draft", () => {
    expect(
      validateProspectiveArticlePlacement(
        { ...current, canonicalCategoryId: null },
        false,
        [],
      ),
    ).toBe(true);
  });

  it("refuses a canonical category with no published version in this language", () => {
    expect(
      validateProspectiveArticlePlacement(current, false, []),
    ).toContain("no published");
  });

  it("refuses a slug another article already claims in the same category and language", () => {
    const siblings: readonly ArticleSibling[] = [
      { contentId: "content-other", slug: current.slug, canonicalCategoryId: current.canonicalCategoryId },
    ];
    expect(
      validateProspectiveArticlePlacement(current, true, siblings),
    ).toContain("content-other");
  });

  it("ignores a same-slug sibling in a different category", () => {
    const siblings: readonly ArticleSibling[] = [
      { contentId: "content-other", slug: current.slug, canonicalCategoryId: "cat-technique" },
    ];
    expect(validateProspectiveArticlePlacement(current, true, siblings)).toBe(true);
  });

  it("ignores its own sibling row, so re-saving an unchanged article does not collide with itself", () => {
    const siblings: readonly ArticleSibling[] = [
      { contentId: current.contentId, slug: current.slug, canonicalCategoryId: current.canonicalCategoryId },
    ];
    expect(validateProspectiveArticlePlacement(current, true, siblings)).toBe(true);
  });

  it("passes when the category is published in this language and no slug collides", () => {
    expect(validateProspectiveArticlePlacement(current, true, [])).toBe(true);
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

  it("queries with a perspective that sees the published tree", async () => {
    const { context, clientSettings } = harnessOf({
      published: null,
      category: { slug: [{ language: "en", value: "landscape" }], label: [{ language: "en", value: "Landscape" }] },
      siblings: [],
    });

    await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        canonicalCategory: { _ref: "cat-landscape" },
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
      published: { language: "en", slug: "old-slug", canonicalCategoryRef: "cat-landscape" },
      category: { slug: [{ language: "en", value: "landscape" }], label: [{ language: "en", value: "Landscape" }] },
      siblings: [],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "new-slug",
        canonicalCategory: { _ref: "cat-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toContain("URL-change workflow");
  });

  it("allows re-publishing an article whose URL fields are unchanged", async () => {
    const { context } = harnessOf({
      published: { language: "en", slug: "reading-coastal-light", canonicalCategoryRef: "cat-landscape" },
      category: { slug: [{ language: "en", value: "landscape" }], label: [{ language: "en", value: "Landscape" }] },
      siblings: [],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-reading-coastal-light",
        language: "en",
        slug: "reading-coastal-light",
        canonicalCategory: { _ref: "cat-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toBe(true);
  });

  it("refuses a first publish into a category with no published version in this language", async () => {
    const { context } = harnessOf({
      published: null,
      category: null,
      siblings: [],
    });

    const result = await validateArticlePublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        canonicalCategory: { _ref: "cat-landscape" },
      },
      context,
      ARTICLE_TYPE_NAME,
    );

    expect(result).toContain("no published");
  });
});
