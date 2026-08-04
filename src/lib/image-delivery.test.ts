import { describe, expect, it } from "vitest";
import {
  getLightboxImageSizes,
  imageRenderProfiles,
} from "@/lib/image-delivery";
import { projectPublicImageMedia } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

describe("bounded image render profiles", () => {
  it("matches the reviewed sizes declarations for current layouts", () => {
    expect(imageRenderProfiles).toEqual({
      portfolioGrid: {
        sizes:
          "(min-width: 1152px) 358px, (min-width: 1024px) calc(33.333vw - 26.667px), (min-width: 640px) calc(50vw - 32px), calc(100vw - 32px)",
      },
      serviceGrid: {
        sizes:
          "(min-width: 1152px) 352px, (min-width: 1024px) calc(33.333vw - 32px), (min-width: 640px) calc(50vw - 36px), calc(100vw - 32px)",
      },
      blogGrid: {
        sizes:
          "(min-width: 1152px) 347px, (min-width: 1024px) calc(33.333vw - 37.333px), (min-width: 640px) calc(50vw - 40px), calc(100vw - 32px)",
      },
      serviceContent: {
        sizes:
          "(min-width: 1152px) 736px, (min-width: 1024px) calc(100vw - 416px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
      },
      articleContent: {
        sizes:
          "(min-width: 768px) 720px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
      },
    });
  });

  it("caps the future lightbox sizes hint at the public source width", () => {
    expect(getLightboxImageSizes(mockImages.coastalLandscape.rendition)).toBe(
      "(min-width: 1568px) 1536px, calc(100vw - 32px)",
    );
  });

  it("applies the proposed terminal lightbox bound to wider sources", () => {
    const wideRendition = projectPublicImageMedia({
      mediaId: "wide-test-image",
      publiclyRenderable: true,
      rendition: {
        sourceKind: "public-web-derivative",
        src: "/gallery/wide-test-image.0123456789ab.webp",
        version: "0123456789ab",
        width: 8192,
        height: 4096,
      },
      alt: "Wide test image",
    }).rendition;

    expect(getLightboxImageSizes(wideRendition)).toBe(
      "(min-width: 3872px) 3840px, calc(100vw - 32px)",
    );
  });
});
