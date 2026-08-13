/**
 * Reading one more gallery slice from the browser.
 *
 * The endpoint answers with exactly what the server would have rendered, so the
 * only work here is asking for it and refusing an answer that is not one. A
 * malformed or truncated response has to fail loudly rather than append
 * half a page: the grid, the slide list, and the keyboard order all index the
 * same arrays, and a slice missing its slides would desynchronize them.
 */

import type { GallerySlice } from "@/lib/gallery-slice";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isGalleryItem(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.media)) return false;

  const { media } = value;
  if (!isRecord(media.rendition)) return false;

  return (
    isNonEmptyString(value.itemId) &&
    isNonEmptyString(value.mediaId) &&
    isOptionalString(value.placementId) &&
    isOptionalString(value.sectionId) &&
    media.type === "image" &&
    media.mediaId === value.mediaId &&
    typeof media.alt === "string" &&
    isOptionalString(media.caption) &&
    isOptionalString(media.credit) &&
    isNonEmptyString(media.rendition.src) &&
    isNonEmptyString(media.rendition.version) &&
    isPositiveInteger(media.rendition.width) &&
    isPositiveInteger(media.rendition.height)
  );
}

function isLightboxSlide(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    isNonEmptyString(value.itemId) &&
    isNonEmptyString(value.mediaId) &&
    isNonEmptyString(value.src) &&
    isOptionalString(value.srcset) &&
    isPositiveInteger(value.width) &&
    isPositiveInteger(value.height) &&
    typeof value.alt === "string" &&
    isOptionalString(value.caption) &&
    isOptionalString(value.credit)
  );
}

/** The continuation endpoint, addressed by canonical path and opaque token. */
export function gallerySliceEndpoint(
  galleryPath: string,
  cursor: string,
): string {
  const params = new URLSearchParams({ path: galleryPath, cursor });
  return `/api/gallery?${params.toString()}`;
}

function isGallerySlice(value: unknown): value is GallerySlice {
  if (!isRecord(value)) return false;

  const { items, slides, nextCursor } = value;
  if (
    !Array.isArray(items) ||
    !Array.isArray(slides) ||
    items.length !== slides.length ||
    (nextCursor !== null && !isNonEmptyString(nextCursor))
  ) {
    return false;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const slide = slides[index];
    if (!isGalleryItem(item) || !isLightboxSlide(slide)) return false;
    const media = item.media;
    if (!isRecord(media) || !isRecord(media.rendition)) return false;

    // The two arrays are one ordered result in two projections. Equal lengths
    // alone are not enough: a mismatch would make a grid trigger open another
    // item's photograph, metadata, or dimensions and return focus by the wrong
    // identity. The delivery URL may differ because the server optimizes the
    // lightbox source separately, but the public subject must stay the same.
    if (
      item.itemId !== slide.itemId ||
      item.mediaId !== slide.mediaId ||
      media.alt !== slide.alt ||
      media.caption !== slide.caption ||
      media.credit !== slide.credit ||
      media.rendition.width !== slide.width ||
      media.rendition.height !== slide.height
    ) {
      return false;
    }
  }

  return true;
}

/**
 * One more slice, or a thrown error.
 *
 * Every failure is one failure to the caller — offline, a 404 for a token that
 * names nothing, a 500, or a body that is not a slice. The control retries the
 * same way regardless, and telling a visitor which of those happened would say
 * nothing they could act on.
 */
export async function fetchGallerySlice(
  galleryPath: string,
  cursor: string,
): Promise<GallerySlice> {
  const response = await fetch(gallerySliceEndpoint(galleryPath, cursor), {
    headers: { accept: "application/json" },
    // The response is `no-store` and the token is single-purpose; asking the
    // HTTP cache for it would only risk replaying a stale slice.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Gallery continuation failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isGallerySlice(payload)) {
    throw new TypeError("Gallery continuation returned an unusable slice");
  }

  return payload;
}
