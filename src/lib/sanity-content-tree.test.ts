import { describe, expect, it } from "vitest";

import { categoryType } from "../../sanity/schemas/category";
import { LOCALIZED_SLUG_PATTERN } from "../../sanity/schemas/localized-slug";
import {
  buildContentTree,
  ContentTreeValidationError,
  diffCanonicalPaths,
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

  it("throws for a category with no usable categoryId", () => {
    const document = docOf({ _id: "doc-x", categoryId: "" });

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
});

describe("projecting a full fetch", () => {
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

    const beforeTree = buildContentTree({
      categories: projectPublicCategoryInputs(before, "en"),
      placements,
    });
    const afterTree = buildContentTree({
      categories: projectPublicCategoryInputs(after, "en"),
      placements,
    });

    const diff = diffCanonicalPaths(beforeTree, afterTree);

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
