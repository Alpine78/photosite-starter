import { describe, expect, it } from "vitest";

import {
  BENCHMARK_ID_PREFIX,
  buildKeywordBenchmarkFixtures,
  computeExpandedKeywordIds,
  DUPLICATE_CAPTURED_AT,
  KeywordBenchmarkFixtureError,
  MAX_CANONICAL_KEYWORDS,
  MAX_KEYWORD_DEPTH,
  toBenchmarkDocuments,
  validateKeywordBenchmarkFixtures,
} from "./keyword-benchmark-fixtures.mts";

// A small corpus keeps the suite fast; every structural invariant scales.
const SMALL = { mediaCount: 300 } as const;

describe("buildKeywordBenchmarkFixtures", () => {
  it("is deterministic — same options produce byte-identical output", () => {
    const a = buildKeywordBenchmarkFixtures(SMALL);
    const b = buildKeywordBenchmarkFixtures(SMALL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a corpus that passes its own validation", () => {
    expect(() => validateKeywordBenchmarkFixtures(buildKeywordBenchmarkFixtures(SMALL))).not.toThrow();
  });

  it("builds the default ~8000-media corpus and validates it", () => {
    const fixtures = buildKeywordBenchmarkFixtures();
    expect(fixtures.media).toHaveLength(8000);
    expect(() => validateKeywordBenchmarkFixtures(fixtures)).not.toThrow();
  });

  it("keeps every document inside the dot-free kwbench-- namespace", () => {
    const docs = toBenchmarkDocuments(buildKeywordBenchmarkFixtures(SMALL));
    for (const doc of docs) {
      expect(doc._id.startsWith(BENCHMARK_ID_PREFIX)).toBe(true);
      expect(doc._id).not.toContain(".");
    }
  });

  it("stamps benchmarkRun on every document so a query can scope to it", () => {
    const fixtures = buildKeywordBenchmarkFixtures({ ...SMALL, benchmarkRun: "kwbench-test" });
    expect(fixtures.scenario.benchmarkRun).toBe("kwbench-test");
    for (const keyword of fixtures.keywords) expect(keyword.benchmarkRun).toBe("kwbench-test");
    for (const medium of fixtures.media) expect(medium.benchmarkRun).toBe("kwbench-test");
  });

  it("models both hierarchy representations consistently", () => {
    const { keywords, media } = buildKeywordBenchmarkFixtures(SMALL);
    const byId = new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));

    for (const keyword of keywords) {
      expect(keyword.ancestorKeywordIds).not.toContain(keyword.keywordId); // A: excludes self
      expect(keyword.depth).toBeLessThanOrEqual(MAX_KEYWORD_DEPTH);
    }
    for (const medium of media) {
      // B: self-inclusive closure
      for (const leaf of medium.leafKeywordIds) {
        expect(medium.expandedKeywordIds).toContain(leaf);
      }
      expect([...medium.expandedKeywordIds]).toEqual(
        computeExpandedKeywordIds(medium.leafKeywordIds, byId),
      );
    }
  });

  it("carries a broad branch, a narrow branch, a duplicate-instant cluster and undated media", () => {
    const { media, scenario } = buildKeywordBenchmarkFixtures(SMALL);
    const matches = (keywordId: string): number =>
      media.filter((m) => m.expandedKeywordIds.includes(keywordId)).length;

    expect(matches(scenario.broadRootKeywordId)).toBeGreaterThan(media.length * 0.4);
    expect(matches(scenario.narrowLeafKeywordId)).toBeLessThanOrEqual(12);
    expect(matches(scenario.narrowLeafKeywordId)).toBeGreaterThan(0);

    expect(media.some((m) => m.capturedAt === null)).toBe(true);
    expect(media.filter((m) => m.capturedAt === DUPLICATE_CAPTURED_AT).length).toBeGreaterThan(20);
  });

  it("sets up the AC4 parent+descendant redundancy pair so collapse is meaning-preserving", () => {
    const { keywords, media, scenario } = buildKeywordBenchmarkFixtures(SMALL);
    const byId = new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));
    const { ancestorKeywordId, descendantKeywordId } = scenario.parentDescendantPair;

    expect(byId.get(descendantKeywordId)!.ancestorKeywordIds).toContain(ancestorKeywordId);

    const bothCount = media.filter(
      (m) =>
        m.expandedKeywordIds.includes(ancestorKeywordId) &&
        m.expandedKeywordIds.includes(descendantKeywordId),
    ).length;
    const descendantOnlyCount = media.filter((m) =>
      m.expandedKeywordIds.includes(descendantKeywordId),
    ).length;
    // Cars AND Peugeot === Peugeot: the collapsed selection yields the same set.
    expect(bothCount).toBe(descendantOnlyCount);
  });

  it("exposes a genuine internal node (with children) on the parent+descendant root path", () => {
    const { keywords, scenario } = buildKeywordBenchmarkFixtures(SMALL);
    const byId = new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));
    expect(keywords.some((k) => k.parentKeywordId === scenario.internalNodeKeywordId)).toBe(true);
    expect(byId.get(scenario.parentDescendantPair.descendantKeywordId)!.ancestorKeywordIds).toContain(
      scenario.internalNodeKeywordId,
    );
    expect(scenario.internalNodeKeywordId).not.toBe(scenario.parentDescendantPair.descendantKeywordId);
  });

  it("exposes a five-wide antichain and a provably empty intersection", () => {
    const { keywords, media, scenario } = buildKeywordBenchmarkFixtures(SMALL);
    const byId = new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));

    expect(scenario.fiveWideKeywordIds).toHaveLength(MAX_CANONICAL_KEYWORDS);
    for (let i = 0; i < scenario.fiveWideKeywordIds.length; i += 1) {
      for (let j = i + 1; j < scenario.fiveWideKeywordIds.length; j += 1) {
        const a = byId.get(scenario.fiveWideKeywordIds[i]!)!;
        const b = byId.get(scenario.fiveWideKeywordIds[j]!)!;
        expect(a.ancestorKeywordIds).not.toContain(b.keywordId);
        expect(b.ancestorKeywordIds).not.toContain(a.keywordId);
      }
    }
    const wideMatch = media.filter((m) =>
      scenario.fiveWideKeywordIds.every((k) => m.expandedKeywordIds.includes(k)),
    ).length;
    expect(wideMatch).toBeGreaterThan(0);

    const emptyMatch = media.filter((m) =>
      scenario.emptyIntersectionKeywordIds.every((k) => m.expandedKeywordIds.includes(k)),
    ).length;
    expect(emptyMatch).toBe(0);
  });

  it("crafts sub-second-precision timestamp pairs (ADR-0012 §9 keyset risk)", () => {
    const { media, scenario } = buildKeywordBenchmarkFixtures(SMALL);
    const byMediaId = new Map(media.map((m) => [m.mediaId, m]));
    expect(scenario.subSecondPrecisionMediaIds.length).toBeGreaterThan(0);
    for (const [firstId, secondId] of scenario.subSecondPrecisionMediaIds) {
      const first = byMediaId.get(firstId)!;
      const second = byMediaId.get(secondId)!;
      expect(first.capturedAt).not.toBe(second.capturedAt);
      expect(first.capturedAt!.slice(0, 19)).toBe(second.capturedAt!.slice(0, 19));
    }
  });
});

