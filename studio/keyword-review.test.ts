import { describe, expect, it } from "vitest";

import { evaluate, parse } from "groq-js";

import { keywordDocument, keywordRow } from "../sanity/schemas/keyword-fixtures";
import {
  aggregateKeywordReview, KEYWORD_ALIAS_TARGET_QUERY, keywordAliasTargetParams, keywordReviewAction, keywordReviewCopy, keywordReviewOutcome, planAddAlias, planCreateKeywordDraft, proposedCategoryId, proposedKeywordId, proposedTitle, REPRESENTATIVE_MEDIA_LIMIT,
  type AliasTarget, type KeywordReviewGraph, type KeywordReviewGroup,
} from "./keyword-review";

const subject = "category-subject", place = "category-place";
const graph: KeywordReviewGraph = {
  stateRevision: "state-1",
  keywords: [
    keywordRow({ id: "cycling", title: "Cycling", category: subject, aliases: ["bike racing"] }),
    keywordRow({ id: "harbour", title: "Harbour", category: place }),
  ],
};
const group = (overrides: Partial<KeywordReviewGroup> = {}): KeywordReviewGroup => ({ reason: "unmatched", key: "new term", terms: ["New Term"], occurrences: 1, mediaIds: ["m1"], candidates: [], proposedCategoryTerm: null, ...overrides });
const target = (overrides: Partial<AliasTarget> = {}): AliasTarget => ({ ...keywordDocument({ id: "cycling", title: "Cycling", category: subject, aliases: ["bike racing"] }), _rev: "rev-1", hasDraft: false, ...overrides }) as unknown as AliasTarget;

describe("aggregating review items", () => {
  const item = (key: string, terms: string[], reason = "unmatched") => ({ reason, key, terms, candidates: [], proposedCategoryTerm: null });

  it("gives one row per normalized term, counting photographs and collecting raw forms", () => {
    const rows = aggregateKeywordReview([
      { mediaId: "m1", reviewItems: [item("new term", ["New Term"])] },
      { mediaId: "m2", reviewItems: [item("new term", ["new  term"]), item("other", ["Other"])] },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ key: "new term", terms: ["New Term", "new  term"], occurrences: 2, mediaIds: ["m1", "m2"] }),
      expect.objectContaining({ key: "other", occurrences: 1 }),
    ]);
  });

  it("keeps one term with two reasons apart, because they need different decisions", () => {
    const rows = aggregateKeywordReview([{ mediaId: "m1", reviewItems: [item("alpha", ["Alpha"]), item("alpha", ["Alpha"], "ambiguous")] }]);
    expect(rows.map((row) => row.reason).sort()).toEqual(["ambiguous", "unmatched"]);
  });

  it("orders by photographs, then term, and bounds the examples without losing the count", () => {
    const records = Array.from({ length: REPRESENTATIVE_MEDIA_LIMIT + 3 }, (_, index) => ({ mediaId: `m${index}`, reviewItems: [item("common", ["Common"])] }));
    const rows = aggregateKeywordReview([{ mediaId: "z", reviewItems: [item("rare", ["Rare"]), item("arare", ["A Rare"])] }, ...records]);
    expect(rows.map((row) => row.key)).toEqual(["common", "arare", "rare"]);
    expect(rows[0].occurrences).toBe(REPRESENTATIVE_MEDIA_LIMIT + 3);
    expect(rows[0].mediaIds).toHaveLength(REPRESENTATIVE_MEDIA_LIMIT);
  });

  it("collects candidates and a proposed category", () => {
    const rows = aggregateKeywordReview([{ mediaId: "m", reviewItems: [{ reason: "ambiguous", key: "a", terms: ["A"], candidates: ["x", "y"], proposedCategoryTerm: "Root" }] }]);
    expect(rows[0]).toMatchObject({ candidates: ["x", "y"], proposedCategoryTerm: "Root" });
  });

  it.each([[{ reviewItems: [{}] }], [{ mediaId: "m", reviewItems: "x" }], [{ mediaId: "m", reviewItems: [{ reason: 1, key: "a" }] }], [{ mediaId: 1, reviewItems: [] }]])("skips a malformed record %j rather than failing the view", (record) => {
    expect(aggregateKeywordReview([record as never])).toEqual([]);
  });
});

