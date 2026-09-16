/**
 * Order-preserving masonry placement (AB#157).
 *
 * A masonry has no rows, so "row-major" does not define an order in it. This
 * module defines one precisely and places items so the layout obeys it:
 *
 * > **Progression rule.** Masonry items read by their top edge, top to bottom.
 * > Items whose top edges are within one CSS pixel of each other read left to
 * > right. Wherever an item sits in a column *left of* (or in the same column
 * > as) the item before it, it starts at least `MASONRY_ORDER_SEPARATION_REM`
 * > lower, so no rounding can make it read first.
 *
 * DOM order, keyboard order, and the lightbox sequence are the result order, so
 * a layout obeying the rule reads in exactly the order they count.
 *
 * ## Placing without knowing the viewport
 *
 * The server renders the first slice without knowing how wide the page is. It
 * does not need to: every length here is either a multiple of the column width
 * `w` (an image's height is `w / ratio`) or a multiple of `rem` (the gap and a
 * reserved caption box). So a top edge is `a·w + b·rem`, and dividing by `w`
 * gives `a + ρ·b` with `ρ = rem / w` — **linear in ρ**.
 *
 * Each column count is only used inside a container-width band expressed in
 * `rem` (`MASONRY_BANDS`), and the masonry container's own maximum width is
 * `rem` too, so each band bounds ρ to a closed interval that holds whatever the
 * visitor's root font size is. A linear inequality that holds at both ends of an
 * interval holds everywhere inside it, so checking the progression rule at the
 * two endpoints proves it for every container width that band can render.
 *
 * ## Why an item may start below its column's bottom
 *
 * Plain shortest-column placement obeys the rule at one width, not across an
 * interval. Merely *refusing* columns that would break it is worse: a refused
 * column's bottom stops growing while later top edges keep rising, so it can
 * never be chosen again and the masonry collapses into fewer columns. Instead,
 * a candidate column's start is raised to the smallest *linear* position that
 * is at or above both its bottom and the rule's floor at both interval ends —
 * the chord through the pointwise maximum, which lies above that (convex)
 * maximum everywhere between. Every column therefore stays available, at the
 * cost of a little whitespace where the band's width range made a column's
 * relative height ambiguous.
 *
 * Placement depends only on the items before it, so appending never moves an
 * item already placed: at a fixed container width, earlier photographs keep
 * their position and size.
 */

/** The gap between items, horizontally and vertically. */
export const MASONRY_GAP_REM = 1;

/**
 * Height reserved under a photograph for a below-placement caption: two lines of
 * `line-height: 1.25rem` plus `0.5rem` of padding above and below. The CSS box
 * (`gallery-figure.css`) is exactly this tall whatever the caption says, because
 * the placement arithmetic assumes it is.
 */
export const MASONRY_CAPTION_BELOW_REM = 3.5;

/**
 * Minimum vertical separation between an item and the one before it when it
 * does not sit to that item's right. Four CSS pixels at the default root size:
 * well clear of the one-pixel tie tolerance and sub-pixel layout rounding.
 */
export const MASONRY_ORDER_SEPARATION_REM = 0.25;

/** The widest the masonry container renders. Enforced by its own CSS. */
export const MASONRY_MAX_CONTAINER_REM = 69;

export type MasonryColumnCount = 2 | 3;

export type MasonryBand = {
  readonly columns: MasonryColumnCount;
  /** Container width from which this column count applies (inclusive). */
  readonly minContainerRem: number;
  /** Widest container this column count is used at. */
  readonly maxContainerRem: number;
};

/**
 * Column counts by container width. Below the first band the masonry is a
 * single column in plain document flow, where order needs no placement at all.
 * The CSS container queries in `gallery-masonry.css` must use these exact
 * thresholds; `gallery-masonry.test.ts` pins them against the stylesheet.
 */
export const MASONRY_BANDS: readonly MasonryBand[] = [
  { columns: 2, minContainerRem: 34, maxContainerRem: 56 },
  { columns: 3, minContainerRem: 56, maxContainerRem: MASONRY_MAX_CONTAINER_REM },
];

/** A length of `a` column widths plus `b` rem. */
export type MasonryLength = {
  readonly a: number;
  readonly b: number;
};

export type MasonryItemInput = {
  /** The rendition's true intrinsic width. */
  readonly width: number;
  /** The rendition's true intrinsic height. */
  readonly height: number;
  /** Reserved caption height under the image, in rem; 0 for none. */
  readonly captionRem: number;
};

export type MasonryItemPlacement = {
  readonly column: number;
  readonly top: MasonryLength;
};

export type MasonryBandPlacement = {
  readonly columns: MasonryColumnCount;
  readonly items: readonly MasonryItemPlacement[];
  /** Each column's bottom edge, trailing gap included. */
  readonly columnBottoms: readonly MasonryLength[];
};

/** The closed interval of `rem / columnWidth` a band can render at. */
export function masonryRhoInterval(band: MasonryBand): readonly [number, number] {
  const gaps = (band.columns - 1) * MASONRY_GAP_REM;
  const narrowest = (band.minContainerRem - gaps) / band.columns;
  const widest = (band.maxContainerRem - gaps) / band.columns;
  return [1 / widest, 1 / narrowest];
}

