import { describe, expect, it } from "vitest";

import { categoryType, CATEGORY_TYPE_NAME } from "./category";
import {
  CATEGORY_VALIDATION_QUERY,
  STUDIO_MAX_CATEGORY_DEPTH,
  validateProspectiveCategoryTree,
} from "./category-validation";
import { MAX_CATEGORY_DEPTH } from "../../src/lib/content-tree";
import { defineSchemaTypes } from "./index";
import { localizedSlugType } from "./localized-slug";
import { localizedTextType } from "./localized-text";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

/**
 * Duplicated from `media.test.ts` rather than shared: each schema test file
 * stays readable on its own, and the harness is small enough that keeping two
 * copies costs less than the coupling a shared module would add between two
 * otherwise independent document types.
 */
type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

type RecordedQuery = {
  query: string;
  params: Readonly<Record<string, unknown>> | undefined;
};

function inspect(
  validation: SchemaValidation | undefined,
  dataset: { answer?: unknown } = {},
) {
  const checks: CustomCheck[] = [];
  const queries: RecordedQuery[] = [];
  const clientSettings: { perspective: string; useCdn?: boolean }[] = [];
  let required = false;
  let min: number | undefined;

  const rule: SchemaValidationRule = {
    required() {
      required = true;
      return rule;
    },
    min(value) {
      min = value;
      return rule;
    },
    max() {
      return rule;
    },
    custom(check) {
      checks.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const contextFor = (
    document?: Record<string, unknown>,
  ): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, params });
      return dataset.answer as never;
    },
    withConfig(settings) {
      clientSettings.push(settings);
      return client;
    },
  };

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));

  return { required, min, run, queries, clientSettings };
}

