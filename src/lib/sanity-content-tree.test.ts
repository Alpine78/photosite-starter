import { describe, expect, it } from "vitest";

import { categoryType } from "../../sanity/schemas/category";
import { LOCALIZED_SLUG_PATTERN } from "../../sanity/schemas/localized-slug";
import {
  buildContentTree,
  ContentTreeValidationError,
  getCanonicalContentPath,
  getPublicChildCategories,
  SLUG_PATTERN,
  type ContentCategoryInput,
  type ContentPlacementInput,
} from "@/lib/content-tree";
import {
  CATEGORY_DOCUMENT_TYPE,
  CATEGORY_FILTER,
  CATEGORY_PROJECTION,
  diffPublicCategorySnapshots,
  PROJECTED_CATEGORY_FIELDS,
  projectPublicCategoryInput,
  projectPublicCategoryInputs,
  readPublicCategoryInputs,
  readPublicContentTree,
  SanityContentTreeError,
  type RawPublicCategoryDocument,
} from "@/lib/sanity-content-tree";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";

function fakeClient(
  answer: unknown,
): { client: SanityClient; requests: SanityQueryRequest[] } {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        return answer;
      },
    },
  };
}

const label = (value: string, language = "en") => [{ language, value }];

function docOf(
  overrides: Partial<RawPublicCategoryDocument> & { _id: string; categoryId: string },
): RawPublicCategoryDocument {
  return {
    parentRef: undefined,
    slug: label(overrides.categoryId.replace(/^cat-/, "")),
    label: label(overrides.categoryId.replace(/^cat-/, "")),
    order: 0,
    ...overrides,
  };
}

describe("the query contract", () => {
  it("asks only for fields the schema declares", () => {
    const declared = new Set(categoryType.fields.map((field) => field.name));

    for (const field of PROJECTED_CATEGORY_FIELDS) {
      expect(declared.has(field)).toBe(true);
      expect(CATEGORY_PROJECTION).toContain(field);
    }

    expect(CATEGORY_DOCUMENT_TYPE).toBe(categoryType.name);
    expect(CATEGORY_FILTER).toContain(CATEGORY_DOCUMENT_TYPE);
  });

  it("keeps localized-slug.ts's restated pattern pinned to content-tree.ts's own rule", () => {
    // `sanity/schemas/` cannot import `src/lib` (see `sanity/README.md`), so
    // `localized-slug.ts` restates this pattern rather than importing it. This
    // is the test that keeps the restatement from drifting silently.
    expect(LOCALIZED_SLUG_PATTERN.source).toBe(SLUG_PATTERN.source);
  });
});