describe("validateKeywordBenchmarkFixtures", () => {
  it("rejects a corpus with a drifted expanded closure", () => {
    const fixtures = buildKeywordBenchmarkFixtures(SMALL);
    const broken = {
      ...fixtures,
      media: fixtures.media.map((medium, index) =>
        index === 0 ? { ...medium, expandedKeywordIds: [...medium.expandedKeywordIds, "kw-9999"] } : medium,
      ),
    };
    expect(() => validateKeywordBenchmarkFixtures(broken)).toThrow(KeywordBenchmarkFixtureError);
  });

  it("rejects a non-synthetic keyword label", () => {
    const fixtures = buildKeywordBenchmarkFixtures(SMALL);
    const broken = {
      ...fixtures,
      keywords: fixtures.keywords.map((keyword, index) =>
        index === 1 ? { ...keyword, label: "Helsinki" } : keyword,
      ),
    };
    expect(() => validateKeywordBenchmarkFixtures(broken)).toThrow(/not a synthetic benchmark label/);
  });

  it("rejects a drifted pinned intersection count", () => {
    const fixtures = buildKeywordBenchmarkFixtures(SMALL);
    const broken = {
      ...fixtures,
      scenario: {
        ...fixtures.scenario,
        pinnedIntersections: fixtures.scenario.pinnedIntersections.map((pinned, index) =>
          index === 0 ? { ...pinned, expectedCount: pinned.expectedCount + 1 } : pinned,
        ),
      },
    };
    expect(() => validateKeywordBenchmarkFixtures(broken)).toThrow(/pinned intersection/);
  });
});
