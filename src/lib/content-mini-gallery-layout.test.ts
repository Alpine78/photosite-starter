import { describe, expect, it } from "vitest";
import { miniGalleryJustifiedLayout, MINI_JUSTIFIED_MIN_CELL_REM } from "./content-mini-gallery-layout";
import { computeJustifiedLayout } from "./gallery-justified-layout";
import { JUSTIFIED_BANDS } from "./gallery-justified";

const image = (width: number, height: number) => ({ media: { rendition: { width, height } } });

describe("bounded inline justified fitting", () => {
  it("isolates tiny renditions without collapsing their normal neighbours", () => {
    const items = [image(1536, 1024), image(2048, 1), image(1, 2048),
      image(32, 24), image(1024, 1536), image(1536, 1024), image(1254, 1254)];
    const result = miniGalleryJustifiedLayout(items);
    for (const rows of result.rowsByBand) {
      expect(rows.flatMap(row => Array.from({ length: row.count }, (_, i) => row.start + i)))
        .toEqual(items.map((_, i) => i));
      for (const index of [1, 2, 3]) expect(rows.find(row => row.start <= index && row.start + row.count > index)?.count).toBe(1);
      expect(rows.some(row => row.count > 1)).toBe(true);
    }
  });

  it("preserves a legible width across each band's full range for non-singleton rows", () => {
    // Both extremes occur mid-set, so neither can pass merely as a final tail.
    const items = [image(1024, 1536), image(256, 2048), image(2048, 1024),
      image(1536, 1024), image(2048, 512), image(1254, 1254)];
    const result = miniGalleryJustifiedLayout(items);
    result.rowsByBand.forEach((rows, bandIndex) => {
      for (const row of rows.filter(row => row.count > 1)) {
        for (const width of [JUSTIFIED_BANDS[bandIndex].minContainerRem, JUSTIFIED_BANDS[bandIndex].maxContainerRem]) {
          const height = Math.min(row.closed ? 16 : 12, (width - (row.count - 1)) / row.ratio);
          for (const item of items.slice(row.start, row.start + row.count)) {
            expect(height * item.media.rendition.width / item.media.rendition.height)
              .toBeGreaterThanOrEqual(MINI_JUSTIFIED_MIN_CELL_REM);
          }
        }
      }
    });
  });
});

it("keeps the curated style compositor's closed-row output stable when resumed", () => {
  const items = Array.from({ length: 80 }, (_, i) => image([1536, 1024, 1254][i % 3], [1024, 1536, 1254][i % 3]));
  const prefix = computeJustifiedLayout(items.slice(0, 24));
  const resumed = computeJustifiedLayout(items, prefix);
  expect(resumed).toEqual(computeJustifiedLayout(items));
  prefix.rowsByBand.forEach((rows, bandIndex) => {
    for (const row of rows.filter(row => row.closed)) {
      for (let i = row.start; i < row.start + row.count; i++) {
        for (const suffix of ["row", "width", "left"]) {
          const key = `--j${bandIndex + 2}-${suffix}`;
          expect(resumed.styles[i][key]).toBe(prefix.styles[i][key]);
        }
      }
    }
  });
});
