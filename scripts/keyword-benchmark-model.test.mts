import { describe, expect, it } from "vitest";

import {
  buildKeywordBenchmarkFixtures,
  type BenchmarkKeyword,
  BENCHMARK_KEYWORD_TYPE,
} from "./keyword-benchmark-fixtures.mts";
import {
  antichainSelectionCardinality,
  buildKeywordIndex,
  canonicalizeSelection,
  comparePublicMediaOrder,
  hierarchyMoveAmplification,
  membershipChangeFanOut,
  naiveSelectionCardinality,
  orderByPublicMediaOrder,
} from "./keyword-benchmark-model.mts";

/** R -> {A -> A1, B}. Four nodes, hand-checkable antichain counts. */
function tinyTree(): BenchmarkKeyword[] {
  const make = (keywordId: string, parentKeywordId: string | null, ancestors: string[]): BenchmarkKeyword => ({
    _id: `kwbench--kw--${keywordId}`,
    _type: BENCHMARK_KEYWORD_TYPE,
    benchmarkRun: "kwbench-test",
    keywordId,
    label: "Root",
    parentKeywordId,
    ancestorKeywordIds: ancestors,
    depth: ancestors.length,
  });
  return [
    make("R", null, []),
    make("A", "R", ["R"]),
    make("B", "R", ["R"]),
    make("A1", "A", ["R", "A"]),
  ];
}

describe("canonicalizeSelection (ADR-0012 §3)", () => {
  const index = buildKeywordIndex(tinyTree());

  it("drops an ancestor when a descendant is also selected — Cars + Peugeot => Peugeot", () => {
    const result = canonicalizeSelection(["R", "A1"], index);
    expect(result.canonical).toEqual(["A1"]);
    expect(result.collapsedAncestors).toEqual(["R"]);
  });

  it("collapses a whole grandparent-parent-child chain to the child", () => {
    const result = canonicalizeSelection(["A1", "A", "R"], index);
    expect(result.canonical).toEqual(["A1"]);
    expect(new Set(result.collapsedAncestors)).toEqual(new Set(["A", "R"]));
  });

  it("dedupes and sorts", () => {
    const result = canonicalizeSelection(["B", "A", "B"], index);
    expect(result.canonical).toEqual(["A", "B"]);
    expect(result.duplicates).toEqual(["B"]);
  });

  it("reports the 1..5 bound without enforcing it", () => {
    expect(canonicalizeSelection(["A", "B"], index).withinBound).toBe(true);
    expect(canonicalizeSelection([], index).withinBound).toBe(false);
  });
});

describe("comparePublicMediaOrder (AC5 / ADR-0012 §9)", () => {
  it("orders by capturedAt descending, then mediaId ascending, undated last", () => {
    const ordered = orderByPublicMediaOrder([
      { capturedAt: null, mediaId: "m-2" },
      { capturedAt: "2023-01-01T00:00:00Z", mediaId: "m-9" },
      { capturedAt: "2023-06-01T00:00:00Z", mediaId: "m-4" },
      { capturedAt: "2023-06-01T00:00:00Z", mediaId: "m-1" },
      { capturedAt: null, mediaId: "m-1" },
    ]);
    // 2023-06-01 group (mediaId asc), then 2023-01-01, then undated (mediaId asc).
    expect(ordered.map((m) => m.mediaId)).toEqual(["m-1", "m-4", "m-9", "m-1", "m-2"]);
  });

  it("treats a sub-second-precision difference as a real ordering (what GROQ must match)", () => {
    expect(
      comparePublicMediaOrder(
        { capturedAt: "2023-03-03T03:03:03.500Z", mediaId: "m-1" },
        { capturedAt: "2023-03-03T03:03:03.000Z", mediaId: "m-2" },
      ),
    ).toBeLessThan(0); // .500 sorts before .000 under descending order
  });
});

describe("antichainSelectionCardinality (AC6)", () => {
  it("matches the hand-computed count for a tiny tree", () => {
    const { bySize, total } = antichainSelectionCardinality(tinyTree(), 4);
    expect(bySize[1]).toBe(BigInt(4)); // {R},{A},{B},{A1}
    expect(bySize[2]).toBe(BigInt(2)); // {A,B},{B,A1}
    expect(bySize[3]).toBe(BigInt(0));
    expect(total).toBe(BigInt(6));
  });

  it("stays far below the naive Σ C(V,k) ceiling for the benchmark taxonomy", () => {
    const { keywords } = buildKeywordBenchmarkFixtures({ mediaCount: 200 });
    const antichain = antichainSelectionCardinality(keywords).total;
    const naive = naiveSelectionCardinality(keywords.length);
    expect(antichain).toBeGreaterThan(BigInt(0));
    expect(antichain).toBeLessThan(naive);
  });
});

