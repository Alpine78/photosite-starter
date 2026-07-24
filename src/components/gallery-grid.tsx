import Image from "next/image";
import type { Gallery } from "@/lib/gallery";

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
          <li key={item.id} className="mb-4 break-inside-avoid">
            <figure
              tabIndex={0}
              className="overflow-hidden rounded-sm bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 dark:bg-white/5"
            >
              <Image
                src={media.src}
                alt={media.alt}
                width={media.width}
                height={media.height}
                loading="lazy"
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
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
