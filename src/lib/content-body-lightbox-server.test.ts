import { describe, expect, it, vi } from "vitest";

// The rendition boundary itself needs a Next build; here it only has to be
// called once per image with the media it is given.
const rendition = vi.hoisted(() => vi.fn((media: { rendition: { src: string } }) => ({ src: `${media.rendition.src}?viewer` })));
vi.mock("@/lib/lightbox-rendition-server", () => ({ resolveLightboxRendition: rendition }));

import { buildContentBodyLightboxSlides } from "./content-body-lightbox-server";
import { listContentBodyImages } from "./content-body-media";
import { mockContentPages } from "./mock-content-pages";
import type { ContentBlock } from "./content-page";

function bodyWithMostImages(): readonly ContentBlock[] {
  let best: readonly ContentBlock[] = [];
  for (const pages of Object.values(mockContentPages)) {
    for (const page of pages.values()) {
      if (listContentBodyImages(page.body).length > listContentBodyImages(best).length) best = page.body;
    }
  }
  return best;
}

describe("buildContentBodyLightboxSlides", () => {
  it("is empty for a body without image placements, so no viewer is mounted", () => {
    expect(buildContentBodyLightboxSlides([])).toEqual([]);
    expect(rendition).not.toHaveBeenCalled();
  });

  it("makes one slide per placement in authored order, through the rendition boundary", () => {
    const body = bodyWithMostImages();
    const images = listContentBodyImages(body);
    expect(images.length).toBeGreaterThan(1);
    const slides = buildContentBodyLightboxSlides(body);
    expect(slides.map((slide) => slide.itemId)).toEqual(images.map((image) => image.itemId));
    expect(slides.map((slide) => slide.mediaId)).toEqual(images.map((image) => image.media.mediaId));
    slides.forEach((slide, index) => {
      const image = images[index]!;
      expect(slide.src).toBe(`${image.media.rendition.src}?viewer`);
      // True intrinsic dimensions of the public derivative, never a crop box.
      expect([slide.width, slide.height]).toEqual([image.media.rendition.width, image.media.rendition.height]);
      // A placement caption overrides the media default; otherwise the media's own applies.
      expect(slide.caption).toBe(image.caption ?? image.media.caption);
    });
    expect(rendition).toHaveBeenCalledTimes(images.length);
  });
});
