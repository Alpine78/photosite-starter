import { describe, expect, it } from "vitest";

import {
  CATEGORY_WRITE_PLAN_VERSION,
  categoryDatasetIssues,
  categoryDocumentsDigest,
  categoryWriteWaves,
  normalizeCategoryReadback,
  parseArguments,
  validateCategoryDocuments,
  validateCategoryWritePlan,
  type CategoryWriteDocument,
} from "./write-sanity-categories.mts";

const documents: readonly CategoryWriteDocument[] = [
  {
    _id: "migrated--category-motorsport",
    _type: "category",
    categoryId: "motorsport",
    slug: [
      { _key: "fi", _type: "localizedSlug", language: "fi", value: "moottoriurheilu" },
      { _key: "en", _type: "localizedSlug", language: "en", value: "motorsport" },
    ],
    label: [
      { _key: "fi", _type: "localizedText", language: "fi", value: "Moottoriurheilu" },
      { _key: "en", _type: "localizedText", language: "en", value: "Motorsport" },
    ],
    description: [{
      _key: "fi",
      _type: "categoryDescription",
      language: "fi",
      blocks: [{
        _key: "intro",
        _type: "categoryDescriptionParagraph",
        spans: [{ _key: "text", _type: "categoryDescriptionInlineSpan", text: "Rallikuvia." }],
      }],
    }],
    order: 0,
  },
  {
    _id: "migrated--category-wrc",
    _type: "category",
    categoryId: "wrc",
    parent: { _type: "reference", _ref: "migrated--category-motorsport" },
    slug: [
      { _key: "fi", _type: "localizedSlug", language: "fi", value: "wrc" },
      { _key: "en", _type: "localizedSlug", language: "en", value: "wrc" },
    ],
    label: [
      { _key: "fi", _type: "localizedText", language: "fi", value: "WRC" },
      { _key: "en", _type: "localizedText", language: "en", value: "WRC" },
    ],
    order: 1,
  },
];

describe("category write plan validation", () => {
  it("accepts a localized parent-child fragment", () => {
    const result = validateCategoryWritePlan({ version: CATEGORY_WRITE_PLAN_VERSION, documents });
    expect(result.issues).toEqual([]);
    expect(result.plan?.documents).toHaveLength(2);
  });

  it("rejects unexpected fields and descriptions that broaden the restricted schema", () => {
    const result = validateCategoryDocuments([{
      ...documents[0],
      secret: "must not be written",
      description: [{
        ...documents[0].description![0],
        blocks: [{
          ...documents[0].description![0].blocks[0],
          spans: [{ ...documents[0].description![0].blocks[0].spans[0], href: "https://example.test" }],
        }],
      }],
    }]);
    expect(result.issues).toContain("documents[0] has unsupported field(s): secret");
    expect(result.issues).toContain("documents[0].description[0].blocks[0].spans[0] may not add marks or links to an import description");
  });

  it("binds approval to normalized category content", () => {
    expect(categoryDocumentsDigest([...documents].reverse())).toBe(categoryDocumentsDigest(documents));
    expect(categoryDocumentsDigest([{ ...documents[0], order: 9 }, documents[1]])).not.toBe(categoryDocumentsDigest(documents));
  });

  it("writes parents before their children", () => {
    expect(categoryWriteWaves([...documents].reverse()).map((wave) => wave.map((document) => document.categoryId))).toEqual([
      ["motorsport"], ["wrc"],
    ]);
  });

  it("allows an exact rerun but refuses an editor change, draft, or foreign identity", () => {
    expect(categoryDatasetIssues(documents, documents)).toEqual([]);
    expect(categoryDatasetIssues([{ ...documents[0], order: 9 }], documents)).toContain(
      'planned document "migrated--category-motorsport" already exists with different content',
    );
    expect(categoryDatasetIssues([{ ...documents[0], _id: "drafts.migrated--category-motorsport" }], documents)).toContain(
      'planned document "migrated--category-motorsport" has an unpublished draft',
    );
    expect(categoryDatasetIssues([{ ...documents[0], _id: "other-category" }], documents)).toContain(
      'categoryId "motorsport" is already owned by "other-category"',
    );
  });

  it("normalizes GROQ nulls for omitted optional fields before readback", () => {
    expect(normalizeCategoryReadback({ ...documents[0], parent: null })).toEqual({
      ...documents[0],
    });
  });
});

describe("category write CLI", () => {
  it("is dry-run by default and accepts the apply guard explicitly", () => {
    expect(parseArguments(["--plan", "plan.json"])).toEqual({ plan: "plan.json", apply: false });
    expect(parseArguments(["--plan", "plan.json", "--approved-digest", "a".repeat(64), "--yes"])).toEqual({
      plan: "plan.json", approvedDigest: "a".repeat(64), apply: true,
    });
  });
});