function valueAt(length: MasonryLength, rho: number): number {
  return length.a + rho * length.b;
}

/** The line through `max(first, second)` at both interval ends. */
function chordOfMaximum(
  first: MasonryLength,
  second: MasonryLength,
  rhoLow: number,
  rhoHigh: number,
): MasonryLength {
  const low = Math.max(valueAt(first, rhoLow), valueAt(second, rhoLow));
  const high = Math.max(valueAt(first, rhoHigh), valueAt(second, rhoHigh));
  const b = (high - low) / (rhoHigh - rhoLow);
  return { a: low - b * rhoLow, b };
}

/**
 * Whether `length` names a page position no lower than `boundary`, at both
 * interval ends. Named for the numeric comparison (`<=`), not for a "below"
 * reading a page-down-is-larger-y convention would invite: a *smaller* value
 * here is higher on the page, so "at or below the boundary" would mean the
 * opposite of what this returns.
 */
function startsNoLaterThan(
  length: MasonryLength,
  boundary: MasonryLength,
  rhoLow: number,
  rhoHigh: number,
): boolean {
  return (
    valueAt(length, rhoLow) <= valueAt(boundary, rhoLow) &&
    valueAt(length, rhoHigh) <= valueAt(boundary, rhoHigh)
  );
}

/** Where `column` could start the next item without breaking the rule. */
function candidateStart(
  bottom: MasonryLength,
  column: number,
  previous: MasonryItemPlacement | undefined,
  rhoLow: number,
  rhoHigh: number,
): MasonryLength {
  if (previous === undefined) return bottom;

  if (column > previous.column) {
    // To the right of the previous item an exact tie reads correctly, so a
    // column that has not yet reached the previous top edge starts level with
    // it — the same expression, so the two can never render apart.
    if (startsNoLaterThan(bottom, previous.top, rhoLow, rhoHigh)) return previous.top;
    return chordOfMaximum(bottom, previous.top, rhoLow, rhoHigh);
  }

  const floor = {
    a: previous.top.a,
    b: previous.top.b + MASONRY_ORDER_SEPARATION_REM,
  };
  return chordOfMaximum(bottom, floor, rhoLow, rhoHigh);
}

/**
 * Places items, in result order, for one column-count band.
 *
 * Each item goes to the column that would start it highest at the band's middle
 * rem/column-width ratio; ties go to the leftmost column.
 *
 * Pass a previous call's own result as `resume` to place only the items past
 * `resume.items.length` rather than recomputing the whole list: placement
 * depends only on the items before the one being placed, so a caller that
 * kept its last result can resume from it and get exactly the same output a
 * full recomputation would, in time proportional to what was appended rather
 * than to the whole list loaded so far. `resume` must be a placement this
 * function itself produced for the same `band` over a prefix of `items`.
 */
export function placeMasonry(
  items: readonly MasonryItemInput[],
  band: MasonryBand,
  resume?: MasonryBandPlacement,
): MasonryBandPlacement {
  if (resume !== undefined) {
    if (resume.columns !== band.columns) {
      throw new RangeError("A resumed masonry placement's column count must match this band.");
    }
    if (resume.items.length > items.length) {
      throw new RangeError("Cannot resume masonry placement from a longer list than given.");
    }
  }

  const [rhoLow, rhoHigh] = masonryRhoInterval(band);
  const rhoMiddle = (rhoLow + rhoHigh) / 2;
  const bottoms: MasonryLength[] =
    resume === undefined
      ? Array.from({ length: band.columns }, () => ({ a: 0, b: 0 }))
      : resume.columnBottoms.map((bottom) => ({ a: bottom.a, b: bottom.b }));
  const placements: MasonryItemPlacement[] = resume === undefined ? [] : [...resume.items];

  for (let index = placements.length; index < items.length; index += 1) {
    const item = items[index];
    if (
      !(item.width > 0) ||
      !(item.height > 0) ||
      !Number.isFinite(item.width) ||
      !Number.isFinite(item.height) ||
      !(item.captionRem >= 0) || !Number.isFinite(item.captionRem)
    ) {
      throw new RangeError("A masonry item needs positive, finite dimensions.");
    }

    const previous = placements.at(-1);
    let best: MasonryItemPlacement | undefined;
    for (let column = 0; column < band.columns; column += 1) {
      const top = candidateStart(bottoms[column], column, previous, rhoLow, rhoHigh);
      if (best === undefined || valueAt(top, rhoMiddle) < valueAt(best.top, rhoMiddle)) {
        best = { column, top };
      }
    }

    // `best` is always set: a band has at least two columns.
    const chosen = best!;
    placements.push(chosen);
    bottoms[chosen.column] = {
      a: chosen.top.a + item.height / item.width,
      b: chosen.top.b + item.captionRem + MASONRY_GAP_REM,
    };
  }

  return { columns: band.columns, items: placements, columnBottoms: bottoms };
}

/** Rounds a coefficient for an inline style without changing ties. */
export function formatMasonryCoefficient(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
