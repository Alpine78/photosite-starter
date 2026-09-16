/**
 * Greedy, prefix-stable rows. Each container band groups at its widest width:
 * close a row as soon as its images at 16rem high would fill that width.
 * The browser scales the whole row together to its actual width. Closed rows
 * never change on append; only the unclosed tail can acquire more photographs.
 *
 * Below 34rem each row holds one image. A singleton or unclosed row is capped
 * at 12rem, never stretched to fill. Multi-image closed rows are <=16rem.
 * There is no unconditional positive minimum: fitting an arbitrarily wide
 * panorama without cropping requires a height of containerWidth / aspectRatio.
 * Every row's minimum is therefore its fit height at the band's narrow edge,
 * capped by the same 12/16rem maximum. No image is cropped or distorted.
 */
export const JUSTIFIED_MAX_HEIGHT_REM = 16;
export const JUSTIFIED_TAIL_HEIGHT_REM = 12;
export const JUSTIFIED_GAP_REM = 1;
export const JUSTIFIED_BANDS = [
  { minContainerRem: 34, maxContainerRem: 56 },
  { minContainerRem: 56, maxContainerRem: 69 },
] as const;

export type JustifiedRow = {
  readonly start: number;
  readonly count: number;
  readonly ratio: number;
  readonly closed: boolean;
};

/**
 * Groups image ratios into rows for one container band, in result order.
 *
 * Pass a previous call's own result as `resume` to regroup only from its
 * first still-open row: a closed row's boundary never changes no matter what
 * comes after it (the algorithm never looks ahead), so every closed row in
 * `resume` is kept as-is and only the unclosed tail — which may still
 * acquire more photographs — is recomputed together with whatever is new in
 * `ratios`. `resume` must be a grouping this function itself produced over a
 * prefix of `ratios` for the same `maxContainerRem`.
 */
export function groupJustifiedRows(
  ratios: readonly number[],
  maxContainerRem: number,
  resume?: readonly JustifiedRow[],
): JustifiedRow[] {
  const closedResume = resume?.filter((row) => row.closed) ?? [];
  const consumed = closedResume.length === 0 ? 0 : closedResume.at(-1)!.start + closedResume.at(-1)!.count;
  if (consumed > ratios.length) {
    throw new RangeError("Cannot resume justified rows from a state longer than the given ratios.");
  }

  const rows: JustifiedRow[] = [...closedResume];
  let start = consumed;
  let ratio = 0;
  for (let index = consumed; index < ratios.length; index += 1) {
    if (!(ratios[index] > 0) || !Number.isFinite(ratios[index])) {
      throw new RangeError("A justified item needs a finite, positive aspect ratio.");
    }
    ratio += ratios[index];
    const count = index - start + 1;
    if (ratio * JUSTIFIED_MAX_HEIGHT_REM + (count - 1) * Math.min(JUSTIFIED_GAP_REM, maxContainerRem / (2 * count)) >= maxContainerRem) {
      rows.push({ start, count, ratio, closed: true });
      start = index + 1;
      ratio = 0;
    }
  }
  if (start < ratios.length) rows.push({ start, count: ratios.length - start, ratio, closed: false });
  return rows;
}
