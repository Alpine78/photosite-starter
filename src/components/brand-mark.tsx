import Image from "next/image";

import type { PublicImageRendition } from "@/lib/media";

/**
 * Where the mark appears, at the design proposal's scale: the header's 43px
 * (33px below `sm`) and the footer's 62px. The width cap keeps a wide wordmark
 * from crowding the row; a square mark never reaches it.
 */
const PLACEMENTS = {
  header: {
    maxHeightPx: 43,
    maxWidthPx: 160,
    className: "max-h-[33px] max-w-40 sm:max-h-[43px]",
  },
  footer: {
    maxHeightPx: 62,
    maxWidthPx: 192,
    className: "max-h-[62px] max-w-48",
  },
} as const;

export type BrandMarkPlacement = keyof typeof PLACEMENTS;

/**
 * The mark at its native ratio.
 *
 * Width and height both stay `auto`, each under its own maximum: CSS sizes a
 * replaced element with two auto dimensions and min/max constraints so that
 * its intrinsic ratio holds, so a square mark and a wide wordmark both fit
 * without being cropped or stretched. The true pixel dimensions on the
 * `<Image>` give it that ratio and reserve its space while it loads.
 *
 * `alt` is empty because the mark is decorative: the visible site name beside
 * it already names the brand, and a second name would only repeat it. `sizes`
 * is the exact rendered width the bounds produce, so the optimizer is asked for
 * nothing wider than the placement shows.
 */
function BrandMark({
  logo,
  placement,
  modeClass = "",
}: {
  logo: PublicImageRendition;
  placement: BrandMarkPlacement;
  modeClass?: string;
}) {
  const bounds = PLACEMENTS[placement];
  const renderedWidth = Math.ceil(
    Math.min(bounds.maxWidthPx, (bounds.maxHeightPx * logo.width) / logo.height),
  );
  const mobileWidth = Math.ceil(Math.min(bounds.maxWidthPx, (33 * logo.width) / logo.height));
  return (
    <Image
      src={logo.src}
      alt=""
      width={logo.width}
      height={logo.height}
      sizes={placement === "header"
        ? `(min-width: 40rem) ${renderedWidth}px, ${mobileWidth}px`
        : `${renderedWidth}px`}
      className={`h-auto w-auto shrink-0 ${bounds.className} ${modeClass}`}
    />
  );
}

/**
 * The mark, or the light/dark pair. The pair swaps through the
 * `light-mode-only` / `dark-mode-only` rules in `globals.css`, which follow the
 * same OS preference and pinned mode as the palette, so the right variant
 * shows before hydration and without JavaScript.
 */
export function BrandMarks({
  logo,
  logoDark,
  placement,
}: {
  logo: PublicImageRendition;
  logoDark?: PublicImageRendition;
  placement: BrandMarkPlacement;
}) {
  if (logoDark === undefined) return <BrandMark logo={logo} placement={placement} />;
  return (
    <>
      <BrandMark logo={logo} placement={placement} modeClass="light-mode-only" />
      <BrandMark logo={logoDark} placement={placement} modeClass="dark-mode-only" />
    </>
  );
}
