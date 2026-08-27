import { describe, expect, it } from "vitest";

import { buildKeywordBenchmarkFixtures } from "./keyword-benchmark-fixtures.mts";
import { orderByPublicMediaOrder } from "./keyword-benchmark-model.mts";
import {
  type AncestorStrategy,
  buildCountQuery,
  buildDescendantResolutionQuery,
  buildKeysetPageQuery,
  buildLevelExpansionQuery,
  buildMatchQuery,
  buildOffsetPageQuery,
  evaluateMatch,
  keysetWalkInMemory,
  type MatchSpec,
} from "./keyword-benchmark-queries.mts";

const RUN = "kwbench-test";
const STRATEGIES: readonly AncestorStrategy[] = [
  "media-expansion",
  "materialized-ancestors",
  "query-time-traversal",
];

function spec(overrides: Partial<MatchSpec>): MatchSpec {
  return {
    benchmarkRun: RUN,
    selectionKeywordIds: ["kw-0002"],
    strategy: "media-expansion",
    requireDynamicallyDiscoverable: false,
    ...overrides,
  };
}

describe("GROQ builders", () => {
  it("media-expansion match: one round trip, `$k in expandedKeywordIds` per keyword", () => {
    const query = buildMatchQuery(spec({ selectionKeywordIds: ["kw-0002", "kw-0009"] }));
    expect(query.query).toBe(
      `*[_type == $mediaType && benchmarkRun == $run && publiclyRenderable == true && $k0 in expandedKeywordIds && $k1 in expandedKeywordIds] | order(coalesce(capturedAt, "") desc, mediaId asc) { "mediaId": mediaId, capturedAt }`,
    );
    expect(query.params).toMatchObject({ mediaType: "benchmarkMedia", run: RUN, k0: "kw-0002", k1: "kw-0009" });
  });

  it("materialized-ancestors match without pre-resolution: a correlated descendant subquery per keyword", () => {
    const query = buildMatchQuery(spec({ strategy: "materialized-ancestors" }));
    expect(query.query).toContain(
      `count(leafKeywordIds[@ in *[_type == $keywordType && benchmarkRun == $run && (keywordId == $k0 || $k0 in ancestorKeywordIds)].keywordId]) > 0`,
    );
  });

  it("materialized-ancestors match with pre-resolution: an inlined id set, no subquery", () => {
    const resolved = new Map([["kw-0002", ["kw-0002", "kw-0050"]]]);
    const query = buildMatchQuery(spec({ strategy: "materialized-ancestors" }), resolved);
    expect(query.query).toContain(`count(leafKeywordIds[@ in $desc0]) > 0`);
    expect(query.params).toMatchObject({ desc0: ["kw-0002", "kw-0050"] });
  });

  it("adds the dynamicallyDiscoverable AND only when eligibility requires it", () => {
    expect(buildCountQuery(spec({ requireDynamicallyDiscoverable: true })).query).toContain(
      "dynamicallyDiscoverable == true",
    );
    expect(buildCountQuery(spec({ requireDynamicallyDiscoverable: false })).query).not.toContain(
      "dynamicallyDiscoverable",
    );
  });

  it("keyset page: descending-key boundary, integer-literal slice", () => {
    const query = buildKeysetPageQuery(spec({}), 24, { afterKey: "2024-01-01T00:00:00Z", afterId: "m-00100" });
    expect(query.query).toContain(
      `(coalesce(capturedAt, "") < $afterKey || (coalesce(capturedAt, "") == $afterKey && mediaId > $afterId))`,
    );
    expect(query.query).toContain(`[0...24]`);
    expect(query.params).toMatchObject({ afterKey: "2024-01-01T00:00:00Z", afterId: "m-00100" });
  });

  it("rejects a non-integer or negative slice bound", () => {
    expect(() => buildKeysetPageQuery(spec({}), -1, undefined)).toThrow(/non-negative integer/);
    expect(() => buildOffsetPageQuery(spec({}), 10, 5)).toThrow(/end .* < start/);
  });

  it("descendant resolution query is self-inclusive", () => {
    const query = buildDescendantResolutionQuery("kw-0002", RUN);
    expect(query.query).toBe(
      `*[_type == $keywordType && benchmarkRun == $run && (keywordId == $k || $k in ancestorKeywordIds)].keywordId`,
    );
  });

  it("level-expansion query walks one parentKeywordId level for a frontier", () => {
    const query = buildLevelExpansionQuery(["kw-0002", "kw-0003"], RUN);
    expect(query.query).toBe(
      `*[_type == $keywordType && benchmarkRun == $run && parentKeywordId in $frontier].keywordId`,
    );
    expect(query.params).toMatchObject({ frontier: ["kw-0002", "kw-0003"] });
  });
});