describe("projecting one document", () => {
  it("maps a well-formed category", () => {
    const document = docOf({
      _id: "doc-coastal",
      categoryId: "cat-coastal",
      parentRef: "doc-landscape",
      slug: label("coastal"),
      label: label("Coastal"),
      order: 2,
    });

    expect(
      projectPublicCategoryInput(
        document,
        "en",
        new Map([["doc-landscape", "cat-landscape"]]),
      ),
    ).toEqual<ContentCategoryInput>({
      categoryId: "cat-coastal",
      parentId: "cat-landscape",
      slug: "coastal",
      label: "Coastal",
      order: 2,
    });
  });

  it("resolves no parent reference to a top-level category", () => {
    const document = docOf({ _id: "doc-portfolio", categoryId: "cat-portfolio" });

    expect(
      projectPublicCategoryInput(document, "en", new Map())?.parentId,
    ).toBeNull();
  });

  it("passes an unresolvable parent reference through unchanged", () => {
    // No document in this fetch has `_id: "missing"`, so `content-tree.ts`
    // reports `missing-parent` once this reaches `buildContentTree` — this
    // module never invents or drops the reference itself.
    const document = docOf({
      _id: "doc-coastal",
      categoryId: "cat-coastal",
      parentRef: "missing",
    });

    expect(
      projectPublicCategoryInput(document, "en", new Map())?.parentId,
    ).toBe("missing");
  });

  it.each([" ", 42, false, {}])(
    "rejects the malformed parent reference %j instead of making it top-level",
    (parentRef) => {
      const document = docOf({
        _id: "doc-coastal",
        categoryId: "cat-coastal",
        parentRef,
      });

      expect(() => projectPublicCategoryInput(document, "en", new Map())).toThrow(
        SanityContentTreeError,
      );
    },
  );

  it("throws for a category with no usable categoryId", () => {
    const document = docOf({ _id: "doc-x", categoryId: "" });

    expect(() => projectPublicCategoryInput(document, "en", new Map())).toThrow(
      SanityContentTreeError,
    );
  });

  it("does not trim a malformed structural identity into a usable one", () => {
    const document = docOf({ _id: "doc-x", categoryId: " cat-x " });

    expect(() => projectPublicCategoryInput(document, "en", new Map())).toThrow(
      SanityContentTreeError,
    );
  });

  it("treats a category missing this language's slug or label as unpublished in it", () => {
    const noFinnishSlug = docOf({
      _id: "doc-gear",
      categoryId: "cat-gear",
      slug: label("gear"),
      label: label("Gear"),
    });

    expect(projectPublicCategoryInput(noFinnishSlug, "fi", new Map())).toBeUndefined();
  });

  it("normalizes a route locale to the language entries are keyed by", () => {
    const document = docOf({
      _id: "doc-portfolio",
      categoryId: "cat-portfolio",
      slug: label("portfolio", "en"),
      label: label("Portfolio", "en"),
    });

    expect(
      projectPublicCategoryInput(document, "en-GB", new Map())?.slug,
    ).toBe("portfolio");
  });

  it("lets an invalid order reach the domain's own validation rather than guessing one", () => {
    const document = docOf({ _id: "doc-x", categoryId: "cat-x", order: undefined });

    expect(
      Number.isFinite(projectPublicCategoryInput(document, "en", new Map())?.order),
    ).toBe(false);
  });

  it.each([null, "", "2", false, []])(
    "does not coerce the non-number order %j into an authored number",
    (order) => {
      const document = docOf({ _id: "doc-x", categoryId: "cat-x", order });

      expect(
        Number.isFinite(projectPublicCategoryInput(document, "en", new Map())?.order),
      ).toBe(false);
    },
  );

  it("leaves slug whitespace for the domain to reject instead of repairing it", () => {
    const document = docOf({
      _id: "doc-x",
      categoryId: "cat-x",
      slug: label(" coastal "),
    });

    expect(() =>
      buildContentTree({
        categories: [
          projectPublicCategoryInput(document, "en", new Map()) as ContentCategoryInput,
        ],
        placements: [],
      }),
    ).toThrow(ContentTreeValidationError);
  });

  it.each([
    { slug: "not-an-array" },
    { slug: [{ language: "en", value: "one" }, { language: "en", value: "two" }] },
    { label: [{ language: "en-US", value: "English" }] },
    { label: [{ language: "en", value: 42 }] },
  ])("rejects a malformed localized category value: %j", (overrides) => {
    const document = docOf({
      _id: "doc-x",
      categoryId: "cat-x",
      ...overrides,
    });

    expect(() => projectPublicCategoryInput(document, "en", new Map())).toThrow(
      SanityContentTreeError,
    );
  });

  it("omits a document that is complete in no language from every locale", () => {
    const document = docOf({
      _id: "doc-x",
      categoryId: "cat-x",
      slug: label("coast", "en"),
      label: label("Rannikko", "fi"),
    });

    expect(projectPublicCategoryInput(document, "en", new Map())).toBeUndefined();
    expect(projectPublicCategoryInput(document, "fi", new Map())).toBeUndefined();
    expect(projectPublicCategoryInput(document, "de", new Map())).toBeUndefined();
  });
});

