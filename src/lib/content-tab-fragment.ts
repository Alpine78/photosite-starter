/** Only the one layout change caused by progressive tab enhancement is eligible. */
export function fragmentIntersectsViewport(top: number, bottom: number, viewportHeight: number): boolean {
  return [top, bottom, viewportHeight].every(Number.isFinite) &&
    viewportHeight > 0 && bottom > top && bottom > 0 && top < viewportHeight;
}

/** Negative scroll preserves a heading displaced upward, bounded by this group's shrink. */
export function tabFragmentScrollCorrection(
  beforeTop: number,
  afterTop: number,
  beforeHeight: number,
  afterHeight: number,
): number {
  if (![beforeTop, afterTop, beforeHeight, afterHeight].every(Number.isFinite) ||
      beforeHeight <= 0 || afterHeight <= 0) return 0;
  const displacement = beforeTop - afterTop;
  const shrink = beforeHeight - afterHeight;
  if (displacement < 1 || shrink < 1) return 0;
  return -Math.min(displacement, shrink);
}
