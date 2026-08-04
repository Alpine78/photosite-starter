import Image from "next/image";
import type { Gallery } from "@/lib/gallery";
import { imageRenderProfiles } from "@/lib/image-delivery";

type GalleryGridProps = {
  gallery: Gallery;
};

export function GalleryGrid({ gallery }: GalleryGridProps) {
  return (
    <ul
      aria-label={gallery.title}
      className="columns-1 gap-4 sm:columns-2 lg:columns-3"
    >
      {gallery.items.map((item) => {
        if (item.media.type !== "image") return null;

        const { media } = item;

        return (
          <li key={item.placementId} className="mb-4 break-inside-avoid">
            <figure className="overflow-hidden rounded-sm bg-black/5 dark:bg-white/5">
              <Image
                src={media.rendition.src}
                alt={media.alt}
                width={media.rendition.width}
                height={media.rendition.height}
                loading="lazy"
                sizes={imageRenderProfiles.portfolioGrid.sizes}
                className="h-auto w-full"
              />
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
  );
}
