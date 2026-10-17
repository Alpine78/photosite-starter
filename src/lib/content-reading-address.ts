/** Geometry only: existing authored heading ids are never generated here. */
export type ReadingHeading = {
  readonly id: string;
  readonly top: number;
  readonly height: number;
  /** Effective native alignment: root scroll padding plus this target’s scroll margin. */
  readonly margin: number;
};

export type ReadingChapter =
  | { readonly kind: "heading"; readonly id: string }
  | { readonly kind: "intro" | "outside" | "invalid" };

/** Native fragment scrolling can settle a fraction of a CSS pixel off its margin. */
const EDGE_TOLERANCE = 1;

export function currentReadingChapter(
  headings: readonly ReadingHeading[],
  body: { readonly top: number; readonly bottom: number },
): ReadingChapter {
  if (!headings.length || !Number.isFinite(body.top) ||
      !Number.isFinite(body.bottom) || body.bottom <= body.top) {
    return { kind: "invalid" };
  }
  let previous = -Infinity;
  for (const heading of headings) {
    if (!heading.id || !Number.isFinite(heading.top) ||
        !Number.isFinite(heading.height) || heading.height <= 0 ||
        !Number.isFinite(heading.margin) || heading.margin < 0 ||
        heading.top < previous || heading.top < body.top - EDGE_TOLERANCE ||
        heading.top + heading.height > body.bottom + EDGE_TOLERANCE) {
      return { kind: "invalid" };
    }
    previous = heading.top;
  }
  // After the narrative, leave gallery/grid/footer fragment navigation alone.
  if (body.bottom <= headings[0].margin) return { kind: "outside" };
  let id: string | undefined;
  for (const heading of headings) {
    if (heading.top <= heading.margin + EDGE_TOLERANCE) id = heading.id;
  }
  return id === undefined ? { kind: "intro" } : { kind: "heading", id };
}