describe("membershipChangeFanOut (AC6)", () => {
  it("counts every antichain touching a node's root-path chain", () => {
    const result = membershipChangeFanOut(tinyTree(), "A1", 4);
    expect(result.totalSelections).toBe(BigInt(6));
    expect(result.affectedSelections).toBe(BigInt(5)); // all but {B}
  });

  it("is monotone non-decreasing down a root path (chain grows, so fan-out grows)", () => {
    const { keywords, scenario } = buildKeywordBenchmarkFixtures({ mediaCount: 200 });
    const ancestor = membershipChangeFanOut(keywords, scenario.parentDescendantPair.ancestorKeywordId);
    const descendant = membershipChangeFanOut(keywords, scenario.parentDescendantPair.descendantKeywordId);
    expect(descendant.affectedSelections).toBeGreaterThanOrEqual(ancestor.affectedSelections);
    for (const result of [ancestor, descendant]) {
      expect(result.affectedSelections).toBeLessThan(result.totalSelections);
      expect(result.affectedSelections).toBeGreaterThan(BigInt(0));
    }
    // The point of AC6: the two differ, and by a wide margin.
    expect(descendant.affectedSelections).not.toBe(ancestor.affectedSelections);
  });
});

describe("hierarchyMoveAmplification (AC7)", () => {
  it("charges strategy A the subtree size and strategy B only the media whose closure changes", () => {
    const { keywords, media, scenario } = buildKeywordBenchmarkFixtures({ mediaCount: 400 });
    const { broadKeywordId, newParentKeywordId } = scenario.hierarchyMoveTargets;
    const move = hierarchyMoveAmplification(keywords, media, broadKeywordId, newParentKeywordId);

    expect(move.strategyA.keywordDocsRewritten).toBe(move.subtreeKeywordIds.length);
    expect(move.strategyA.mediaDocsRewritten).toBe(0);
    expect(move.strategyB.keywordDocsRewritten).toBe(1);
    // The real write count is strictly below the naive "tagged in subtree" count.
    expect(move.strategyB.mediaDocsRewritten).toBeGreaterThan(0);
    expect(move.strategyB.mediaDocsRewritten).toBeLessThan(move.strategyB.mediaTaggedInSubtree);
    expect(move.strategyB.mediaDocsRewritten + move.strategyB.mediaDocsUnchanged).toBe(
      move.strategyB.mediaTaggedInSubtree,
    );
  });

  it("counts a medium already under the new parent's branch (via another keyword) as unchanged", () => {
    const { keywords, media, scenario } = buildKeywordBenchmarkFixtures({ mediaCount: 400 });
    const { broadKeywordId, newParentKeywordId } = scenario.hierarchyMoveTargets;
    const byId = new Map(keywords.map((k) => [k.keywordId, k]));
    const newParent = byId.get(newParentKeywordId)!;
    const facetLeaf = keywords.find((k) => k.parentKeywordId === newParentKeywordId)!;
    const subtreeLeaf = scenario.parentDescendantPair.descendantKeywordId; // under broadKeywordId

    // A medium tagged both under the moved subtree AND directly with a leaf
    // under the new parent: moving the subtree adds `newParentKeywordId` to
    // its closure — but it is already there, so nothing to write.
    const alreadyCovered = {
      _id: "kwbench--media--m-probe",
      _type: "benchmarkMedia" as const,
      benchmarkRun: scenario.benchmarkRun,
      mediaId: "m-probe",
      publiclyRenderable: true as const,
      dynamicallyDiscoverable: true,
      capturedAt: "2024-01-01T00:00:00Z",
      leafKeywordIds: [subtreeLeaf, facetLeaf.keywordId].sort(),
      expandedKeywordIds: [
        subtreeLeaf,
        ...byId.get(subtreeLeaf)!.ancestorKeywordIds,
        facetLeaf.keywordId,
        ...facetLeaf.ancestorKeywordIds,
      ]
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort(),
    };
    expect(alreadyCovered.expandedKeywordIds).toContain(newParentKeywordId);
    expect(newParent).toBeDefined();

    const withProbe = [...media, alreadyCovered];
    const withoutProbe = hierarchyMoveAmplification(keywords, media, broadKeywordId, newParentKeywordId);
    const withProbeMove = hierarchyMoveAmplification(keywords, withProbe, broadKeywordId, newParentKeywordId);

    // The probe medium is tagged in the subtree but must NOT add to the write count.
    expect(withProbeMove.strategyB.mediaTaggedInSubtree).toBe(withoutProbe.strategyB.mediaTaggedInSubtree + 1);
    expect(withProbeMove.strategyB.mediaDocsRewritten).toBe(withoutProbe.strategyB.mediaDocsRewritten);
    expect(withProbeMove.strategyB.mediaDocsUnchanged).toBe(withoutProbe.strategyB.mediaDocsUnchanged + 1);
  });
});
