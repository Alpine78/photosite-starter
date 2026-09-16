import { useId } from "react";
import Image from "next/image";
import { GalleryLightboxTrigger } from "@/components/gallery-lightbox";
import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  resolvesToBelowCaption,
  type GalleryCaptionPlacement,
} from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";
import "@/components/gallery-figure.css";

/** Two-line resting captions are optional; full text remains in the figcaption. */
export function GalleryFigure({ item, index, captionPlacement, boundedBelow = false, sizes, labels }: {
  item: GallerySlice["items"][number];
  index: number;
  captionPlacement: GalleryCaptionPlacement;
  boundedBelow?: boolean;
  sizes: string;
  labels: BuiltInLabels;
}) {
  const { media } = item;
  const captionId = useId();
  // Very low panoramas cannot contain two readable lines. Their caption gets
  // a reserved strip below the image, with the same photographic treatment.
  const below = resolvesToBelowCaption(captionPlacement, media.rendition);
  const bounded = captionPlacement === "overlay" || boundedBelow;
  return (
    <figure className={`gallery-figure rounded-sm bg-surface-muted${bounded && media.caption ? " gallery-figure--bounded" : ""}`}>
      <GalleryLightboxTrigger itemId={item.itemId} index={index}
        captionPopoverId={bounded && media.caption ? captionId : undefined}
        label={media.alt.length > 0 ? undefined : labels.lightbox.openImage}>
        <Image src={media.rendition.src} alt={media.alt}
          width={media.rendition.width} height={media.rendition.height}
          style={{ aspectRatio: `${media.rendition.width} / ${media.rendition.height}` }}
          loading="lazy" sizes={sizes} className="h-auto w-full" />
      </GalleryLightboxTrigger>
      {media.caption && bounded && below && <div className="gallery-caption-slot" aria-hidden="true" />}
      {media.caption && <figcaption className={bounded
        ? `gallery-caption gallery-caption--bounded ${captionPlacement === "overlay" ? "gallery-caption--overlay" : "bg-surface text-subtle"}`
        : "px-3 py-2 text-sm text-subtle wrap-anywhere"}>
        <span className={bounded ? "gallery-caption-text" : undefined}>{media.caption}</span>
      </figcaption>}
      {bounded && media.caption && (
        <div id={captionId} popover="auto" role="dialog"
          aria-label={media.alt || labels.gallery.images} tabIndex={-1} autoFocus
          className="gallery-caption-popover rounded-sm border border-border-strong bg-surface text-foreground">
          <p>{media.caption}</p>
        </div>
      )}
    </figure>
  );
}
