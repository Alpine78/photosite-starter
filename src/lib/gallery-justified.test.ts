import { describe, expect, it } from "vitest";
import { groupJustifiedRows, JUSTIFIED_BANDS, JUSTIFIED_MAX_HEIGHT_REM,
  JUSTIFIED_TAIL_HEIGHT_REM } from "@/lib/gallery-justified";

describe("justified rows", () => {
  const ratios = Array.from({ length: 400 }, (_, i) => [1.5, 2 / 3, 1, 16, 1 / 8][i % 5]);
  for (const band of JUSTIFIED_BANDS) {
    it(`keeps closed rows unchanged on append in the ${band.maxContainerRem}rem band`, () => {
      const whole = groupJustifiedRows(ratios, band.maxContainerRem);
      for (const size of [1, 2, 24, 48, 75, 200]) {
        const closed = groupJustifiedRows(ratios.slice(0, size), band.maxContainerRem).filter((row) => row.closed);
        expect(whole.slice(0, closed.length)).toEqual(closed);
      }
    });
    it(`fits each row without changing any aspect ratio (${band.maxContainerRem}rem)`, () => {
      for (const row of groupJustifiedRows(ratios, band.maxContainerRem)) {
        for (const width of [band.minContainerRem, band.maxContainerRem]) {
          const cap = row.closed && row.count > 1 ? JUSTIFIED_MAX_HEIGHT_REM : JUSTIFIED_TAIL_HEIGHT_REM;
          const gaps = (row.count - 1) * Math.min(1, width / (2 * row.count));
          const height = Math.min(cap, (width - gaps) / row.ratio);
          expect(height).toBeGreaterThan(0);
          expect(height).toBeLessThanOrEqual(16);
          expect(height * row.ratio + gaps).toBeLessThanOrEqual(width + 1e-9);
          if (row.closed && row.count > 1) expect(height * row.ratio + gaps).toBeCloseTo(width);
        }
      }
    });
  }
  for (const band of JUSTIFIED_BANDS) {
    it(`resumes from a prior grouping with exactly the result a full recomputation gives (${band.maxContainerRem}rem)`, () => {
      const whole = groupJustifiedRows(ratios, band.maxContainerRem);
      for (const split of [0, 1, 2, 24, 48, 200, ratios.length]) {
        const partial = groupJustifiedRows(ratios.slice(0, split), band.maxContainerRem);
        expect(groupJustifiedRows(ratios, band.maxContainerRem, partial)).toEqual(whole);
      }
    });
  }

  it("refuses to resume from a state longer than the given ratios", () => {
    const whole = groupJustifiedRows(ratios, JUSTIFIED_BANDS[0].maxContainerRem);
    expect(() =>
      groupJustifiedRows(ratios.slice(0, 5), JUSTIFIED_BANDS[0].maxContainerRem, whole),
    ).toThrow(RangeError);
  });

  it("handles empty galleries, lone portraits and invalid dimensions explicitly", () => {
    expect(groupJustifiedRows([], 69)).toEqual([]);
    expect(groupJustifiedRows([1 / 8], 69)).toEqual([{ start: 0, count: 1, ratio: 1 / 8, closed: false }]);
    for (const ratio of [0, -1, NaN, Infinity]) expect(() => groupJustifiedRows([ratio], 69)).toThrow(RangeError);
  });
});
