/** Neutral fixtures only: a deployment's vocabulary is content, never part of this repository. */
import { describe, expect, it } from "vitest";

import { deriveExpandedKeywordIds, keywordMatchKey as schemaMatchKey } from "../sanity/schemas/keyword-rules";
import { KEYWORD_FIXTURE_INPUTS, keywordRow } from "../sanity/schemas/keyword-fixtures";
import {
  importedKeywordsFromFields, keywordMatchKey, KeywordImportError, mapImportedKeywords, NO_IMPORTED_KEYWORDS,
  type ImportedKeywords, type KeywordOverrides,
} from "./keyword-import-mapping.mts";

const subject = "category-subject", place = "category-place";
const published = KEYWORD_FIXTURE_INPUTS.map(keywordRow);
const none: KeywordOverrides = { added: [], removed: [] };
const input = (fields: Partial<ImportedKeywords>): ImportedKeywords => ({ ...NO_IMPORTED_KEYWORDS, ...fields });
const flat = (...terms: string[]) => input({ dcSubject: terms, iptcKeywords: terms });
const paths = (hierarchical: string[], terms: string[] = []) => input({ hierarchicalSubject: hierarchical, dcSubject: terms });

describe("pinned copies", () => {
  it("match the schema's match key, with explicit expected values", () => {
    for (const [value, expected] of [["  Bike\t Racing ", "bike racing"], ["MÄKI", "mäki"], ["Maki", "maki"], ["é", "é"], ["", ""]] as const) {
      expect(keywordMatchKey(value)).toBe(expected);
      expect(schemaMatchKey(value)).toBe(expected);
    }
  });

  it("derive the same closure as the schema", () => {
    const result = mapImportedKeywords(paths(["Sport|Cycling|Road cycling"]), published, none);
    expect(result.expandedKeywordIds).toEqual(["cycling", "road-cycling", "sport"]);
    expect(result.expandedKeywordIds).toEqual(deriveExpandedKeywordIds(result.keywords, published));
  });

  const harbour = keywordRow({ id: "harbour", title: "Harbour", category: place });
  const malformedRows: readonly (readonly [string, unknown])[] = [
    ["a missing row", undefined], ["a null row", null], ["an array row", []], ["a string row", "Harbour"],
    ...Object.entries({
      _id: [undefined, null, 1],
      keywordId: [undefined, null, 1, "", "a", "Harbour", "har bour", "-harbour", "harbour-", "har--bour", "härbour", "a".repeat(41)],
      categoryRef: [undefined, null, 1, {}],
      titles: [undefined, null, [], [""], [" \t\n"], ["", "  "], "Harbour", [1], ["Harbour", null], Object.assign(new Array<unknown>(2), { 0: "Harbour" })],
      aliases: ["Harbour", [1], new Array<unknown>(1)],
      parentRef: ["", 1, {}],
      mergedIntoRef: ["", 1, {}],
      status: [undefined, null, "other"],
      visibility: [undefined, null, 1],
    }).flatMap(([field, values]) => values.map((value): readonly [string, unknown] => [
      `${field} = ${JSON.stringify(value)}`, { ...harbour, [field]: value },
    ])),
  ];

  it.each(malformedRows)("both parsers reject %s", (_name, row) => {
    const rows = published.map((original) => original._id === "doc-harbour" ? row : original);
    const run = () => mapImportedKeywords(flat("Harbour"), rows, none);
    expect(run).toThrowError(KeywordImportError);
    expect(run).toThrowError("VOCABULARY_MALFORMED");
    expect(() => deriveExpandedKeywordIds(["doc-harbour"], rows)).toThrowError("A published keyword is malformed.");
  });

  it("both parsers accept a nonblank title beside blank titles and optional aliases", () => {
    const rows = [{ ...harbour, titles: ["", " Harbour ", " \t"], aliases: null }];
    const result = mapImportedKeywords(flat("Harbour"), rows, none);
    expect(result.keywords).toEqual(["doc-harbour"]);
    expect(result.expandedKeywordIds).toEqual(deriveExpandedKeywordIds(result.keywords, rows));
  });
});

