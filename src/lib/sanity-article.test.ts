import { describe, expect, it, vi } from "vitest";

import { articleType } from "../../sanity/schemas/article";
import {
  ARTICLE_DETAIL_PROJECTION,
  ARTICLE_DOCUMENT_TYPE,
  ARTICLE_FILTER,
  ARTICLE_LISTING_PROJECTION,
  ARTICLE_PLACEMENT_PROJECTION,
  projectArticleContentPage,
  projectArticleListingRecord,
  projectArticlePlacementInput,
  PROJECTED_ARTICLE_DETAIL_FIELDS,
  PROJECTED_ARTICLE_LISTING_FIELDS,
  PROJECTED_ARTICLE_PLACEMENT_FIELDS,
  readPublicArticleListingRecords,
  readPublicArticlePage,
  readPublicArticlePlacements,
  SanityArticleError,
  type RawArticleDetailDocument,
  type RawArticleListingDocument,
  type RawArticlePlacementDocument,
} from "@/lib/sanity-article";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const languages = { language: "en", fallbackLanguage: "fi", config };

/** Dispatches a canned answer per query tag, so a multi-query read is testable. */
function fakeClient(
  answers: Readonly<Record<string, unknown>>,
): { client: SanityClient; requests: SanityQueryRequest[] } {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        if (request.tag === undefined || !(request.tag in answers)) {
          throw new Error(`no fixture answer for tag "${request.tag}"`);
        }
        return answers[request.tag];
      },
    },
  };
}

function rejectionOf(run: () => unknown): SanityArticleError {
  try {
    run();
  } catch (error) {
    if (error instanceof SanityArticleError) return error;
    throw error;
  }
  throw new Error("expected projection to throw");
}

describe("the query contract", () => {
  it("asks only for fields the schema declares", () => {
    const declared = new Set(articleType.fields.map((field) => field.name));

    for (const field of [
      ...PROJECTED_ARTICLE_PLACEMENT_FIELDS,
      ...PROJECTED_ARTICLE_LISTING_FIELDS,
      ...PROJECTED_ARTICLE_DETAIL_FIELDS,
    ]) {
      expect(declared.has(field)).toBe(true);
    }

    for (const field of PROJECTED_ARTICLE_PLACEMENT_FIELDS) {
      expect(ARTICLE_PLACEMENT_PROJECTION).toContain(field);
    }
    for (const field of PROJECTED_ARTICLE_LISTING_FIELDS) {
      expect(ARTICLE_LISTING_PROJECTION).toContain(field);
    }
    for (const field of PROJECTED_ARTICLE_DETAIL_FIELDS) {
      expect(ARTICLE_DETAIL_PROJECTION).toContain(field);
    }

    expect(ARTICLE_DOCUMENT_TYPE).toBe(articleType.name);
    expect(ARTICLE_FILTER).toContain(ARTICLE_DOCUMENT_TYPE);
    expect(ARTICLE_FILTER).toContain("language == $language");
  });
});

