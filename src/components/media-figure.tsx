import Image from "next/image";
import type { ImageMedia } from "@/lib/media";

type MediaFigureProps = {
  image: ImageMedia;
  /** Browser source-size hint from the presentation context's render profile. */
  sizes: string;
  /** Set on the one image a page is expected to show above the fold. */
  preload?: boolean;
  className?: string;
};

/**
 * One placed photograph with whatever the image itself says about its origin.
 *
 * Shared by the body renderer and the page cover so a credit cannot survive in
 * one place and vanish in the other. Attribution is the reason this is one
 * component: an image carrying a credit is showing someone else's name, and a
 * surface that quietly drops it is publishing uncredited work.
 *
 * The frame is never cropped — `h-auto w-full` over the rendition's true
 * intrinsic dimensions — so every image keeps its native aspect ratio and its
 * full frame, and reserves the right amount of space while it loads.
 */
export function MediaFigure({
  image,
  sizes,
  preload = false,
  className,
}: MediaFigureProps) {
  const { caption, credit } = image;

  return (
    <figure className={className}>
      <Image
        src={image.rendition.src}
        alt={image.alt}
        width={image.rendition.width}
        height={image.rendition.height}
        sizes={sizes}
        preload={preload}
        className="h-auto w-full rounded-lg"
      />
      {(caption || credit) && (
        <figcaption className="mt-2 text-sm text-subtle">
          {caption}
          {caption && credit && " — "}
          {credit}
        </figcaption>
      )}
    </figure>
  );
}