describe("input states", () => {
  it("gives an empty result for absent input, and keeps the audit fields as they were", () => {
    const result = mapImportedKeywords(NO_IMPORTED_KEYWORDS, published, none);
    expect(result).toMatchObject({ raw: NO_IMPORTED_KEYWORDS, mapped: [], review: [], consumed: [], keywords: [], internalKeywords: [], expandedKeywordIds: [] });
  });

  it("treats empty fields like absent ones", () => {
    expect(mapImportedKeywords(input({ dcSubject: [], hierarchicalSubject: [] }), published, none)).toMatchObject({ mapped: [], review: [] });
  });

  it("still applies an editor's additions when the import holds nothing", () => {
    expect(mapImportedKeywords(NO_IMPORTED_KEYWORDS, published, { added: ["doc-harbour"], removed: [] }).keywords).toEqual(["doc-harbour"]);
  });

  it("is deep-equal across runs and input orders", () => {
    const a = mapImportedKeywords(flat("Harbour", "Tripod", "Unknown"), published, none);
    const b = mapImportedKeywords(flat("Unknown", "Tripod", "Harbour"), published, none);
    expect(mapImportedKeywords(flat("Harbour", "Tripod", "Unknown"), published, none)).toEqual(a);
    expect({ ...b, raw: null }).toEqual({ ...a, raw: null });
  });

  it("keeps the raw values and uses normalization for matching only", () => {
    const raw = flat("  HARBOUR ");
    const result = mapImportedKeywords(raw, published, none);
    expect(result.raw.dcSubject).toEqual(["  HARBOUR "]);
    expect(result.mapped).toEqual(["harbour"]);
  });
});

describe("flat terms", () => {
  it("maps titles and aliases without duplicates, whatever the case or spacing", () => {
    const result = mapImportedKeywords(flat("cycling", "CYCLING", "Bike  Racing"), published, none);
    expect(result.mapped).toEqual(["cycling"]);
    expect(result.keywords).toEqual(["doc-cycling"]);
    expect(result.expandedKeywordIds).toEqual(["cycling", "sport"]);
  });

  it("does not treat an active keyword's id as a term", () => {
    const rows = [keywordRow({ id: "alpha-id", title: "Alpha", category: subject })];
    expect(mapImportedKeywords(flat("alpha-id"), rows, none)).toMatchObject({ mapped: [], review: [{ reason: "unmatched", key: "alpha-id" }] });
  });

  it("reads a term found only in the weighted field, so no extracted term disappears", () => {
    expect(mapImportedKeywords(input({ weightedFlatSubject: ["Harbour"] }), published, none).mapped).toEqual(["harbour"]);
    expect(mapImportedKeywords(input({ weightedFlatSubject: ["Unknown"] }), published, none).review).toMatchObject([{ reason: "unmatched", key: "unknown" }]);
  });

  it("keeps diacritics distinct", () => {
    const rows = [keywordRow({ id: "maki", title: "Maki", category: subject }), keywordRow({ id: "maeki", title: "Mäki", category: subject })];
    expect(mapImportedKeywords(flat("Mäki"), rows, none).mapped).toEqual(["maeki"]);
  });

  it("returns an unmatched term for review with every raw form", () => {
    const result = mapImportedKeywords(input({ dcSubject: ["New Term"], iptcKeywords: ["new  term"] }), published, none);
    expect(result.review).toEqual([{ reason: "unmatched", key: "new term", terms: ["New Term", "new  term"], candidates: [], proposedCategoryTerm: null }]);
  });

  it("sends a name in two categories to review", () => {
    const rows = [keywordRow({ id: "make", title: "Alpha", category: subject }), keywordRow({ id: "team", title: "Alpha", category: place })];
    const result = mapImportedKeywords(flat("alpha"), rows, none);
    expect(result.mapped).toEqual([]);
    expect(result.review).toMatchObject([{ reason: "ambiguous", candidates: ["make", "team"] }]);
  });

  it("ignores a blank term, and keeps it in the audit", () => {
    const result = mapImportedKeywords(flat("   "), published, none);
    expect(result).toMatchObject({ review: [], mapped: [] });
    expect(result.raw.dcSubject).toEqual(["   "]);
  });
});