describe("evaluateMatch — the three strategies agree on membership (AC2)", () => {
  const fixtures = buildKeywordBenchmarkFixtures({ mediaCount: 500, benchmarkRun: RUN });
  const { scenario } = fixtures;

  const selections: readonly (readonly string[])[] = [
    [scenario.broadRootKeywordId],
    [scenario.narrowLeafKeywordId],
    [scenario.parentDescendantPair.ancestorKeywordId, scenario.parentDescendantPair.descendantKeywordId],
    scenario.fiveWideKeywordIds,
    scenario.emptyIntersectionKeywordIds,
  ];

  for (const selectionKeywordIds of selections) {
    it(`selection [${selectionKeywordIds.join(", ")}] is strategy-independent`, () => {
      const results = STRATEGIES.map((strategy) =>
        evaluateMatch(fixtures, spec({ selectionKeywordIds, strategy })).map((m) => m.mediaId),
      );
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    });
  }

  it("Cars + Peugeot === Peugeot (AC4 redundancy)", () => {
    const { ancestorKeywordId, descendantKeywordId } = scenario.parentDescendantPair;
    const both = evaluateMatch(
      fixtures,
      spec({ selectionKeywordIds: [ancestorKeywordId, descendantKeywordId], strategy: "media-expansion" }),
    ).map((m) => m.mediaId);
    const collapsed = evaluateMatch(
      fixtures,
      spec({ selectionKeywordIds: [descendantKeywordId], strategy: "media-expansion" }),
    ).map((m) => m.mediaId);
    expect(both).toEqual(collapsed);
  });

  it("the dynamicallyDiscoverable AND removes only private media", () => {
    const all = evaluateMatch(
      fixtures,
      spec({ selectionKeywordIds: [scenario.broadRootKeywordId], requireDynamicallyDiscoverable: false }),
    );
    const discoverable = evaluateMatch(
      fixtures,
      spec({ selectionKeywordIds: [scenario.broadRootKeywordId], requireDynamicallyDiscoverable: true }),
    );
    expect(discoverable.length).toBeGreaterThan(0);
    expect(discoverable.length).toBeLessThan(all.length);
  });

  it("empty selection yields nothing", () => {
    expect(evaluateMatch(fixtures, spec({ selectionKeywordIds: [] }))).toEqual([]);
  });
});

describe("keysetWalkInMemory — reproduces the full ordered list (AC5 / ADR-0012 §9)", () => {
  const fixtures = buildKeywordBenchmarkFixtures({ mediaCount: 1200, benchmarkRun: RUN });

  it("walks the broad result with no duplicate or gap, across the duplicate-instant cluster", () => {
    const ordered = evaluateMatch(
      fixtures,
      spec({ selectionKeywordIds: [fixtures.scenario.broadRootKeywordId] }),
    );
    expect(ordered.length).toBeGreaterThan(400);

    for (const pageSize of [1, 7, 24, 100]) {
      const walked = keysetWalkInMemory(ordered, pageSize);
      expect(walked.map((m) => m.mediaId)).toEqual(ordered.map((m) => m.mediaId));
    }
  });

  it("agrees with a straight re-sort of the walked items", () => {
    const ordered = evaluateMatch(fixtures, spec({ selectionKeywordIds: [fixtures.scenario.broadRootKeywordId] }));
    const walked = keysetWalkInMemory(ordered, 24);
    expect(walked).toEqual(orderByPublicMediaOrder(walked));
  });
});