describe("what can be decided here", () => {
  it.each([
    ["unmatched", "new term", "decide"],
    ["unmatched", "root|new term", "decide"],
    ["unmatched-beside-paths", "new term", "decide"],
    ["path-mismatch", "root|leaf", "decide"],
    ["ambiguous", "root|leaf", "decide"],
    ["ambiguous", "shared name", "fix-keywords"],
    ["malformed-path", "root||leaf", "fix-source"],
  ])("%s %s → %s", (reason, key, action) => {
    expect(keywordReviewAction({ reason, key })).toBe(action);
  });

  it("refuses both writes for a term no alias could settle, so nothing misleading is saved", () => {
    const shared = group({ reason: "ambiguous", key: "shared name" });
    expect(planAddAlias(graph, shared, target())).toEqual({ refused: "This term cannot be decided here." });
    expect(planCreateKeywordDraft(graph, shared, { title: "Shared Name", keywordId: "shared-name", categoryRef: place, internal: false, language: "fi", uuid: "u" })).toEqual({ refused: "This term cannot be decided here." });
  });
});

describe("proposals", () => {
  it("preselects the category the import's root term names, and nothing otherwise", () => {
    const categories = [{ _id: "c1", name: "Paikat" }, { _id: "c2" }];
    expect(proposedCategoryId(group({ proposedCategoryTerm: " paikat " }), categories)).toBe("c1");
    expect(proposedCategoryId(group({ proposedCategoryTerm: "Muu" }), categories)).toBe("");
    expect(proposedCategoryId(group(), categories)).toBe("");
  });

  it("starts a new keyword from the leaf of a path, and proposes an id", () => {
    expect(proposedTitle(group({ terms: ["Root | Leaf Name"] }))).toBe("Leaf Name");
    expect(proposedKeywordId("Mäki Ääni")).toBe("maki-aani");
    expect(proposedKeywordId("!!")).toBe("");
  });
});

describe("adding an alias", () => {
  it("writes under both revision guards", () => {
    expect(planAddAlias(graph, group(), target())).toEqual({ mutations: [
      { patch: { id: "keywordTaxonomyState", ifRevisionID: "state-1", inc: { publicationSequence: 1 } } },
      { patch: { id: "doc-cycling", ifRevisionID: "rev-1", set: { aliases: ["bike racing", "new term"] } } },
    ] });
  });

  it("can hold a whole path, so a keyword the site moved stops coming back", () => {
    expect(planAddAlias(graph, group({ reason: "path-mismatch", key: "old root|cycling" }), target())).toMatchObject({ mutations: [{}, { patch: { set: { aliases: ["bike racing", "old root|cycling"] } } }] });
  });

  it("refuses a keyword that is no longer active, because the term would not resolve to it", () => {
    expect(planAddAlias(graph, group(), target({ status: "retired" }))).toEqual({ refused: "This keyword is not active." });
  });

  it("finds a draft or a release version of the keyword, either of which would overwrite the alias", async () => {
    const read = async (dataset: object[]) => (await (await evaluate(parse(KEYWORD_ALIAS_TARGET_QUERY, { params: keywordAliasTargetParams("keyword.x") }), { dataset, params: keywordAliasTargetParams("keyword.x") })).get()) as { target: { _id: string } | null; hasDraft: boolean };
    const published = { _id: "keyword.x", _type: "keyword", _rev: "r", keywordId: "x" };
    expect(await read([published])).toMatchObject({ target: { _id: "keyword.x" }, hasDraft: false });
    expect(await read([published, { _id: "drafts.keyword.x" }])).toMatchObject({ hasDraft: true });
    expect(await read([published, { _id: "versions.r1.keyword.x" }])).toMatchObject({ hasDraft: true });
    expect(await read([published, { _id: "drafts.keyword.xy" }, { _id: "versions.r1.keyword.xy" }])).toMatchObject({ hasDraft: false });
  });

  it("detects a collision before saving", () => {
    const other = { ...graph, keywords: [...graph.keywords, keywordRow({ id: "taken", title: "New Term", category: subject })] };
    expect(planAddAlias(other, group(), target())).toEqual({ refused: expect.stringMatching(/both use the name "new term"/) });
  });

  it("refuses a repeat, and a keyword with an unpublished draft, which would drop the alias when published", () => {
    expect(planAddAlias(graph, group({ key: "bike racing" }), target())).toEqual({ refused: "This keyword already has that alias." });
    expect(planAddAlias(graph, group(), target({ hasDraft: true }))).toEqual({ refused: "This keyword has an unpublished draft. Publish or discard it first." });
  });
});