describe("merges and retirement", () => {
  const rows = [
    ...published,
    keywordRow({ id: "biking", title: "Biking", category: subject, aliases: ["cycle sport"], status: "merged", mergedInto: "cycling" }),
    keywordRow({ id: "older", title: "Older", category: subject, status: "merged", mergedInto: "biking" }),
    keywordRow({ id: "old", title: "Old", category: subject, status: "retired" }),
    keywordRow({ id: "gone", title: "Gone", category: subject, status: "merged", mergedInto: "old" }),
  ];

  it("maps a merge record's title, alias and id to the end of its chain", () => {
    for (const term of ["Biking", "cycle sport", "biking", "Older", "older"]) {
      expect(mapImportedKeywords(flat(term), rows, none).mapped, term).toEqual(["cycling"]);
    }
  });

  it("gives a retired keyword, or a chain ending at one, no term", () => {
    for (const term of ["Old", "Gone"]) expect(mapImportedKeywords(flat(term), rows, none).review, term).toMatchObject([{ reason: "unmatched" }]);
  });

  it("counts two sources reaching one target as one assignment", () => {
    const shared = [...rows, keywordRow({ id: "second", title: "Shared", category: subject, status: "merged", mergedInto: "cycling" }), keywordRow({ id: "third", title: "Shared", category: place, status: "merged", mergedInto: "cycling" })];
    expect(mapImportedKeywords(flat("Shared"), shared, none)).toMatchObject({ mapped: ["cycling"], review: [] });
  });
});

