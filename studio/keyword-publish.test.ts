import { describe, expect, it, vi } from "vitest";
import { KEYWORD_CATEGORY_FIXTURES, KEYWORD_FIXTURE_INPUTS, keywordDocument, keywordRow } from "../sanity/schemas/keyword-fixtures";
import { commitKeywordPublication, keywordPublishCopy, keywordPublishReady, reviewKeywordPublication, type KeywordPublishReader } from "./keyword-publish";

const rows = KEYWORD_FIXTURE_INPUTS.map(keywordRow);
const STATE = "state-rev-1";
const CATEGORIES = KEYWORD_CATEGORY_FIXTURES.map((category) => ({ ...category }));

function reader(documents: readonly Record<string, unknown>[], overrides: Partial<KeywordPublishReader> = {}, graph: unknown = { state: { _rev: STATE }, keywords: rows }): KeywordPublishReader {
  return {
    ensureState: vi.fn(async () => undefined),
    graph: vi.fn(async () => graph),
    docs: vi.fn(async (ids: readonly string[]) => ({
      documents: [...documents, ...CATEGORIES].filter((document) => ids.includes(document._id as string)),
      omitted: ids.filter((id) => ![...documents, ...CATEGORIES].some((document) => document._id === id)).map((id) => ({ id, reason: "existence" })),
    })),
    ...overrides,
  };
}

const draftOf = (document: Readonly<Record<string, unknown>>, rev = "draft-rev") => ({ ...document, _id: `drafts.${document._id as string}`, _rev: rev });
const publishedOf = (document: Readonly<Record<string, unknown>>, rev = "pub-rev") => ({ ...document, _rev: rev });
const cycling = keywordDocument({ id: "cycling", title: "Cycling", category: "category-subject", parent: "sport", aliases: ["bike racing"] });

describe("keyword publication review", () => {
  it("creates a new keyword and advances only the publication sequence", async () => {
    const fresh = keywordDocument({ id: "fresh", title: "Fresh", category: "category-place" });
    const review = await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(fresh)]));
    expect("ready" in review && review.ready.effects).toEqual({ retainedAliases: [], structural: false });
    expect("ready" in review && review.ready.mutations).toEqual([
      { patch: { id: "keywordTaxonomyState", ifRevisionID: STATE, inc: { publicationSequence: 1 } } },
      { patch: { id: "drafts.doc-fresh", ifRevisionID: "draft-rev", set: { keywordId: "fresh" } } },
      { delete: { id: "drafts.doc-fresh" } },
      { create: expect.objectContaining({ _id: "doc-fresh", _type: "keyword", keywordId: "fresh" }) },
    ]);
  });

  it("writes a rename with its retained alias, under both revision guards, without a version bump", async () => {
    const renamed = { ...cycling, title: [{ language: "en", value: "Bike sport" }] };
    const review = await reviewKeywordPublication("doc-cycling", "draft-rev", reader([draftOf(renamed), publishedOf(cycling)]));
    if (!("ready" in review)) throw new Error("expected a plan");
    expect(review.ready.effects).toEqual({ retainedAliases: ["cycling"], structural: false });
    expect(review.ready.mutations[0]).toEqual({ patch: { id: "keywordTaxonomyState", ifRevisionID: STATE, inc: { publicationSequence: 1 } } });
    expect(review.ready.mutations).toContainEqual({ patch: { id: "doc-cycling", ifRevisionID: "pub-rev", set: { keywordId: "cycling" } } });
    const write = review.ready.mutations.at(-1) as { createOrReplace: { aliases: unknown; _rev?: unknown; _id: unknown } };
    expect(write.createOrReplace.aliases).toEqual(["bike racing", "cycling"]);
    expect(write.createOrReplace._id).toBe("doc-cycling");
    expect(write.createOrReplace._rev).toBeUndefined();
  });

  it("raises the taxonomy version with a structural change, in the same transaction", async () => {
    const moved = { ...cycling, parent: undefined };
    const review = await reviewKeywordPublication("doc-cycling", "draft-rev", reader([draftOf(moved), publishedOf(cycling)]));
    if (!("ready" in review)) throw new Error("expected a plan");
    expect(review.ready.effects.structural).toBe(true);
    expect(review.ready.mutations[0]).toEqual({ patch: { id: "keywordTaxonomyState", ifRevisionID: STATE, inc: { publicationSequence: 1, taxonomyVersion: 1 } } });
  });

  it("validates the document with its retained aliases, not the draft alone", async () => {
    const before = keywordDocument({ id: "cycling", title: "Cycling term", category: "category-subject" });
    const graph = { state: { _rev: STATE }, keywords: [keywordRow({ id: "cycling", title: "Cycling term", category: "category-subject" }), keywordRow({ id: "shared", title: "Cycling term", category: "category-place" })] };
    const moved = { ...before, title: [{ language: "en", value: "Renamed" }], category: { _ref: "category-place" } };
    const review = await reviewKeywordPublication("doc-cycling", "draft-rev", reader([draftOf(moved), publishedOf(before)], {}, graph));
    expect(review).toMatchObject({ reason: "invalid" });
  });

  it("refuses a stale draft, a missing draft and a state not yet visible", async () => {
    const fresh = keywordDocument({ id: "fresh", title: "Fresh", category: "category-place" });
    expect(await reviewKeywordPublication("doc-fresh", "older", reader([draftOf(fresh)]))).toEqual({ reason: "stale" });
    expect(await reviewKeywordPublication("doc-fresh", "draft-rev", reader([]))).toEqual({ reason: "stale" });
    expect(await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(fresh)], {}, { state: null, keywords: rows }))).toEqual({ reason: "stale" });
  });

  it("strengthens a reference chosen before its target was published, as native publication does", async () => {
    const pending = { _ref: "category-place", _type: "reference", _weak: true, _strengthenOnPublish: { type: "keywordCategory" } };
    const parent = { _ref: "doc-sport", _type: "reference", _weak: true, _strengthenOnPublish: { type: "keyword", weak: true } };
    const fresh = { ...keywordDocument({ id: "fresh", title: "Fresh", category: "category-place" }), category: pending, parent };
    const review = await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(fresh)]));
    if (!("ready" in review)) throw new Error("expected a plan");
    const { create } = review.ready.mutations.at(-1) as { create: Record<string, unknown> };
    expect(create.category).toEqual({ _ref: "category-place", _type: "reference" });
    expect(create.parent).toEqual({ _ref: "doc-sport", _type: "reference", _weak: true });
  });

  it("refuses a keyword whose category is not published", async () => {
    const fresh = keywordDocument({ id: "fresh", title: "Fresh", category: "category-unpublished" });
    expect(await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(fresh)]))).toEqual({ reason: "invalid", message: "The keyword's category must be published first." });
  });

  it("fails closed when anything cannot be read, and refuses an invalid graph", async () => {
    const fresh = keywordDocument({ id: "fresh", title: "Fresh", category: "category-place" });
    expect(await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(fresh)], { ensureState: async () => { throw new Error("denied"); } }))).toEqual({ reason: "unreadable" });
    expect(await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(fresh)], { graph: async () => { throw new Error("down"); } }))).toEqual({ reason: "unreadable" });
    const clash = keywordDocument({ id: "fresh", title: "Cycling", category: "category-subject" });
    expect(await reviewKeywordPublication("doc-fresh", "draft-rev", reader([draftOf(clash)]))).toMatchObject({ reason: "invalid" });
  });
});

