import { describe, expect, it } from "vitest";
import { appendGallerySlice, type GallerySlice } from "@/lib/gallery-slice";
import type { GalleryResultItem } from "@/lib/gallery-result";
import type { LightboxSlide } from "@/lib/lightbox-slides";
import type { ImageMedia } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

function item(itemId: string, media: ImageMedia = mockImages.coastalLandscape) {
  return { itemId, mediaId: media.mediaId, media } satisfies GalleryResultItem<ImageMedia>;
}

function slide(itemId: string, media: ImageMedia = mockImages.coastalLandscape) {
  return {
    itemId,
    mediaId: media.mediaId,
    src: media.rendition.src,
    width: media.rendition.width,
    height: media.rendition.height,
    alt: media.alt,
  } satisfies LightboxSlide;
}

function slice(itemIds: readonly string[], nextCursor: string | null = null): GallerySlice {
  return {
    items: itemIds.map((id) => item(id)),
    slides: itemIds.map((id) => slide(id)),
    nextCursor,
  };
}

describe("appendGallerySlice", () => {
  it("adds the next slice after what is already loaded", () => {
    const result = appendGallerySlice(slice(["a", "b"], "cursor-1"), slice(["c", "d"], "cursor-2"));

    expect(result.items.map((entry) => entry.itemId)).toEqual(["a", "b", "c", "d"]);
    expect(result.slides.map((entry) => entry.itemId)).toEqual(["a", "b", "c", "d"]);
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("keeps the grid and the slide list in one order", () => {
    // They are separate arrays that must never disagree: the lightbox opens by
    // index into the slides, and the grid's trigger positions are the indices.
    const result = appendGallerySlice(slice(["a"]), slice(["b", "c"]));

    expect(result.slides.map((entry) => entry.itemId)).toEqual(
      result.items.map((entry) => entry.itemId),
    );
  });

  it("drops an item already loaded rather than showing it twice", () => {
    // A cursor names a boundary, not a set, so an overlapping slice is a legal
    // answer — and a double-activated control asks for the same one twice.
    // A duplicate `itemId` would break focus return and React's list keys.
    const result = appendGallerySlice(slice(["a", "b"]), slice(["b", "c"]));

    expect(result.items.map((entry) => entry.itemId)).toEqual(["a", "b", "c"]);
    expect(result.slides.map((entry) => entry.itemId)).toEqual(["a", "b", "c"]);
  });

  it("drops a repeated identity inside the incoming slice too", () => {
    const result = appendGallerySlice(slice(["a"]), slice(["b", "b", "c"]));

    expect(result.items.map((entry) => entry.itemId)).toEqual(["a", "b", "c"]);
    expect(result.slides.map((entry) => entry.itemId)).toEqual(["a", "b", "c"]);
  });

  it("never reorders what a visitor has already scrolled past", () => {
    const result = appendGallerySlice(slice(["a", "b", "c"]), slice(["c", "b", "d"]));

    expect(result.items.map((entry) => entry.itemId)).toEqual(["a", "b", "c", "d"]);
  });

  it("adds nothing when the whole slice is already loaded", () => {
    const loaded = slice(["a", "b"], "cursor-1");
    const result = appendGallerySlice(loaded, slice(["a", "b"], null));

    expect(result.items.map((entry) => entry.itemId)).toEqual(["a", "b"]);
    // The cursor still advances: the adapter has spoken about what follows.
    expect(result.nextCursor).toBeNull();
  });

  it("keeps distinct placements of one photograph", () => {
    // The archive places six images four hundred times. De-duplication is by
    // result identity, never media identity, or the grid would collapse a
    // repeated photograph into a single entry.
    const result = appendGallerySlice(
      slice(["placement-1"]),
      slice(["placement-2"]),
    );

    expect(result.items.map((entry) => entry.itemId)).toEqual([
      "placement-1",
      "placement-2",
    ]);
    expect(new Set(result.items.map((entry) => entry.mediaId)).size).toBe(1);
  });

  it("carries the end of the gallery through as a null cursor", () => {
    expect(appendGallerySlice(slice(["a"], "cursor-1"), slice(["b"], null)).nextCursor).toBeNull();
  });
});
