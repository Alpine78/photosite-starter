import { describe, expect, it } from "vitest";
import {
  indexContentBodyImages,
  isContentBodyImageBlock,
  listContentBodyImages,
} from "@/lib/content-body-media";
import type { ContentBlock } from "@/lib/content-page";
import type { VideoMedia } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

const video: VideoMedia = {
  type: "video",
  mediaId: "showcase-clip",
  src: "https://example.test/clip.mp4",
  title: "Showcase clip",
  width: 1920,
  height: 1080,
};

const paragraph: ContentBlock = { type: "paragraph", text: "Body copy." };
const heading: ContentBlock = { type: "heading", level: 2, text: "A section" };

describe("listContentBodyImages", () => {
  it("returns image placements in authored source order, skipping other blocks", () => {
    const images = listContentBodyImages([
      paragraph,
      { type: "media", media: mockImages.lichenStones },
      heading,
      { type: "media", media: mockImages.forestStream },
    ]);

    expect(images.map((image) => image.media.mediaId)).toEqual([
      "lichen-stones",
      "forest-stream",
    ]);
    expect(images.map((image) => image.index)).toEqual([0, 1]);
  });

  it("skips a video media block rather than carrying it toward a slide", () => {
    const images = listContentBodyImages([
      { type: "media", media: video },
      { type: "media", media: mockImages.forestStream },
      { type: "media", media: video },
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]?.media.mediaId).toBe("forest-stream");
    expect(images[0]?.index).toBe(0);
  });

  it("derives a stable per-occurrence id from the image ordinal when no key is set", () => {
    const images = listContentBodyImages([
      paragraph,
      { type: "media", media: mockImages.lichenStones },
      { type: "media", media: mockImages.forestStream },
    ]);

    expect(images.map((image) => image.itemId)).toEqual([
      "body-image-0",
      "body-image-1",
    ]);
  });

  it("prefers a block's own store key over the ordinal fallback", () => {
    const images = listContentBodyImages([
      { type: "media", media: mockImages.lichenStones, key: "sanity-key-a" },
      { type: "media", media: mockImages.forestStream, key: "sanity-key-b" },
    ]);

    expect(images.map((image) => image.itemId)).toEqual([
      "sanity-key-a",
      "sanity-key-b",
    ]);
  });

  it("gives the same photograph placed twice two distinct occurrence ids", () => {
    const images = listContentBodyImages([
      { type: "media", media: mockImages.forestStream },
      paragraph,
      { type: "media", media: mockImages.forestStream },
    ]);

    expect(images.map((image) => image.itemId)).toEqual([
      "body-image-0",
      "body-image-1",
    ]);
    expect(new Set(images.map((image) => image.media.mediaId)).size).toBe(1);
  });

  it("returns nothing for a body with no image placements", () => {
    expect(listContentBodyImages([paragraph, heading])).toEqual([]);
    expect(listContentBodyImages([{ type: "media", media: video }])).toEqual([]);
  });
});

describe("indexContentBodyImages", () => {
  it("keys each image by its position in the block array, not by image ordinal", () => {
    const byBlock = indexContentBodyImages([
      paragraph,
      { type: "media", media: mockImages.lichenStones },
      heading,
      { type: "media", media: video },
      { type: "media", media: mockImages.forestStream },
    ]);

    expect([...byBlock.keys()]).toEqual([1, 4]);
    expect(byBlock.get(1)?.index).toBe(0);
    expect(byBlock.get(4)?.index).toBe(1);
    expect(byBlock.get(4)?.itemId).toBe("body-image-1");
  });
});

describe("isContentBodyImageBlock", () => {
  it("accepts only an image media block", () => {
    expect(
      isContentBodyImageBlock({ type: "media", media: mockImages.forestStream }),
    ).toBe(true);
    expect(isContentBodyImageBlock({ type: "media", media: video })).toBe(false);
    expect(isContentBodyImageBlock(paragraph)).toBe(false);
  });
});
