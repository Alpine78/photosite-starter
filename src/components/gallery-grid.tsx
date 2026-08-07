import Image, { getImageProps } from "next/image";
import {
  GalleryLightbox,
  GalleryLightboxTrigger,
} from "@/components/gallery-lightbox";
import { getDefaultLocaleLabels } from "@/lib/deployment-config";
import type { Gallery } from "@/lib/gallery";
import {
  getLightboxImageSizes,
  imageRenderProfiles,
} from "@/lib/image-delivery";
import {
  buildLightboxSlides,
  type LightboxRendition,
} from "@/lib/lightbox-slides";
import type { ImageMedia } from "@/lib/media";

type GalleryGridProps = {
  gallery: Gallery;
};

/**
 * Resolves the only source the lightbox is allowed to deliver: candidates
 * derived from the item's own approved public rendition.
 *
 * `getImageProps` runs the same pipeline the grid's `<Image>` does, so no
 * optimizer URL is hand-built here and nothing but this derivative reaches the
 * browser. The `sizes` hint is what makes the optimizer emit width-descriptor
 * candidates; the lightbox then narrows the attribute to the slide's real
 * rendered width at runtime.
 */
function resolveLightboxRendition(media: ImageMedia): LightboxRendition {
  const { props } = getImageProps({
    src: media.rendition.src,
    alt: media.alt,
    width: media.rendition.width,
    height: media.rendition.height,
    sizes: getLightboxImageSizes(media.rendition),
  });

  return {
    src: props.src,
    ...(props.srcSet === undefined ? {} : { srcset: props.srcSet }),
  };
}

export function GalleryGrid({ gallery }: GalleryGridProps) {
  const labels = getDefaultLocaleLabels();
  const slides = buildLightboxSlides(
    gallery.result.items,
    resolveLightboxRendition,
  );

  return (
    <GalleryLightbox slides={slides} labels={labels.lightbox}>
      <ul
        aria-label={gallery.title}
        className="columns-1 gap-4 sm:columns-2 lg:columns-3"
      >
        {gallery.result.items.map((item, index) => {
          const { media } = item;

          return (
            <li key={item.itemId} className="mb-4 break-inside-avoid">
              <figure className="rounded-sm bg-black/5 dark:bg-white/5">
                <GalleryLightboxTrigger
                  itemId={item.itemId}
                  index={index}
                  label={
                    media.alt.length > 0
                      ? undefined
                      : labels.lightbox.openImage
                  }
                >
                  <Image
                    src={media.rendition.src}
                    alt={media.alt}
                    width={media.rendition.width}
                    height={media.rendition.height}
                    loading="lazy"
                    sizes={imageRenderProfiles.portfolioGrid.sizes}
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
