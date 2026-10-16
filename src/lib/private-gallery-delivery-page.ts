import "server-only";

import type { PrivateGalleryPlacement } from "@/lib/private-gallery";
import { projectPrivateGalleryItems, type PrivateGalleryItem } from "@/lib/private-gallery-item";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY as MAX_FILES,
  PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE as PAGE_SIZE,
} from "@/lib/private-gallery-limits";

/** A single bounded, internally consistent store snapshot. Never a browser DTO. */
export type PrivateGalleryDeliveryPageStore = {
  readPage(galleryId: string, pageIndex: number, limit: number): Promise<{
    readonly placements: readonly PrivateGalleryPlacement[];
    readonly totalCount: number;
  } | undefined>;
};

/** Contains only the same safe item fields as the original delivery grid. */
export type PrivateGalleryDeliveryPage = {
  readonly items: readonly PrivateGalleryItem[];
  readonly pageIndex: number;
  readonly totalCount: number;
  readonly hasNextPage: boolean;
};

export function projectPrivateGalleryDeliveryPage(
  galleryId: string,
  pageIndex: number,
  snapshot: Awaited<ReturnType<PrivateGalleryDeliveryPageStore["readPage"]>>,
): PrivateGalleryDeliveryPage | undefined {
  if (
    !Number.isSafeInteger(pageIndex) || pageIndex < 0 ||
    pageIndex >= Math.ceil(MAX_FILES / PAGE_SIZE) || snapshot === undefined ||
    !Number.isSafeInteger(snapshot.totalCount) || snapshot.totalCount < 0 ||
    snapshot.totalCount > MAX_FILES
  ) return undefined;
  const offset = pageIndex * PAGE_SIZE;
  if (pageIndex > 0 && offset >= snapshot.totalCount) return undefined;
  if (snapshot.placements.length !== Math.min(PAGE_SIZE, snapshot.totalCount - offset) ||
    snapshot.placements.some((item) => item.galleryId !== galleryId)) return undefined;
  // Projection refuses duplicate identities, oversized derivatives and raw store fields.
  return {
    items: projectPrivateGalleryItems(snapshot.placements),
    pageIndex,
    totalCount: snapshot.totalCount,
    hasNextPage: offset + snapshot.placements.length < snapshot.totalCount,
  };
}
