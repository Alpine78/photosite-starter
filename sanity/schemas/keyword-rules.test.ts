import { describe, expect, it } from "vitest";

import { KEYWORD_CATEGORY_FIXTURES, KEYWORD_FIXTURE_INPUTS, keywordDocument, keywordRow } from "./keyword-fixtures";
import {
  deriveExpandedKeywordIds,
  isPrivateKeywordPath,
  KEYWORD_ID_PATTERN,
  keywordMatchKey,
  keywordPublicationEffects,
  MAX_KEYWORD_DEPTH,
  proposeKeywordId,
  validateProspectiveKeywordGraph,
} from "./keyword-rules";

const published = KEYWORD_FIXTURE_INPUTS.map(keywordRow);
const subject = "category-subject", place = "category-place";

describe("keyword identity", () => {
  it.each(["ab", "a1", "road-cycling", "x".repeat(40)])("accepts %s", (id) => {
    expect(KEYWORD_ID_PATTERN.test(id)).toBe(true);
  });
  it.each(["a", "x".repeat(41), "-ab", "ab-", "a--b", "Ab", "a,b", "a.b", "äb"])("rejects %s", (id) => {
    expect(KEYWORD_ID_PATTERN.test(id)).toBe(false);
  });

  it("fits five ids in ADR-0012's cursor scope, leaving room for the version prefix", () => {
    expect(Array(5).fill("x".repeat(40)).join(",").length).toBe(204);
  });

  it("normalizes match keys and preserves diacritics", () => {
    expect(keywordMatchKey("  Mäki\t Rally ")).toBe("mäki rally");
    expect(keywordMatchKey("Mäki")).toBe(keywordMatchKey("Mäki"));
    expect(keywordMatchKey("Mäki")).not.toBe(keywordMatchKey("Maki"));
  });

  it("proposes an ASCII id without a numeric suffix", () => {
    expect(proposeKeywordId("Mäkelä Åström")).toBe("makela-astrom");
    expect(proposeKeywordId("Crème  Brûlée!")).toBe("creme-brulee");
    expect(proposeKeywordId("🙂")).toBeUndefined();
    expect(proposeKeywordId("x")).toBeUndefined();
  });

  it("keeps a truncated proposal valid", () => {
    const proposal = proposeKeywordId(`${"a".repeat(39)} bcd`);
    expect(proposal).toBe("a".repeat(39));
    expect(KEYWORD_ID_PATTERN.test(proposal!)).toBe(true);
  });

  it("recognises private paths through draft and release prefixes", () => {
    expect(isPrivateKeywordPath("keyword.client-name")).toBe(true);
    expect(isPrivateKeywordPath("drafts.keyword.client-name")).toBe(true);
    expect(isPrivateKeywordPath("versions.r1.keyword.client-name")).toBe(true);
    expect(isPrivateKeywordPath("drafts.abc")).toBe(false);
    expect(isPrivateKeywordPath("versions.r1.abc")).toBe(false);
  });
});

