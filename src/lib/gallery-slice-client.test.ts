import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGallerySlice } from "@/lib/gallery-slice-client";
import type { GallerySlice } from "@/lib/gallery-slice";
import { mockImages } from "@/lib/mock-media";

function validSlice(): GallerySlice {
  const media = mockImages.coastalLandscape;

  return {
    items: [
      {
        itemId: "placement-a",
        mediaId: media.mediaId,
        placementId: "placement-a",
        media,
      },
    ],
    slides: [
      {
        itemId: "placement-a",
        mediaId: media.mediaId,
        src: media.rendition.src,
        width: media.rendition.width,
        height: media.rendition.height,
        alt: media.alt,
        ...(media.caption === undefined ? {} : { caption: media.caption }),
        ...(media.credit === undefined ? {} : { credit: media.credit }),
      },
    ],
    nextCursor: null,
  };
}

function stubResponse(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGallerySlice", () => {
  it("accepts one complete ordered slice", async () => {
    const slice = validSlice();
    stubResponse(slice);

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).resolves.toEqual(slice);
  });

  it("refuses equal-length arrays whose entries are malformed", async () => {
    stubResponse({ items: [null], slides: [null], nextCursor: null });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });

  it("refuses grid and lightbox projections with different identities", async () => {
    const slice = validSlice();
    stubResponse({
      ...slice,
      slides: [{ ...slice.slides[0], itemId: "another-placement" }],
    });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });

  it("refuses lightbox metadata that disagrees with the grid item", async () => {
    const slice = validSlice();
    stubResponse({
      ...slice,
      slides: [{ ...slice.slides[0], alt: "A different photograph" }],
    });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });

  it("refuses an empty continuation token", async () => {
    stubResponse({ ...validSlice(), nextCursor: "" });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });
});
