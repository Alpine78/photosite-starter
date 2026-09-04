import { describe, expect, it } from "vitest";
import {
  getLightboxImageSizes,
  getLightboxZoomCap,
  HERO_CHROME_RESERVE_PX,
  imageRenderProfiles,
  LIGHTBOX_MAX_CSS_WIDTH,
  LIGHTBOX_PRELOAD_WINDOW,
} from "@/lib/image-delivery";
import { projectPublicImageMedia } from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

describe("bounded image render profiles", () => {
  it("matches the reviewed sizes declarations for current layouts", () => {
    expect(imageRenderProfiles).toEqual({
      galleryGrid: {
        sizes:
          "(min-width: 1152px) 358px, (min-width: 1024px) calc(33.333vw - 26.667px), (min-width: 640px) calc(50vw - 32px), calc(100vw - 32px)",
      },
      serviceGrid: {
        sizes:
          "(min-width: 1152px) 352px, (min-width: 1024px) calc(33.333vw - 32px), (min-width: 640px) calc(50vw - 36px), calc(100vw - 32px)",
      },
      contentListingGrid: {
        sizes:
          "(min-width: 1152px) 347px, (min-width: 1024px) calc(33.333vw - 37.333px), (min-width: 640px) calc(50vw - 40px), calc(100vw - 32px)",
      },
      serviceContent: {
        sizes:
          "(min-width: 1152px) 736px, (min-width: 1024px) calc(100vw - 416px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
      },
      contentBody: {
        sizes:
          "(min-width: 768px) 720px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
      },
      galleryBody: {
        sizes:
          "(min-width: 816px) 768px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)",
      },
    });
  });

  it("caps the lightbox sizes hint at the public source width", () => {
    expect(getLightboxImageSizes(mockImages.coastalLandscape.rendition)).toBe(
      "(min-width: 1536px) 1536px, 100vw",
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
      "(min-width: 3840px) 3840px, 100vw",
    );
  });
});

/**
 * The library's own zoom-level arithmetic, restated so the cap can be checked
 * against it without a browser.
 *
 * Reproduced from PhotoSwipe 5.4.4 `src/js/slide/zoom-level.js`: `fit` is
 * bounded at 1 so an image is never enlarged past its own pixels, the
 * secondary level is three times `fit` under its own 4000-pixel clamp, the
 * maximum is four times `fit`, and the level a pinch can actually reach is the
 * largest of the three. That last step is why capping only some of them is not
 * enough.
 */
const PHOTOSWIPE_SECONDARY_ZOOM_CLAMP = 4000;

function photoSwipeZoomLevels(
  declaredWidth: number,
  declaredHeight: number,
  panArea: { readonly x: number; readonly y: number },
  cap: (level: number) => number,
) {
  const fit = Math.min(
    1,
    Math.min(panArea.x / declaredWidth, panArea.y / declaredHeight),
  );

  const initial = cap(fit);
  const uncappedSecondary = Math.min(1, fit * 3);
  const secondary = cap(
    uncappedSecondary * declaredWidth > PHOTOSWIPE_SECONDARY_ZOOM_CLAMP
      ? PHOTOSWIPE_SECONDARY_ZOOM_CLAMP / declaredWidth
      : uncappedSecondary,
  );
  const max = Math.max(initial, secondary, cap(Math.max(1, fit * 4)));

  return { fit, initial, secondary, max };
}

describe("lightbox preload window", () => {
  it("pins the decided one-back, two-forward bound (AB#79)", () => {
    expect(LIGHTBOX_PRELOAD_WINDOW).toEqual([1, 2]);
  });

  it("is small enough that opening a large gallery cannot download it whole", () => {
    const [before, after] = LIGHTBOX_PRELOAD_WINDOW;

    expect(Number.isInteger(before)).toBe(true);
    expect(Number.isInteger(after)).toBe(true);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThanOrEqual(0);
    // Far below any real gallery's item count, so a change to this constant
    // that accidentally widened it into "most of the gallery" fails here
    // before it ever reaches a browser.
    expect(before + after).toBeLessThanOrEqual(5);
  });
});

