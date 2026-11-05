import { describe, expect, it } from "vitest";

import { evaluate, parse } from "groq-js/1";

import { keywordDocument, keywordRow } from "../sanity/schemas/keyword-fixtures";
import {
  aggregateKeywordReview, KEYWORD_TERM_DECISIONS_ID, planChooseKeyword, planRemoveDecision, proposedParentId, recordedDecisions, KEYWORD_ALIAS_TARGET_QUERY, KEYWORD_ID_RESERVATION_QUERY, keywordAliasTargetParams, keywordReviewAction, keywordReviewCopy, keywordReviewOutcome, planAddAlias, planCreateKeywordDraft, proposedCategoryId, proposedKeywordId, proposedTitle, REPRESENTATIVE_MEDIA_LIMIT,
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

  it("gives a term beside paths and without them one row, because they need one decision", () => {
    const rows = aggregateKeywordReview([
      { mediaId: "m1", reviewItems: [item("harbour", ["Harbour"])] },
      { mediaId: "m2", reviewItems: [item("harbour", ["Harbour"], "unmatched-beside-paths")] },
    ]);
    expect(rows).toEqual([expect.objectContaining({ reason: "unmatched", key: "harbour", occurrences: 2 })]);
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
    ["unmatched", "new term", "add-alias"],
    ["unmatched", "root|new term", "choose-for-path"],
    ["path-mismatch", "root|leaf", "choose-for-path"],
    ["ambiguous", "root|leaf", "choose-for-path"],
    ["ambiguous", "shared name", "choose-candidate"],
    ["malformed-path", "root||leaf", "fix-source"],
  ])("%s %s → %s", (reason, key, action) => {
    expect(keywordReviewAction({ reason, key })).toBe(action);
  });

  it("records a choice among a flat term's keywords, replacing an earlier one for that term only", () => {
    const shared = group({ reason: "ambiguous", key: "shared name", candidates: ["cycling", "harbour"] });
    const existing = [{ _key: "a", key: "shared name", keyword: { _ref: "old" } }, { _key: "b", key: "another", keyword: { _ref: "kept" } }];
    expect(planChooseKeyword(graph, shared, { documentId: "doc-harbour", keywordId: "harbour" }, existing, "u1")).toEqual({ mutations: [
      { patch: { id: "keywordTaxonomyState", ifRevisionID: "state-1", inc: { publicationSequence: 1 } } },
      { createOrReplace: { _id: KEYWORD_TERM_DECISIONS_ID, _type: "keywordTermDecisions", decisions: [existing[1], { _key: "u1", key: "shared name", keyword: { _type: "reference", _ref: "doc-harbour", _weak: true } }] } },
    ] });
  });

  it("lets a path name any keyword, because it is private and a path has no candidates to narrow", () => {
    const path = group({ reason: "unmatched", key: "clients|some name|session" });
    expect(planChooseKeyword(graph, path, { documentId: "doc-harbour", keywordId: "harbour" }, null, "u1")).toMatchObject({ mutations: [{}, { createOrReplace: { decisions: [{ key: "clients|some name|session" }] } }] });
  });

  it("repairs a damaged list by leaving out what the sync could not read", () => {
    const shared = group({ reason: "ambiguous", key: "shared name", candidates: ["harbour"] });
    const existing = [{ key: 5, keyword: { _ref: "x" } }, { key: "no keyword" }, null] as never;
    expect(planChooseKeyword(graph, shared, { documentId: "doc-harbour", keywordId: "harbour" }, existing, "u")).toMatchObject({ mutations: [{}, { createOrReplace: { decisions: [{ key: "shared name" }] } }] });
  });

  it("shows recorded choices and takes one back, so a wrong choice can be corrected", () => {
    const existing = [{ _key: "a", key: "one", keyword: { _ref: "doc-a" } }, { _key: "b", key: "two", keyword: { _ref: "doc-b" } }];
    expect(recordedDecisions(existing)).toEqual([{ key: "one", documentId: "doc-a" }, { key: "two", documentId: "doc-b" }]);
    expect(recordedDecisions(null)).toEqual([]);
    expect(planRemoveDecision(graph, existing, "one")).toEqual({ mutations: [
      { patch: { id: "keywordTaxonomyState", ifRevisionID: "state-1", inc: { publicationSequence: 1 } } },
      { createOrReplace: { _id: KEYWORD_TERM_DECISIONS_ID, _type: "keywordTermDecisions", decisions: [existing[1]] } },
    ] });
  });

  it("refuses a choice that is not one of the term's keywords, or a term a choice cannot settle", () => {
    const shared = group({ reason: "ambiguous", key: "shared name", candidates: ["cycling", "harbour"] });
    expect(planChooseKeyword(graph, shared, { documentId: "doc-other", keywordId: "other" }, [], "u")).toEqual({ refused: "This term cannot be decided here." });
    expect(planChooseKeyword(graph, group(), { documentId: "doc-harbour", keywordId: "harbour" }, [], "u")).toEqual({ refused: "This term cannot be decided here." });
    expect(planChooseKeyword(graph, group({ reason: "malformed-path", key: "a||b" }), { documentId: "doc-harbour", keywordId: "harbour" }, [], "u")).toEqual({ refused: "This term cannot be decided here." });
  });

  it("refuses both writes for a term no alias could settle, so nothing misleading is saved", () => {
    const shared = group({ reason: "ambiguous", key: "shared name" });
    expect(planAddAlias(graph, shared, target(), true)).toEqual({ refused: "This term cannot be decided here." });
    expect(planCreateKeywordDraft(graph, shared, { title: "Shared Name", keywordId: "shared-name", categoryRef: place, internal: false, idReserved: false, publicConfirmed: true, language: "fi", uuid: "u" })).toEqual({ refused: "This term cannot be decided here." });
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

  it("proposes a path's parent only when exactly one keyword is named by its next-to-last term", () => {
    const keywords = [{ _id: "a", name: "Cycling" }, { _id: "b", name: "Twin" }, { _id: "c", name: "twin" }];
    expect(proposedParentId(group({ key: "sport|cycling|track" }), keywords)).toBe("a");
    expect(proposedParentId(group({ key: "x|twin|y" }), keywords)).toBe("");
    expect(proposedParentId(group({ key: "flat" }), keywords)).toBe("");
  });
});

describe("adding an alias", () => {
  it("writes under both revision guards", () => {
    expect(planAddAlias(graph, group(), target(), true)).toEqual({ mutations: [
      { patch: { id: "keywordTaxonomyState", ifRevisionID: "state-1", inc: { publicationSequence: 1 } } },
      { patch: { id: "doc-cycling", ifRevisionID: "rev-1", set: { aliases: ["bike racing", "new term"] } } },
    ] });
  });

  it("refuses a whole path, which could name a client on a public keyword", () => {
    expect(planAddAlias(graph, group({ reason: "path-mismatch", key: "clients|some name" }), target(), true)).toEqual({ refused: "This term cannot be decided here." });
  });

  it("asks before a term becomes readable on a public keyword, but not on an internal one", () => {
    expect(planAddAlias(graph, group(), target(), false)).toEqual({ refused: "Confirm that this name may be public." });
    expect(planAddAlias(graph, group(), target({ visibility: "internal" }), false)).not.toHaveProperty("refused", "Confirm that this name may be public.");
  });

  it("refuses a keyword that is no longer active, because the term would not resolve to it", () => {
    expect(planAddAlias(graph, group(), target({ status: "retired" }), true)).toEqual({ refused: "This keyword is not active." });
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
    expect(planAddAlias(other, group(), target(), true)).toEqual({ refused: expect.stringMatching(/both use the name "new term"/) });
  });

  it("refuses a repeat, and a keyword with an unpublished draft, which would drop the alias when published", () => {
    expect(planAddAlias(graph, group({ key: "bike racing" }), target(), true)).toEqual({ refused: "This keyword already has that alias." });
    expect(planAddAlias(graph, group(), target({ hasDraft: true }), true)).toEqual({ refused: "This keyword has an unpublished draft. Publish or discard it first." });
  });
});

describe("creating a keyword", () => {
  const input = { title: "New Term", keywordId: "new-term", categoryRef: place, internal: false, idReserved: false, publicConfirmed: true, language: "fi", uuid: "uuid-1" };

  it("creates a draft, never a published keyword, for the guarded action to publish", () => {
    expect(planCreateKeywordDraft(graph, group(), input)).toEqual({
      draftId: "drafts.uuid-1",
      mutations: [{ create: {
        _id: "drafts.uuid-1", _type: "keyword", keywordId: "new-term", title: [{ _key: "fi", _type: "localizedText", language: "fi", value: "New Term" }],
        category: { _type: "reference", _ref: place }, status: "active", visibility: "public",
      } }],
    });
  });

  it("never stores a path as an alias, and takes the parent the editor left in the form", () => {
    const entry = planCreateKeywordDraft(graph, group({ reason: "unmatched", key: "sport|cycling|track" }), { ...input, title: "Track", keywordId: "track", parentRef: "doc-cycling", publicConfirmed: false });
    expect(entry).toMatchObject({ mutations: [{ create: { parent: { _ref: "doc-cycling" } } }] });
    expect(JSON.stringify(entry)).not.toContain("aliases");
  });

  it("asks before a differing term becomes a public alias, but not on an internal keyword", () => {
    const named = { ...input, title: "Better Name", keywordId: "better-name", publicConfirmed: false };
    expect(planCreateKeywordDraft(graph, group(), named)).toEqual({ refused: "Confirm that this name may be public." });
    expect(planCreateKeywordDraft(graph, group(), { ...named, internal: true })).toMatchObject({ draftId: "drafts.keyword.better-name" });
  });

  it("never reuses an id, even one a retired internal keyword holds, whose document it would replace", () => {
    const retired = { ...graph, keywords: [...graph.keywords, keywordRow({ id: "maki", documentId: "keyword.maki", title: "Old", category: subject, visibility: "internal", status: "retired" })] };
    expect(planCreateKeywordDraft(retired, group(), { ...input, title: "Mäki", keywordId: "maki", internal: true })).toEqual({ refused: "This keyword ID is already in use." });
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
    ["an id an unpublished keyword holds", { idReserved: true }, /unpublished keyword already uses/],
    ["an id already taken", { keywordId: "cycling" }, /already in use/],
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

describe("reserving a new keyword's id", () => {
  const reserved = async (dataset: object[]) => (await evaluate(parse(KEYWORD_ID_RESERVATION_QUERY, { params: { keywordId: "maki" } }), { dataset, params: { keywordId: "maki" } })).get();

  it("sees a draft or a release version, which the published graph cannot", async () => {
    expect(await reserved([{ _id: "drafts.a", _type: "keyword", keywordId: "maki" }])).toBe(true);
    expect(await reserved([{ _id: "versions.r1.a", _type: "keyword", keywordId: "maki" }])).toBe(true);
    expect(await reserved([{ _id: "drafts.keyword.maki", _type: "keyword", keywordId: "maki" }])).toBe(true);
  });

  it("ignores a published keyword, which the graph validates, and another id", async () => {
    expect(await reserved([{ _id: "a", _type: "keyword", keywordId: "maki" }, { _id: "drafts.b", _type: "keyword", keywordId: "other" }])).toBe(false);
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
