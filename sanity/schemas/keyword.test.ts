import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { defineKeywordType, keywordCategoryType, keywordTaxonomyStateType } from "./keyword";
import { KEYWORD_FIXTURE_INPUTS, keywordDocument, keywordRow } from "./keyword-fixtures";
import { defineMediaType } from "./media";
import type { SchemaFieldDefinition, SchemaValidationClient, SchemaValidationContext } from "./schema-types";
import { inspectValidationRules } from "./validation-test-helper";

const keywordType = defineKeywordType({ defaultContentLanguage: "fi" });

function field(name: string, type = keywordType): SchemaFieldDefinition {
  return type.fields.find((candidate) => candidate.name === name)!;
}

function contextOf(document: Readonly<Record<string, unknown>> | undefined, answer: unknown = null): SchemaValidationContext {
  const client: SchemaValidationClient = { fetch: async <T,>() => answer as T, withConfig: () => client };
  return { document, getClient: () => client };
}

const run = async (definition: SchemaFieldDefinition, value: unknown, context = contextOf({ _id: "drafts.doc" }, { taken: false, publishedKeywordId: null })) =>
  Promise.all(inspectValidationRules(definition.validation).checks.map((check) => check(value, context)));

describe("keyword schema", () => {
  it("declares ADR-0039's fields, with one parent and a closed status", () => {
    expect(keywordType.fields.map(({ name }) => name).sort()).toEqual(
      ["aliases", "category", "description", "keywordId", "mergedInto", "parent", "status", "title", "visibility"]);
    expect(field("parent").type).toBe("reference");
    expect(field("category").to).toEqual([{ type: "keywordCategory" }]);
    expect(field("status").options?.list?.map(({ value }) => value)).toEqual(["active", "merged", "retired"]);
    expect(field("status").initialValue).toBe("active");
    expect(field("visibility").readOnly).toBe(true);
    expect(inspectValidationRules(field("category").validation).required).toBe(true);
  });

  it("configures categories as content rather than an enum", () => {
    expect(field("category").options?.list).toBeUndefined();
    expect(keywordCategoryType.fields.map(({ name }) => name)).toEqual(["title", "slug", "order", "description"]);
  });

  it("hardcodes no deployment vocabulary", () => {
    for (const file of ["keyword.ts", "keyword-rules.ts", "keyword-fixtures.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/\b(?:rally|ralli|wrc|driver|hyundai)\b/iu);
    }
  });

  it("keeps the taxonomy state out of hand editing", () => {
    for (const definition of keywordTaxonomyStateType.fields) expect(definition.readOnly).toBe(true);
  });

  it("proposes an id from the default-language title when one is missing or invalid", async () => {
    const document = { _id: "drafts.doc", title: [{ language: "en", value: "Other" }, { language: "fi", value: "Mäkelä" }] };
    expect(await run(field("keywordId"), "Bad Id", contextOf(document))).toEqual(["Use 2–40 lowercase letters, digits and single hyphens. Proposed from the title: makela"]);
    expect(await run(field("keywordId"), undefined, contextOf({ _id: "drafts.doc" }))).toEqual(["Use 2–40 lowercase letters, digits and single hyphens."]);
  });

  it("checks id uniqueness across every status, and immutability", async () => {
    expect(await run(field("keywordId"), "good-id")).toEqual([true]);
    expect((await run(field("keywordId"), "good-id", contextOf({ _id: "doc" }, { taken: true, publishedKeywordId: null })))[0]).toMatch(/never reused/);
    expect((await run(field("keywordId"), "good-id", contextOf({ _id: "doc" }, { taken: false, publishedKeywordId: "older" })))[0]).toMatch(/published as "older"/);
  });

  it("requires a title in the default language when the site names one", async () => {
    const check = async (type: ReturnType<typeof defineKeywordType>, value: unknown) => {
      const results = await run(field("title", type), value);
      return results.find((result) => result !== true) ?? true;
    };
    expect(await check(keywordType, [{ language: "fi", value: "Satama" }])).toBe(true);
    expect(await check(keywordType, [{ language: "en", value: "Harbour" }])).toBe("Add a title in the site's default language (fi).");
    expect(await check(keywordType, [{ language: "fi", value: "  " }])).toMatch(/default language/);
    expect(await check(defineKeywordType(), [{ language: "en", value: "Harbour" }])).toBe(true);
    expect(await check(keywordType, [{ language: "fi", value: "A" }, { language: "fi", value: "B" }])).toMatch(/One entry per language/);
  });

  it("rejects an empty alias and a self reference", async () => {
    expect(await run(field("aliases"), ["ok"])).toEqual([true]);
    expect(await run(field("aliases"), ["   "])).toEqual(["An alias cannot be empty."]);
    expect(await run(field("parent"), { _ref: "doc" }, contextOf({ _id: "drafts.doc" }))).toEqual(["A keyword cannot refer to itself."]);
    expect(await run(field("mergedInto"), { _ref: "other" }, contextOf({ _id: "drafts.doc" }))).toEqual([true]);
  });

  it("validates the document against the published graph and refuses releases", async () => {
    const [check] = inspectValidationRules(keywordType.validation).checks;
    const rows = KEYWORD_FIXTURE_INPUTS.map(keywordRow);
    const good = { ...keywordDocument({ id: "fresh", title: "Fresh", category: "category-place" }), _id: "drafts.doc-fresh" };
    expect(await check(good, contextOf(good, rows))).toBe(true);
    const clash = { ...keywordDocument({ id: "fresh", title: "Bike racing", category: "category-subject" }), _id: "drafts.doc-fresh" };
    expect(await check(clash, contextOf(clash, rows))).toMatch(/both use the name "bike racing"/);
    const release = { ...good, _id: "versions.r1.doc-fresh" };
    expect(await check(release, contextOf(release, rows))).toMatch(/outside Content Releases/);
  });

  it("checks a category slug's syntax and uniqueness", async () => {
    const slug = field("slug", keywordCategoryType);
    expect(await run(slug, "places", contextOf({ _id: "drafts.c" }, false))).toEqual([true]);
    expect(await run(slug, "Places", contextOf({ _id: "drafts.c" }, false))).toEqual(["Use lowercase letters, digits, and single hyphens"]);
    expect(await run(slug, "places", contextOf({ _id: "drafts.c" }, true))).toEqual(['Another keyword category already uses "places".']);
    expect(await run(slug, "places", contextOf({ _id: "secret.c" }, false))).toEqual(["A keyword category must be an ordinary public document."]);
  });
});

describe("media keyword fields", () => {
  const media = defineMediaType({ datasetVisibility: "public" });

  it("are generated, never hand-edited", () => {
    expect(field("keywords", media).readOnly).toBe(true);
    expect(field("expandedKeywordIds", media).readOnly).toBe(true);
    expect(field("expandedKeywordIds", media).of).toEqual([{ type: "string" }]);
    expect(field("keywords", media).of).toEqual([{ type: "reference", to: [{ type: "keyword" }] }]);
  });

  it("reject a private keyword and warn about one that is no longer active", async () => {
    const rules = inspectValidationRules(field("keywords", media).validation);
    expect(await Promise.all(rules.checks.map((check) => check([{ _ref: "doc-a" }], contextOf({ _id: "m" }))))).toEqual([true]);
    expect(await rules.checks[0]([{ _ref: "drafts.keyword.client" }], contextOf({ _id: "m" }))).toMatch(/internal keyword/);
    expect(await rules.warnings[0]([{ _ref: "doc-a" }], contextOf({ _id: "m" }, true))).toMatch(/no longer active/);
    expect(await rules.warnings[0]([{ _ref: "doc-a" }], contextOf({ _id: "m" }, false))).toBe(true);
    expect(await rules.warnings[0]([], contextOf({ _id: "m" }, true))).toBe(true);
  });
});