describe("paths", () => {
  it("maps the leaf of a complete path, and its ancestors through the closure", () => {
    const result = mapImportedKeywords(paths(["Sport|Cycling|Road cycling"]), published, none);
    expect(result.mapped).toEqual(["road-cycling"]);
    expect(result.keywords).toEqual(["doc-road-cycling"]);
    expect(result.expandedKeywordIds).toEqual(["cycling", "road-cycling", "sport"]);
  });

  it("uses an alias inside a path, ignoring case and spacing", () => {
    expect(mapImportedKeywords(paths([" sport | bike  racing | ROAD CYCLING "]), published, none).mapped).toEqual(["road-cycling"]);
  });

  it("treats a one-level path as a flat term", () => {
    expect(mapImportedKeywords(paths(["Harbour"]), published, none).mapped).toEqual(["harbour"]);
    // A term with no parents in Lightroom may have one on the site.
    expect(mapImportedKeywords(paths(["Cycling"]), published, none)).toMatchObject({ mapped: ["cycling"], review: [] });
    expect(mapImportedKeywords(paths(["Unknown"]), published, none).review).toEqual([{ reason: "unmatched", key: "unknown", terms: ["Unknown"], candidates: [], proposedCategoryTerm: null }]);
    const rows = [keywordRow({ id: "make", title: "Alpha", category: subject }), keywordRow({ id: "team", title: "Alpha", category: place })];
    expect(mapImportedKeywords(paths(["Alpha"]), rows, none).review).toMatchObject([{ reason: "ambiguous", candidates: ["make", "team"] }]);
  });

  it("uses the path to tell apart keywords that share a name", () => {
    const rows = [
      keywordRow({ id: "root-a", title: "Root A", category: subject }), keywordRow({ id: "root-b", title: "Root B", category: place }),
      keywordRow({ id: "leaf-a", title: "Leaf", category: subject, parent: "root-a" }), keywordRow({ id: "leaf-b", title: "Leaf", category: place, parent: "root-b" }),
    ];
    expect(mapImportedKeywords(paths(["Root B|Leaf"]), rows, none).mapped).toEqual(["leaf-b"]);
  });

  it("sends a path the vocabulary does not hold to review, proposing its top-level term, and creates nothing", () => {
    const result = mapImportedKeywords(paths(["New Root|New Leaf"]), published, none);
    expect(result.mapped).toEqual([]);
    expect(result.review).toEqual([{ reason: "unmatched", key: "new root|new leaf", terms: ["New Root|New Leaf"], candidates: [], proposedCategoryTerm: "New Root" }]);
  });

  it("does not guess when only the leaf exists under another parent", () => {
    const result = mapImportedKeywords(paths(["Other|Road cycling"]), published, none);
    expect(result).toMatchObject({ mapped: [], review: [{ reason: "path-mismatch", candidates: ["road-cycling"], proposedCategoryTerm: "Other" }] });
  });

  it("does not treat an ancestor's id as one of its names", () => {
    const rows = [keywordRow({ id: "alpha", title: "Beta", category: subject }), keywordRow({ id: "leaf", title: "Leaf", category: subject, parent: "alpha" })];
    expect(mapImportedKeywords(paths(["Alpha|Leaf"]), rows, none).review).toMatchObject([{ reason: "path-mismatch", candidates: ["leaf"] }]);
    expect(mapImportedKeywords(paths(["Beta|Leaf"]), rows, none).mapped).toEqual(["leaf"]);
  });

  it("follows an editor's decision recorded as a whole-path alias, whatever the hierarchy says", () => {
    const rows = [keywordRow({ id: "moved", title: "Moved", category: subject, aliases: ["old root|moved"] })];
    expect(mapImportedKeywords(paths(["Old Root | Moved"]), rows, none)).toMatchObject({ mapped: ["moved"], review: [] });
    expect(mapImportedKeywords(paths(["Other Root|Moved"]), rows, none).review).toMatchObject([{ reason: "path-mismatch" }]);
  });

  it("lets a whole-path alias settle an ambiguous path, but not a flat name two categories share", () => {
    const rows = [
      keywordRow({ id: "one", title: "Shared", category: subject, aliases: ["root|shared"] }),
      keywordRow({ id: "two", title: "Shared", category: "category-other" }),
    ];
    expect(mapImportedKeywords(paths(["Root|Shared"]), rows, none)).toMatchObject({ mapped: ["one"], review: [] });
    expect(mapImportedKeywords(flat("Shared"), rows, none).review).toMatchObject([{ reason: "ambiguous", key: "shared" }]);
  });

  it("follows an editor's choice for a flat name two categories share, while it stays one of the options", () => {
    const rows = [keywordRow({ id: "one", title: "Shared", category: subject }), keywordRow({ id: "two", title: "Shared", category: "category-other" })];
    const chosen = (documentId: string) => mapImportedKeywords(flat("Shared"), rows, none, { termDecisions: new Map([["shared", documentId]]) });
    expect(chosen("doc-two")).toMatchObject({ mapped: ["two"], review: [] });
    expect(chosen("doc-gone").review).toMatchObject([{ reason: "ambiguous" }]);
    const unrelated = [...rows, keywordRow({ id: "three", title: "Other", category: subject })];
    expect(mapImportedKeywords(flat("Shared"), unrelated, none, { termDecisions: new Map([["shared", "doc-three"]]) }).review).toMatchObject([{ reason: "ambiguous" }]);
  });

  it("keeps a keyword the site moved on a medium already holding it, and still asks about the path", () => {
    const rows = [
      keywordRow({ id: "sport", title: "Sport", category: subject }),
      keywordRow({ id: "outdoors", title: "Outdoors", category: subject }),
      keywordRow({ id: "cycling", title: "Cycling", category: subject, parent: "outdoors" }),
    ];
    const held = mapImportedKeywords(paths(["Sport|Cycling"]), rows, none, { currentKeywords: ["doc-cycling"] });
    expect(held).toMatchObject({ mapped: ["cycling"], expandedKeywordIds: ["cycling", "outdoors"], review: [{ reason: "path-mismatch" }] });
    expect(mapImportedKeywords(paths(["Sport|Cycling"]), rows, none).mapped).toEqual([]);
    expect(mapImportedKeywords(paths(["Sport|Cycling"]), rows, { added: [], removed: ["doc-cycling"] }, { currentKeywords: ["doc-cycling"] }).keywords).toEqual([]);
    expect(mapImportedKeywords(paths(["Sport|Cycling"]), rows, none, { currentKeywords: ["doc-gone"] }).mapped).toEqual([]);
  });

  it("requires the path to start at a root", () => {
    expect(mapImportedKeywords(paths(["Cycling|Road cycling"]), published, none).review).toMatchObject([{ reason: "path-mismatch" }]);
  });

  it.each(["Sport||Cycling", "|Sport|Cycling", "Sport|Cycling|", "|", "  |  "])("does not repair %j", (path) => {
    const result = mapImportedKeywords(paths([path]), published, none);
    expect(result.mapped).toEqual([]);
    expect(result.review).toMatchObject([{ reason: "malformed-path", terms: [path], proposedCategoryTerm: null }]);
  });

  it("accepts an old path that names a merge record, as well as its target's path", () => {
    const rows = [
      ...published,
      keywordRow({ id: "old-root", title: "Old Root", category: subject, status: "retired" }),
      keywordRow({ id: "old-leaf", title: "Old Leaf", category: subject, parent: "old-root", status: "merged", mergedInto: "cycling" }),
    ];
    expect(mapImportedKeywords(paths(["Old Root|Old Leaf"]), rows, none).mapped).toEqual(["cycling"]);
    expect(mapImportedKeywords(paths(["Sport|Cycling"]), rows, none).mapped).toEqual(["cycling"]);
  });

  it("reports two paths that reach one keyword once", () => {
    expect(mapImportedKeywords(paths(["Sport|Cycling", "sport|CYCLING"]), published, none)).toMatchObject({ mapped: ["cycling"], review: [] });
  });
});

