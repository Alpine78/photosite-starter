import {
  groupJustifiedRows,
  JUSTIFIED_BANDS,
  JUSTIFIED_GAP_REM,
  JUSTIFIED_MAX_HEIGHT_REM,
  JUSTIFIED_TAIL_HEIGHT_REM,
  type JustifiedRow,
} from "@/lib/gallery-justified";
import {
  computeJustifiedLayout,
  type JustifiedLayoutItem,
} from "@/lib/gallery-justified-layout";

/** An explicit tested root-font bound, not an assumption about browser defaults. */
export const MINI_JUSTIFIED_ROOT_CEILING_PX = 32;
/** Full captions and keyboard triggers must not be squeezed into image slivers. */
export const MINI_JUSTIFIED_MIN_CELL_REM = 3;

/** Reuse curated row grouping over runs separated by small native renditions. */
function rowsForBand(
  items: readonly JustifiedLayoutItem[],
  band: (typeof JUSTIFIED_BANDS)[number],
): JustifiedRow[] {
  const ratios = items.map(({ media }) => media.rendition.width / media.rendition.height);
  const rows: JustifiedRow[] = [];
  let runStart = 0;
  const flush = (end: number) => {
    for (const row of groupJustifiedRows(ratios.slice(runStart, end), band.maxContainerRem)) {
      rows.push({ ...row, start: row.start + runStart });
    }
  };
  items.forEach(({ media }, index) => {
    // Otherwise a 1px-high panorama could cap every normal image in its row.
    if (media.rendition.height >= JUSTIFIED_MAX_HEIGHT_REM * MINI_JUSTIFIED_ROOT_CEILING_PX) return;
    flush(index);
    rows.push({ start: index, count: 1, ratio: ratios[index], closed: true });
    runStart = index + 1;
  });
  flush(items.length);

  return rows.flatMap((row) => {
    if (row.count === 1) return [row];
    const gap = Math.min(JUSTIFIED_GAP_REM, band.minContainerRem / (2 * row.count));
    const height = Math.min(row.closed ? JUSTIFIED_MAX_HEIGHT_REM : JUSTIFIED_TAIL_HEIGHT_REM,
      (band.minContainerRem - (row.count - 1) * gap) / row.ratio);
    const indices = Array.from({ length: row.count }, (_, index) => row.start + index);
    return indices.some((index) => ratios[index] * height < MINI_JUSTIFIED_MIN_CELL_REM)
      ? indices.map((index) => ({ start: index, count: 1, ratio: ratios[index], closed: true }))
      : [row];
  });
}

/** Small sets render whole, with one DOM occurrence per image at every band. */
export function miniGalleryJustifiedLayout(items: readonly JustifiedLayoutItem[]) {
  return computeJustifiedLayout(items, undefined, {
    rowsByBand: JUSTIFIED_BANDS.map((band) => rowsForBand(items, band)),
    boundToIntrinsicSize: true,
    fullRowSingletons: true,
  });
}