describe("keyword graph", () => {
  const check = (document: Readonly<Record<string, unknown>>, rows: unknown = published) => validateProspectiveKeywordGraph(rows, document);

  it("accepts the fixtures, which span two hierarchy levels and several categories", () => {
    expect(KEYWORD_CATEGORY_FIXTURES.length).toBeGreaterThanOrEqual(3);
    for (const input of KEYWORD_FIXTURE_INPUTS) expect(check(keywordDocument(input))).toBe(true);
    expect(check({ ...keywordDocument({ id: "new-one", title: "New one", category: subject, parent: "road-cycling" }), _id: "drafts.doc-new-one" })).toBe(true);
  });

  it("fails closed on an unreadable store or an incomplete document", () => {
    expect(check(keywordDocument({ id: "a1", title: "A", category: subject }), "nope")).toMatch(/malformed/);
    expect(check(keywordDocument({ id: "a1", title: "A", category: subject }), [{ _id: "x" }])).toMatch(/malformed/);
    expect(check({ _id: "doc-a1" })).toMatch(/Complete the keyword/);
  });

  it("lets a draft repair its own malformed published version, but not another keyword's", () => {
    const damaged = { ...keywordRow({ id: "tripod", title: "Tripod", category: "category-equipment" }), titles: null };
    const rows = [...published.filter((row) => row.keywordId !== "tripod"), damaged];
    expect(check(keywordDocument({ id: "tripod", title: "Tripod", category: "category-equipment" }), rows)).toBe(true);
    expect(check(keywordDocument({ id: "renamed", title: "Tripod", category: "category-equipment", documentId: "doc-tripod" }), rows)).toMatch(/published as "tripod"/);
    expect(check(keywordDocument({ id: "harbour", title: "Harbour", category: place }), rows)).toMatch(/published keyword is malformed/);
    const merged = { ...keywordRow({ id: "biking", title: "Biking", category: subject, status: "merged", mergedInto: "cycling" }), titles: null };
    expect(check(keywordDocument({ id: "biking", title: "Biking", category: subject }), [...published, merged])).toMatch(/cannot be reversed/);
  });

  it("rejects direct and indirect parent cycles", () => {
    expect(check(keywordDocument({ id: "sport", title: "Sport", category: subject, parent: "sport" }))).toMatch(/own parent/);
    expect(check(keywordDocument({ id: "sport", title: "Sport", category: subject, parent: "road-cycling" }))).toMatch(/cycle/);
  });

  it("rejects a chain deeper than the limit, including through a moved subtree", () => {
    const chain = Array.from({ length: MAX_KEYWORD_DEPTH }, (_, index) => keywordRow({
      id: `level-${index}`, title: `Level ${index}`, category: subject, ...(index === 0 ? {} : { parent: `level-${index - 1}` }),
    }));
    expect(check(keywordDocument({ id: "level-5", title: "Level 5", category: subject, parent: "level-4" }), chain)).toBe(true);
    expect(check(keywordDocument({ id: "extra", title: "Extra", category: subject, parent: "level-5" }), chain)).toMatch(/6-level limit/);
    const separate = [...published.slice(0, 3), ...chain];
    expect(check(keywordDocument({ id: "sport", title: "Sport", category: subject, parent: "level-3" }), separate)).toMatch(/6-level limit/);
  });

  it("requires a published, active parent", () => {
    expect(check(keywordDocument({ id: "new-one", title: "New one", category: subject, parent: "missing" }))).toMatch(/published first/);
    const rows = [keywordRow({ id: "old", title: "Old", category: subject, status: "retired" })];
    expect(check(keywordDocument({ id: "new-one", title: "New one", category: subject, parent: "old" }), rows)).toMatch(/active parent/);
  });

  it("detects duplicate ids, immutability and id reuse after retirement", () => {
    expect(check(keywordDocument({ id: "sport", title: "Other", category: place, documentId: "doc-other" }))).toMatch(/keyword ID "sport"/);
    expect(check(keywordDocument({ id: "renamed", title: "Sport", category: subject, documentId: "doc-sport" }))).toMatch(/published as "sport"/);
    const rows = [keywordRow({ id: "old", title: "Old", category: subject, status: "retired" })];
    expect(check(keywordDocument({ id: "old", title: "New", category: subject, documentId: "doc-new" }), rows)).toMatch(/keyword ID "old"/);
  });

  it("scopes name collisions to one category and is deterministic", () => {
    const rows = [keywordRow({ id: "alpha-make", title: "Alpha", category: "category-equipment" })];
    expect(check(keywordDocument({ id: "alpha-team", title: "ALPHA ", category: subject }), rows)).toBe(true);
    const clash = check(keywordDocument({ id: "alpha-other", title: "alpha", category: "category-equipment" }), rows);
    expect(clash).toBe('Keywords "alpha-make" and "alpha-other" both use the name "alpha" in one category.');
    expect(check(keywordDocument({ id: "alpha-other", title: "alpha", category: "category-equipment" }), [...rows].reverse())).toBe(clash);
    expect(check(keywordDocument({ id: "bicycle", title: "Bicycle", category: subject, aliases: ["Bike  Racing"] }))).toMatch(/"bike racing"/);
  });

  it("allows repeats inside one keyword's own titles and aliases", () => {
    expect(check(keywordDocument({ id: "harbour", title: "Harbour", category: place, aliases: ["harbour", " HARBOUR"] }))).toBe(true);
  });

  it("rejects a name equal to another keyword's id in its own category, in any status", () => {
    expect(check(keywordDocument({ id: "port", title: "Sport", category: subject }))).toMatch(/equals the ID of another keyword in its category/);
    const rows = [keywordRow({ id: "old", title: "Former", category: subject, status: "retired" })];
    expect(check(keywordDocument({ id: "newer", title: "Newer", category: subject, aliases: ["OLD"] }), rows)).toMatch(/equals the ID of another keyword in its category/);
  });

  it("allows a name equal to another keyword's id in a different category", () => {
    expect(check(keywordDocument({ id: "port", title: "Sport", category: place }))).toBe(true);
    const rows = [keywordRow({ id: "old", title: "Former", category: subject, status: "retired" })];
    expect(check(keywordDocument({ id: "newer", title: "Newer", category: place, aliases: ["OLD"] }), rows)).toBe(true);
  });

  it("re-checks a name when the keyword holding that id moves into its category", () => {
    const rows = [...published, keywordRow({ id: "port", title: "Sport", category: place })];
    expect(check(keywordDocument({ id: "sport", title: "Sport", category: place }), rows)).toMatch(/both use|equals the ID/);
  });

  describe("merges", () => {
    const merged = keywordRow({ id: "biking", title: "Biking", category: subject, aliases: ["cycle sport"], status: "merged", mergedInto: "cycling" });
    const rows = [...published, merged];

    it("requires a target exactly when merged", () => {
      expect(check(keywordDocument({ id: "harbour", title: "Harbour", category: place, status: "merged" }))).toMatch(/needs a merge target/);
      expect(check(keywordDocument({ id: "harbour", title: "Harbour", category: place, mergedInto: "tripod" }))).toMatch(/needs a merge target/);
    });

    it("targets an active keyword other than itself", () => {
      expect(check(keywordDocument({ id: "harbour", title: "Harbour", category: place, status: "merged", mergedInto: "harbour" }))).toMatch(/into itself/);
      const retired = [...published, keywordRow({ id: "old", title: "Old", category: subject, status: "retired" })];
      expect(check(keywordDocument({ id: "harbour", title: "Harbour", category: place, status: "merged", mergedInto: "old" }), retired)).toMatch(/active keyword/);
    });

    it("reserves a merge record's id, title and aliases for its target", () => {
      expect(check(keywordDocument({ id: "new-one", title: "Cycle Sport", category: subject }), rows)).toMatch(/both use the name "cycle sport"/);
      expect(check(keywordDocument({ id: "new-two", title: "Biking", category: subject }), rows)).toMatch(/both use|equals the ID/);
      expect(check(keywordDocument({ id: "new-three", title: "Biking", category: place }), rows)).toBe(true);
    });

    it("lets a target and its merge records share terms, and two sources share one target", () => {
      expect(check(keywordDocument({ id: "cycling", title: "Cycling", category: subject, parent: "sport", aliases: ["bike racing", "cycle sport", "biking"] }), rows)).toBe(true);
      const second = keywordDocument({ id: "pedalling", title: "Pedalling", category: subject, aliases: ["cycle sport"], status: "merged", mergedInto: "cycling" });
      expect(check(second, rows)).toBe(true);
    });

    it("cannot be reversed or retargeted once published", () => {
      expect(check(keywordDocument({ id: "biking", title: "Biking", category: subject, aliases: ["cycle sport"] }), rows)).toMatch(/cannot be reversed/);
      expect(check(keywordDocument({ id: "biking", title: "Biking", category: subject, aliases: ["cycle sport"], status: "retired" }), rows)).toMatch(/cannot be reversed/);
      expect(check(keywordDocument({ id: "biking", title: "Biking", category: subject, aliases: ["cycle sport"], status: "merged", mergedInto: "sport" }), rows)).toMatch(/cannot be reversed/);
    });

    it("keeps an unchanged chain publishable after its target merges or retires, and releases the terms of a retired end", () => {
      const chain = [
        keywordRow({ id: "source", title: "Source", category: subject, status: "merged", mergedInto: "middle" }),
        keywordRow({ id: "middle", title: "Middle", category: subject, status: "merged", mergedInto: "end" }),
        keywordRow({ id: "end", title: "End", category: subject }),
      ];
      expect(check(keywordDocument({ id: "source", title: "Source", category: subject, status: "merged", mergedInto: "middle" }), chain)).toBe(true);
      const retiredEnd = [chain[0], chain[1], keywordRow({ id: "end", title: "End", category: subject, status: "retired" })];
      expect(check(keywordDocument({ id: "source", title: "Source", category: subject, status: "merged", mergedInto: "middle" }), retiredEnd)).toBe(true);
      expect(check(keywordDocument({ id: "fresh", title: "Fresh", category: subject, aliases: ["source term"] }), retiredEnd)).toBe(true);
    });

    it("rejects a merge cycle already in the data", () => {
      const cycle = [
        keywordRow({ id: "one", title: "One", category: subject, status: "merged", mergedInto: "two" }),
        keywordRow({ id: "two", title: "Two", category: subject, status: "merged", mergedInto: "one" }),
      ];
      expect(check(keywordDocument({ id: "other", title: "Other", category: subject }), cycle)).toMatch(/merge cycle/);
    });
  });

  it("blocks retiring or merging a keyword with active children", () => {
    expect(check(keywordDocument({ id: "cycling", title: "Cycling", category: subject, parent: "sport", status: "retired" }))).toMatch(/still has active child "road-cycling"/);
    expect(check(keywordDocument({ id: "cycling", title: "Cycling", category: subject, parent: "sport", status: "merged", mergedInto: "harbour" }))).toMatch(/still has active child/);
    expect(check(keywordDocument({ id: "road-cycling", title: "Road cycling", category: subject, parent: "cycling", status: "retired" }))).toBe(true);
  });

  it("frees a retired keyword's names, and re-checks them on reactivation", () => {
    const rows = [
      keywordRow({ id: "old", title: "Shared name", category: subject, status: "retired" }),
      keywordRow({ id: "taker", title: "Shared name", category: subject }),
    ];
    expect(check(keywordDocument({ id: "taker", title: "Shared name", category: subject }), rows)).toBe(true);
    expect(check(keywordDocument({ id: "old", title: "Shared name", category: subject }), rows)).toMatch(/both use the name "shared name"/);
  });

  describe("privacy", () => {
    const internal = keywordRow({ id: "client", title: "Client", category: subject, documentId: "keyword.client", visibility: "internal" });

    it("fixes visibility by the storage path", () => {
      expect(check(keywordDocument({ id: "client", title: "Client", category: subject, documentId: "keyword.client" }))).toMatch(/must be "internal"/);
      expect(check(keywordDocument({ id: "client", title: "Client", category: subject, documentId: "drafts.keyword.client", visibility: "internal" }))).toBe(true);
      expect(check(keywordDocument({ id: "client", title: "Client", category: subject, visibility: "internal" }))).toMatch(/must be "public"/);
    });

    it("never lets a public document refer to a private one", () => {
      const asParent = { ...keywordDocument({ id: "child", title: "Child", category: subject }), parent: { _ref: "keyword.client" } };
      const asTarget = { ...keywordDocument({ id: "child", title: "Child", category: subject, status: "merged" }), mergedInto: { _ref: "keyword.client" } };
      expect(check(asParent, [internal])).toMatch(/internal parent/);
      expect(check(asTarget, [internal])).toMatch(/into an internal keyword/);
      expect(check(keywordDocument({ id: "child", title: "Child", category: "keywordCategory.secret" }), [])).toMatch(/ordinary public/);
    });

    it("lets an internal keyword sit under a public parent", () => {
      expect(check(keywordDocument({ id: "guest", title: "Guest", category: subject, parent: "sport", documentId: "keyword.guest", visibility: "internal" }))).toBe(true);
    });
  });
});