describe("flat terms beside paths", () => {
  it("consumes a repeat of a mapped path's components, and says what covers it", () => {
    const result = mapImportedKeywords(paths(["Sport|Cycling|Road cycling"], ["Sport", "Cycling", "Road cycling"]), published, none);
    expect(result.mapped).toEqual(["road-cycling"]);
    expect(result.review).toEqual([]);
    expect(result.consumed).toEqual([
      { key: "cycling", terms: ["Cycling"], coveredByKeyword: "road-cycling", coveredByReviewPath: null },
      { key: "road cycling", terms: ["Road cycling"], coveredByKeyword: "road-cycling", coveredByReviewPath: null },
      { key: "sport", terms: ["Sport"], coveredByKeyword: "road-cycling", coveredByReviewPath: null },
    ]);
  });

  it("consumes a known synonym of a mapped keyword's ancestor", () => {
    const result = mapImportedKeywords(paths(["Sport|Cycling|Road cycling"], ["bike racing"]), published, none);
    expect(result).toMatchObject({ mapped: ["road-cycling"], review: [], consumed: [{ key: "bike racing", coveredByKeyword: "road-cycling" }] });
  });

  it("ties a repeat of an unresolved path to that path's review item, with no second item", () => {
    const result = mapImportedKeywords(paths(["New Root|New Leaf"], ["New Root", "New Leaf"]), published, none);
    expect(result.review).toMatchObject([{ reason: "unmatched", key: "new root|new leaf" }]);
    expect(result.consumed).toEqual([
      { key: "new leaf", terms: ["New Leaf"], coveredByKeyword: null, coveredByReviewPath: "new root|new leaf" },
      { key: "new root", terms: ["New Root"], coveredByKeyword: null, coveredByReviewPath: "new root|new leaf" },
    ]);
  });

  it("keeps a flat-only unknown term in review, marked as beside paths", () => {
    const result = mapImportedKeywords(paths(["Sport|Cycling"], ["Unknown Synonym"]), published, none);
    expect(result.review).toEqual([{ reason: "unmatched-beside-paths", key: "unknown synonym", terms: ["Unknown Synonym"], candidates: [], proposedCategoryTerm: null }]);
  });

  it("does not let one flat term's mapping cover another", () => {
    const result = mapImportedKeywords(flat("Road cycling", "Sport"), published, none);
    expect(result.mapped).toEqual(["road-cycling", "sport"]);
    expect(result.consumed).toEqual([]);
  });

  it("maps a flat-only term that belongs to an unrelated keyword", () => {
    expect(mapImportedKeywords(paths(["Sport|Cycling"], ["Harbour"]), published, none).mapped).toEqual(["cycling", "harbour"]);
  });
});

