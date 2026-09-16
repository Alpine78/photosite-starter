import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MASONRY_BANDS,
  MASONRY_CAPTION_BELOW_REM,
  MASONRY_GAP_REM,
  MASONRY_MAX_CONTAINER_REM,
  masonryRhoInterval,
  placeMasonry,
  type MasonryBand,
  type MasonryBandPlacement,
  type MasonryItemInput,
} from "@/lib/gallery-masonry";

/** Deterministic, so a failure names a reproducible sequence. */
function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Landscape, portrait, square, and two extremes a real archive holds. */
const DIMENSIONS = [
  [1536, 1024],
  [1024, 1536],
  [1254, 1254],
  [3000, 1000],
  [900, 2000],
] as const;

function sequence(seed: number, length: number, captionRem: number): MasonryItemInput[] {
  const next = randomSource(seed);
  return Array.from({ length }, () => {
    const [width, height] = DIMENSIONS[Math.floor(next() * DIMENSIONS.length)];
    return { width, height, captionRem: captionRem > 0 && next() < 0.8 ? captionRem : 0 };
  });
}

type RenderedBox = { column: number; top: number; bottom: number };

/** Lays a placement out in CSS pixels, exactly as the stylesheet computes it. */
function render(
  placement: MasonryBandPlacement,
  items: readonly MasonryItemInput[],
  remPx: number,
  rho: number,
): RenderedBox[] {
  const columnPx = remPx / rho;
  return placement.items.map((item, index) => {
    const top = item.top.a * columnPx + item.top.b * remPx;
    const source = items[index];
    const height = (source.height / source.width) * columnPx + source.captionRem * remPx;
    return { column: item.column, top, bottom: top + height };
  });
}

function sampledRhos(band: MasonryBand): number[] {
  const [low, high] = masonryRhoInterval(band);
  return Array.from({ length: 11 }, (_unused, step) => low + ((high - low) * step) / 10);
}

describe("masonry bands", () => {
  it("match the stylesheet's container thresholds and maximum width", () => {
    const css = readFileSync("src/components/gallery-masonry.css", "utf8");
    for (const band of MASONRY_BANDS) {
      expect(css).toContain(`@container (min-width: ${band.minContainerRem}rem)`);
    }
    expect(css).toContain(`max-inline-size: ${MASONRY_MAX_CONTAINER_REM}rem`);
    expect(readFileSync("src/components/gallery-figure.css", "utf8")).toContain(`height: ${MASONRY_CAPTION_BELOW_REM}rem`);
    // Each band ends where the next begins, and the last at the container's cap.
    expect(MASONRY_BANDS[0].maxContainerRem).toBe(MASONRY_BANDS[1].minContainerRem);
    expect(MASONRY_BANDS.at(-1)!.maxContainerRem).toBe(MASONRY_MAX_CONTAINER_REM);
  });

  it("bound rem-per-column-width from the container widths alone", () => {
    const [low, high] = masonryRhoInterval(MASONRY_BANDS[1]);
    expect(low).toBeCloseTo(3 / (69 - 2 * MASONRY_GAP_REM), 12);
    expect(high).toBeCloseTo(3 / (56 - 2 * MASONRY_GAP_REM), 12);
  });
});