describe("projecting a full fetch", () => {
  it("does not let a category complete in no language break another category's locale", () => {
    const disjoint = docOf({
      _id: "doc-x",
      categoryId: "cat-x",
      slug: label("coast", "en"),
      label: label("Rannikko", "fi"),
    });
    const english = docOf({ _id: "doc-y", categoryId: "cat-y" });

    expect(projectPublicCategoryInputs([disjoint, english], "en")).toEqual([
      expect.objectContaining({ categoryId: "cat-y" }),
    ]);
  });

  it("does not let one unusable Sanity id prevent the rest of the batch from projecting", () => {
    const document = docOf({ _id: "doc-x", categoryId: "cat-x" });
    const withoutId = { ...document, _id: undefined };

    const sibling = docOf({ _id: "doc-y", categoryId: "cat-y" });

    expect(projectPublicCategoryInputs([withoutId, sibling], "en")).toEqual([
      expect.objectContaining({ categoryId: "cat-x" }),
      expect.objectContaining({ categoryId: "cat-y" }),
    ]);
  });

  it("resolves a five-level chain to the maximum authored depth", () => {
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-travel", order: 0 }),
      docOf({ _id: "d2", categoryId: "cat-europe", parentRef: "d1", order: 0 }),
      docOf({ _id: "d3", categoryId: "cat-nordics", parentRef: "d2", order: 0 }),
      docOf({ _id: "d4", categoryId: "cat-winter", parentRef: "d3", order: 0 }),
      docOf({ _id: "d5", categoryId: "cat-polar-night", parentRef: "d4", order: 0 }),
    ];

    const tree = buildContentTree({
      categories: projectPublicCategoryInputs(documents, "en"),
      placements: [],
    });

    expect(tree.categories.get("cat-polar-night")?.depth).toBe(5);
  });

  it("produces an empty tree from an empty fetch", () => {
    expect(projectPublicCategoryInputs([], "en")).toEqual([]);
    expect(() => buildContentTree({ categories: [], placements: [] })).not.toThrow();
  });

  it("produces an empty tree for a language none of the fetched categories publish", () => {
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-gear", slug: label("gear"), label: label("Gear") }),
    ];

    expect(projectPublicCategoryInputs(documents, "fi")).toEqual([]);
  });

  it("composes fetched categories with gallery and article placements from other adapters", () => {
    // Categories come from this module; placements come from whichever
    // adapter owns gallery and article content (AB#113, AB#81). Neither
    // exists yet, so this fixture stands in for what they will eventually
    // read — mirroring `mock-content-tree.ts`'s own English tree.
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-portfolio", slug: label("portfolio"), label: label("Portfolio"), order: 0 }),
      docOf({ _id: "d2", categoryId: "cat-landscape", slug: label("landscape"), label: label("Landscape"), order: 1 }),
      docOf({ _id: "d3", categoryId: "cat-events", slug: label("events"), label: label("Events"), order: 2 }),
    ];

    const placements: ContentPlacementInput[] = [
      {
        contentId: "content-selected-work",
        variant: "gallery",
        slug: "selected-work",
        published: true,
        canonicalCategoryId: "cat-portfolio",
      },
      {
        contentId: "content-reading-coastal-light",
        variant: "article",
        slug: "reading-coastal-light",
        published: true,
        canonicalCategoryId: "cat-landscape",
        secondaryCategoryIds: ["cat-events"],
      },
    ];

    const tree = buildContentTree({
      categories: projectPublicCategoryInputs(documents, "en"),
      placements,
    });

    expect(getCanonicalContentPath(tree, "content-selected-work")).toEqual([
      "portfolio",
      "selected-work",
    ]);
    expect(getCanonicalContentPath(tree, "content-reading-coastal-light")).toEqual([
      "landscape",
      "reading-coastal-light",
    ]);
    // A secondary placement lists the category as public without granting it
    // a detail route of its own.
    expect(tree.publicCategoryIds.has("cat-events")).toBe(true);
  });

  it("rejects a self-parenting category the same way the domain always has", () => {
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-loop", parentRef: "d1" }),
    ];

    expect(() =>
      buildContentTree({ categories: projectPublicCategoryInputs(documents, "en"), placements: [] }),
    ).toThrow(ContentTreeValidationError);
  });

  it("rejects an indirect cycle", () => {
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-a", parentRef: "d2" }),
      docOf({ _id: "d2", categoryId: "cat-b", parentRef: "d1" }),
    ];

    let issues: ContentTreeValidationError | undefined;
    try {
      buildContentTree({ categories: projectPublicCategoryInputs(documents, "en"), placements: [] });
    } catch (error) {
      issues = error as ContentTreeValidationError;
    }

    expect(issues?.issues.map((issue) => issue.code)).toContain("category-cycle");
  });

  it("rejects a dangling parent reference as an orphan, not a top-level category", () => {
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-coastal", parentRef: "missing" }),
    ];

    let issues: ContentTreeValidationError | undefined;
    try {
      buildContentTree({ categories: projectPublicCategoryInputs(documents, "en"), placements: [] });
    } catch (error) {
      issues = error as ContentTreeValidationError;
    }

    expect(issues?.issues.map((issue) => issue.code)).toContain("missing-parent");
  });

  it("rejects sibling categories that claim the same slug", () => {
    const documents: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-a", slug: label("gear"), order: 0 }),
      docOf({ _id: "d2", categoryId: "cat-b", slug: label("gear"), order: 1 }),
    ];

    let issues: ContentTreeValidationError | undefined;
    try {
      buildContentTree({ categories: projectPublicCategoryInputs(documents, "en"), placements: [] });
    } catch (error) {
      issues = error as ContentTreeValidationError;
    }

    expect(issues?.issues.map((issue) => issue.code)).toContain(
      "sibling-slug-collision",
    );
  });
});

