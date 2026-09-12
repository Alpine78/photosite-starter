import { ContentBodyFigure } from "@/components/content-body-figure";
import { GalleryLightbox } from "@/components/gallery-lightbox";
import { buildContentBodyLightboxSlides } from "@/lib/content-body-lightbox-server";
import { listContentBodyImages } from "@/lib/content-body-media";
import {
  miniGalleryImageBlocks,
  type MiniGalleryBlock,
} from "@/lib/content-mini-gallery";
import type { BuiltInLabels } from "@/lib/deployment-config";

type ContentMiniGalleryProps = {
  block: MiniGalleryBlock;
  labels: BuiltInLabels;
  name: string;
  sizes: string;
};

/** Each authored set owns its sequence, including when nested in the body viewer. */
export function ContentMiniGallery({
  block,
  labels,
  name,
  sizes,
}: ContentMiniGalleryProps) {
  const blocks = miniGalleryImageBlocks(block);
  const images = listContentBodyImages(blocks);
  const slides = buildContentBodyLightboxSlides(blocks);

  return (
    <div>
      {block.title && (
        <p className="mb-3 font-semibold text-foreground">{block.title}</p>
      )}
      <GalleryLightbox slides={slides} labels={labels.lightbox}>
        <ul
          aria-label={name}
          data-mini-gallery
          className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2"
        >
          {images.map(({ media, itemId, index }) => (
            <li key={itemId} style={{ maxWidth: media.rendition.width }}>
              <ContentBodyFigure
                image={media}
                sizes={sizes}
                index={index}
                itemId={itemId}
                openLabel={labels.lightbox.openImage}
              />
            </li>
          ))}
        </ul>
      </GalleryLightbox>
    </div>
  );
}
