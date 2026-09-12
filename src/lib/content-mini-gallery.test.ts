import { describe, expect, it } from "vitest";
import { miniGalleryNames, miniGalleryImageBlocks } from "./content-mini-gallery";
import { listContentBodyImages } from "./content-body-media";
import { mockImages } from "./mock-media";
import type { ContentBlock } from "./content-page";

const gallery = (title?: string): ContentBlock => ({ type: "mini-gallery", title, items: [{ media: mockImages.forestStream }] });

describe("mini-gallery names", () => {
  it("numbers untitled galleries independently of other body blocks", () => {
    expect([...miniGalleryNames([gallery(), { type: "paragraph", text: "Text" }, gallery()], "Minigalleria")])
      .toEqual([[0, "Minigalleria 1"], [2, "Minigalleria 2"]]);
  });
  it("preserves unique authored titles and disambiguates repeated or fallback-like titles", () => {
    const names = [...miniGalleryNames([
      gallery("Mini-gallery 2"), gallery(), gallery("Details"), gallery("Details"),
      gallery("Details (4)"), gallery("Details (4) (4)"),
    ], "Mini-gallery").values()];
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe("Mini-gallery 2");
    expect(names[4]).toBe("Details (4)");
    expect(names[5]).toBe("Details (4) (4)");
  });
});

it("keeps repeated photographs as occurrences while excluding a video from slides", () => {
  const block: Extract<ContentBlock, { type: "mini-gallery" }> = {
    type: "mini-gallery", items: [
      { key: "mini-image-1", media: mockImages.forestStream },
      { media: mockImages.forestStream },
      { media: { type: "video", mediaId: "video", src: "/unused.mp4", title: "Video", width: 640, height: 360 } },
      { key: "last", media: mockImages.openMarsh },
    ],
  };
  const images = listContentBodyImages(miniGalleryImageBlocks(block));
  expect(images.map(i => i.index)).toEqual([0, 1, 2]);
  expect(new Set(images.map(i => i.itemId)).size).toBe(3);
  expect(images.map(i => i.media.mediaId)).toEqual(["forest-stream", "forest-stream", "open-marsh"]);
  expect(listContentBodyImages([
    { type: "media", media: mockImages.lichenStones }, block,
    { type: "media", media: mockImages.lakesideReeds },
  ]).map(i => i.media.mediaId)).toEqual(["lichen-stones", "lakeside-reeds"]);
});

it("adding a body mini-gallery leaves curated items, hasNextPage, and cursor unchanged", async () => {
  const { getMockGalleryResult } = await import("./mock-gallery");
  const { createHmacGalleryCursorCodec } = await import("./gallery-pagination");
  const { mockContentPages } = await import("./mock-content-pages");
  const codec = createHmacGalleryCursorCodec("test-only-mini-gallery-cursor-key-0123456789");
  const pages = mockContentPages.en as Map<string, import("./content-page").ContentPage>;
  const id = "content-large-archive";
  const original = pages.get(id)!;
  expect(original).toBeDefined();
  const before = await getMockGalleryResult("en-GB", id, { cursorCodec: codec });
  expect(before?.page.hasNextPage).toBe(true);
  try {
    pages.set(id, { ...original, body: [...original.body, gallery()] });
    const after = await getMockGalleryResult("en-GB", id, { cursorCodec: codec });
    expect(after).toEqual(before);
  } finally {
    pages.set(id, original);
  }
});