describe("moves and renames", () => {
  it("exposes what the first-site redirect mapping needs, by stable categoryId", () => {
    const before: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-landscape", slug: label("landscape"), order: 0 }),
      docOf({ _id: "d2", categoryId: "cat-coastal", slug: label("coastal-old"), order: 0 }),
      docOf({ _id: "d3", categoryId: "cat-technique", slug: label("low-light-old"), order: 1 }),
    ];
    // `cat-coastal` moves under `cat-landscape`; `cat-technique` is renamed
    // in place. Both keep their `categoryId`, which is what associates the
    // two snapshots — exactly ADR-0003 decision 7's model of a move or rename.
    const after: RawPublicCategoryDocument[] = [
      docOf({ _id: "d1", categoryId: "cat-landscape", slug: label("landscape"), order: 0 }),
      docOf({ _id: "d2", categoryId: "cat-coastal", parentRef: "d1", slug: label("coastal"), order: 0 }),
      docOf({ _id: "d3", categoryId: "cat-technique", slug: label("low-light"), order: 1 }),
    ];

    const placements: ContentPlacementInput[] = [
      {
        contentId: "content-x",
        variant: "gallery",
        slug: "x",
        published: true,
        canonicalCategoryId: "cat-coastal",
      },
      // `cat-technique` needs published content of its own to be part of the
      // public tree at all (ADR-0003 decision 4) — otherwise `diffCanonicalPaths`
      // correctly has nothing to say about a rename nobody could have reached.
      {
        contentId: "content-y",
        variant: "article",
        slug: "y",
        published: true,
        canonicalCategoryId: "cat-technique",
      },
    ];

    const diff = diffPublicCategorySnapshots({
      language: "en",
      previousDocuments: before,
      currentDocuments: after,
      previousPlacements: placements,
      currentPlacements: placements,
    });

    expect(diff.conflicts).toEqual([]);
    expect(diff.redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "category",
          id: "cat-coastal",
          previousPath: ["coastal-old"],
          currentPath: ["landscape", "coastal"],
        }),
        expect.objectContaining({
          kind: "category",
          id: "cat-technique",
          previousPath: ["low-light-old"],
          currentPath: ["low-light"],
        }),
        // The move also changes the canonical content path beneath it.
        expect.objectContaining({
          kind: "content",
          id: "content-x",
          previousPath: ["coastal-old", "x"],
          currentPath: ["landscape", "coastal", "x"],
        }),
      ]),
    );
  });
});

