import Image from "next/image";
import Link from "next/link";
import type { ImageMedia } from "@/lib/media";
import { HERO_CHROME_RESERVE_PX, HERO_IMAGE_SIZES } from "@/lib/image-delivery";

export type HeroOverlayAction = {
  readonly label: string;
  readonly href: string;
};

export type HeroOverlayMeta = {
  /** ISO 8601 — the effective event date (AB#150, ADR-0017), never `publishedAt`. */
  readonly dateTime: string;
  /** Already formatted in the page's locale (`formatDate`). */
  readonly label: string;
};

type HeroOverlayProps = {
  media: ImageMedia;
  title: string;
  /**
   * Rendered above the title inside the overlay band: currently the page's
   * effective event date (AB#150, ADR-0017) — the in-flow `<time>` treatment
   * both content-page variants used to render in their own header, now moved
   * onto the hero. AB#151 (author byline) is expected to extend this same
   * meta line rather than add a second one.
   */
  meta?: HeroOverlayMeta;
  /** Rendered under the title inside the overlay band — a tagline (home) or a gallery's lead description (AB#149). Article heroes pass none, per that variant's own acceptance criteria. */
  description?: string;
  action?: HeroOverlayAction;
  /**
   * Overrides the title's own size classes. Home keeps its original, larger
   * scale (unchanged from before AB#149); a content-page hero (AB#149) passes
   * the same scale its non-hero title already used, so the type doesn't
   * change size just because a photograph moved behind it.
   */
  titleClassName?: string;
};

const DEFAULT_TITLE_CLASSNAME =
  "text-4xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-6xl lg:text-7xl";

/**
 * Shared full-bleed hero mechanism (ADR-0016, extracted for AB#149 per that
 * ADR's own action item): the photograph renders at its true native size,
 * uncapped and never cropped; the overlaid text sits in a band clamped to
 * `min(the image's own rendered height, the viewport height below the
 * header)` and anchored to the top of the hero rather than the image's
 * bottom edge, so the title always lands inside the visible viewport on
 * load regardless of how tall the photograph renders at a given width.
 *
 * One mechanism, three call sites (the home hero, and — via AB#149 — the
 * article and gallery content-page heroes): duplicating this markup a
 * second time is exactly what ADR-0016 asks not to do.
 */
export function HeroOverlay({
  media,
  title,
  meta,
  description,
  action,
  titleClassName = DEFAULT_TITLE_CLASSNAME,
}: HeroOverlayProps) {
  const { caption, credit } = media;

  return (
    <figure className="relative">
      <Image
        src={media.rendition.src}
        alt={media.alt}
        width={media.rendition.width}
        height={media.rendition.height}
        preload
        sizes={HERO_IMAGE_SIZES}
        className="h-auto w-full"
      />
      {/* Attribution, same rule `MediaFigure` enforces everywhere else an
          image is placed: a credit is someone else's name, and a surface
          that quietly drops it is publishing uncredited work. A corner label
          rather than the in-flow figcaption `MediaFigure` uses, because a
          full-bleed hero has no in-flow position directly under the image
          the way a body figure does. */}
      {(caption || credit) && (
        <figcaption className="absolute bottom-2 right-2 max-w-[70%] rounded bg-black/50 px-2 py-1 text-right text-xs text-white/90 sm:bottom-3 sm:right-4">
          {caption}
          {caption && credit && " — "}
          {credit}
        </figcaption>
      )}
      <div
        className="absolute inset-x-0 top-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-8 sm:px-6 sm:pb-14 lg:pb-20"
        style={{
          height: `min(calc(100vw * ${media.rendition.height} / ${media.rendition.width}), calc(100dvh - ${HERO_CHROME_RESERVE_PX}px))`,
        }}
      >
        <div className="mx-auto max-w-6xl">
          {meta && (
            <time
              dateTime={meta.dateTime}
              className="block text-sm text-white/80 drop-shadow-sm"
            >
              {meta.label}
            </time>
          )}
          <h1 className={titleClassName}>{title}</h1>
          {description && (
            <p className="mt-3 max-w-2xl text-lg text-white/90 drop-shadow-sm sm:text-xl">
              {description}
            </p>
          )}
          {action && (
            <Link
              href={action.href}
              className="mt-6 inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:mt-8 sm:text-base"
            >
              {action.label}
            </Link>
          )}
        </div>
      </div>
    </figure>
  );
}
