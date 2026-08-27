import { describe, expect, it } from "vitest";

import { buildKeywordBenchmarkFixtures } from "./keyword-benchmark-fixtures.mts";
import {
  buildMeasurementMatrix,
  ENDPOINT_PASSES,
  formatResultsMarkdown,
  STRATEGY_VARIANTS,
  type MatrixResults,
} from "./keyword-benchmark-plan.mts";

const { scenario } = buildKeywordBenchmarkFixtures({ mediaCount: 200 });

describe("buildMeasurementMatrix", () => {
  const matrix = buildMeasurementMatrix(scenario, { repetitions: 5 });

  it("covers the full strategy × shape × endpoint cross-product for intersections", () => {
    const shapes = 6;
    expect(matrix.intersection).toHaveLength(shapes * STRATEGY_VARIANTS.length * ENDPOINT_PASSES.length);
    expect(ENDPOINT_PASSES.map((p) => p.id)).toEqual(["direct-api", "cdn"]);
    expect(matrix.repetitions).toBe(5);
  });

  it("pre-resolves descendants only for the two-step and traversal variants", () => {
    for (const cell of matrix.intersection) {
      if (cell.variant.strategy === "media-expansion" || !cell.variant.preResolveDescendants) {
        expect(cell.resolveDescendantsFor).toEqual([]);
      } else {
        expect(cell.resolveDescendantsFor.length).toBeGreaterThan(0);
      }
    }
  });

  it("labels the parent+descendant shapes as AC4 and includes both pre- and post-collapse", () => {
    const ac4 = matrix.intersection.filter((cell) => cell.acRef === "AC4");
    expect(ac4.some((cell) => cell.shape === "parent-descendant-pre-collapse")).toBe(true);
    expect(ac4.some((cell) => cell.shape === "parent-descendant-collapsed")).toBe(true);
  });

  it("walks the broad result: keyset per strategy plus one offset baseline, and the three count modes", () => {
    const keyset = matrix.pagination.filter((cell) => cell.mode === "keyset");
    expect(keyset.map((cell) => cell.spec.strategy).sort()).toEqual([
      "materialized-ancestors",
      "media-expansion",
      "query-time-traversal",
    ]);
    expect(matrix.pagination.filter((cell) => cell.mode === "offset")).toHaveLength(1);
    for (const cell of keyset) {
      if (cell.spec.strategy === "media-expansion") expect(cell.resolveDescendantsFor).toEqual([]);
      else expect(cell.resolveDescendantsFor.length).toBeGreaterThan(0);
    }
    expect(matrix.count.map((cell) => cell.mode).sort()).toEqual([
      "count-function",
      "id-projection-length",
      "no-count",
    ]);
    for (const cell of [...matrix.pagination, ...matrix.count]) {
      expect(cell.spec.selectionKeywordIds).toEqual([scenario.broadRootKeywordId]);
    }
  });

  it("requires dynamicallyDiscoverable on every measured spec (ADR-0012 §2)", () => {
    for (const cell of [...matrix.intersection, ...matrix.pagination, ...matrix.count]) {
      expect(cell.spec.requireDynamicallyDiscoverable).toBe(true);
    }
  });
});

describe("formatResultsMarkdown", () => {
  it("renders a table with one row per cell", () => {
    const results: MatrixResults = {
      benchmarkRun: "kwbench-fixture-v1",
      capturedAt: "2026-08-27T00:00:00Z",
      projectId: "abc123",
      dataset: "kwbench",
      apiVersion: "v2024-01-01",
      cells: [
        {
          cellId: "intersection/broad-root/media-expansion/direct-api",
          requestCount: 8,
          summary: {
            samples: 8,
            medianWallMs: 42.3,
            p95WallMs: 61.7,
            minWallMs: 30,
            maxWallMs: 70,
            medianServerMs: 12,
            medianPayloadBytes: 51234,
            resultCount: 4821,
          },
          cacheHeaderSample: { age: "0", "x-cache": "MISS" },
          note: "cold",
        },
      ],
    };
    const markdown = formatResultsMarkdown(results);
    expect(markdown).toContain("intersection/broad-root/media-expansion/direct-api");
    expect(markdown).toContain("| 42.3 | 61.7 | 12.0 | 51234 |");
    expect(markdown).toContain("age=0; x-cache=MISS");
    expect(markdown).toContain("kwbench-fixture-v1");
  });
});