describe("derived keyword closure", () => {
  it("includes every ancestor, once, in a stable order", () => {
    expect(deriveExpandedKeywordIds(["doc-road-cycling"], published)).toEqual(["cycling", "road-cycling", "sport"]);
    expect(deriveExpandedKeywordIds(["doc-tripod", "doc-cycling", "doc-sport"], published)).toEqual(["cycling", "sport", "tripod"]);
    expect(deriveExpandedKeywordIds([], published)).toEqual([]);
  });

  it("refuses to produce a partial closure", () => {
    expect(() => deriveExpandedKeywordIds(["doc-missing"], published)).toThrow(/cannot be resolved/);
    expect(() => deriveExpandedKeywordIds(["doc-a1"], [keywordRow({ id: "a1", title: "A", category: subject, parent: "gone" })])).toThrow(/cannot be resolved/);
    expect(() => deriveExpandedKeywordIds(["doc-a1"], [{ _id: "doc-a1" }])).toThrow(/malformed/);
    const cycle = [keywordRow({ id: "a1", title: "A", category: subject, parent: "b1" }), keywordRow({ id: "b1", title: "B", category: subject, parent: "a1" })];
    expect(() => deriveExpandedKeywordIds(["doc-a1"], cycle)).toThrow(/cannot be resolved/);
  });
});

