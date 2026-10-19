import { currentReadingChapter, type ReadingChapter } from "@/lib/content-reading-address";

/**
 * Measures the current chapter the same way native fragment alignment places
 * a heading: root scroll padding plus that heading's own scroll margin. Shared
 * by the reading-address observer and the visible contents state so the list
 * never marks a different chapter than the one that would be saved.
 * Call only in browser effects or handlers.
 */
export function measureReadingChapter(body: Element, headings: readonly HTMLElement[]): ReadingChapter {
  const rootPadding = window.getComputedStyle(document.documentElement).scrollPaddingTop;
  const padding = rootPadding === "auto" ? 0 : Number.parseFloat(rootPadding);
  return currentReadingChapter(headings.map((heading) => {
    const bounds = heading.getBoundingClientRect();
    return { id: heading.id, top: bounds.top, height: bounds.height,
      margin: padding + Number.parseFloat(window.getComputedStyle(heading).scrollMarginTop) };
  }), body.getBoundingClientRect());
}

/** Whole-percent progress through the body: 0 before it starts, 100 once its end is visible. */
export function readingProgress(body: { readonly top: number; readonly height: number }, viewport: number): number {
  if (!Number.isFinite(body.top) || !Number.isFinite(body.height) || body.height <= 0 || viewport <= 0) return 0;
  const travel = body.height - viewport;
  if (travel <= 0) return body.top + body.height <= viewport ? 100 : 0;
  return Math.round(Math.min(1, Math.max(0, -body.top / travel)) * 100);
}
