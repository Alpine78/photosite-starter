import { createImageUrlBuilder } from "@sanity/image-url";
import type { PreviewProps } from "sanity";
import { studioSettings } from "./environment";
import { previewImageId } from "./preview-image";

const images = createImageUrlBuilder(studioSettings);

/** Keep the native editor layout, replacing only photographic thumbnail rendering. */
export function FullFramePreview(props: PreviewProps) {
  const id = previewImageId(props.media);
  if (!id) return props.renderDefault(props);
  const src = images.image(id).width(320).height(320).fit("max").auto("format").url();
  return props.renderDefault({
    ...props,
    // This standalone editor does not use Next.js's image component/optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    media: <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />,
  });
}
