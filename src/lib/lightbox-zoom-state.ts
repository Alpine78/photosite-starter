/**
 * Whether the lightbox is currently magnified past the level it opened at.
 *
 * Both the caption presentation and the zoom control's pressed state are driven
 * from this one predicate, so it lives here — browser-free and testable —
 * rather than inline in the client wrapper, the same way `buildLightboxCaption`
 * and `getLightboxZoomCap` already do.
 *
 * "Opened at" is PhotoSwipe's `zoomLevels.initial`, not `fit`: the two differ
 * only for a source narrower than its slot, and a visitor who has not zoomed is
 * looking at `initial` whichever one that is. The comparison is strict, so a
 * slide whose capped levels are all equal (ADR-0005: an already-large image
 * whose `initial === secondary === max`, where the zoom toggle is a no-op)
 * never reports as zoomed and never hides its caption.
 *
 * Fails closed to "not zoomed" for a non-finite level: an unknown magnification
 * is not evidence of one, and leaving the caption visible is the safe default.
 */
export function isLightboxZoomed(
  currentZoomLevel: number,
  initialZoomLevel: number,
): boolean {
  if (!Number.isFinite(currentZoomLevel) || !Number.isFinite(initialZoomLevel)) {
    return false;
  }

  return currentZoomLevel > initialZoomLevel;
}