function fieldOf(
  type: { readonly fields: readonly SchemaFieldDefinition[] },
  name: string,
): SchemaFieldDefinition {
  const field = type.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

const fieldNames = (type: SchemaTypeDefinition) =>
  type.fields.map((field) => field.name);

const UNIQUE_AND_UNCHANGED = { taken: false, publishedCategoryId: null };

const localized = (value: string, language = "en") => [{ language, value }];

function publishedCategory(options: {
  id: string;
  categoryId?: string;
  parentRef?: string;
  slug?: string;
  order?: number;
}) {
  return {
    _id: options.id,
    categoryId: options.categoryId ?? `cat-${options.id}`,
    parentRef: options.parentRef ?? null,
    slug: localized(options.slug ?? options.id),
    label: localized(options.id),
    order: options.order ?? 0,
  };
}

function editedCategory(options: {
  id: string;
  categoryId?: string;
  parentRef?: string;
  slug?: string;
  order?: number;
}) {
  return {
    _id: `drafts.${options.id}`,
    _type: CATEGORY_TYPE_NAME,
    categoryId: options.categoryId ?? `cat-${options.id}`,
    ...(options.parentRef === undefined
      ? {}
      : { parent: { _type: "reference", _ref: options.parentRef } }),
    slug: localized(options.slug ?? options.id),
    label: localized(options.id),
    order: options.order ?? 0,
  };
}

describe("the category document", () => {
  it("keeps the Studio depth limit pinned to the domain rule", () => {
    // Sanity schemas cannot import application code, so the Studio-facing
    // value is restated and this boundary test prevents silent drift.
    expect(STUDIO_MAX_CATEGORY_DEPTH).toBe(MAX_CATEGORY_DEPTH);
  });

  it("is registered with the object types it uses", () => {
    const types = defineSchemaTypes({ datasetVisibility: "public" });

    expect(types).toContainEqual(localizedTextType);
    expect(types).toContainEqual(localizedSlugType);
    expect(types.map((type) => type.name)).toContain(CATEGORY_TYPE_NAME);
  });

  it("never lists its own content, and never conflates tags, sections, or keywords with categories", () => {
    // ADR-0003 decision 4 and this story's own scope guard: a category is a
    // tree node, not a listing, and article tags, gallery sections, and media
    // keywords are separate concepts that never consume tree depth.
    for (const foreignField of [
      "content",
      "items",
      "placements",
      "tags",
      "sections",
      "keywords",
      // Canonical/secondary placement belongs to the gallery or article
      // being placed (AB#113, AB#81), never to the category receiving it.
      "canonicalCategory",
      "secondaryCategories",
    ]) {
      expect(fieldNames(categoryType)).not.toContain(foreignField);
    }
  });

  it("requires no parent, for a top-level category", () => {
    expect(fieldOf(categoryType, "parent").validation).toBeDefined();
    // `required` is asserted indirectly: the self-parent check below treats
    // `undefined` as valid, which is what an unrequired reference allows.
  });
});

describe("publication validation", () => {
  it("checks the published tree with the current draft overlaid", async () => {
    const current = editedCategory({ id: "coastal", parentRef: "landscape" });
    const { run, queries, clientSettings } = inspect(categoryType.validation, {
      answer: [publishedCategory({ id: "landscape" })],
    });

    expect(await run(current, current)).toEqual([true]);
    expect(queries).toEqual([
      { query: CATEGORY_VALIDATION_QUERY, params: { type: CATEGORY_TYPE_NAME } },
    ]);
    expect(clientSettings).toEqual([{ perspective: "published", useCdn: false }]);
  });

  it("blocks an indirect cycle before publish", () => {
    const current = editedCategory({ id: "a", parentRef: "b" });
    const published = [publishedCategory({ id: "b", parentRef: "a" })];

    expect(validateProspectiveCategoryTree(published, current)).toContain("cycle");
  });

  it("blocks an orphan before publish", () => {
    const current = editedCategory({ id: "coastal", parentRef: "missing" });

    expect(validateProspectiveCategoryTree([], current)).toContain("missing");
  });

  it("blocks a category that would be published in no language", () => {
    const current = {
      ...editedCategory({ id: "coastal" }),
      slug: localized("coast", "en"),
      label: localized("Rannikko", "fi"),
    };

    expect(validateProspectiveCategoryTree([], current)).toContain(
      "both a path segment and a display label",
    );
  });

  it("blocks a sibling slug collision before publish", () => {
    const current = editedCategory({ id: "second", slug: "shared" });
    const published = [publishedCategory({ id: "first", slug: "shared" })];

    expect(validateProspectiveCategoryTree(published, current)).toContain(
      "same en path segment",
    );
  });

  it("blocks a sixth authored level before publish", () => {
    const published = [
      publishedCategory({ id: "one" }),
      publishedCategory({ id: "two", parentRef: "one" }),
      publishedCategory({ id: "three", parentRef: "two" }),
      publishedCategory({ id: "four", parentRef: "three" }),
      publishedCategory({ id: "five", parentRef: "four" }),
    ];
    const current = editedCategory({ id: "six", parentRef: "five" });

    expect(validateProspectiveCategoryTree(published, current)).toContain(
      "maximum 5-level depth",
    );
  });

  it("blocks ordinary edits to a published path segment", () => {
    const published = [publishedCategory({ id: "coastal", slug: "old-coast" })];
    const current = editedCategory({ id: "coastal", slug: "new-coast" });

    expect(validateProspectiveCategoryTree(published, current)).toContain(
      "URL-change workflow",
    );
  });

  it("blocks ordinary moves of a published category", () => {
    const published = [
      publishedCategory({ id: "landscape" }),
      publishedCategory({ id: "coastal" }),
    ];
    const current = editedCategory({ id: "coastal", parentRef: "landscape" });

    expect(validateProspectiveCategoryTree(published, current)).toContain(
      "URL-change workflow",
    );
  });

  it("allows labels and order to change without moving a published URL", () => {
    const published = [publishedCategory({ id: "coastal", order: 1 })];
    const current = {
      ...editedCategory({ id: "coastal", order: 9 }),
      label: localized("A new display label"),
    };

    expect(validateProspectiveCategoryTree(published, current)).toBe(true);
  });

  it("allows a published category to gain its first path in another language", () => {
    const published = [publishedCategory({ id: "coastal", slug: "coast" })];
    const current = {
      ...editedCategory({ id: "coastal", slug: "coast" }),
      slug: [...localized("coast"), ...localized("rannikko", "fi")],
      label: [...localized("Coast"), ...localized("Rannikko", "fi")],
    };

    expect(validateProspectiveCategoryTree(published, current)).toBe(true);
  });

  it("blocks removing the label that makes a published locale route exist", () => {
    const published = [
      {
        ...publishedCategory({ id: "coastal", slug: "coast" }),
        slug: [...localized("coast"), ...localized("rannikko", "fi")],
        label: [...localized("Coast"), ...localized("Rannikko", "fi")],
      },
    ];
    const current = {
      ...editedCategory({ id: "coastal", slug: "coast" }),
      slug: [...localized("coast"), ...localized("rannikko", "fi")],
      label: localized("Rannikko", "fi"),
    };

    expect(validateProspectiveCategoryTree(published, current)).toContain(
      "URL-change workflow",
    );
  });

  it("allows changing a slug that never had a matching published label", () => {
    const published = [
      {
        ...publishedCategory({ id: "coastal", slug: "coast" }),
        slug: [...localized("coast"), ...localized("old-shore", "fi")],
      },
    ];
    const current = {
      ...editedCategory({ id: "coastal", slug: "coast" }),
      slug: [...localized("coast"), ...localized("rannikko", "fi")],
      label: [...localized("Coast"), ...localized("Rannikko", "fi")],
    };

    expect(validateProspectiveCategoryTree(published, current)).toBe(true);
  });
});

describe("the category identity", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(fieldOf(categoryType, "categoryId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(required).toBe(true);
    expect(await run("coastal-landscapes")).toEqual([true]);
    for (const rejected of [
      "Coastal Landscapes",
      "coastal--landscapes",
      "-coastal",
      "coastal_landscapes",
      "",
      undefined,
    ]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it.each([
    ["a published document", "other"],
    ["another document's unpublished draft", "drafts.other"],
    ["another document inside a content release", "versions.summer-drop.other"],
  ])("refuses an identity %s already claims", async () => {
    const { run } = inspect(fieldOf(categoryType, "categoryId").validation, {
      answer: { taken: true, publishedCategoryId: null },
    });

    expect((await run("coastal-landscapes", { _id: "abc" }))[0]).toContain(
      "already uses",
    );
  });

  it("asks with a perspective that can see unpublished documents", async () => {
    const { run, clientSettings } = inspect(
      fieldOf(categoryType, "categoryId").validation,
      { answer: UNIQUE_AND_UNCHANGED },
    );

    await run("coastal-landscapes", { _id: "abc" });

    expect(clientSettings).toEqual([{ perspective: "raw", useCdn: false }]);
  });

  it.each([
    ["its own published version", "abc"],
    ["its own draft", "drafts.abc"],
    ["its own version in a release", "versions.summer-drop.abc"],
  ])("does not collide with %s", async (_case, ownId) => {
    const { run } = inspect(fieldOf(categoryType, "categoryId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(await run("coastal-landscapes", { _id: ownId })).toEqual([true]);
  });

  it("scopes the uniqueness query to this document type", async () => {
    const { run, queries } = inspect(fieldOf(categoryType, "categoryId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    await run("coastal-landscapes", { _id: "abc" });

    expect(queries[0].params).toMatchObject({ type: CATEGORY_TYPE_NAME });
  });

  it("refuses to rename an identity that has already been published", async () => {
    const { run } = inspect(fieldOf(categoryType, "categoryId").validation, {
      answer: { taken: false, publishedCategoryId: "coastal-landscapes" },
    });

    expect((await run("quiet-coast", { _id: "abc" }))[0]).toContain(
      "coastal-landscapes",
    );
  });

  it("allows correcting an identity before the first publish", async () => {
    const { run } = inspect(fieldOf(categoryType, "categoryId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(await run("quiet-coast", { _id: "drafts.abc" })).toEqual([true]);
  });
});

describe("the parent reference", () => {
  it("accepts a category with no parent", async () => {
    const { run } = inspect(fieldOf(categoryType, "parent").validation);

    expect(await run(undefined, { _id: "abc" })).toEqual([true]);
  });

  it("accepts a reference to a different category", async () => {
    const { run } = inspect(fieldOf(categoryType, "parent").validation);

    expect(
      await run({ _ref: "landscape" }, { _id: "coastal" }),
    ).toEqual([true]);
  });

  it.each([
    ["itself, published", "abc", "abc"],
    ["itself, while editing its own draft", "drafts.abc", "abc"],
    ["itself, while editing its own release version", "versions.summer-drop.abc", "abc"],
    ["its own draft, while its published self is being edited", "abc", "drafts.abc"],
  ])("rejects a category naming %s as its parent", async (_case, documentId, ref) => {
    const { run } = inspect(fieldOf(categoryType, "parent").validation);

    const [message] = await run({ _ref: ref }, { _id: documentId });
    expect(message).toContain("own parent");
  });
});

describe("the path segment", () => {
  it("requires at least one language and refuses two entries for one language", async () => {
    const { required, min, run } = inspect(fieldOf(categoryType, "slug").validation);

    expect(required).toBe(true);
    expect(min).toBe(1);
    expect(
      await run([{ language: "fi" }, { language: "en" }]),
    ).toEqual([true]);
    expect((await run([{ language: "fi" }, { language: "fi" }]))[0]).toContain(
      "fi",
    );
  });

  it("accepts a lowercase hyphenated path segment and refuses anything else", async () => {
    const { required, run } = inspect(fieldOf(localizedSlugType, "value").validation);

    expect(required).toBe(true);
    expect(await run("coastal-landscapes")).toEqual([true]);
    for (const rejected of [
      "Coastal Landscapes",
      "coastal--landscapes",
      "-coastal",
      "coastal_landscapes",
      "coastal landscapes",
      "",
      undefined,
    ]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it("accepts a language subtag and refuses a locale or a name", async () => {
    const { required, run } = inspect(fieldOf(localizedSlugType, "language").validation);

    expect(required).toBe(true);
    for (const accepted of ["fi", "en", "swe"]) {
      expect(await run(accepted)).toEqual([true]);
    }
    for (const rejected of ["FI", "fi-FI", "finnish", "f", ""]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });
});

describe("the display label", () => {
  it("requires at least one language and refuses two entries for one language", async () => {
    const { required, min, run } = inspect(fieldOf(categoryType, "label").validation);

    expect(required).toBe(true);
    expect(min).toBe(1);
    expect(await run([{ language: "en" }])).toEqual([true]);
    expect((await run([{ language: "en" }, { language: "en" }]))[0]).toContain(
      "en",
    );
  });
});

describe("sibling order", () => {
  it("is required", () => {
    expect(inspect(fieldOf(categoryType, "order").validation).required).toBe(
      true,
    );
  });
});
