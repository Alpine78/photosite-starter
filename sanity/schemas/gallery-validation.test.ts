import { describe, expect, it } from "vitest";

import { GALLERY_TYPE_NAME } from "./gallery";
import {
  validateGalleryPlacementIdentity,
  validateGalleryPublication,
  type PlacementOwner,
} from "./gallery-validation";
import type { SchemaValidationClient, SchemaValidationContext } from "./schema-types";

const currentDocument = {
  documentId: "doc-abc",
  contentId: "content-northern-coast",
  language: "en",
  slug: "northern-coast",
  canonicalCategoryRef: null,
  secondaryCategoryRefs: [],
  placements: [
    { placementId: "northern-coast-01", mediaId: "media-a" },
    { placementId: "northern-coast-02", mediaId: "media-b", sectionId: "sec-intro" },
  ],
  sections: [],
};

describe("validateGalleryPlacementIdentity", () => {
  it("passes when no other gallery shares a placement id", () => {
    expect(validateGalleryPlacementIdentity(currentDocument, [], undefined)).toBe(true);
  });

  it("rejects a placement id repeated within this same document", () => {
    const withDuplicate = {
      ...currentDocument,
      placements: [
        { placementId: "same-id", mediaId: "media-a" },
        { placementId: "same-id", mediaId: "media-b" },
      ],
    };
    expect(validateGalleryPlacementIdentity(withDuplicate, [], undefined)).toContain(
      "Duplicate placement id",
    );
  });

  it("rejects a placement id already used by a different gallery (site-wide uniqueness)", () => {
    const otherOwners: readonly PlacementOwner[] = [
      {
        contentId: "content-different-gallery",
        placements: [{ placementId: "northern-coast-01", mediaId: "media-x" }],
      },
    ];
    expect(
      validateGalleryPlacementIdentity(currentDocument, otherOwners, undefined),
    ).toContain("already used by a different gallery");
  });

  it("allows a matching placement id on a sibling-language version of the same gallery", () => {
    const otherOwners: readonly PlacementOwner[] = [
      {
        contentId: currentDocument.contentId,
        placements: [
          { placementId: "northern-coast-01", mediaId: "media-a" },
          { placementId: "northern-coast-02", mediaId: "media-b", sectionId: "sec-intro" },
        ],
      },
    ];
    expect(validateGalleryPlacementIdentity(currentDocument, otherOwners, undefined)).toBe(true);
  });

  it("rejects a sibling-language placement id rebound to a different photograph", () => {
    const otherOwners: readonly PlacementOwner[] = [
      {
        contentId: currentDocument.contentId,
        placements: [{ placementId: "northern-coast-01", mediaId: "media-different" }],
      },
    ];
    expect(
      validateGalleryPlacementIdentity(currentDocument, otherOwners, undefined),
    ).toContain("different photograph or section");
  });

  it("rejects a sibling-language placement id rebound to a different section", () => {
    const otherOwners: readonly PlacementOwner[] = [
      {
        contentId: currentDocument.contentId,
        placements: [
          { placementId: "northern-coast-02", mediaId: "media-b", sectionId: "sec-other" },
        ],
      },
    ];
    expect(
      validateGalleryPlacementIdentity(currentDocument, otherOwners, undefined),
    ).toContain("different photograph or section");
  });

  it("rejects replacing a published placement's media without minting a new placement id", () => {
    const published = [{ placementId: "northern-coast-01", mediaId: "media-was-here" }];
    expect(
      validateGalleryPlacementIdentity(currentDocument, [], published),
    ).toContain("already published against a different photograph");
  });

  it("allows re-publishing a placement whose media is unchanged", () => {
    const published = [{ placementId: "northern-coast-01", mediaId: "media-a" }];
    expect(validateGalleryPlacementIdentity(currentDocument, [], published)).toBe(true);
  });
});

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

  it("rejects a placement referencing an undeclared section", async () => {
    const { context } = harnessOf(undefined);

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        placements: [{ placementId: "p1", media: { _ref: "media-a" }, sectionId: "unknown" }],
        sections: [],
      },
      context,
      GALLERY_TYPE_NAME,
    );

    expect(result).toContain("unknown gallery section");
  });

  it("blocks an ordinary edit that changes the published slug", async () => {
    const { context } = harnessOf({
      published: { language: "en", slug: "old-slug", canonicalCategoryRef: "doc-landscape" },
      categories: [landscapeCategoryRow],
      siblings: [],
      placementOwners: [],
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
        placements: [],
        sections: [{ sectionId: "sec-a", slug: "old-slug" }],
      },
      categories: [],
      siblings: [],
      placementOwners: [],
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
      placementOwners: [],
    });

    const result = await validateGalleryPublication(
      {
        _id: "abc",
        contentId: "content-x",
        language: "en",
        slug: "x",
        placements: [{ placementId: "p1", media: { _ref: "media-a" } }],
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
      placementOwners: [],
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
