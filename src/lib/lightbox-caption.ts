/**
 * What the lightbox says about the photograph it is showing.
 *
 * Both values arrive already resolved: a curated item carries its placement's
 * caption override, and credit is media-owned in every context it appears in
 * (ADR-0002). The viewer is not a second source of truth about either — it
 * decides only which parts are presentable and in which order, which is why
 * that rule lives here, browser-free and testable, instead of inside the
 * client wrapper that renders it.
 */

export type LightboxCaptionSource = {
  readonly caption?: string;
  readonly credit?: string;
};

export type LightboxCaptionPart = {
  /** Which metadata the line carries; the viewer presents the two differently. */
  readonly kind: "caption" | "credit";
  readonly text: string;
};

/**
 * The presentable lines for one slide, caption first — empty when the item has
 * nothing to say.
 *
 * Blank text counts as nothing. A caption of spaces, or an empty credit string
 * left behind by an import, would otherwise open a strip across the photograph
 * that describes none of it, and hand assistive technology a description with
 * no content in it.
 */
export function buildLightboxCaption(
  source: LightboxCaptionSource,
): readonly LightboxCaptionPart[] {
  return [
    presentablePart("caption", source.caption),
    presentablePart("credit", source.credit),
  ].filter((part) => part !== null);
}

function presentablePart(
  kind: LightboxCaptionPart["kind"],
  value: string | undefined,
): LightboxCaptionPart | null {
  const text = value?.trim() ?? "";

  return text.length === 0 ? null : { kind, text };
}
