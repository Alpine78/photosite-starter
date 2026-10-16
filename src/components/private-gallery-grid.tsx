"use client";

import { useState } from "react";
import type { PrivateGalleryItem } from "@/lib/private-gallery-access";
import { PrivateGalleryPreviewMintQueue } from "@/lib/private-gallery-preview-mint-queue";
import { PrivateGalleryPreviewImage, type PrivateGalleryPreviewImageLabels } from "@/components/private-gallery-preview-image";

/** Row-major complete frames, with bounded minting shared by this whole page. */
export function PrivateGalleryGrid({ items, assetPath, labels }: {
  readonly items: readonly PrivateGalleryItem[];
  readonly assetPath: string;
  readonly labels: PrivateGalleryPreviewImageLabels & {
    readonly noPhotographs: string;
    readonly photograph: string;
  };
}) {
  const [queue] = useState(() => new PrivateGalleryPreviewMintQueue());
  if (items.length === 0) return <p className="text-muted">{labels.noPhotographs}</p>;

  return (
    <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <li key={item.itemId} className="m-0">
          <PrivateGalleryPreviewImage
            item={item}
            fallbackAlt={labels.photograph.replace("{number}", String(index + 1))}
            assetPath={assetPath}
            queue={queue}
            labels={labels}
          />
        </li>
      ))}
    </ul>
  );
}
