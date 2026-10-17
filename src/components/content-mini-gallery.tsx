import { ContentBodyFigure } from "@/components/content-body-figure";
import { GalleryLightbox } from "@/components/gallery-lightbox";
import { buildContentBodyLightboxSlides } from "@/lib/content-body-lightbox-server";
import { listContentBodyImages } from "@/lib/content-body-media";
import {
  miniGalleryImageBlocks,
  type MiniGalleryBlock,
} from "@/lib/content-mini-gallery";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { CSSProperties } from "react";
import type { GalleryLayout } from "@/lib/gallery-presentation";
import { miniGalleryJustifiedLayout } from "@/lib/content-mini-gallery-layout";
import "@/components/gallery-justified.css";
import "@/components/content-mini-gallery.css";

type ContentMiniGalleryProps = {
  block: MiniGalleryBlock;
  labels: BuiltInLabels;
  name: string;
  sizes: string;
  layout: GalleryLayout;
};

/** Each authored set owns its sequence, including when nested in the body viewer. */
export function ContentMiniGallery({
  block,
  labels,
  name,
  sizes,
  layout,
}: ContentMiniGalleryProps) {
  const blocks = miniGalleryImageBlocks(block);
  const images = listContentBodyImages(blocks);
  const slides = buildContentBodyLightboxSlides(blocks);
  const justified = layout === "justified";
  const geometry = justified ? miniGalleryJustifiedLayout(images) : undefined;

  return (
    <div className={`content-mini-gallery${justified ? " gallery-justified" : ""}`}>
      {block.title && (
        <p className="mb-3 font-semibold text-foreground">{block.title}</p>
      )}
      <GalleryLightbox slides={slides} labels={labels.lightbox}>
        <ul
          aria-label={name}
          data-mini-gallery
          className={justified ? "gallery-justified__list"
            : "grid grid-cols-1 items-start gap-6 sm:grid-cols-2"}
        >
          {images.map(({ media, itemId, index }) => (
            <li key={itemId} className={justified ? "gallery-justified__item" : undefined}
              style={{
                ...(justified ? geometry!.styles[index] : { maxWidth: media.rendition.width }),
                "--mini-image-ratio": `${media.rendition.width} / ${media.rendition.height}`,
              } as CSSProperties & { "--mini-image-ratio": string }}>
              <ContentBodyFigure
                image={media}
                sizes={sizes}
                index={index}
                itemId={itemId}
                openLabel={labels.lightbox.openImage}
                pictureClassName={justified ? "mini-gallery-justified__picture" : undefined}
              />
            </li>
          ))}
        </ul>
      </GalleryLightbox>
    </div>
  );
}