describe("keyword publication commit", () => {
  const plan = { effects: { retainedAliases: [], structural: false }, mutations: [] };
  const failing = (statusCode?: number) => async () => { throw Object.assign(new Error("x"), { statusCode }); };

  it("distinguishes a conflict, a refusal and an unknown result", async () => {
    expect(await commitKeywordPublication(plan, async () => undefined)).toBe("published");
    expect(await commitKeywordPublication(plan, failing(409))).toBe("conflict");
    expect(await commitKeywordPublication(plan, failing(403))).toBe("refused");
    expect(await commitKeywordPublication(plan, failing(503))).toBe("uncertain");
    expect(await commitKeywordPublication(plan, failing())).toBe("uncertain");
  });
});

describe("keyword publication readiness", () => {
  const state = { type: "keyword", ready: true, draft: { _rev: "r1" } };
  const validated = { isValidating: false, revision: "r1", validation: [] };

  it("needs a validated draft at its current revision", () => {
    expect(keywordPublishReady(state, validated, false)).toBe(true);
    expect(keywordPublishReady({ ...state, draft: null }, validated, false)).toBe(false);
    expect(keywordPublishReady(state, { ...validated, revision: "r0" }, false)).toBe(false);
    expect(keywordPublishReady(state, { ...validated, isValidating: true }, false)).toBe(false);
    expect(keywordPublishReady(state, { ...validated, validation: [{ level: "error" }] }, false)).toBe(false);
    expect(keywordPublishReady(state, { ...validated, validation: [{ level: "warning" }] }, false)).toBe(true);
    expect(keywordPublishReady(state, validated, true)).toBe(false);
  });

  it("is never available for a release or a scheduled version", () => {
    expect(keywordPublishReady({ ...state, version: { _rev: "r1" } }, validated, false)).toBe(false);
    expect(keywordPublishReady({ ...state, release: "r" }, validated, false)).toBe(false);
  });
});

describe("keyword publication copy", () => {
  it("covers both interface languages with the same keys", () => {
    const keys = (value: object): string[] => Object.entries(value).flatMap(([key, entry]) => (typeof entry === "object" ? keys(entry) : [key]));
    expect(keys(keywordPublishCopy("fi-FI"))).toEqual(keys(keywordPublishCopy("en-US")));
  });
});
