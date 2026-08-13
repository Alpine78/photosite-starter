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

/** The continuation endpoint, addressed by canonical path and opaque token. */
export function gallerySliceEndpoint(
  galleryPath: string,
  cursor: string,
): string {
  const params = new URLSearchParams({ path: galleryPath, cursor });
  return `/api/gallery?${params.toString()}`;
}

function isGallerySlice(value: unknown): value is GallerySlice {
  if (typeof value !== "object" || value === null) return false;

  const slice = value as Record<string, unknown>;
  return (
    Array.isArray(slice.items) &&
    Array.isArray(slice.slides) &&
    slice.items.length === slice.slides.length &&
    (slice.nextCursor === null || typeof slice.nextCursor === "string")
  );
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
