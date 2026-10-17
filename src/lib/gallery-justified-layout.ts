import {
  groupJustifiedRows,
  JUSTIFIED_BANDS,
  JUSTIFIED_MAX_HEIGHT_REM,
  JUSTIFIED_TAIL_HEIGHT_REM,
  type JustifiedRow,
} from "@/lib/gallery-justified";
import { formatMasonryCoefficient as coefficient } from "@/lib/gallery-masonry";

/** Only rendition geometry is needed; body images need no curated identity. */
export type JustifiedLayoutItem = {
  readonly media: { readonly rendition: { readonly width: number; readonly height: number } };
};

export type JustifiedLayout = {
  readonly styles: readonly Record<string, string>[];
  readonly rowsByBand: readonly (readonly JustifiedRow[])[];
};

/** Inline sets may fit a bounded row without altering the curated defaults. */
type JustifiedLayoutOptions = {
  readonly rowsByBand: readonly (readonly JustifiedRow[])[];
  readonly boundToIntrinsicSize: true;
  readonly fullRowSingletons: true;
};

/**
 * Groups every band's rows and builds the per-item CSS custom properties
 * `gallery-justified.css` reads from them.
 *
 * `resumeFrom`, when given, must be a previous call's own `rowsByBand` and
 * `styles` for a prefix of `items`: a row already closed keeps the style it
 * was given (a closed row's boundary and height never change once resumed —
 * `groupJustifiedRows` guarantees this), so only a row that is new or was
 * still open is (re)written, and only the per-item fallback width is added
 * for newly arrived items.
 */
export function computeJustifiedLayout(
  items: readonly JustifiedLayoutItem[],
  resumeFrom?: JustifiedLayout,
  options?: JustifiedLayoutOptions,
): JustifiedLayout {
  const ratios = items.map(({ media }) => media.rendition.width / media.rendition.height);

  const styles: Record<string, string>[] = resumeFrom
    ? resumeFrom.styles.map((style) => ({ ...style }))
    : [];
  for (let index = styles.length; index < ratios.length; index += 1) {
    styles.push({
      "--j-single-width": options?.fullRowSingletons ? "100cqi"
        : `min(100cqi, ${coefficient(ratios[index] * JUSTIFIED_TAIL_HEIGHT_REM)}rem)`,
      ...(options === undefined ? {} : {
        "--j-single-image-width": `min(100cqi, ${coefficient(ratios[index] * JUSTIFIED_TAIL_HEIGHT_REM)}rem, ${items[index].media.rendition.width}px)`,
      }),
    });
  }

  const rowsByBand = options?.rowsByBand ?? JUSTIFIED_BANDS.map((band, bandIndex) =>
    groupJustifiedRows(ratios, band.maxContainerRem, resumeFrom?.rowsByBand[bandIndex]),
  );

  JUSTIFIED_BANDS.forEach((_band, bandIndex) => {
    const rows = rowsByBand[bandIndex];
    const priorRows = resumeFrom?.rowsByBand[bandIndex] ?? [];
    // A row already closed keeps the style it was given: nothing about it can
    // change once resumed. Only the row that was still open (if any), plus
    // every row after it, needs (re)writing.
    const firstOpenRow = priorRows.findIndex((row) => !row.closed);
    const startRow = firstOpenRow === -1 ? priorRows.length : firstOpenRow;
    const prefix = `--j${bandIndex + 2}`;

    for (let rowIndex = startRow; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const cap = row.closed && row.count > 1 ? JUSTIFIED_MAX_HEIGHT_REM : JUSTIFIED_TAIL_HEIGHT_REM;
      const gap = `min(1rem, calc(100cqi / ${2 * row.count}))`;
      const intrinsicCap = options?.boundToIntrinsicSize
        ? `${Math.min(...items.slice(row.start, row.start + row.count).map(({ media }) => media.rendition.height))}px, `
        : "";
      const height = `min(${cap}rem, ${intrinsicCap}calc((100cqi - ${row.count - 1} * ${gap}) / ${coefficient(row.ratio)}))`;
      let leftRatio = 0;
      for (let i = row.start; i < row.start + row.count; i += 1) {
        styles[i][`${prefix}-row`] = String(rowIndex + 1);
        styles[i][`${prefix}-width`] = `calc(${coefficient(ratios[i])} * ${height})`;
        styles[i][`${prefix}-left`] = `calc(${coefficient(leftRatio)} * ${height} + ${i - row.start} * ${gap})`;
        if (options?.fullRowSingletons) {
          styles[i][`${prefix}-image-width`] = row.count === 1
            ? `min(100cqi, ${coefficient(ratios[i] * JUSTIFIED_TAIL_HEIGHT_REM)}rem, ${items[i].media.rendition.width}px)`
            : "100%";
          if (row.count === 1) {
            styles[i][`${prefix}-width`] = "100cqi";
            styles[i][`${prefix}-left`] = "0px";
          }
        }
        leftRatio += ratios[i];
      }
    }
  });

  return { styles, rowsByBand };
}

