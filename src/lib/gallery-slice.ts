/**
 * One bounded gallery page in the browser, and the rules for appending one.
 *
 * This module is deliberately client-safe. The server-only projection that
 * creates a slice — including its optimizer-generated lightbox sources — lives
 * in `gallery-slice-server.ts`; keeping that boundary separate prevents
 * `getImageProps` and future server-only delivery decisions from entering a
 * Client Component's module graph when the grid imports the append rule.
 */

import type { GalleryResultItem } from "@/lib/gallery-result";
import type { LightboxSlide } from "@/lib/lightbox-slides";
import type { ImageMedia } from "@/lib/media";

/**
 * One gallery URL, built from its parameter-free path plus an optional
 * section filter and continuation cursor.
 *
 * The one place that assembles a `?section=`/`?cursor=` query, so every
 * internal link — a section control, the continuation control, "back to
 * start", and the `/api/gallery` fetch address — agrees on the same shape.
 * ADR-0003 decision 8 fixes the stable emitted order as `section` then
 * `cursor` when both are present, so alternate spellings of one request never
 * look like two different addresses to a crawler. Both values are
 * percent-encoded and otherwise passed through untouched; neither is ever
 * normalized here — a bare `galleryPath` is returned when neither is set.
 */
export function buildGalleryHref(
  galleryPath: string,
  { section, cursor }: { readonly section?: string; readonly cursor?: string },
): string {
  const params = new URLSearchParams();
  if (section !== undefined) params.set("section", section);
  if (cursor !== undefined) params.set("cursor", cursor);
  const query = params.toString();
  return query.length === 0 ? galleryPath : `${galleryPath}?${query}`;
}

/**
 * Where the slice after this one lives.
 *
 * One rule, used by the server that renders the link and by the client that
 * rebuilds it after an append, so the address a visitor can copy is the same
 * one either path produces. The token is percent-encoded and otherwise passed
 * through untouched — decision 8 makes it case-sensitive and never normalized.
 *
 * `section` carries the active section forward so a continuation reached from
 * inside a named section keeps its own filter rather than silently reverting
 * to the unfiltered view.
 */
export function galleryContinuationHref(
  galleryPath: string,
  cursor: string,
  section?: string,
): string {
  return buildGalleryHref(galleryPath, { section, cursor });
}

export type GallerySlice = {
  /** What the grid renders, in the result's authoritative order. */
  readonly items: readonly GalleryResultItem<ImageMedia>[];
  /** The same items as lightbox slides, in the same order and by the same ids. */
  readonly slides: readonly LightboxSlide[];
  /**
   * The token that reaches the slice after this one, or `null` at the end.
   * Opaque here as everywhere outside the adapter: it is carried, never read.
   */
  readonly nextCursor: string | null;
};

/**
 * Appends a slice to what is already loaded, dropping anything already present.
 *
 * A cursor names a boundary rather than a set, so an adapter is free to return
 * an overlapping slice — and a visitor who double-activates the control can ask
 * for the same one twice. Both would otherwise put a duplicate `itemId` in the
 * grid, which is the identity the lightbox returns focus by and the key React
 * renders the list with. De-duplicating here, once, keeps the grid, the slide
 * list, and the keyboard order agreeing without either caller remembering to.
 *
 * Order is never rearranged: what is already loaded keeps its positions and new
 * items follow, because the sequence a visitor has already scrolled past must
 * not move under them.
 */
export function appendGallerySlice(
  loaded: GallerySlice,
  next: GallerySlice,
): GallerySlice {
  const seen = new Set(loaded.items.map((item) => item.itemId));
  const addedItems = next.items.filter((item) => {
    if (seen.has(item.itemId)) return false;
    seen.add(item.itemId);
    return true;
  });
  const slidesByItemId = new Map<string, LightboxSlide>();
  for (const slide of next.slides) {
    if (!slidesByItemId.has(slide.itemId)) {
      slidesByItemId.set(slide.itemId, slide);
    }
  }
  const addedSlides = addedItems.map((item) => {
    const slide = slidesByItemId.get(item.itemId);
    if (slide === undefined) {
      throw new TypeError(`Gallery slice has no slide for item ${item.itemId}`);
    }
    return slide;
  });

  return {
    items: [...loaded.items, ...addedItems],
    slides: [...loaded.slides, ...addedSlides],
    nextCursor: next.nextCursor,
  };
}