describe("reading from the store", () => {
  it("requests the category filter and a stable tag", async () => {
    const { client, requests } = fakeClient([]);

    await readPublicCategoryInputs({ language: "en", client });

    expect(requests).toHaveLength(1);
    expect(requests[0].query).toContain(CATEGORY_FILTER);
    expect(requests[0].tag).toBe("category.tree");
  });

  it("throws when the store answers with something other than a list", async () => {
    const { client } = fakeClient({ notAList: true });

    await expect(readPublicCategoryInputs({ language: "en", client })).rejects.toThrow(
      SanityContentTreeError,
    );
  });

  it("composes a fetched tree with the caller's own placements", async () => {
    const { client } = fakeClient([
      docOf({ _id: "d1", categoryId: "cat-portfolio", slug: label("portfolio"), label: label("Portfolio") }),
    ]);

    const tree = await readPublicContentTree({
      language: "en",
      client,
      placements: [
        {
          contentId: "content-selected-work",
          variant: "gallery",
          slug: "selected-work",
          published: true,
          canonicalCategoryId: "cat-portfolio",
        },
      ],
    });

    expect(getPublicChildCategories(tree, null).map((category) => category.categoryId)).toEqual([
      "cat-portfolio",
    ]);
  });

  it("rejects placements the domain would always reject, surfaced through the same read", async () => {
    const { client } = fakeClient([]);

    await expect(
      readPublicContentTree({
        language: "en",
        client,
        placements: [
          {
            contentId: "content-orphan",
            variant: "article",
            slug: "orphan",
            published: true,
            canonicalCategoryId: "cat-does-not-exist",
          },
        ],
      }),
    ).rejects.toThrow(ContentTreeValidationError);
  });
});

describe("readPublicCategoryListingContentVersion (AB#140, ADR-0013)", () => {
  function taggedClient(
    byTag: Record<string, unknown>,
  ): { client: SanityClient; requests: SanityQueryRequest[] } {
    const requests: SanityQueryRequest[] = [];
    return {
      requests,
      client: {
        async query(request) {
          requests.push(request);
          return byTag[request.tag ?? ""] ?? null;
        },
      },
    };
  }

  it("returns the most recent in-scope content _updatedAt, scoped by reference and language", async () => {
    const { client, requests } = taggedClient({
      "category.index": [
        { _id: "doc-gear", categoryId: "cat-gear" },
        { _id: "doc-other", categoryId: "cat-other" },
      ],
      "category.listing.version": "2024-09-09T10:00:00Z",
    });

    const { readPublicCategoryListingContentVersion } = await import(
      "@/lib/sanity-content-tree"
    );
    const version = await readPublicCategoryListingContentVersion({
      subtreeCategoryIds: ["cat-gear"],
      language: "en",
      client,
    });

    expect(version).toBe("2024-09-09T10:00:00Z");
    const versionRequest = requests.find(
      (request) => request.tag === "category.listing.version",
    );
    expect(versionRequest?.query).toContain("references($categoryIds)");
    expect(versionRequest?.query).toContain('_type == "article" || _type == "gallery"');
    expect(versionRequest?.params).toMatchObject({
      language: "en",
      categoryIds: ["doc-gear"],
    });
  });

  it("is a stable sentinel when the scope resolves to no category or no content", async () => {
    const { readPublicCategoryListingContentVersion } = await import(
      "@/lib/sanity-content-tree"
    );

    await expect(
      readPublicCategoryListingContentVersion({
        subtreeCategoryIds: [],
        language: "en",
        client: taggedClient({}).client,
      }),
    ).resolves.toBe("empty");

    await expect(
      readPublicCategoryListingContentVersion({
        subtreeCategoryIds: ["cat-gear"],
        language: "en",
        client: taggedClient({ "category.index": [] }).client,
      }),
    ).resolves.toBe("empty");
  });

  it("treats a null answer as 'no in-scope update', not a defect", async () => {
    const { readPublicCategoryListingContentVersion } = await import(
      "@/lib/sanity-content-tree"
    );
    await expect(
      readPublicCategoryListingContentVersion({
        subtreeCategoryIds: ["cat-gear"],
        language: "en",
        client: taggedClient({
          "category.index": [{ _id: "doc-gear", categoryId: "cat-gear" }],
          "category.listing.version": null,
        }).client,
      }),
    ).resolves.toBe("empty");
  });

  it("rejects a malformed (non-timestamp) version answer as a classified defect", async () => {
    const { readPublicCategoryListingContentVersion, SanityContentTreeError } =
      await import("@/lib/sanity-content-tree");
    await expect(
      readPublicCategoryListingContentVersion({
        subtreeCategoryIds: ["cat-gear"],
        language: "en",
        client: taggedClient({
          "category.index": [{ _id: "doc-gear", categoryId: "cat-gear" }],
          "category.listing.version": 1234,
        }).client,
      }),
    ).rejects.toBeInstanceOf(SanityContentTreeError);
  });
});
