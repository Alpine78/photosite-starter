/** Neutral fixtures only, against an in-memory store with revision guards. Nothing reaches a network. */
import { describe, expect, it } from "vitest";

import { keywordRow } from "../sanity/schemas/keyword-fixtures";
import { KEYWORD_GRAPH_PROJECTION } from "../sanity/schemas/keyword-rules";
import { keywordRecordId, KEYWORD_RECORD_TYPE, planKeywordSync, summarizeKeywordSync, type KeywordSyncInput, type KeywordSyncMedia, type KeywordSyncRecord } from "./keyword-sync-plan.mts";
import { KEYWORD_SYNC_BATCH_SIZE, KEYWORD_SYNC_VOCABULARY_QUERY, parseArguments, parseImports, runKeywordSync, type KeywordSyncPort } from "./keyword-sync.mts";

const subject = "category-subject";
const vocabulary = [
  keywordRow({ id: "sport", title: "Sport", category: subject }),
  keywordRow({ id: "cycling", title: "Cycling", category: subject, parent: "sport" }),
  keywordRow({ id: "harbour", title: "Harbour", category: subject }),
  keywordRow({ id: "person", documentId: "keyword.person", title: "Person", category: subject, visibility: "internal" }),
];
const NOW = "2026-11-05T00:00:00.000Z";
const medium = (mediaId: string, overrides: Partial<KeywordSyncMedia> = {}): KeywordSyncMedia => ({ _id: `doc-${mediaId}`, _rev: `rev-${mediaId}`, mediaId, ...overrides });
const fields = (...terms: string[]) => ({ "XMP-dc:Subject": terms });
const input = (overrides: Partial<KeywordSyncInput> = {}): KeywordSyncInput => ({ vocabulary, media: [medium("m1")], records: [], now: NOW, ...overrides });
const onlyEntry = (overrides: Partial<KeywordSyncInput>) => planKeywordSync(input(overrides)).entries[0];

describe("planning", () => {
  it("does nothing for a medium no import has touched", () => {
    expect(onlyEntry({})).toEqual({ mediaId: "m1", status: "unchanged", review: [] });
  });

  it("writes keywords, the closure and a private record for an import, keeping the raw values", () => {
    const entry = onlyEntry({ imports: new Map([["m1", fields("Cycling", "Person", "Unknown Term")]]) });
    if (entry.status !== "update") throw new Error("expected an update");
    const [patch, record] = entry.mutations as readonly [{ patch: { id: string; ifRevisionID: string; set: Record<string, unknown> } }, { create: Record<string, unknown> }];
    expect(patch.patch.id).toBe("doc-m1");
    expect(patch.patch.ifRevisionID).toBe("rev-m1");
    expect(patch.patch.set.keywords).toMatchObject([{ _ref: "doc-cycling", _type: "reference" }]);
    expect(patch.patch.set.expandedKeywordIds).toEqual(["cycling", "sport"]);
    expect(JSON.stringify(patch)).not.toMatch(/Unknown Term|keyword\.person/);
    expect(record.create._id).toBe(keywordRecordId("m1"));
    expect(record.create._type).toBe(KEYWORD_RECORD_TYPE);
    expect(record.create.importedKeywords).toMatchObject({ raw: { dcSubject: ["Cycling", "Person", "Unknown Term"] }, importedAt: NOW });
    expect(record.create.internalKeywords).toMatchObject([{ _ref: "keyword.person", _weak: true }]);
    expect(record.create.reviewItems).toMatchObject([{ reason: "unmatched", key: "unknown term" }]);
    expect(entry.review).toHaveLength(1);
  });

  it("puts the private record on a private path, because raw terms can name anyone", () => {
    expect(keywordRecordId("m1")).toContain(".");
  });

  it("also patches a draft, because publishing a stale draft would undo the sync", () => {
    const entry = onlyEntry({ media: [medium("m1", { draft: { _id: "drafts.doc-m1", _rev: "rev-draft" } })], imports: new Map([["m1", fields("Harbour")]]) });
    if (entry.status !== "update") throw new Error("expected an update");
    expect(entry.mutations).toContainEqual(expect.objectContaining({ patch: expect.objectContaining({ id: "drafts.doc-m1", ifRevisionID: "rev-draft" }) }));
  });

  it("opts a medium in only when asked, and only for media in the import", () => {
    const imports = new Map([["m1", fields("Harbour")]]);
    const asked = onlyEntry({ imports, setDiscoverable: true });
    expect(JSON.stringify(asked)).toContain('"dynamicallyDiscoverable":true');
    expect(JSON.stringify(onlyEntry({ imports }))).not.toContain("dynamicallyDiscoverable");
    const other = planKeywordSync(input({ media: [medium("m1"), medium("m2")], imports, setDiscoverable: true })).entries[1];
    expect(other.status).toBe("unchanged");
  });

  it("reports an import naming no medium, without guessing", () => {
    const plan = planKeywordSync(input({ imports: new Map([["ghost", fields("Harbour")]]) }));
    expect(plan.unmatchedImports).toEqual(["ghost"]);
    expect(plan.entries[0].status).toBe("unchanged");
  });

  it("stops the whole plan on a broken vocabulary, because no result could be trusted", () => {
    expect(() => planKeywordSync(input({ vocabulary: [{ _id: "x" }] }))).toThrow();
  });

  it("fails one medium on its own bad data, and continues with the others", () => {
    const record: KeywordSyncRecord = { _id: keywordRecordId("m1"), _rev: "r", keywordOverrides: { added: [{ _ref: "doc-missing" }] } };
    const plan = planKeywordSync(input({ media: [medium("m1"), medium("m2")], records: [record], imports: new Map([["m2", fields("Harbour")]]) }));
    expect(plan.entries.map((entry) => entry.status)).toEqual(["failed", "update"]);
    expect(summarizeKeywordSync(plan)).toMatchObject({ failed: 1, update: 1, media: 2 });
  });

  it("refuses a medium a Content Release holds, because releasing it would undo the sync", () => {
    expect(onlyEntry({ media: [medium("m1", { hasVersion: true })], imports: new Map([["m1", fields("Harbour")]]) })).toEqual({ mediaId: "m1", status: "failed", code: "RELEASE_VERSION_EXISTS" });
  });

  it("refuses keywords with no record, rather than removing what it cannot explain", () => {
    expect(onlyEntry({ media: [medium("m1", { keywords: [{ _ref: "doc-harbour" }] })] })).toEqual({ mediaId: "m1", status: "failed", code: "KEYWORDS_WITHOUT_RECORD" });
  });

  it.each([["a string", "text"], ["a bad field", { dcSubject: [1] }]])("refuses a stored import that is %s", (_name, raw) => {
    const record = { _id: keywordRecordId("m1"), _rev: "r", importedKeywords: { raw } } as unknown as KeywordSyncRecord;
    expect(onlyEntry({ records: [record] })).toEqual({ mediaId: "m1", status: "failed", code: "RECORD_MALFORMED" });
  });

  it("refuses two documents claiming one mediaId", () => {
    const plan = planKeywordSync(input({ media: [medium("m1"), { ...medium("m1"), _id: "doc-other" }] }));
    expect(plan.entries[1]).toEqual({ mediaId: "m1", status: "failed", code: "MEDIA_ID_REPEATED" });
  });
});

