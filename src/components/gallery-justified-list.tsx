import { useState, type CSSProperties } from "react";
import { GalleryFigure } from "@/components/gallery-figure";
import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  groupJustifiedRows,
  JUSTIFIED_BANDS,
  JUSTIFIED_MAX_HEIGHT_REM,
  JUSTIFIED_TAIL_HEIGHT_REM,
  type JustifiedRow,
} from "@/lib/gallery-justified";
import type { GalleryCaptionPlacement } from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";
import { formatMasonryCoefficient as coefficient } from "@/lib/gallery-masonry";
import { imageRenderProfiles } from "@/lib/image-delivery";
import "@/components/gallery-justified.css";

type JustifiedLayout = {
  readonly styles: readonly Record<string, string>[];
  readonly rowsByBand: readonly (readonly JustifiedRow[])[];
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
function computeJustifiedLayout(
  items: GallerySlice["items"],
  resumeFrom?: JustifiedLayout,
): JustifiedLayout {
  const ratios = items.map(({ media }) => media.rendition.width / media.rendition.height);

  const styles: Record<string, string>[] = resumeFrom
    ? resumeFrom.styles.map((style) => ({ ...style }))
    : [];
  for (let index = styles.length; index < ratios.length; index += 1) {
    styles.push({
      "--j-single-width": `min(100cqi, ${coefficient(ratios[index] * JUSTIFIED_TAIL_HEIGHT_REM)}rem)`,
    });
  }

  const rowsByBand = JUSTIFIED_BANDS.map((band, bandIndex) =>
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
      const height = `min(${cap}rem, calc((100cqi - ${row.count - 1} * ${gap}) / ${coefficient(row.ratio)}))`;
      let leftRatio = 0;
      for (let i = row.start; i < row.start + row.count; i += 1) {
        styles[i][`${prefix}-row`] = String(rowIndex + 1);
        styles[i][`${prefix}-width`] = `calc(${coefficient(ratios[i])} * ${height})`;
        styles[i][`${prefix}-left`] = `calc(${coefficient(leftRatio)} * ${height} + ${i - row.start} * ${gap})`;
        leftRatio += ratios[i];
      }
    }
  });

  return { styles, rowsByBand };
}

/**
 * A flat semantic list. Each row's items share one CSS grid track, with widths
 * and offsets proportional to their real ratios. Track height is intrinsic, so
 * even unbounded below captions need no measurement or hydration correction.
 *
 * An append resumes each band's own prior row grouping instead of regrouping
 * every image from scratch — see `computeJustifiedLayout`'s own comment and
 * `docs/gallery-presentation.md`. The prior layout is kept in state rather
 * than a ref and derived directly during render, matching
 * `GalleryMasonryList`'s identical pattern (React's documented "storing
 * information from previous renders": a ref must not be read while
 * rendering, and this component needs exactly that value to decide whether
 * to resume).
 */
export function GalleryJustifiedList({ label, items, captionPlacement, labels }: {
  label: string;
  items: GallerySlice["items"];
  captionPlacement: GalleryCaptionPlacement;
  labels: BuiltInLabels;
}) {
  const [cache, setCache] = useState<{
    items: GallerySlice["items"];
    layout: JustifiedLayout;
  } | null>(null);

  const isCurrent = cache !== null && cache.items === items;
  const layout = isCurrent
    ? cache.layout
    : computeJustifiedLayout(
        items,
        cache !== null && cache.layout.styles.length <= items.length ? cache.layout : undefined,
      );
  if (!isCurrent) {
    setCache({ items, layout });
  }

  return <div className="gallery-justified">
    <ul aria-label={label} className="gallery-justified__list">
      {items.map((item, index) => <li key={item.itemId} className="gallery-justified__item"
        style={layout.styles[index] as CSSProperties}>
        <GalleryFigure item={item} index={index} captionPlacement={captionPlacement}
          sizes={imageRenderProfiles.galleryJustified.sizes} labels={labels} />
      </li>)}
    </ul>
  </div>;
}
