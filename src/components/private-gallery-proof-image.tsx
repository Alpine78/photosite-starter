"use client";

import { PrivateGalleryPreviewImage, type PrivateGalleryPreviewImageLabels } from "@/components/private-gallery-preview-image";
import type { PrivateGalleryPreviewMintQueue } from "@/lib/private-gallery-preview-mint-queue";

/** Preserve proof identities and filename copy while sharing private delivery. */
export function PrivateGalleryProofImage({ item, ...props }: {
  readonly item: {
    readonly itemId: string;
    readonly width: number;
    readonly height: number;
    readonly alt?: string;
    readonly reference: string;
    readonly filename: string;
  };
  readonly assetPath: string;
  readonly queue: PrivateGalleryPreviewMintQueue;
  readonly labels: PrivateGalleryPreviewImageLabels;
}) {
  return <PrivateGalleryPreviewImage item={item} fallbackAlt={`${item.reference} — ${item.filename}`} {...props} />;
}