/** Revision guards and all-or-nothing transactions, like the real API. */
function store(documents: readonly (Readonly<Record<string, unknown>> & { _id: string })[], options: { failAt?: number; failStatus?: number } = {}) {
  const docs = new Map(documents.map((document) => [document._id, { ...document }]));
  let counter = 0, transactions = 0;
  const port: KeywordSyncPort = {
    query: async (query, params) => {
      if (query === KEYWORD_SYNC_VOCABULARY_QUERY) return vocabulary;
      if (query.includes('path("versions.**")]._id')) return [...docs.keys()].filter((id) => id.startsWith("versions."));
      if (query.includes('_id == "keywordTaxonomyState"')) return docs.get("keywordTaxonomyState") ?? null;
      const type = query.includes('_type == "media"') ? "media" : KEYWORD_RECORD_TYPE;
      const rows = [...docs.values()].filter((document) => document._type === type).sort((a, b) => (a._id < b._id ? -1 : 1));
      return rows.slice(params.from as number, params.to as number).map((row) => ({ ...row, draft: null }));
    },
    mutate: async (mutations) => {
      transactions += 1;
      if (options.failAt === transactions) throw Object.assign(new Error("failed"), { status: options.failStatus ?? 409 });
      const next = new Map([...docs].map(([id, document]) => [id, { ...document }]));
      for (const mutation of mutations) {
        if ("create" in mutation) {
          if (next.has(mutation.create._id)) throw Object.assign(new Error("exists"), { status: 409 });
          next.set(mutation.create._id, { ...mutation.create, _rev: `new-${counter += 1}` });
        } else if ("patch" in mutation) {
          const current = next.get(mutation.patch.id);
          if (current === undefined || current._rev !== mutation.patch.ifRevisionID) throw Object.assign(new Error("revision"), { status: 409 });
          next.set(mutation.patch.id, { ...current, ...mutation.patch.set, _rev: `new-${counter += 1}` });
        }
      }
      docs.clear();
      for (const [id, document] of next) docs.set(id, document);
    },
  };
  return { port, docs, transactionCount: () => transactions };
}