describe("keyword publication effects", () => {
  const base = keywordDocument({ id: "cycling", title: "Cycling", category: subject, parent: "sport", aliases: ["bike racing"] });

  it("treats a first publication as neither a rename nor structural", () => {
    expect(keywordPublicationEffects(undefined, base)).toEqual({ retainedAliases: [], structural: false });
  });

  it("keeps a former title's key as an alias, without any media write", () => {
    const renamed = { ...base, title: [{ language: "en", value: "Bike sport" }] };
    expect(keywordPublicationEffects(base, renamed)).toEqual({ retainedAliases: ["cycling"], structural: false });
  });

  it("adds nothing for a casing change or a title already kept as an alias", () => {
    expect(keywordPublicationEffects(base, { ...base, title: [{ language: "en", value: "CYCLING" }] }).retainedAliases).toEqual([]);
    expect(keywordPublicationEffects(base, { ...base, title: [{ language: "en", value: "Bike sport" }], aliases: ["cycling"] }).retainedAliases).toEqual([]);
  });

  it("retains a removed translation's term", () => {
    const two = { ...base, title: [{ language: "en", value: "Cycling" }, { language: "fi", value: "Pyöräily" }] };
    expect(keywordPublicationEffects(two, base).retainedAliases).toEqual(["pyöräily"]);
  });

  it("does not restore an alias the editor removed on purpose", () => {
    expect(keywordPublicationEffects(base, { ...base, aliases: [] }).retainedAliases).toEqual([]);
  });

  it("flags a parent move, merge, retirement and reactivation as structural", () => {
    expect(keywordPublicationEffects(base, { ...base, parent: { _ref: "doc-other" } }).structural).toBe(true);
    expect(keywordPublicationEffects(base, { ...base, parent: undefined }).structural).toBe(true);
    expect(keywordPublicationEffects(base, { ...base, status: "merged", mergedInto: { _ref: "doc-other" } }).structural).toBe(true);
    expect(keywordPublicationEffects(base, { ...base, status: "retired" }).structural).toBe(true);
    expect(keywordPublicationEffects({ ...base, status: "retired" }, base).structural).toBe(true);
  });

  it("does not flag a rename, category, alias or description edit", () => {
    expect(keywordPublicationEffects(base, { ...base, category: { _ref: place }, aliases: ["x"], description: [{ language: "en", value: "y" }] }).structural).toBe(false);
  });
});