describe("placeMasonry", () => {
  const cases = MASONRY_BANDS.flatMap((band) =>
    [0, MASONRY_CAPTION_BELOW_REM].map((captionRem) => ({ band, captionRem })),
  );

  it.each(cases)(
    "obeys the progression rule at every width a $band.columns-column band renders (caption $captionRem rem)",
    ({ band, captionRem }) => {
      const failures: string[] = [];
      for (let seed = 1; seed <= 12; seed += 1) {
        const items = sequence(seed, 400, captionRem);
        const placement = placeMasonry(items, band);
        // Root sizes from a small user setting to a large one: the proof must not
        // depend on the default 16px.
        for (const remPx of [10, 16, 24]) {
          for (const rho of sampledRhos(band)) {
            const boxes = render(placement, items, remPx, rho);
            for (let index = 1; index < boxes.length; index += 1) {
              const delta = boxes[index].top - boxes[index - 1].top;
              const readsNext =
                delta > 1 ||
                (Math.abs(delta) <= 1 && boxes[index].column > boxes[index - 1].column);
              if (!readsNext) {
                failures.push(`seed ${seed} rem ${remPx} rho ${rho} item ${index}`);
              }
            }
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each(cases)(
    "never overlaps two items in one column ($band.columns columns, caption $captionRem rem)",
    ({ band, captionRem }) => {
      const items = sequence(7, 400, captionRem);
      const placement = placeMasonry(items, band);
      for (const rho of sampledRhos(band)) {
        const boxes = render(placement, items, 16, rho);
        const lastBottom = new Map<number, number>();
        for (const box of boxes) {
          const previous = lastBottom.get(box.column);
          if (previous !== undefined) {
            expect(box.top).toBeGreaterThanOrEqual(previous + MASONRY_GAP_REM * 16 - 1e-6);
          }
          lastBottom.set(box.column, box.bottom);
        }
      }
    },
  );

  it("never moves an item already placed when more are appended", () => {
    for (const band of MASONRY_BANDS) {
      const items = sequence(3, 120, MASONRY_CAPTION_BELOW_REM);
      const whole = placeMasonry(items, band);
      for (const prefix of [1, 24, 48, 100]) {
        expect(placeMasonry(items.slice(0, prefix), band).items).toEqual(
          whole.items.slice(0, prefix),
        );
      }
    }
  });

  it("resumes from a prior placement with exactly the result a full recomputation gives", () => {
    for (const band of MASONRY_BANDS) {
      const items = sequence(9, 120, MASONRY_CAPTION_BELOW_REM);
      const whole = placeMasonry(items, band);
      for (const split of [0, 1, 24, 48, 100, 119, 120]) {
        const partial = placeMasonry(items.slice(0, split), band);
        const resumed = placeMasonry(items, band, partial);
        expect(resumed).toEqual(whole);
      }
    }
  });

  it("refuses to resume a placement for a different column count or a longer list", () => {
    const items = sequence(4, 10, 0);
    const twoColumn = placeMasonry(items, MASONRY_BANDS[0]);
    expect(() => placeMasonry(items, MASONRY_BANDS[1], twoColumn)).toThrow(RangeError);
    const whole = placeMasonry(items, MASONRY_BANDS[0]);
    expect(() => placeMasonry(items.slice(0, 5), MASONRY_BANDS[0], whole)).toThrow(RangeError);
  });

  it("keeps every column in use, even after a sequence that strands one under plain refusal", () => {
    // A column whose start the progression rule would refuse must not be given up
    // for good: this opening made the right column permanently unusable when
    // infeasible columns were simply skipped.
    const opening: MasonryItemInput[] = [
      { width: 1536, height: 1024, captionRem: MASONRY_CAPTION_BELOW_REM },
      { width: 1254, height: 1254, captionRem: 0 },
      { width: 1536, height: 1024, captionRem: MASONRY_CAPTION_BELOW_REM },
      { width: 1024, height: 1536, captionRem: 0 },
      { width: 1536, height: 1024, captionRem: 0 },
    ];
    const items = [...opening, ...sequence(11, 60, 0)];
    for (const band of MASONRY_BANDS) {
      const counts = Array.from({ length: band.columns }, () => 0);
      for (const item of placeMasonry(items, band).items.slice(opening.length)) {
        counts[item.column] += 1;
      }
      const fairShare = (items.length - opening.length) / band.columns;
      for (const count of counts) expect(count).toBeGreaterThan(fairShare * 0.6);
    }
  });

  it("packs within a few percent of unconstrained shortest-column placement", () => {
    for (const band of MASONRY_BANDS) {
      for (const captionRem of [0, MASONRY_CAPTION_BELOW_REM]) {
        const items = sequence(5, 400, captionRem);
        const [low, high] = masonryRhoInterval(band);
        const rho = (low + high) / 2;
        const tallest = (placement: MasonryBandPlacement) =>
          Math.max(...placement.columnBottoms.map((bottom) => bottom.a + rho * bottom.b));

        // Plain shortest-column placement at this one width, for comparison.
        const columns = Array.from({ length: band.columns }, () => 0);
        for (const item of items) {
          const shortest = columns.indexOf(Math.min(...columns));
          columns[shortest] +=
            item.height / item.width + rho * (item.captionRem + MASONRY_GAP_REM);
        }

        expect(tallest(placeMasonry(items, band))).toBeLessThan(Math.max(...columns) * 1.05);
      }
    }
  });

  it("refuses an item without real dimensions rather than guessing its shape", () => {
    expect(() =>
      placeMasonry([{ width: 0, height: 100, captionRem: 0 }], MASONRY_BANDS[0]),
    ).toThrow(RangeError);
  });
});
