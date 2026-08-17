import { describe, expect, it } from "vitest";
import { buildLightboxCaption } from "@/lib/lightbox-caption";
import { buildLightboxSlides } from "@/lib/lightbox-slides";
import {
  getMockGalleryResult,
  MOCK_FEATURED_GALLERY_ID,
} from "@/lib/mock-gallery";

/**
 * The featured gallery's English result. The fixture must publish it, so an
 * absent one is a fixture defect rather than a case these tests tolerate.
 */
async function requireFeaturedGallery() {
  const result = await getMockGalleryResult("en", MOCK_FEATURED_GALLERY_ID);
  if (result === undefined) {
    throw new Error("the mock fixture publishes no featured gallery");
  }
  return result;
}

describe("buildLightboxCaption", () => {
  it("presents the caption before the credit", () => {
    expect(
      buildLightboxCaption({ caption: "Quiet coast", credit: "A. Photographer" }),
    ).toEqual([
      { kind: "caption", text: "Quiet coast" },
      { kind: "credit", text: "A. Photographer" },
    ]);
  });

  it("presents a caption that has no credit", () => {
    expect(buildLightboxCaption({ caption: "Quiet coast" })).toEqual([
      { kind: "caption", text: "Quiet coast" },
    ]);
  });

  it("presents a credit that has no caption", () => {
    expect(buildLightboxCaption({ credit: "A. Photographer" })).toEqual([
      { kind: "credit", text: "A. Photographer" },
    ]);
  });

  it("presents nothing for an item that carries neither", () => {
    expect(buildLightboxCaption({})).toEqual([]);
  });

  it("treats blank text as nothing to say", () => {
    expect(buildLightboxCaption({ caption: "   ", credit: "" })).toEqual([]);
  });

  it("drops only the blank part of an item that also carries text", () => {
    expect(
      buildLightboxCaption({ caption: "\n ", credit: "A. Photographer" }),
    ).toEqual([{ kind: "credit", text: "A. Photographer" }]);
  });

  it("trims authored whitespace off the text it presents", () => {
    expect(buildLightboxCaption({ caption: "  Quiet coast\n" })).toEqual([
      { kind: "caption", text: "Quiet coast" },
    ]);
  });

  it("presents each gallery slide from the metadata that slide carries", async () => {
    const result = await requireFeaturedGallery();
    const slides = buildLightboxSlides(result.items, (media) => ({
      src: media.rendition.src,
    }));

    const presented = slides.map((slide) => ({
      itemId: slide.itemId,
      lines: buildLightboxCaption(slide).map((part) => part.text),
    }));

    expect(presented).toEqual(
      result.items.map((item) => ({
        itemId: item.itemId,
        lines: [item.media.caption, item.media.credit].filter(
          (text) => text !== undefined,
        ),
      })),
    );
  });
});