describe("creating a keyword", () => {
  const input = { title: "New Term", keywordId: "new-term", categoryRef: place, internal: false, language: "fi", uuid: "uuid-1" };

  it("creates a draft, never a published keyword, for the guarded action to publish", () => {
    expect(planCreateKeywordDraft(graph, group(), input)).toEqual({
      draftId: "drafts.uuid-1",
      mutations: [{ create: {
        _id: "drafts.uuid-1", _type: "keyword", keywordId: "new-term", title: [{ _key: "fi", language: "fi", value: "New Term" }],
        category: { _type: "reference", _ref: place }, status: "active", visibility: "public",
      } }],
    });
  });

  it("keeps the imported term as an alias when the title differs", () => {
    expect(planCreateKeywordDraft(graph, group(), { ...input, title: "Better Name", keywordId: "better-name" })).toMatchObject({ mutations: [{ create: { aliases: ["new term"] } }] });
  });

  it("puts an internal keyword on a private path, because even a name can identify someone", () => {
    expect(planCreateKeywordDraft(graph, group(), { ...input, internal: true })).toMatchObject({ draftId: "drafts.keyword.new-term", mutations: [{ create: { _id: "drafts.keyword.new-term", visibility: "internal" } }] });
  });

  it.each([
    ["a blank title", { title: "  " }, /needs a title/],
    ["a bad id", { keywordId: "Not Valid" }, /2–40 lowercase/],
    ["an id already taken", { keywordId: "cycling" }, /More than one keyword document|keyword ID/],
    ["a name equal to another keyword's id in the category", { title: "Harbour", keywordId: "harbour-two" }, /equals the ID of another keyword/],
    ["a name another keyword in the category already answers to", { title: "Bike Racing", keywordId: "bike-racing-two", categoryRef: subject }, /both use the name/],
  ])("refuses %s before saving", (_name, overrides, message) => {
    expect(planCreateKeywordDraft(graph, group(), { ...input, ...overrides })).toEqual({ refused: expect.stringMatching(message) });
  });
});

describe("a failed save", () => {
  it.each([[409, "conflict"], [403, "failed"], [500, "uncertain"], [undefined, "uncertain"]])("status %s → %s", (statusCode, outcome) => {
    expect(keywordReviewOutcome({ statusCode })).toBe(outcome);
  });
});

describe("copy", () => {
  it("covers both interface languages with the same keys", () => {
    const keys = (value: object): string[] => Object.entries(value).flatMap(([key, entry]) => (typeof entry === "object" && key !== "refused" ? keys(entry) : [key]));
    expect(keys(keywordReviewCopy("fi-FI"))).toEqual(keys(keywordReviewCopy("en-US")));
  });

  it("names every review reason the mapping can give", () => {
    for (const reason of ["unmatched", "unmatched-beside-paths", "ambiguous", "path-mismatch", "malformed-path"]) {
      expect(keywordReviewCopy("fi").reasons[reason], reason).toBeTruthy();
      expect(keywordReviewCopy("en").reasons[reason], reason).toBeTruthy();
    }
  });
});