const state = (overrides: Record<string, unknown> = {}) => ({ _id: "keywordTaxonomyState", _type: "keywordTaxonomyState", _rev: "s0", taxonomyVersion: 1, resyncedVersion: 1, publicationSequence: 0, ...overrides });
const mediaDocument = (mediaId: string) => ({ _id: `doc-${mediaId}`, _type: "media", _rev: `rev-${mediaId}`, mediaId });
const mediaIds = (count: number) => Array.from({ length: count }, (_, index) => `m${String(index).padStart(4, "0")}`);
const importsFor = (ids: readonly string[]) => new Map(ids.map((id) => [id, fields("Harbour")]));

describe("running", () => {
  it("reads and reports without writing unless told, and needs the digest it reported", async () => {
    const { port, docs, transactionCount } = store([state(), mediaDocument("m1")]);
    const imports = importsFor(["m1"]);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    expect(planned.outcome).toBe("planned");
    expect(transactionCount()).toBe(0);
    expect(docs.get("doc-m1")?.keywords).toBeUndefined();
    await expect(runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: "wrong" })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    const written = await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest });
    expect(written).toMatchObject({ outcome: "written", written: 1 });
    expect(docs.get("doc-m1")?.expandedKeywordIds).toEqual(["harbour"]);
    expect(docs.get(keywordRecordId("m1"))).toBeDefined();
  });

  it("gives the same result on a second run, with nothing written", async () => {
    const { port, transactionCount } = store([state(), mediaDocument("m1")]);
    const imports = importsFor(["m1"]);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest });
    const before = transactionCount();
    const again = await runKeywordSync(port, { imports, now: "2030-01-01T00:00:00.000Z" });
    expect(again.summary).toMatchObject({ update: 0, unchanged: 1 });
    expect(transactionCount()).toBe(before);
  });

  it("keeps an editor's additions and removals through a re-import", async () => {
    const record = { _id: keywordRecordId("m1"), _type: KEYWORD_RECORD_TYPE, _rev: "r0", keywordOverrides: { added: [{ _ref: "doc-sport" }], removed: [{ _ref: "doc-harbour" }] } };
    const { port, docs } = store([state(), mediaDocument("m1"), record]);
    const imports = new Map([["m1", fields("Harbour", "Cycling")]]);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest });
    expect((docs.get("doc-m1")?.keywords as { _ref: string }[]).map((entry) => entry._ref).sort()).toEqual(["doc-cycling", "doc-sport"]);
    expect((docs.get(keywordRecordId("m1"))?.keywordOverrides as { removed: { _ref: string }[] }).removed.map((entry) => entry._ref)).toEqual(["doc-harbour"]);
  });

  it("re-maps a medium from its stored import, with no file involved", async () => {
    const record = { _id: keywordRecordId("m1"), _type: KEYWORD_RECORD_TYPE, _rev: "r0", importedKeywords: { raw: { dcSubject: ["Cycling"], iptcKeywords: null, hierarchicalSubject: null, weightedFlatSubject: null }, importedAt: "2020-01-01T00:00:00.000Z" } };
    const { port, docs } = store([state({ taxonomyVersion: 2 }), mediaDocument("m1"), record]);
    const planned = await runKeywordSync(port, { now: NOW });
    const result = await runKeywordSync(port, { now: NOW, yes: true, approvedDigest: planned.digest });
    expect(docs.get("doc-m1")?.expandedKeywordIds).toEqual(["cycling", "sport"]);
    expect((docs.get(keywordRecordId("m1"))?.importedKeywords as { importedAt: string }).importedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(result.acknowledgedVersion).toBe(2);
    expect(docs.get("keywordTaxonomyState")?.resyncedVersion).toBe(2);
  });

  it("does not acknowledge a re-sync from an import, or with a medium failed", async () => {
    const { port, docs } = store([state({ taxonomyVersion: 2 }), mediaDocument("m1")]);
    const imports = importsFor(["m1"]);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest });
    expect(docs.get("keywordTaxonomyState")?.resyncedVersion).toBe(1);
  });

  it("does not acknowledge a full run that had to skip a medium", async () => {
    const version = { _id: "versions.rel1.doc-m1", _type: "media", _rev: "v", mediaId: "m1" };
    const { port, docs } = store([state({ taxonomyVersion: 2 }), mediaDocument("m1"), version]);
    const planned = await runKeywordSync(port, { now: NOW });
    expect(planned.summary.failed).toBeGreaterThan(0);
    await runKeywordSync(port, { now: NOW, yes: true, approvedDigest: planned.digest });
    expect(docs.get("keywordTaxonomyState")?.resyncedVersion).toBe(1);
  });

  it("writes one transaction per batch, each under the taxonomy state's guard", async () => {
    const ids = mediaIds(KEYWORD_SYNC_BATCH_SIZE + 1);
    const { port, docs, transactionCount } = store([state(), ...ids.map(mediaDocument)]);
    const imports = importsFor(ids);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest });
    expect(transactionCount()).toBe(2);
    expect(docs.get("keywordTaxonomyState")?.publicationSequence).toBe(2);
  });

  it("resumes after a partial failure without repeating what was written", async () => {
    const ids = mediaIds(KEYWORD_SYNC_BATCH_SIZE + 5);
    const { port, docs } = store([state(), ...ids.map(mediaDocument)], { failAt: 2 });
    const imports = importsFor(ids);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    const first = await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest });
    expect(first).toMatchObject({ outcome: "conflict", written: KEYWORD_SYNC_BATCH_SIZE });
    const second = await runKeywordSync(port, { imports, now: NOW });
    expect(second.summary).toMatchObject({ update: 5, unchanged: KEYWORD_SYNC_BATCH_SIZE });
    const finished = await runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: second.digest });
    expect(finished).toMatchObject({ outcome: "written", written: 5 });
    expect(ids.every((id) => docs.get(`doc-${id}`)?.expandedKeywordIds !== undefined)).toBe(true);
    expect([...docs.values()].filter((document) => document._type === KEYWORD_RECORD_TYPE)).toHaveLength(ids.length);
  });

  it("lets a non-conflict failure surface", async () => {
    const { port } = store([state(), mediaDocument("m1")], { failAt: 1, failStatus: 500 });
    const imports = importsFor(["m1"]);
    const planned = await runKeywordSync(port, { imports, now: NOW });
    await expect(runKeywordSync(port, { imports, now: NOW, yes: true, approvedDigest: planned.digest })).rejects.toThrow("failed");
  });

  it("stops if the taxonomy moves during the run", async () => {
    const ids = mediaIds(KEYWORD_SYNC_BATCH_SIZE + 1);
    const base = store([state(), ...ids.map(mediaDocument)]);
    const imports = importsFor(ids);
    const planned = await runKeywordSync(base.port, { imports, now: NOW });
    const moving: KeywordSyncPort = {
      ...base.port,
      mutate: async (mutations) => {
        await base.port.mutate(mutations);
        const current = base.docs.get("keywordTaxonomyState")!;
        base.docs.set("keywordTaxonomyState", { ...current, taxonomyVersion: 9 });
      },
    };
    expect(await runKeywordSync(moving, { imports, now: NOW, yes: true, approvedDigest: planned.digest })).toMatchObject({ outcome: "taxonomy-changed", written: KEYWORD_SYNC_BATCH_SIZE });
  });

  it("refuses to run without the taxonomy state", async () => {
    await expect(runKeywordSync(store([mediaDocument("m1")]).port, { now: NOW })).rejects.toMatchObject({ code: "TAXONOMY_STATE_MISSING" });
  });

  it("plans a 400-medium batch within its budget", async () => {
    const ids = mediaIds(400);
    const { port } = store([state(), ...ids.map(mediaDocument)]);
    const start = performance.now();
    const planned = await runKeywordSync(port, { imports: importsFor(ids), now: NOW });
    expect(planned.summary.update).toBe(400);
    expect(performance.now() - start).toBeLessThan(5000);
  }, 60_000); // A generous ceiling for a loaded machine; the measured figure is in docs/keyword-sync.md.
});

