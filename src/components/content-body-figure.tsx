"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { GalleryLightboxTrigger } from "@/components/gallery-lightbox";
import { MEDIA_FIGURE_IMAGE_CLASS } from "@/components/media-figure";
import type { ImageMedia } from "@/lib/media";

type ContentBodyFigureProps = {
  image: ImageMedia;
  /** Browser source-size hint for the in-flow figure — the body's own column. */
  sizes: string;
  /** This figure's position in the body's image sequence, i.e. its slide. */
  index: number;
  /** Per-occurrence identity focus returns to; the trigger carries it in DOM. */
  itemId: string;
  /** Used only when the image has no alt text to name the control by. */
  openLabel: string;
};

/** No external store to read; the two snapshots are the whole signal. */
const subscribeToNothing = () => () => {};

/**
 * One body photograph that opens the fullscreen lightbox — but only once its
 * script has run.
 *
 * Wrapping every body figure in a server-rendered `<button>` would turn a
 * photograph into a focusable control that does nothing when scripts are
 * unavailable, where today it is a plain image. So the server render (and the
 * first client render, which must match it) emits exactly what `MediaFigure`
 * does; `useSyncExternalStore` reports `false` on the server and `true` once
 * hydrated, and only then does the image become a lightbox trigger. A visitor
 * with no JavaScript keeps the plain image they have always had.
 *
 * The figure, the caption, and the credit are the image's own — never cropped,
 * native ratio, `MediaFigure`'s shared image class — so the only thing
 * enhancement changes is that the photograph becomes clickable.
 */
export function ContentBodyFigure({
  image,
  sizes,
  index,
  itemId,
  openLabel,
}: ContentBodyFigureProps) {
  const enhanced = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const { caption, credit } = image;

  const picture = (
    <Image
      src={image.rendition.src}
      alt={image.alt}
      width={image.rendition.width}
      height={image.rendition.height}
      sizes={sizes}
      className={MEDIA_FIGURE_IMAGE_CLASS}
    />
  );

  return (
    <figure>
      {enhanced ? (
        <GalleryLightboxTrigger
          itemId={itemId}
          index={index}
          label={image.alt.length > 0 ? undefined : openLabel}
        >
          {picture}
        </GalleryLightboxTrigger>
      ) : (
        picture
      )}
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
