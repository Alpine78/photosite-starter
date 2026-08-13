import { describe, expect, it } from "vitest";
import type {
  CuratedGalleryResultItem,
  GalleryCursor,
  GalleryPage,
} from "@/lib/gallery-result";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import { mockImages } from "@/lib/mock-media";

function item(
  itemId: string,
  media = mockImages.coastalLandscape,
): CuratedGalleryResultItem {
  return {
    itemId,
    placementId: itemId,
    mediaId: media.mediaId,
    media,
  };
}

describe("projectGallerySlice", () => {
  it("projects one ordered result into matching grid items and slides", () => {
    const page: GalleryPage<CuratedGalleryResultItem> = {
      items: [item("placement-a"), item("placement-b", mockImages.cityNight)],
      page: {
        size: 24,
        hasNextPage: true,
        endCursor: "cursor-after-b" as GalleryCursor,
      },
    };

    const slice = projectGallerySlice(page);

    expect(slice.items).toBe(page.items);
    expect(slice.slides.map((slide) => slide.itemId)).toEqual(
      slice.items.map((entry) => entry.itemId),
    );
    expect(slice.slides[0]).toMatchObject({
      itemId: "placement-a",
      mediaId: mockImages.coastalLandscape.mediaId,
      width: mockImages.coastalLandscape.rendition.width,
      height: mockImages.coastalLandscape.rendition.height,
      alt: mockImages.coastalLandscape.alt,
      src: expect.stringContaining("/_next/image?url="),
      srcset: expect.stringContaining(" 640w"),
    });
    expect(slice.nextCursor).toBe("cursor-after-b");
  });

  it("projects the final page with no continuation cursor", () => {
    expect(
      projectGallerySlice({
        items: [item("last-placement")],
        page: { size: 24, hasNextPage: false, endCursor: null },
      }).nextCursor,
    ).toBeNull();
  });
});
