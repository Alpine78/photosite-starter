import { describe, expect, it } from "vitest";

import { CATEGORY_TYPE_NAME } from "./category";
import { defineSchemaTypes } from "./index";
import { galleryType, GALLERY_TYPE_NAME } from "./gallery";
import {
  GALLERY_SECTION_INTRO_LIST_TYPE_NAME,
  GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME,
} from "./gallery-section-intro";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

function inspect(
  validation: SchemaValidation | undefined,
  dataset: { answer?: unknown } = {},
) {
  const checks: CustomCheck[] = [];
  const warnings: CustomCheck[] = [];
  const queries: { query: string; params?: Readonly<Record<string, unknown>> }[] = [];
  let required = false;

  const rule: SchemaValidationRule = {
    required() {
      required = true;
      return rule;
    },
    min() {
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
      warnings.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, ...(params === undefined ? {} : { params }) });
      return dataset.answer as never;
    },
    withConfig() {
      return client;
    },
  };

  const contextFor = (document?: Record<string, unknown>): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));
  const runWarnings = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(warnings.map((check) => check(value, contextFor(document))));

  return { required, run, runWarnings, queries };
}

function fieldOf(name: string): SchemaFieldDefinition {
  const field = galleryType.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

function itemFieldOf(field: SchemaFieldDefinition, name: string): SchemaFieldDefinition {
  const item = field.of?.[0];
  const itemField = item?.fields?.find((candidate) => candidate.name === name);
  if (itemField === undefined) {
    throw new Error(`no field named "${name}" on ${field.name}'s array item`);
  }
  return itemField;
}

const fieldNames = () => galleryType.fields.map((field) => field.name);

const UNIQUE_AND_UNCHANGED = { taken: false, publishedContentId: null, otherLanguageType: null };

describe("the gallery document", () => {
  it("is registered in the schema index", () => {
    const types = defineSchemaTypes({
      datasetVisibility: "public",
      storyRootPaths: ["/stories"],
    });
    expect(types.some((type) => type.name === GALLERY_TYPE_NAME)).toBe(true);
    expect(types.some((type) => type.name === GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME)).toBe(
      true,
    );
    expect(types.some((type) => type.name === GALLERY_SECTION_INTRO_LIST_TYPE_NAME)).toBe(true);
  });

  it("carries one language's text directly, like article.ts — not language-keyed arrays", () => {
    expect(fieldNames()).toEqual(
      expect.arrayContaining(["contentId", "language", "title", "slug", "summary"]),
    );
    expect(fieldOf("title").type).toBe("string");
  });

  it("keeps a canonical media reference for its cover", () => {
    expect(fieldOf("cover").to).toEqual([{ type: MEDIA_TYPE_NAME }]);
  });

  it("requires a canonical category, matching article.ts", () => {
    expect(fieldOf("canonicalCategory").to).toEqual([{ type: CATEGORY_TYPE_NAME }]);
    const { required } = inspect(fieldOf("canonicalCategory").validation);
    expect(required).toBe(true);
  });

  it("has an optional body, unlike article.ts's required one", () => {
    const { required } = inspect(fieldOf("body").validation);
    expect(required).toBe(false);
  });
});

describe("the content identity", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(fieldOf("contentId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(required).toBe(true);
    expect(await run("northern-coast-2026", { language: "en" })).toEqual([true]);
    for (const rejected of ["Northern Coast", "-northern", "northern_coast", "", undefined]) {
      expect((await run(rejected, { language: "en" }))[0]).toEqual(expect.any(String));
    }
  });

  it("checks uniqueness across both articles and galleries", async () => {
    const { run, queries } = inspect(fieldOf("contentId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    await run("northern-coast-2026", { language: "en", _id: "abc" });

    expect(queries[0].params?.siblingTypes).toEqual(["article", "gallery"]);
  });

  it("refuses an id an article already claims in the same language", async () => {
    const { run } = inspect(fieldOf("contentId").validation, {
      answer: { taken: true, publishedContentId: null, otherLanguageType: null },
    });

    expect(
      (await run("northern-coast-2026", { language: "en", _id: "abc" }))[0],
    ).toContain("already uses");
  });

  it("refuses a contentId already used by an article in another language", async () => {
    const { run } = inspect(fieldOf("contentId").validation, {
      answer: { taken: false, publishedContentId: null, otherLanguageType: "article" },
    });

    const result = (await run("northern-coast-2026", { language: "en", _id: "abc" }))[0];
    expect(result).toContain("article");
    expect(result).toContain("variant");
  });

  it("refuses to rename an identity that has already been published", async () => {
    const { run } = inspect(fieldOf("contentId").validation, {
      answer: { taken: false, publishedContentId: "northern-coast-2026", otherLanguageType: null },
    });

    expect(
      (await run("a-different-id", { language: "en", _id: "abc" }))[0],
    ).toContain("northern-coast-2026");
  });
});

describe("ordering", () => {
  it("defaults to manual and offers seeded-random", () => {
    expect(fieldOf("orderingRule").initialValue).toBe("manual");
    expect(fieldOf("orderingRule").options?.list).toEqual([
      { title: "Manual (placement order)", value: "manual" },
      { title: "Seeded random", value: "seeded-random" },
    ]);
  });

  it("requires orderingSeed exactly when orderingRule is seeded-random", async () => {
    const { run } = inspect(fieldOf("orderingSeed").validation);

    expect(await run(undefined, { orderingRule: "manual" })).toEqual([true]);
    expect(await run("abc", { orderingRule: "manual" })).toEqual([expect.any(String)]);
    expect(await run(undefined, { orderingRule: "seeded-random" })).toEqual([expect.any(String)]);
    expect(await run("abc", { orderingRule: "seeded-random" })).toEqual([true]);
  });
});

describe("placements", () => {
  const placementIdField = () => itemFieldOf(fieldOf("placements"), "placementId");
  const mediaField = () => itemFieldOf(fieldOf("placements"), "media");
  const visibleField = () => itemFieldOf(fieldOf("placements"), "visible");

  it("references media and requires a placement id, matching the documented form", async () => {
    expect(mediaField().to).toEqual([{ type: MEDIA_TYPE_NAME }]);
    const { required, run } = inspect(placementIdField().validation);
    expect(required).toBe(true);
    expect(await run("northern-coast-2026-01")).toEqual([true]);
    expect((await run("Not Valid"))[0]).toEqual(expect.any(String));
  });

  it("defaults visible to true and pinned to false", () => {
    expect(visibleField().initialValue).toBe(true);
    expect(itemFieldOf(fieldOf("placements"), "pinned").initialValue).toBe(false);
  });

  it("warns, without blocking, when a photograph repeats across placements (ADR-0002 §2)", async () => {
    const { runWarnings } = inspect(fieldOf("placements").validation);

    const repeated = [
      { media: { _ref: "media-a" } },
      { media: { _ref: "media-b" } },
      { media: { _ref: "media-a" } },
    ];
    expect((await runWarnings(repeated))[0]).toEqual(expect.any(String));

    const distinct = [{ media: { _ref: "media-a" } }, { media: { _ref: "media-b" } }];
    expect(await runWarnings(distinct)).toEqual([true]);
  });
});

describe("sections", () => {
  const slugField = () => itemFieldOf(fieldOf("sections"), "slug");

  it("rejects the reserved 'all' slug", async () => {
    const { run } = inspect(slugField().validation);
    expect((await run("all"))[0]).toEqual(expect.any(String));
    expect(await run("behind-the-scenes")).toEqual([true]);
  });

  it("carries a bounded intro field built from the shared block types", () => {
    const introField = itemFieldOf(fieldOf("sections"), "intro");
    expect(introField.of).toEqual([
      { type: GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME },
      { type: GALLERY_SECTION_INTRO_LIST_TYPE_NAME },
    ]);
  });
});
