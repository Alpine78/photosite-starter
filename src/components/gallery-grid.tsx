import Image from "next/image";
import {
  GalleryLightbox,
  GalleryLightboxTrigger,
} from "@/components/gallery-lightbox";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { GallerySlice } from "@/lib/gallery-slice";
import { imageRenderProfiles } from "@/lib/image-delivery";

type GalleryGridProps = {
  /** Accessible name of the image list, normally the gallery's own title. */
  label: string;
  /**
   * One bounded page of the shared result contract, in its authoritative order.
   * The type is AB#67's and nothing narrower: the grid renders a curated gallery
   * and a later dynamic one identically, and never learns which it was given.
   */
  slice: GallerySlice;
  labels: BuiltInLabels;
};

/**
 * One page of gallery items as a grid of full-frame thumbnails, each opening
 * the fullscreen lightbox at its own position.
 *
 * The layout is row-major: one, two, or three equal columns filled left to
 * right in DOM order. That is the whole reason it is a grid rather than the CSS
 * multi-column masonry this replaced — multi-column fills a column at a time, so
 * the top row of a three-column masonry reads as items one, three, and five
 * while the lightbox, the keyboard, and the source all count one, two, three.
 * One authoritative order means the eye has to agree with them too.
 *
 * The cost is a ragged bottom edge where a portrait and a landscape frame share
 * a row, and that is the right trade: every image keeps its native aspect ratio
 * and full frame — `h-auto w-full` over the rendition's true dimensions, no
 * `object-cover` and no fixed-ratio cell — because a cropped preview
 * misrepresents the photograph and can make a strong image go unseen.
 */
export function GalleryGrid({ label, slice, labels }: GalleryGridProps) {
  return (
    <GalleryLightbox slides={slice.slides} labels={labels.lightbox}>
      <ul
        aria-label={label}
        className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {slice.items.map((item, index) => {
          const { media } = item;

          return (
            <li key={item.itemId}>
              <figure className="rounded-sm bg-black/5 dark:bg-white/5">
                <GalleryLightboxTrigger
                  itemId={item.itemId}
                  index={index}
                  label={
                    media.alt.length > 0 ? undefined : labels.lightbox.openImage
                  }
                >
                  <Image
                    src={media.rendition.src}
                    alt={media.alt}
                    width={media.rendition.width}
                    height={media.rendition.height}
                    loading="lazy"
                    sizes={imageRenderProfiles.galleryGrid.sizes}
                    className="h-auto w-full"
                  />
                </GalleryLightboxTrigger>
                {media.caption && (
                  <figcaption className="px-3 py-2 text-sm text-foreground/65">
                    {media.caption}
                  </figcaption>
                )}
              </figure>
            </li>
          );
        })}
      </ul>
    </GalleryLightbox>
  );
}
