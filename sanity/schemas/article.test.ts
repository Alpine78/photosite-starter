import { describe, expect, it } from "vitest";

import { articleType, ARTICLE_TYPE_NAME } from "./article";
import { CATEGORY_TYPE_NAME } from "./category";
import { CONTENT_BLOCK_OBJECT_TYPES } from "./content-block";
import { defineSchemaTypes } from "./index";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

/**
 * Duplicated from `media.test.ts` rather than shared — see `category.test.ts`'s
 * comment on the same choice.
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
    warning(check) {
      checks.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, params });
      return dataset.answer as never;
    },
    withConfig() {
      return client;
    },
  };

  const contextFor = (
    document?: Record<string, unknown>,
  ): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));

  return { required, min, run, queries };
}

function fieldOf(name: string): SchemaFieldDefinition {
  const field = articleType.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

const fieldNames = () => articleType.fields.map((field) => field.name);

const UNIQUE_AND_UNCHANGED = { taken: false, publishedContentId: null };

describe("the article document", () => {
  it("is registered in the schema index", () => {
    const types = defineSchemaTypes({
      datasetVisibility: "public",
      storyRootPaths: ["/stories"],
    });
    expect(types.map((type) => type.name)).toContain(ARTICLE_TYPE_NAME);
  });

  it("carries one language's text directly, not language-keyed arrays", () => {
    // Unlike category.ts's label/slug, an article has its own per-language
    // publication lifecycle (ADR-0003 decision 7), so it is one document per
    // language rather than one document describing every language.
    expect(fieldNames()).toEqual(
      expect.arrayContaining(["contentId", "language", "title", "slug"]),
    );
    expect(fieldOf("title").type).toBe("string");
    expect(fieldOf("slug").type).toBe("string");
  });

  it("keeps a canonical media reference rather than a copied asset", () => {
    expect(fieldOf("cover").to).toEqual([{ type: MEDIA_TYPE_NAME }]);
  });
});

describe("the content identity", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(fieldOf("contentId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(required).toBe(true);
    expect(await run("reading-coastal-light", { language: "en" })).toEqual([true]);
    for (const rejected of ["Reading Coastal Light", "-reading", "reading_coastal", "", undefined]) {
      expect((await run(rejected, { language: "en" }))[0]).toEqual(expect.any(String));
    }
  });

  it("scopes uniqueness to one language, so two languages may share one contentId", async () => {
    const { run, queries } = inspect(fieldOf("contentId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    await run("reading-coastal-light", { language: "en", _id: "abc" });

    expect(queries[0].params?.language).toBe("en");
    expect(queries[0].query).toContain("language == $language");
  });

  it("refuses an id another document in the same language already claims", async () => {
    const { run } = inspect(fieldOf("contentId").validation, {
      answer: { taken: true, publishedContentId: null },
    });

    expect(
      (await run("reading-coastal-light", { language: "en", _id: "abc" }))[0],
    ).toContain("already uses");
  });

  it("refuses to rename an identity that has already been published", async () => {
    const { run } = inspect(fieldOf("contentId").validation, {
      answer: { taken: false, publishedContentId: "reading-coastal-light" },
    });

    expect(
      (await run("a-different-id", { language: "en", _id: "abc" }))[0],
    ).toContain("reading-coastal-light");
  });

  it("defers to the language field's own validation when language is missing", async () => {
    const { run, queries } = inspect(fieldOf("contentId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(await run("reading-coastal-light", { _id: "abc" })).toEqual([true]);
    expect(queries).toHaveLength(0);
  });
});

describe("the language field", () => {
  it("accepts a language subtag and refuses a locale or a name", async () => {
    const { required, run } = inspect(fieldOf("language").validation);

    expect(required).toBe(true);
    for (const accepted of ["fi", "en"]) {
      expect(await run(accepted)).toEqual([true]);
    }
    for (const rejected of ["FI", "en-GB", "english", ""]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });
});

describe("the slug field", () => {
  it("uses the same lowercase-hyphen grammar as a category path segment", async () => {
    const { required, run } = inspect(fieldOf("slug").validation);

    expect(required).toBe(true);
    expect(await run("reading-coastal-light")).toEqual([true]);
    for (const rejected of ["Reading-Coastal-Light", "reading_coastal", ""]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });
});

describe("canonical category placement", () => {
  it("is required, so a standard publish cannot leave an article unplaced", () => {
    // ADR-0003 decision 5: draft content may stay unplaced while authored.
    // Sanity's validation model blocks *publishing*, not saving a draft, so
    // `required()` alone is the Studio-side half of that rule.
    expect(inspect(fieldOf("canonicalCategory").validation).required).toBe(true);
    expect(fieldOf("canonicalCategory").to).toEqual([{ type: CATEGORY_TYPE_NAME }]);
  });

  it("refuses a secondary category that repeats the canonical one", async () => {
    const { run } = inspect(fieldOf("secondaryCategories").validation);

    const document = { canonicalCategory: { _ref: "cat-landscape" } };
    expect(
      (await run([{ _ref: "cat-landscape" }], document))[0],
    ).toContain("repeat the canonical");
  });

  it("refuses two secondary entries for the same category", async () => {
    const { run } = inspect(fieldOf("secondaryCategories").validation);

    expect(
      (
        await run(
          [{ _ref: "cat-events" }, { _ref: "cat-events" }],
          { canonicalCategory: { _ref: "cat-landscape" } },
        )
      )[0],
    ).toContain("repeat the same category");
  });

  it("compares published identity, so a secondary draft ref does not falsely collide", async () => {
    const { run } = inspect(fieldOf("secondaryCategories").validation);

    const document = { canonicalCategory: { _ref: "drafts.cat-landscape" } };
    expect(await run([{ _ref: "cat-events" }], document)).toEqual([true]);
  });

  it("allows an article with no secondary categories at all", async () => {
    const { run } = inspect(fieldOf("secondaryCategories").validation);

    expect(await run(undefined, {})).toEqual([true]);
  });
});

describe("tags", () => {
  it("stay a separate free-text field, not a category reference", () => {
    expect(fieldOf("tags").type).toBe("array");
    expect(fieldOf("tags").of).toEqual([{ type: "string" }]);
  });
});

describe("the body", () => {
  it("allows every shared block kind and requires at least one block", () => {
    const { required, min } = inspect(fieldOf("body").validation);
    expect(required).toBe(true);
    expect(min).toBe(1);
    expect(fieldOf("body").of?.map((member) => member.type).sort()).toEqual(
      Object.values(CONTENT_BLOCK_OBJECT_TYPES).sort(),
    );
  });
});

describe("the document-level publication guard", () => {
  it("is wired to article-validation.ts's prospective check", async () => {
    const { run } = inspect(articleType.validation, {
      answer: {
        published: { language: "en", slug: "old-slug", canonicalCategoryRef: "cat-landscape" },
        categories: [
          {
            _id: "cat-landscape",
            categoryId: "cat-landscape",
            slug: [{ language: "en", value: "landscape" }],
            label: [{ language: "en", value: "Landscape" }],
          },
        ],
        siblings: [],
      },
    });

    const [message] = await run(undefined, {
      _id: "abc",
      contentId: "content-x",
      language: "en",
      slug: "new-slug",
      canonicalCategory: { _ref: "cat-landscape" },
    });

    expect(message).toContain("URL-change workflow");
  });
});
