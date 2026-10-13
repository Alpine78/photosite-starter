import { createImageUrlBuilder } from "@sanity/image-url";
import { useClient } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { previewImageId } from "./preview-image";
import type { SchemaTypeDefinition } from "../sanity/schemas/schema-types";

type PreparedSchema = SchemaTypeDefinition & { preview?: {
  select: Readonly<Record<string, string>>;
  prepare?: (selection: Readonly<Record<string, unknown>>) => { title: string; subtitle: string; media?: unknown };
} };

/** React media is supported by preview.prepare, including document-list previews. */
export function FullFrameMedia({ assetId }: { assetId: string }) {
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const src = createImageUrlBuilder(client).image(assetId).width(320).height(320).fit("max").auto("format").url();
  const dimensions = /-(\d+)x(\d+)-[^-]+$/.exec(assetId);
  // This standalone Studio does not use the public Next.js image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={Number(dimensions?.[1])} height={Number(dimensions?.[2])}
    style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
}

export function withFullFrameMedia(type: PreparedSchema): PreparedSchema {
  const prepare = type.preview?.prepare;
  if (!prepare) return type;
  return { ...type, preview: { ...type.preview!, prepare(selection) {
    const preview = prepare(selection);
    const id = previewImageId(preview.media);
    return id ? { ...preview, media: <FullFrameMedia assetId={id} /> } : preview;
  } } };
}