describe("overrides and effective keywords", () => {
  it("applies additions and removals", () => {
    const result = mapImportedKeywords(flat("Harbour", "Tripod"), published, { added: ["doc-sport"], removed: ["doc-tripod"] });
    expect(result.mapped).toEqual(["harbour", "tripod"]);
    expect(result.keywords).toEqual(["doc-harbour", "doc-sport"]);
  });

  it("lets a removal win over an addition, also through a merge chain", () => {
    const rows = [...published, keywordRow({ id: "biking", title: "Biking", category: subject, status: "merged", mergedInto: "cycling" })];
    const result = mapImportedKeywords(flat("Cycling"), rows, { added: ["doc-cycling"], removed: ["doc-biking"] });
    expect(result.overrides).toEqual({ added: [], removed: ["doc-cycling"] });
    expect(result.keywords).toEqual([]);
  });

  it("converges additions on one target", () => {
    const rows = [...published, keywordRow({ id: "biking", title: "Biking", category: subject, status: "merged", mergedInto: "cycling" })];
    expect(mapImportedKeywords(NO_IMPORTED_KEYWORDS, rows, { added: ["doc-biking", "doc-cycling"], removed: [] }).overrides.added).toEqual(["doc-cycling"]);
  });

  it("keeps a retired keyword as a dormant decision, out of the effective set", () => {
    const rows = [
      ...published,
      keywordRow({ id: "old", title: "Old", category: subject, status: "retired" }),
      keywordRow({ id: "gone", title: "Gone", category: subject, status: "merged", mergedInto: "old" }),
    ];
    const result = mapImportedKeywords(NO_IMPORTED_KEYWORDS, rows, { added: ["doc-gone"], removed: ["doc-old"] });
    expect(result.overrides).toEqual({ added: [], removed: ["doc-old"] });
    const added = mapImportedKeywords(NO_IMPORTED_KEYWORDS, rows, { added: ["doc-gone"], removed: [] });
    expect(added.overrides.added).toEqual(["doc-old"]);
    expect(added.keywords).toEqual([]);
  });

  it("splits by visibility, and keeps internal keywords out of the public closure", () => {
    const rows = [...published, keywordRow({ id: "person", documentId: "keyword.person", title: "Person", category: subject, visibility: "internal" })];
    const result = mapImportedKeywords(flat("Person", "Harbour"), rows, none);
    expect(result.keywords).toEqual(["doc-harbour"]);
    expect(result.internalKeywords).toEqual(["keyword.person"]);
    expect(result.expandedKeywordIds).toEqual(["harbour"]);
  });
});