describe("the command line", () => {
  it("needs --out, and an approved digest to write", () => {
    expect(() => parseArguments([])).toThrow("ARGUMENTS_INVALID");
    expect(() => parseArguments(["--out", "x", "--yes"])).toThrow("APPROVED_DIGEST_REQUIRED");
    expect(parseArguments(["--out", "x", "--yes", "--approved-digest", "abc"])).toMatchObject({ out: "x", yes: true, approvedDigest: "abc" });
  });

  it("refuses an opt-in without imports, and unknown flags", () => {
    expect(() => parseArguments(["--out", "x", "--set-discoverable"])).toThrow("ARGUMENTS_INVALID");
    expect(() => parseArguments(["--out", "x", "--nope"])).toThrow("ARGUMENTS_INVALID");
  });

  it.each(["[]", "not json", '{"m1": []}', '{"m1": 1}'])("refuses imports like %s", (text) => {
    expect(() => parseImports(text)).toThrow("IMPORTS_MALFORMED");
  });

  it("reads imports keyed by mediaId", () => {
    expect(parseImports('{"m1": {"XMP-dc:Subject": ["A"]}}').get("m1")).toEqual({ "XMP-dc:Subject": ["A"] });
  });

  it("reads the same keyword fields as the schema's graph projection", () => {
    for (const field of KEYWORD_GRAPH_PROJECTION.replace(/[{}]/g, "").split(",").map((line) => line.trim())) {
      expect(KEYWORD_SYNC_VOCABULARY_QUERY, field).toContain(field);
    }
  });
});