describe("hero chrome reserve", () => {
  it("is a positive integer pixel budget (ADR-0016)", () => {
    expect(Number.isInteger(HERO_CHROME_RESERVE_PX)).toBe(true);
    expect(HERO_CHROME_RESERVE_PX).toBeGreaterThan(0);
  });

  it("comfortably exceeds the header's real rendered height so the fold-safety guarantee never under-reserves", () => {
    // The header renders at roughly 61px today (py-4 padding plus one line
    // of text-lg type — see site-header.tsx), so the budget must clear that
    // with real margin for a taller clone (bigger type scale, a wrapped
    // two-line site name) without needing to change.
    expect(HERO_CHROME_RESERVE_PX).toBeGreaterThanOrEqual(90);
  });
});

describe("lightbox zoom cap", () => {
  const uncapped = (level: number) => level;

  it("leaves a source narrower than the declared slot alone", () => {
    const cap = getLightboxZoomCap(1536);

    // 2.5, not 1: the cap is a ceiling on the rendered slot, not on
    // magnification, and 1536 pixels may be shown across 3840 of them.
    expect(cap).toBeCloseTo(LIGHTBOX_MAX_CSS_WIDTH / 1536);
    expect(Math.min(1, cap)).toBe(1);
  });

  it("does not bound a width it cannot know", () => {
    expect(getLightboxZoomCap(0)).toBe(Number.POSITIVE_INFINITY);
    expect(getLightboxZoomCap(-1)).toBe(Number.POSITIVE_INFINITY);
  });

  it.each([
    { width: 1536, height: 1024, viewport: { x: 1280, y: 720 } },
    { width: 1254, height: 1254, viewport: { x: 393, y: 659 } },
    { width: 3840, height: 2160, viewport: { x: 3840, y: 2160 } },
    // Beyond the declared slot, and the reason the cap exists at all. Such a
    // derivative is permitted by the public media boundary's 8192 ceiling; no
    // current mock reaches it, so only this calculation catches the case.
    { width: 8192, height: 4096, viewport: { x: 5120, y: 2880 } },
    { width: 6000, height: 8000, viewport: { x: 2560, y: 1440 } },
  ])(
    "holds every zoom level of a $width x $height source inside the declared slot",
    ({ width, height, viewport }) => {
      // The whole viewport: the lightbox holds back no margin.
      const panArea = { x: viewport.x, y: viewport.y };
      const cap = (level: number) =>
        Math.min(level, getLightboxZoomCap(width));

      const levels = photoSwipeZoomLevels(width, height, panArea, cap);

      for (const [name, level] of Object.entries(levels)) {
        if (name === "fit") {
          continue;
        }
        expect(
          level * width,
          `${name} zoom renders ${level * width}px of slot`,
        ).toBeLessThanOrEqual(LIGHTBOX_MAX_CSS_WIDTH);
      }
    },
  );

  it("is the only thing keeping a wide source inside the slot", () => {
    const width = 8192;
    const panArea = { x: 5120, y: 2880 };

    const withoutCap = photoSwipeZoomLevels(width, 4096, panArea, uncapped);

    // The library's own clamps stop short of the declared slot, at its initial
    // level and again at the level a click zooms to. Without the project cap
    // the rendered slot would exceed what the `sizes` hint described, which is
    // the failure this test exists to catch.
    expect(withoutCap.initial * width).toBeGreaterThan(LIGHTBOX_MAX_CSS_WIDTH);
    expect(withoutCap.secondary * width).toBeGreaterThan(
      LIGHTBOX_MAX_CSS_WIDTH,
    );
    expect(withoutCap.max * width).toBeGreaterThan(LIGHTBOX_MAX_CSS_WIDTH);
  });

  it("would still be breached if only the initial and maximum levels were capped", () => {
    const width = 8192;
    const panArea = { x: 5120, y: 2880 };
    const declaredCap = getLightboxZoomCap(width);

    const fit = Math.min(
      1,
      Math.min(panArea.x / width, panArea.y / 4096),
    );
    const cappedInitial = Math.min(fit, declaredCap);
    const uncappedSecondary = Math.min(
      Math.min(1, fit * 3),
      PHOTOSWIPE_SECONDARY_ZOOM_CLAMP / width,
    );
    const effectiveMax = Math.max(
      cappedInitial,
      uncappedSecondary,
      Math.min(Math.max(1, fit * 4), declaredCap),
    );

    expect(effectiveMax * width).toBeGreaterThan(LIGHTBOX_MAX_CSS_WIDTH);
  });
});