describe("projecting a placement", () => {
  const categoryIndex = new Map([["sanity-doc-landscape", "cat-landscape"]]);

  it("resolves canonical and secondary category references through the index", () => {
    const document: RawArticlePlacementDocument = {
      contentId: "content-reading-coastal-light",
      slug: "reading-coastal-light",
      canonicalCategoryRef: "sanity-doc-landscape",
      secondaryCategoryRefs: ["sanity-doc-landscape"],
    };

    expect(projectArticlePlacementInput(document, categoryIndex)).toEqual({
      contentId: "content-reading-coastal-light",
      variant: "article",
      slug: "reading-coastal-light",
      published: true,
      canonicalCategoryId: "cat-landscape",
      secondaryCategoryIds: ["cat-landscape"],
    });
  });

  it("passes an unresolved reference through unchanged, letting content-tree.ts report it", () => {
    const document: RawArticlePlacementDocument = {
      contentId: "content-x",
      slug: "x",
      canonicalCategoryRef: "sanity-doc-unknown",
    };

    expect(
      projectArticlePlacementInput(document, categoryIndex).canonicalCategoryId,
    ).toBe("sanity-doc-unknown");
  });

  it("omits secondaryCategoryIds when there are none", () => {
    const document: RawArticlePlacementDocument = {
      contentId: "content-x",
      slug: "x",
      canonicalCategoryRef: "sanity-doc-landscape",
    };

    expect(
      projectArticlePlacementInput(document, categoryIndex),
    ).not.toHaveProperty("secondaryCategoryIds");
  });

  it("treats a document this query returned as published, unconditionally", () => {
    // sanity-client.ts asks only for the published perspective, so anything
    // reaching this projection is already published in Sanity's own sense.
    const document: RawArticlePlacementDocument = {
      contentId: "content-x",
      slug: "x",
      canonicalCategoryRef: null,
    };

    expect(projectArticlePlacementInput(document, categoryIndex).published).toBe(
      true,
    );
    expect(
      projectArticlePlacementInput(document, categoryIndex).canonicalCategoryId,
    ).toBeNull();
  });

  it("rejects a document with no usable contentId", () => {
    const error = rejectionOf(() =>
      projectArticlePlacementInput({ slug: "x" }, categoryIndex),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("projecting a listing record", () => {
  const document: RawArticleListingDocument = {
    contentId: "content-reading-coastal-light",
    title: "Reading coastal light",
    summary: "How overcast mornings change what a shoreline shows.",
    publishedAt: "2024-08-02",
  };

  it("maps a well-formed document without a cover", () => {
    expect(projectArticleListingRecord(document, languages)).toEqual({
      contentId: "content-reading-coastal-light",
      title: "Reading coastal light",
      summary: "How overcast mornings change what a shoreline shows.",
      publishedAt: "2024-08-02",
    });
  });

  it.each([
    ["title", { ...document, title: undefined }],
    ["publishedAt", { ...document, publishedAt: undefined }],
  ])("rejects a document missing %s", (_field, malformed) => {
    const error = rejectionOf(() =>
      projectArticleListingRecord(malformed, languages),
    );
    expect(error.rejection).toBe("incomplete-document");
    expect(error.contentId).toBe("content-reading-coastal-light");
  });
});

describe("projecting the full page", () => {
  const document: RawArticleDetailDocument = {
    contentId: "content-reading-coastal-light",
    title: "Reading coastal light",
    publishedAt: "2024-08-02",
    tags: ["light", "coastal"],
    body: [
      { _key: "b1", _type: "contentParagraphBlock", text: "Placeholder copy." },
      { _key: "b2", _type: "contentHeadingBlock", level: 2, text: "Waiting for the cloud" },
    ],
  };

  it("maps tags, body, and the article variant", () => {
    expect(projectArticleContentPage(document, languages)).toEqual({
      contentId: "content-reading-coastal-light",
      variant: "article",
      title: "Reading coastal light",
      publishedAt: "2024-08-02",
      tags: ["light", "coastal"],
      body: [
        { type: "paragraph", text: "Placeholder copy.", key: "b1" },
        { type: "heading", level: 2, text: "Waiting for the cloud", key: "b2" },
      ],
    });
  });

  it("omits tags when the article has none", () => {
    const withoutTags: RawArticleDetailDocument = { ...document, tags: undefined };
    expect(projectArticleContentPage(withoutTags, languages)).not.toHaveProperty(
      "tags",
    );
  });

  it.each([
    ["a missing body", { ...document, body: undefined }],
    ["an empty body", { ...document, body: [] }],
  ])("rejects %s — an article's body is the page, unlike a gallery's optional one", (_case, malformed) => {
    const error = rejectionOf(() => projectArticleContentPage(malformed, languages));
    expect(error.rejection).toBe("incomplete-document");
    expect(error.contentId).toBe("content-reading-coastal-light");
  });
});

describe("reading placements", () => {
  it("resolves categories before projecting placements", async () => {
    const { client, requests } = fakeClient({
      "category.index": [{ _id: "sanity-doc-landscape", categoryId: "cat-landscape" }],
      "article.placements": [
        {
          contentId: "content-reading-coastal-light",
          slug: "reading-coastal-light",
          canonicalCategoryRef: "sanity-doc-landscape",
          secondaryCategoryRefs: [],
        },
      ],
    });

    const placements = await readPublicArticlePlacements({
      language: "en",
      client,
    });

    expect(placements).toEqual([
      {
        contentId: "content-reading-coastal-light",
        variant: "article",
        slug: "reading-coastal-light",
        published: true,
        canonicalCategoryId: "cat-landscape",
      },
    ]);
    expect(requests.map((request) => request.tag)).toEqual([
      "category.index",
      "article.placements",
    ]);
  });
});

describe("reading listing records", () => {
  it("skips the query entirely for an empty candidate list", async () => {
    const { client, requests } = fakeClient({});

    const records = await readPublicArticleListingRecords(
      { contentIds: [], ordering: "published-desc-v1", limit: 25 },
      { language: "en", client },
    );

    expect(records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("bounds the query by the given ids and limit", async () => {
    const { client, requests } = fakeClient({ "article.listing": [] });

    await readPublicArticleListingRecords(
      {
        contentIds: ["content-a", "content-b"],
        ordering: "published-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(requests[0].params).toMatchObject({
      language: "en",
      contentIds: ["content-a", "content-b"],
      limit: 5,
    });
  });
});

describe("reading one article's page", () => {
  it("returns undefined when this language publishes none under that id", async () => {
    const { client } = fakeClient({ "article.detail": [] });

    expect(
      await readPublicArticlePage("content-unknown", {
        language: "en",
        client,
        config,
      }),
    ).toBeUndefined();
  });

  it("throws when two published documents claim one identity", async () => {
    const { client } = fakeClient({
      "article.detail": [
        { contentId: "content-x", title: "A", publishedAt: "2024-01-01" },
        { contentId: "content-x", title: "B", publishedAt: "2024-01-02" },
      ],
    });

    await expect(
      readPublicArticlePage("content-x", { language: "en", client, config }),
    ).rejects.toMatchObject({ rejection: "ambiguous-content-id" });
  });

  it("projects the one matching document", async () => {
    const { client } = fakeClient({
      "article.detail": [
        {
          contentId: "content-x",
          title: "A page",
          publishedAt: "2024-01-01",
          body: [{ _key: "b1", _type: "contentParagraphBlock", text: "Placeholder." }],
        },
      ],
    });

    const page = await readPublicArticlePage("content-x", {
      language: "en",
      client,
      config,
    });

    expect(page).toMatchObject({ contentId: "content-x", variant: "article" });
  });
});