describe("errors", () => {
  const failure = (run: () => unknown) => {
    try { run(); } catch (error) { return error instanceof KeywordImportError ? error.code : "other"; }
    return "none";
  };

  it.each([
    ["a row without an id", [{ keywordId: "a", status: "active", visibility: "public" }], "VOCABULARY_MALFORMED"],
    ["an unknown status", [{ _id: "a", keywordId: "a", status: "other", visibility: "public" }], "VOCABULARY_MALFORMED"],
    ["a non-string title", [{ _id: "a", keywordId: "a", titles: [1], status: "active", visibility: "public" }], "VOCABULARY_MALFORMED"],
    ["a merge without a target", [keywordRow({ id: "alpha", title: "A", category: subject, status: "merged" })], "VOCABULARY_MERGE_INVALID"],
    ["a merge cycle", [keywordRow({ id: "alpha", title: "A", category: subject, status: "merged", mergedInto: "beta" }), keywordRow({ id: "beta", title: "B", category: subject, status: "merged", mergedInto: "alpha" })], "VOCABULARY_MERGE_INVALID"],
    ["a dangling merge", [keywordRow({ id: "alpha", title: "A", category: subject, status: "merged", mergedInto: "beta" })], "VOCABULARY_REFERENCE_UNKNOWN"],
  ])("refuses %s", (_name, rows, code) => {
    expect(failure(() => mapImportedKeywords(NO_IMPORTED_KEYWORDS, rows, none))).toBe(code);
  });

  it.each([
    ["a private path marked public", keywordRow({ id: "person", documentId: "keyword.person", title: "Person", category: subject, visibility: "public" })],
    ["an ordinary path marked internal", keywordRow({ id: "person", documentId: "person", title: "Person", category: subject, visibility: "internal" })],
  ])("refuses %s", (_name, row) => {
    expect(failure(() => mapImportedKeywords(flat("Person"), [row], none))).toBe("VOCABULARY_MALFORMED");
  });

  it("refuses an override naming no keyword", () => {
    expect(failure(() => mapImportedKeywords(NO_IMPORTED_KEYWORDS, published, { added: ["doc-missing"], removed: [] }))).toBe("VOCABULARY_REFERENCE_UNKNOWN");
  });

  it("refuses a public keyword with a private ancestor", () => {
    const rows = [
      keywordRow({ id: "secret", documentId: "keyword.secret", title: "Secret", category: subject, visibility: "internal" }),
      { ...keywordRow({ id: "open", title: "Open", category: subject }), parentRef: "keyword.secret" },
    ];
    expect(failure(() => mapImportedKeywords(flat("Open"), rows, none))).toBe("VOCABULARY_PRIVATE_ANCESTOR");
  });

  it("refuses a parent cycle", () => {
    const rows = [keywordRow({ id: "alpha", title: "A", category: subject, parent: "beta" }), keywordRow({ id: "beta", title: "B", category: subject, parent: "alpha" })];
    expect(failure(() => mapImportedKeywords(flat("A"), rows, none))).toBe("VOCABULARY_PARENT_CYCLE");
  });
});

describe("reading ExifTool's fields", () => {
  it("reads grouped fields, scalars and arrays, keeping each field separate", () => {
    expect(importedKeywordsFromFields({
      "XMP-dc:Subject": ["One", "Two"], "IPTC:Keywords": "One", "XMP-lr:HierarchicalSubject": "Root|One", "XMP-lr:WeightedFlatSubject": ["Two"], "IFD0:Make": "Other",
    })).toEqual({ dcSubject: ["One", "Two"], iptcKeywords: ["One"], hierarchicalSubject: ["Root|One"], weightedFlatSubject: ["Two"] });
  });

  it("gives null for a missing field, so absence stays distinct from an empty list", () => {
    expect(importedKeywordsFromFields({})).toEqual(NO_IMPORTED_KEYWORDS);
    expect(importedKeywordsFromFields({ "XMP-dc:Subject": [] }).dcSubject).toEqual([]);
  });

  it("reads a numeric keyword as text", () => {
    expect(importedKeywordsFromFields({ "XMP-dc:Subject": [2024, "Two"] }).dcSubject).toEqual(["2024", "Two"]);
  });

  it.each([[{ a: 1 }], [[true]], [null], [Number.NaN]])("refuses %j rather than losing it", (value) => {
    expect(() => importedKeywordsFromFields({ "XMP-dc:Subject": value })).toThrow(KeywordImportError);
  });

  it("leaves two fields that disagree for the mapping to report", () => {
    const raw = importedKeywordsFromFields({ "XMP-dc:Subject": "Harbour", "IPTC:Keywords": "Tripod" });
    expect(mapImportedKeywords(raw, published, none).mapped).toEqual(["harbour", "tripod"]);
  });
});
