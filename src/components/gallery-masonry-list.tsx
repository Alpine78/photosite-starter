import { useState, type CSSProperties } from "react";
import "@/components/gallery-masonry.css";
import { GalleryFigure } from "@/components/gallery-figure";
import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  formatMasonryCoefficient,
  MASONRY_BANDS,
  MASONRY_CAPTION_BELOW_REM,
  placeMasonry,
  type MasonryBandPlacement,
} from "@/lib/gallery-masonry";
import {
  resolvesToBelowCaption,
  type GalleryCaptionPlacement,
} from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";
import { imageRenderProfiles } from "@/lib/image-delivery";

type GalleryMasonryListProps = {
  label: string;
  items: GallerySlice["items"];
  captionPlacement: GalleryCaptionPlacement;
  labels: BuiltInLabels;
};

type MasonryLayout = {
  readonly listStyle: Record<string, string>;
  readonly itemStyles: readonly Record<string, string>[];
  readonly placements: readonly MasonryBandPlacement[];
};

/**
 * Places every band, from the renditions' true dimensions alone, and builds
 * the CSS custom properties `gallery-masonry.css` reads from them.
 *
 * `resumeFrom`, when given, must be a previous call's own `placements` for
 * the same items-so-far and the same `captionPlacement`: `placeMasonry`
 * resumes each band from it instead of recomputing the whole list, so an
 * append costs work proportional to what was appended rather than to
 * everything loaded so far.
 */
function computeMasonryLayout(
  items: GallerySlice["items"],
  captionPlacement: GalleryCaptionPlacement,
  resumeFrom?: readonly MasonryBandPlacement[],
): MasonryLayout {
  const inputs = items.map((item) => ({
    width: item.media.rendition.width,
    height: item.media.rendition.height,
    captionRem:
      item.media.caption && resolvesToBelowCaption(captionPlacement, item.media.rendition)
        ? MASONRY_CAPTION_BELOW_REM
        : 0,
  }));

  const placements = MASONRY_BANDS.map((band, bandIndex) =>
    placeMasonry(inputs, band, resumeFrom?.[bandIndex]),
  );

  const listStyle: Record<string, string> = {};
  for (const placement of placements) {
    placement.columnBottoms.forEach((bottom, column) => {
      const prefix = `--m${placement.columns}-h${column}`;
      listStyle[`${prefix}-a`] = formatMasonryCoefficient(bottom.a);
      listStyle[`${prefix}-b`] = formatMasonryCoefficient(bottom.b);
    });
  }

  const itemStyles = items.map((_item, index) => {
    const itemStyle: Record<string, string> = {};
    for (const placement of placements) {
      const { column, top } = placement.items[index];
      const prefix = `--m${placement.columns}`;
      itemStyle[`${prefix}-c`] = String(column);
      itemStyle[`${prefix}-a`] = formatMasonryCoefficient(top.a);
      itemStyle[`${prefix}-b`] = formatMasonryCoefficient(top.b);
    }
    return itemStyle;
  });

  return { listStyle, itemStyles, placements };
}

/**
 * The gallery's items as an order-preserving masonry (AB#157).
 *
 * Every column count's placement is computed from the renditions' true
 * dimensions alone and handed to `gallery-masonry.css` as custom properties;
 * container queries choose which one applies. The server render is therefore
 * already laid out with no script.
 *
 * An append resumes each band's own prior placement instead of recomputing
 * the whole loaded list — see `computeMasonryLayout`'s own comment and
 * `docs/gallery-presentation.md`. The prior layout is kept in state rather
 * than a ref, and derived directly during render (React's own documented
 * "storing information from previous renders" pattern:
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders),
 * because a ref's value must not be read while rendering — this component
 * needs exactly that value to decide whether to resume.
 */
export function GalleryMasonryList({
  label,
  items,
  captionPlacement,
  labels,
}: GalleryMasonryListProps) {
  const [cache, setCache] = useState<{
    items: GallerySlice["items"];
    captionPlacement: GalleryCaptionPlacement;
    layout: MasonryLayout;
  } | null>(null);

  const isCurrent = cache !== null && cache.items === items && cache.captionPlacement === captionPlacement;
  const layout = isCurrent
    ? cache.layout
    : computeMasonryLayout(
        items,
        captionPlacement,
        cache !== null &&
          cache.captionPlacement === captionPlacement &&
          cache.layout.placements.every((placement) => placement.items.length <= items.length)
          ? cache.layout.placements
          : undefined,
      );
  if (!isCurrent) {
    setCache({ items, captionPlacement, layout });
  }

  return (
    <div className="gallery-masonry">
      <ul
        aria-label={label}
        className="gallery-masonry__list"
        style={layout.listStyle as CSSProperties}
      >
        {items.map((item, index) => (
          <li
            key={item.itemId}
            className="gallery-masonry__item"
            style={layout.itemStyles[index] as CSSProperties}
          >
            <GalleryFigure
              item={item}
              index={index}
              captionPlacement={captionPlacement}
              boundedBelow
              sizes={imageRenderProfiles.galleryMasonry.sizes}
              labels={labels}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
