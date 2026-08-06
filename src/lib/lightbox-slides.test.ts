import { describe, expect, it } from "vitest";
import type { GalleryResultItem } from "@/lib/gallery-result";
import {
  buildLightboxSlides,
  type LightboxRenditionResolver,
} from "@/lib/lightbox-slides";
import type { ImageMedia, Media, VideoMedia } from "@/lib/media";
import { buildPortfolioGallery } from "@/lib/mock-gallery";
import { mockImages } from "@/lib/mock-media";

/** Stands in for the host image pipeline; the projection must not need one. */
const resolveTestRendition: LightboxRenditionResolver = (media) => ({
  src: `/optimized${media.rendition.src}?w=2048`,
  srcset: `/optimized${media.rendition.src}?w=1024 1024w`,
});

function item(
  itemId: string,
  media: Media,
  mediaId = "mediaId" in media ? media.mediaId : "",
): GalleryResultItem<Media> {
  return { itemId, mediaId, media };
}

const videoMedia: VideoMedia = {
  type: "video",
  mediaId: "showcase-clip",
  src: "https://example.test/clip.mp4",
  title: "Showcase clip",
  width: 1920,
  height: 1080,
};

describe("buildLightboxSlides", () => {
  it("keeps the order of the shared result list", () => {
    const slides = buildLightboxSlides(
      [
        item("placement-c", mockImages.lakesideReeds),
        item("placement-a", mockImages.coastalLandscape),
        item("placement-b", mockImages.mistyBirch),
      ],
      resolveTestRendition,
    );

    expect(slides.map((slide) => slide.itemId)).toEqual([
      "placement-c",
      "placement-a",
      "placement-b",
    ]);
  });

  it("keeps item identity distinct from media identity", () => {
    const [slide] = buildLightboxSlides(
      [item("portfolio-coastal-landscape", mockImages.coastalLandscape)],
      resolveTestRendition,
    );

    expect(slide.itemId).toBe("portfolio-coastal-landscape");
    expect(slide.mediaId).toBe("coastal-landscape");
    expect(slide.itemId).not.toBe(slide.mediaId);
  });

  it("gives repeated placements of one photo distinct item identities", () => {
    const slides = buildLightboxSlides(
      [
        item("placement-first", mockImages.openMarsh),
        item("placement-second", mockImages.openMarsh),
      ],
      resolveTestRendition,
    );

    expect(slides.map((slide) => slide.itemId)).toEqual([
      "placement-first",
      "placement-second",
    ]);
    expect(new Set(slides.map((slide) => slide.mediaId)).size).toBe(1);
  });

  it("carries the derivative's true intrinsic dimensions, not a crop box", () => {
    const portrait = mockImages.forestStream;
    const [slide] = buildLightboxSlides(
      [item("placement-portrait", portrait)],
      resolveTestRendition,
    );

    expect(slide.width).toBe(portrait.rendition.width);
    expect(slide.height).toBe(portrait.rendition.height);
    expect(slide.width / slide.height).toBeCloseTo(
      portrait.rendition.width / portrait.rendition.height,
    );
  });

  it("delivers only the resolved public rendition", () => {
    const [slide] = buildLightboxSlides(
      [item("placement-a", mockImages.coastalLandscape)],
      resolveTestRendition,
    );

    expect(slide.src).toBe(
      "/optimized/gallery/coastal-landscape.1683eecb7e65.webp?w=2048",
    );
    expect(slide.srcset).toBe(
      "/optimized/gallery/coastal-landscape.1683eecb7e65.webp?w=1024 1024w",
    );
    expect(Object.keys(slide).toSorted()).toEqual([
      "alt",
      "height",
      "itemId",
      "mediaId",
      "src",
      "srcset",
      "width",
    ]);
  });

  it("carries the metadata the result resolved for the item", () => {
    const [slide] = buildLightboxSlides(
      [
        item("placement-a", {
          ...mockImages.coastalLandscape,
          caption: "Placement caption",
          credit: "A. Photographer",
        }),
      ],
      resolveTestRendition,
    );

    expect(slide.caption).toBe("Placement caption");
    expect(slide.credit).toBe("A. Photographer");
  });

  it("omits metadata the item does not carry rather than sending empty values", () => {
    const [slide] = buildLightboxSlides(
      [item("placement-a", mockImages.coastalLandscape)],
      resolveTestRendition,
    );

    expect(Object.hasOwn(slide, "caption")).toBe(false);
    expect(Object.hasOwn(slide, "credit")).toBe(false);
  });

  it("omits srcset when the resolver supplies a single source", () => {
    const [slide] = buildLightboxSlides(
      [item("placement-a", mockImages.coastalLandscape)],
      (media) => ({ src: media.rendition.src }),
    );

    expect(slide.src).toBe("/gallery/coastal-landscape.1683eecb7e65.webp");
    expect(Object.hasOwn(slide, "srcset")).toBe(false);
  });

  it("rejects media the lightbox cannot present rather than skipping it", () => {
    expect(() =>
      buildLightboxSlides(
        [
          item("placement-image", mockImages.coastalLandscape),
          item("placement-video", videoMedia),
        ],
        resolveTestRendition,
      ),
    ).toThrow(TypeError);
  });

  it("rejects a resolver that returns no public source", () => {
    expect(() =>
      buildLightboxSlides(
        [item("placement-a", mockImages.coastalLandscape)],
        () => ({ src: "" }),
      ),
    ).toThrow(/no public source/);
  });

  it("projects the portfolio result one slide per item, in result order", () => {
    const { result } = buildPortfolioGallery();
    const slides = buildLightboxSlides(result.items, resolveTestRendition);

    expect(slides).toHaveLength(result.items.length);
    expect(slides.map((slide) => slide.itemId)).toEqual(
      result.items.map((resultItem) => resultItem.itemId),
    );
    expect(slides.map((slide) => slide.alt)).toEqual(
      result.items.map((resultItem: { media: ImageMedia }) =>
        resultItem.media.alt,
      ),
    );
  });

  it("returns nothing for an empty result", () => {
    expect(buildLightboxSlides([], resolveTestRendition)).toEqual([]);
  });
});
