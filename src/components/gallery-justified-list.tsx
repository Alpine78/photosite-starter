import { useState, type CSSProperties } from "react";
import { GalleryFigure } from "@/components/gallery-figure";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { computeJustifiedLayout, type JustifiedLayout } from "@/lib/gallery-justified-layout";
import type { GalleryCaptionPlacement } from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";
import { curatedJustifiedImageSizes, imageRenderProfiles } from "@/lib/image-delivery";
import "@/components/gallery-justified.css";

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
export function GalleryJustifiedList({ label, items, captionPlacement, eagerItems = 0, curated = false, labels }: {
  label: string;
  items: GallerySlice["items"];
  captionPlacement: GalleryCaptionPlacement;
  /** Leading items that load eagerly; see `GalleryGrid`'s `eagerCount`. */
  eagerItems?: number;
  /** In the full-width page column rather than a reading column (AB#385). */
  curated?: boolean;
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
        <GalleryFigure item={item} index={index} captionPlacement={captionPlacement} eager={index < eagerItems}
          sizes={curated ? curatedJustifiedImageSizes(item.media.rendition) : imageRenderProfiles.galleryJustified.sizes}
          labels={labels} />
      </li>)}
    </ul>
  </div>;
}
