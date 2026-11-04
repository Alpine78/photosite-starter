/**
 * Representative keyword documents for the schema tests: three configurable
 * categories and a three-level hierarchy. Neutral on purpose: a deployment's own
 * vocabulary and categories are content, never fixtures in this repository.
 */

export const KEYWORD_CATEGORY_FIXTURES = [
  { _id: "category-subject", _type: "keywordCategory", slug: "subject", order: 0, title: [{ language: "en", value: "Subject" }] },
  { _id: "category-place", _type: "keywordCategory", slug: "place", order: 1, title: [{ language: "en", value: "Place" }] },
  { _id: "category-equipment", _type: "keywordCategory", slug: "equipment", order: 2, title: [{ language: "en", value: "Equipment" }] },
] as const;

type KeywordFixtureInput = Readonly<{
  id: string;
  title: string;
  category: string;
  parent?: string;
  aliases?: readonly string[];
  status?: "active" | "merged" | "retired";
  mergedInto?: string;
  documentId?: string;
  visibility?: "public" | "internal";
}>;

/** A whole keyword document, as Studio edits it. */
export function keywordDocument(input: KeywordFixtureInput): Readonly<Record<string, unknown>> {
  return {
    _id: input.documentId ?? `doc-${input.id}`,
    _type: "keyword",
    keywordId: input.id,
    title: [{ language: "en", value: input.title }],
    category: { _ref: input.category },
    ...(input.parent === undefined ? {} : { parent: { _ref: `doc-${input.parent}` } }),
    ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
    status: input.status ?? "active",
    ...(input.mergedInto === undefined ? {} : { mergedInto: { _ref: `doc-${input.mergedInto}` } }),
    visibility: input.visibility ?? "public",
  };
}

/** The same keyword as the graph query projects it. */
export function keywordRow(input: KeywordFixtureInput): Readonly<Record<string, unknown>> {
  return {
    _id: input.documentId ?? `doc-${input.id}`,
    keywordId: input.id,
    categoryRef: input.category,
    parentRef: input.parent === undefined ? null : `doc-${input.parent}`,
    titles: [input.title],
    aliases: input.aliases ?? null,
    status: input.status ?? "active",
    visibility: input.visibility ?? "public",
    mergedIntoRef: input.mergedInto === undefined ? null : `doc-${input.mergedInto}`,
  };
}

export const KEYWORD_FIXTURE_INPUTS: readonly KeywordFixtureInput[] = [
  { id: "sport", title: "Sport", category: "category-subject" },
  { id: "cycling", title: "Cycling", category: "category-subject", parent: "sport", aliases: ["bike racing"] },
  { id: "road-cycling", title: "Road cycling", category: "category-subject", parent: "cycling" },
  { id: "harbour", title: "Harbour", category: "category-place" },
  { id: "tripod", title: "Tripod", category: "category-equipment" },
];
