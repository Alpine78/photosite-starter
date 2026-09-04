import { describe, expect, it, vi } from "vitest";

import { articleType } from "../../sanity/schemas/article";
import {
  ARTICLE_DETAIL_PROJECTION,
  ARTICLE_DOCUMENT_TYPE,
  ARTICLE_FILTER,
  ARTICLE_LISTING_PROJECTION,
  ARTICLE_PLACEMENT_PROJECTION,
  chunkContentIds,
  encodedContentIdsBytes,
  projectArticleContentPage,
  projectArticleListingRecord,
  projectArticlePlacementInput,
  PROJECTED_ARTICLE_DETAIL_FIELDS,
  PROJECTED_ARTICLE_LISTING_FIELDS,
  PROJECTED_ARTICLE_PLACEMENT_FIELDS,
  readPublicArticleAdjacentRecords,
  readPublicArticleListingRecords,
  readPublicArticleListingRecordsInCategories,
  readPublicArticlePage,
  readPublicArticlePlacements,
  SanityArticleError,
  type RawArticleDetailDocument,
  type RawArticleListingDocument,
  type RawArticlePlacementDocument,
} from "@/lib/sanity-article";
import { MAX_SANITY_GET_URL_BYTES } from "@/lib/sanity-client";
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

  it("marks an unresolved reference so it cannot alias a real categoryId", () => {
    // Prefixed rather than passed through raw: a category id is always
    // lowercase-hyphenated, so an unresolved Sanity document id whose string
    // happened to equal another category's real categoryId must not silently
    // resolve to that unrelated category.
    const document: RawArticlePlacementDocument = {
      contentId: "content-x",
      slug: "x",
      canonicalCategoryRef: "sanity-doc-unknown",
    };

    const canonicalCategoryId = projectArticlePlacementInput(
      document,
      categoryIndex,
    ).canonicalCategoryId;
    expect(canonicalCategoryId).toBe("unresolved-ref:sanity-doc-unknown");
    expect(canonicalCategoryId).not.toBe("sanity-doc-unknown");
    // Cannot alias any real categoryId in the index.
    expect([...categoryIndex.values()]).not.toContain(canonicalCategoryId);
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

  // AB#150/ADR-0017 decision 5: the endDate gate is folded into this
  // placement's *effective* published, at the adapter boundary — the mirror
  // of `content.ts#applyMockEndDateGate` for the Sanity path.
  describe("the endDate gate", () => {
    const document: RawArticlePlacementDocument = {
      contentId: "content-x",
      slug: "x",
      canonicalCategoryRef: null,
    };

    it("reports a document whose endDate has passed as unpublished, not absent", () => {
      const placement = projectArticlePlacementInput(
        { ...document, endDate: "2020-01-01" },
        categoryIndex,
        new Date("2024-01-01"),
      );
      expect(placement.published).toBe(false);
      // Still placed, not simply missing: routing, listing, and
      // `listPublicRoutePaths` all key off `published`, not presence.
      expect(placement.contentId).toBe("content-x");
    });

    it("reports a document whose endDate has not yet arrived as published", () => {
      const placement = projectArticlePlacementInput(
        { ...document, endDate: "2030-01-01" },
        categoryIndex,
        new Date("2024-01-01"),
      );
      expect(placement.published).toBe(true);
    });

    it("treats a document with no endDate as published, regardless of now", () => {
      expect(
        projectArticlePlacementInput(document, categoryIndex, new Date("2099-01-01"))
          .published,
      ).toBe(true);
    });

    it("rejects an endDate that is not a real ISO calendar date", () => {
      const error = rejectionOf(() =>
        projectArticlePlacementInput(
          { ...document, endDate: "not-a-date" },
          categoryIndex,
        ),
      );
      expect(error.rejection).toBe("incomplete-document");
    });
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
      eventDate: "2024-08-02",
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

  it.each([
    ["a calendar day that does not exist", "2026-02-31"],
    ["an out-of-range hour", "2024-08-02T25:00:00Z"],
    ["free text", "August 2, 2024"],
    ["an empty string", ""],
  ])("rejects publishedAt as %s", (_case, publishedAt) => {
    const error = rejectionOf(() =>
      projectArticleListingRecord({ ...document, publishedAt }, languages),
    );
    expect(error.rejection).toBe("incomplete-document");
  });

  it("accepts a full UTC ISO datetime, not just a bare date", () => {
    expect(
      projectArticleListingRecord(
        { ...document, publishedAt: "2024-08-02T14:30:00.000Z" },
        languages,
      ).eventDate,
    ).toBe("2024-08-02T14:30:00.000Z");
  });

  // AB#150/ADR-0017: no authored eventDate falls back to publishedAt.
  it("falls back to publishedAt when no eventDate is authored", () => {
    expect(projectArticleListingRecord(document, languages).eventDate).toBe(
      document.publishedAt,
    );
  });

  it("projects the authored eventDate as the effective date, not publishedAt", () => {
    // A page published later than the real-world event it documents — the
    // exact reorder case ADR-0017 exists for.
    expect(
      projectArticleListingRecord(
        { ...document, eventDate: "2023-11-01" },
        languages,
      ).eventDate,
    ).toBe("2023-11-01");
  });

  it("rejects an eventDate that is not a real ISO calendar date", () => {
    const error = rejectionOf(() =>
      projectArticleListingRecord(
        { ...document, eventDate: "2026-02-31" },
        languages,
      ),
    );
    expect(error.rejection).toBe("incomplete-document");
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

  it("carries the raw author when authored (AB#151)", () => {
    expect(
      projectArticleContentPage({ ...document, author: "Alex Rivers" }, languages)
        .author,
    ).toBe("Alex Rivers");
  });

  it("omits author when none is authored — the route resolves the site-wide fallback, not this projection", () => {
    expect(projectArticleContentPage(document, languages)).not.toHaveProperty(
      "author",
    );
  });

  it("treats a blank author as unauthored", () => {
    expect(
      projectArticleContentPage({ ...document, author: "   " }, languages),
    ).not.toHaveProperty("author");
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

  it("asks for endDate, and reports a document whose endDate has passed as unpublished", async () => {
    const { client, requests } = fakeClient({
      "category.index": [],
      "article.placements": [
        {
          contentId: "content-ended",
          slug: "ended",
          canonicalCategoryRef: null,
          endDate: "2020-01-01",
        },
      ],
    });

    const placements = await readPublicArticlePlacements({ language: "en", client });

    expect(placements).toEqual([
      {
        contentId: "content-ended",
        variant: "article",
        slug: "ended",
        published: false,
        canonicalCategoryId: null,
      },
    ]);
    const placementsRequest = requests.find(
      (request) => request.tag === "article.placements",
    );
    expect(placementsRequest?.query).toContain("endDate");
  });
});

describe("reading listing records", () => {
  it("skips the query entirely for an empty candidate list", async () => {
    const { client, requests } = fakeClient({});

    const records = await readPublicArticleListingRecords(
      { scope: "routed-content", contentIds: [], ordering: "event-date-desc-v1", limit: 25 },
      { language: "en", client },
    );

    expect(records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("bounds the query by the given ids and limit", async () => {
    const { client, requests } = fakeClient({ "article.listing": [] });

    await readPublicArticleListingRecords(
      {
        scope: "routed-content",
        contentIds: ["content-a", "content-b"],
        ordering: "event-date-desc-v1",
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

  it("chunks a candidate list that would exceed the GET URL budget into more than one request", async () => {
    // Long enough ids that a few hundred of them alone exceed half the
    // documented Sanity GET budget, the share this adapter reserves for the
    // contentIds array.
    const contentIds = Array.from(
      { length: 500 },
      (_, index) => `content-${"x".repeat(40)}-${index}`,
    );
    const { client, requests } = fakeClient({ "article.listing": [] });

    await readPublicArticleListingRecords(
      { scope: "routed-content", contentIds, ordering: "event-date-desc-v1", limit: 25 },
      { language: "en", client, config },
    );

    expect(requests.length).toBeGreaterThan(1);
    const requestedIds = requests.flatMap(
      (request) => request.params?.contentIds as readonly string[],
    );
    expect(new Set(requestedIds)).toEqual(new Set(contentIds));
    // Every request still asks for its own top `limit`, never the caller's
    // ids up front — chunking must not change the per-request row bound.
    for (const request of requests) {
      expect(request.params?.limit).toBe(25);
    }
  });

  it("merges and re-bounds chunked results to the requested limit, newest first", async () => {
    const contentIds = Array.from(
      { length: 500 },
      (_, index) => `content-${"x".repeat(40)}-${index}`,
    );
    const olderRecord: RawArticleListingDocument = {
      contentId: "content-older",
      title: "Older",
      publishedAt: "2024-01-01",
    };
    const newerRecord: RawArticleListingDocument = {
      contentId: "content-newer",
      title: "Newer",
      publishedAt: "2024-06-01",
    };

    const requests: SanityQueryRequest[] = [];
    let call = 0;
    const client: SanityClient = {
      async query(request) {
        requests.push(request);
        call += 1;
        // Split the two records across the first two chunks so a correct
        // merge is the only way the assertions below can pass.
        if (call === 1) return [olderRecord];
        if (call === 2) return [newerRecord];
        return [];
      },
    };

    const records = await readPublicArticleListingRecords(
      { scope: "routed-content", contentIds, ordering: "event-date-desc-v1", limit: 1 },
      { language: "en", client, config },
    );

    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(records).toHaveLength(1);
    expect(records[0].contentId).toBe("content-newer");
  });

  it("excludes an ended article and binds the request time (AB#150, ADR-0017)", async () => {
    const { client, requests } = fakeClient({ "article.listing": [] });

    await readPublicArticleListingRecords(
      { scope: "routed-content", contentIds: ["content-a"], ordering: "event-date-desc-v1", limit: 5 },
      { language: "en", client, config },
    );

    expect(requests[0].query).toContain("!defined(endDate) || endDate > $now");
    expect(requests[0].params).toMatchObject({ now: expect.any(String) });
  });
});

describe("reading listing records by category subtree", () => {
  it("skips every query for an empty category scope", async () => {
    const { client, requests } = fakeClient({});

    const records = await readPublicArticleListingRecordsInCategories(
      { scope: "category-subtree", categoryIds: [], ordering: "event-date-desc-v1", limit: 25 },
      { language: "en", client, config },
    );

    expect(records).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("resolves the scope with a targeted lookup and filters by reference, not dereference", async () => {
    const { client, requests } = fakeClient({
      "category.ids": [{ _id: "doc-formula" }, { _id: "doc-rally" }],
      "article.listing.by-category": [
        { contentId: "content-rally-report", title: "Rally report", publishedAt: "2024-05-01" },
      ],
    });

    const records = await readPublicArticleListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-formula", "cat-rally"],
        ordering: "event-date-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(records.map((record) => record.contentId)).toEqual([
      "content-rally-report",
    ]);

    // The scope lookup asks only for the requested categories, never the whole
    // collection.
    const scopeRequest = requests.find(
      (request) => request.tag === "category.ids",
    );
    expect(scopeRequest?.query).toContain("categoryId in $categoryIds");
    expect(scopeRequest?.params).toMatchObject({
      categoryIds: ["cat-formula", "cat-rally"],
    });

    const listingRequest = requests.find(
      (request) => request.tag === "article.listing.by-category",
    );
    expect(listingRequest?.query).toContain("references($categoryIds)");
    expect(listingRequest?.query).not.toContain("->categoryId");
    expect(listingRequest?.params).toMatchObject({
      language: "en",
      categoryIds: ["doc-formula", "doc-rally"],
      limit: 5,
    });
  });

  it("returns nothing when the scope resolves to no known category document", async () => {
    const { client, requests } = fakeClient({ "category.ids": [] });

    const records = await readPublicArticleListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-not-in-store"],
        ordering: "event-date-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(records).toEqual([]);
    expect(
      requests.some((request) => request.tag === "article.listing.by-category"),
    ).toBe(false);
  });

  it("excludes an ended article and binds the request time (AB#150, ADR-0017)", async () => {
    // Required, not merely defensive: this query is scoped by category
    // reference, so an ended article's own reference to an in-scope category
    // would otherwise still surface it even though the tree already treats it
    // as unpublished.
    const { client, requests } = fakeClient({
      "category.ids": [{ _id: "doc-a" }],
      "article.listing.by-category": [],
    });

    await readPublicArticleListingRecordsInCategories(
      { scope: "category-subtree", categoryIds: ["cat-a"], ordering: "event-date-desc-v1", limit: 5 },
      { language: "en", client, config },
    );

    const listingRequest = requests.find(
      (request) => request.tag === "article.listing.by-category",
    );
    expect(listingRequest?.query).toContain("!defined(endDate) || endDate > $now");
    expect(listingRequest?.params).toMatchObject({ now: expect.any(String) });
  });

  it("adds a keyset boundary clause and params for a category continuation cursor (AB#140)", async () => {
    const { client, requests } = fakeClient({
      "category.ids": [{ _id: "doc-a" }],
      "article.listing.by-category": [],
    });

    await readPublicArticleListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-a"],
        ordering: "event-date-desc-v1",
        limit: 5,
        after: { eventDate: "2024-06-18", contentId: "content-x" },
      },
      { language: "en", client, config },
    );

    const listingRequest = requests.find(
      (request) => request.tag === "article.listing.by-category",
    );
    expect(listingRequest?.query).toContain(
      "coalesce(eventDate, publishedAt) < $afterEventDate || (coalesce(eventDate, publishedAt) == $afterEventDate && contentId > $afterContentId)",
    );
    expect(listingRequest?.params).toMatchObject({
      afterEventDate: "2024-06-18",
      afterContentId: "content-x",
    });
  });

  it("omits the keyset clause entirely on a first page", async () => {
    const { client, requests } = fakeClient({
      "category.ids": [{ _id: "doc-a" }],
      "article.listing.by-category": [],
    });

    await readPublicArticleListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds: ["cat-a"],
        ordering: "event-date-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    const listingRequest = requests.find(
      (request) => request.tag === "article.listing.by-category",
    );
    expect(listingRequest?.query).not.toContain("afterPublishedAt");
  });

  it("de-duplicates an article matched by two chunks and re-bounds newest first", async () => {
    // A subtree large enough to force both the scope lookup and the listing
    // query to chunk.
    const categoryIds = Array.from(
      { length: 500 },
      (_, index) => `cat-${"y".repeat(40)}-${index}`,
    );
    const shared: RawArticleListingDocument = {
      contentId: "content-shared",
      title: "Shared",
      publishedAt: "2024-02-01",
    };
    const newer: RawArticleListingDocument = {
      contentId: "content-newer",
      title: "Newer",
      publishedAt: "2024-09-01",
    };

    let call = 0;
    const client: SanityClient = {
      async query(request) {
        if (request.tag === "category.ids") {
          const asked = request.params?.categoryIds as readonly string[];
          return asked.map((categoryId) => ({
            _id: categoryId.replace("cat-", "doc-"),
          }));
        }
        call += 1;
        if (call === 1) return [shared];
        if (call === 2) return [shared, newer];
        return [];
      },
    };

    const records = await readPublicArticleListingRecordsInCategories(
      {
        scope: "category-subtree",
        categoryIds,
        ordering: "event-date-desc-v1",
        limit: 5,
      },
      { language: "en", client, config },
    );

    expect(call).toBeGreaterThanOrEqual(2);
    expect(records.map((record) => record.contentId)).toEqual([
      "content-newer",
      "content-shared",
    ]);
  });
});

describe("chunkContentIds", () => {
  it("keeps a small list in one chunk", () => {
    expect(chunkContentIds(["a", "b", "c"], 1024)).toEqual([["a", "b", "c"]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunkContentIds([], 1024)).toEqual([]);
  });

  it("splits once the real encoded size would exceed the budget", () => {
    // The budget is derived from the measured cost of the first pair so the
    // assertion tracks whatever `encodeURIComponent(JSON.stringify(...))`
    // actually costs, rather than a hand-computed byte count that a change to
    // the encoding would silently make wrong.
    const budget = encodedContentIdsBytes(["a", "b"]);
    expect(chunkContentIds(["a", "b", "c"], budget)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("never drops or reorders an id across chunk boundaries", () => {
    const contentIds = Array.from({ length: 300 }, (_, index) => `content-${index}`);
    const chunks = chunkContentIds(contentIds, Math.floor(MAX_SANITY_GET_URL_BYTES / 2));
    expect(chunks.flat()).toEqual(contentIds);
  });

  it("keeps every produced chunk's real encoded size within budget", () => {
    // The invariant the GET-limit fix exists for: not an approximation of the
    // request size, but the same measurement `buildSanityQueryUrl` applies to
    // the real request.
    const contentIds = Array.from({ length: 300 }, (_, index) => `content-${index}`);
    const budget = 2000;
    const chunks = chunkContentIds(contentIds, budget);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(encodedContentIdsBytes(chunk)).toBeLessThanOrEqual(budget);
    }
  });

  it("rejects a single id too large to fit any chunk by itself", () => {
    // A singleton chunk has nothing to compare against, so the ordinary
    // "would adding this overflow the chunk" check never fires for it —
    // this needs its own guard, catching what would otherwise become an
    // oversized chunk that fails only once the real request is built.
    const hugeId = "content-" + "x".repeat(5000);

    expect(() => chunkContentIds([hugeId], 2000)).toThrow(SanityArticleError);
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

  it("projects the raw eventDate and endDate onto the page, and excludes an ended article at the query", async () => {
    const { client, requests } = fakeClient({
      "article.detail": [
        {
          contentId: "content-x",
          title: "A page",
          publishedAt: "2024-01-01",
          eventDate: "2023-06-15",
          endDate: "2030-01-01",
          body: [{ _key: "b1", _type: "contentParagraphBlock", text: "Placeholder." }],
        },
      ],
    });

    const page = await readPublicArticlePage("content-x", {
      language: "en",
      client,
      config,
    });

    expect(page).toMatchObject({
      contentId: "content-x",
      publishedAt: "2024-01-01",
      eventDate: "2023-06-15",
      endDate: "2030-01-01",
    });
    expect(requests[0].query).toContain("!defined(endDate) || endDate > $now");
    expect(requests[0].params).toMatchObject({ now: expect.any(String) });
  });
});

describe("reading adjacent (sibling) records", () => {
  it("projects both neighbours in one bounded round trip", async () => {
    const { client, requests } = fakeClient({
      "article.adjacent": {
        previous: {
          contentId: "content-newer",
          title: "Newer",
          publishedAt: "2024-06-01",
        },
        next: {
          contentId: "content-older",
          title: "Older",
          publishedAt: "2024-01-01",
        },
      },
    });

    const records = await readPublicArticleAdjacentRecords("content-anchor", {
      language: "en",
      client,
      config,
    });

    expect(records).toEqual({
      previous: {
        contentId: "content-newer",
        title: "Newer",
        eventDate: "2024-06-01",
      },
      next: {
        contentId: "content-older",
        title: "Older",
        eventDate: "2024-01-01",
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].tag).toBe("article.adjacent");
    expect(requests[0].params).toEqual({
      language: "en",
      contentId: "content-anchor",
      now: expect.any(String),
    });
  });

  it("orders and compares by the effective event date, and excludes an ended candidate on both sides (AB#150, ADR-0017)", async () => {
    const { client, requests } = fakeClient({
      "article.adjacent": { previous: null, next: null },
    });

    await readPublicArticleAdjacentRecords("content-anchor", {
      language: "en",
      client,
      config,
    });

    const query = requests[0].query;
    expect(query).toContain("coalesce(^.eventDate, ^.publishedAt)");
    // Both the previous and the next subquery apply the not-ended filter.
    expect(
      query.match(/!defined\(endDate\) \|\| endDate > \$now/g),
    ).toHaveLength(3); // anchor + previous + next
  });

  it("omits a side with no neighbour in that direction", async () => {
    const { client } = fakeClient({
      "article.adjacent": {
        previous: null,
        next: {
          contentId: "content-older",
          title: "Older",
          publishedAt: "2024-01-01",
        },
      },
    });

    const records = await readPublicArticleAdjacentRecords("content-anchor", {
      language: "en",
      client,
      config,
    });

    expect(records).toEqual({
      next: {
        contentId: "content-older",
        title: "Older",
        eventDate: "2024-01-01",
      },
    });
  });

  it("answers no neighbours when the anchor itself does not resolve in this language", async () => {
    const { client } = fakeClient({ "article.adjacent": null });

    await expect(
      readPublicArticleAdjacentRecords("content-anchor", {
        language: "en",
        client,
        config,
      }),
    ).resolves.toEqual({});
  });

  it("rejects a malformed answer rather than silently answering no neighbours", async () => {
    const { client } = fakeClient({ "article.adjacent": "not an object" });

    await expect(
      readPublicArticleAdjacentRecords("content-anchor", {
        language: "en",
        client,
        config,
      }),
    ).rejects.toThrow(SanityArticleError);
  });

  it("rejects a malformed neighbour inside an otherwise shaped answer", async () => {
    const { client } = fakeClient({
      "article.adjacent": { previous: "not an article", next: null },
    });

    await expect(
      readPublicArticleAdjacentRecords("content-anchor", {
        language: "en",
        client,
        config,
      }),
    ).rejects.toMatchObject({
      name: "SanityArticleError",
      rejection: "malformed-result",
    });
  });
});
