import type { PrivateGalleryDeliveryPage } from "@/lib/private-gallery-access";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY as MAX_FILES,
  PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE as PAGE_SIZE,
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX as MAX_EDGE,
} from "@/lib/private-gallery-limits";

/** Treat malformed or stale responses as the same generic refusal as HTTP failure. */
export function parsePrivateGalleryDeliveryResponse(value: unknown, requested: number): PrivateGalleryDeliveryPage | undefined {
  if (typeof value !== "object" || value === null || !("ok" in value) || value.ok !== true || !("view" in value)) return undefined;
  const view = value.view;
  if (typeof view !== "object" || view === null || !("pageIndex" in view) || view.pageIndex !== requested ||
    !("totalCount" in view) || typeof view.totalCount !== "number" || !Number.isSafeInteger(view.totalCount) || view.totalCount < 0 || view.totalCount > MAX_FILES ||
    !("items" in view) || !Array.isArray(view.items) || !("hasNextPage" in view) || typeof view.hasNextPage !== "boolean") return undefined;
  const offset = requested * PAGE_SIZE;
  if (!Number.isSafeInteger(requested) || requested < 0 || requested >= Math.ceil(MAX_FILES / PAGE_SIZE) ||
    (requested > 0 && offset >= view.totalCount) ||
    view.items.length !== Math.min(PAGE_SIZE, view.totalCount - offset) ||
    view.hasNextPage !== (offset + view.items.length < view.totalCount)) return undefined;
  const items: PrivateGalleryDeliveryPage["items"][number][] = [];
  const seen = new Set<string>();
  for (const item of view.items) {
    if (typeof item !== "object" || item === null || typeof item.itemId !== "string" || item.itemId.length === 0 || seen.has(item.itemId) ||
      !Number.isSafeInteger(item.width) || item.width <= 0 || item.width > MAX_EDGE ||
      !Number.isSafeInteger(item.height) || item.height <= 0 || item.height > MAX_EDGE ||
      (item.derivativeKind !== "delivery-preview" && item.derivativeKind !== "watermarked-proof") ||
      (item.alt !== undefined && (typeof item.alt !== "string" || item.alt.length > 500))) return undefined;
    seen.add(item.itemId);
    items.push({ itemId: item.itemId, width: item.width, height: item.height, derivativeKind: item.derivativeKind,
      ...(item.alt === undefined ? {} : { alt: item.alt }) });
  }
  return { items, pageIndex: requested, totalCount: view.totalCount, hasNextPage: view.hasNextPage };
}
