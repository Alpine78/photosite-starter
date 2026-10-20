import { describe, expect, it } from "vitest";
import { effectiveGalleryPresentation, GALLERY_LAYOUTS, GALLERY_CAPTION_PLACEMENTS,
  GALLERY_CONTINUATIONS, readGalleryPresentationFields } from "@/lib/gallery-presentation";
import { mockContentPages } from "@/lib/mock-content-pages";
import { galleryPresentationFields } from "../../sanity/schemas/gallery-presentation";
import { inspectValidationRules } from "../../sanity/schemas/validation-test-helper";

describe("gallery presentation inheritance", () => {
  it("defaults old deployments and independently restores each cleared override", () => {
    expect(effectiveGalleryPresentation({}, {}))
      .toEqual({ layout: "justified", captionPlacement: "below", continuation: "endless" });
    const site = { galleryLayout: "masonry", galleryCaptionPlacement: "overlay", galleryContinuation: "button" } as const;
    expect(effectiveGalleryPresentation({ galleryLayout: "justified" }, site))
      .toEqual({ layout: "justified", captionPlacement: "overlay", continuation: "button" });
    expect(effectiveGalleryPresentation({ galleryCaptionPlacement: "below" }, site))
      .toEqual({ layout: "masonry", captionPlacement: "below", continuation: "button" });
    expect(effectiveGalleryPresentation({ galleryContinuation: "automatic-then-button" }, site))
      .toEqual({ layout: "masonry", captionPlacement: "overlay", continuation: "automatic-then-button" });
    expect(effectiveGalleryPresentation({}, site))
      .toEqual({ layout: "masonry", captionPlacement: "overlay", continuation: "button" });
  });

  it("reads every continuation mode, preserves absence and rejects unknown values (AB#374)", () => {
    const reject = (message: string): never => { throw new Error(message); };
    expect(readGalleryPresentationFields({ galleryContinuation: null }, reject)).toEqual({});
    for (const galleryContinuation of GALLERY_CONTINUATIONS) {
      expect(readGalleryPresentationFields({ galleryContinuation }, reject)).toEqual({ galleryContinuation });
    }
    for (const value of ["", "infinite", [], {}, 1, false]) {
      expect(() => readGalleryPresentationFields({ galleryContinuation: value }, reject)).toThrow();
    }
  });

  it("accepts all six independent combinations and preserves absence", () => {
    const reject = (message: string): never => { throw new Error(message); };
    expect(readGalleryPresentationFields({ galleryLayout: null, galleryCaptionPlacement: null }, reject)).toEqual({});
    for (const galleryLayout of GALLERY_LAYOUTS) for (const galleryCaptionPlacement of GALLERY_CAPTION_PLACEMENTS) {
      expect(readGalleryPresentationFields({ galleryLayout, galleryCaptionPlacement }, reject))
        .toEqual({ galleryLayout, galleryCaptionPlacement });
    }
    for (const value of ["", "columns", [], {}, 1, false]) {
      expect(() => readGalleryPresentationFields({ galleryLayout: value }, reject)).toThrow();
      expect(() => readGalleryPresentationFields({ galleryCaptionPlacement: value }, reject)).toThrow();
    }
  });

  it("authors all choices without silently creating a per-gallery override", () => {
    for (const inherit of [true, false]) {
      const fields = galleryPresentationFields(inherit);
      expect(fields[0].options?.list?.map((entry) => typeof entry === "string" ? entry : entry.value)).toEqual(GALLERY_LAYOUTS);
      expect(fields[1].options?.list?.map((entry) => typeof entry === "string" ? entry : entry.value)).toEqual(GALLERY_CAPTION_PLACEMENTS);
      expect(fields[2].options?.list?.map((entry) => typeof entry === "string" ? entry : entry.value)).toEqual(GALLERY_CONTINUATIONS);
      for (const field of fields) expect(field).not.toHaveProperty("initialValue");
    }
  });

  it("keeps the Studio schema's own validation in step with GALLERY_LAYOUTS/GALLERY_CAPTION_PLACEMENTS", async () => {
    // `options.list` is already pinned to the constants above. The `rule.custom`
    // predicate is a second, independent literal array in the schema file (schemas
    // import nothing from src/lib, so it cannot import the constants directly) —
    // this runs that predicate itself against the real constants, so a future
    // layout or caption placement added to one array and missed in the other
    // fails here rather than only surfacing as a live publish a visitor's read
    // later rejects.
    const [layoutField, captionField, continuationField] = galleryPresentationFields(true);
    const layoutChecks = inspectValidationRules(layoutField.validation).checks;
    const captionChecks = inspectValidationRules(captionField.validation).checks;
    const continuationChecks = inspectValidationRules(continuationField.validation).checks;
    const context = { getClient: () => { throw new Error("not needed"); } };

    for (const value of GALLERY_LAYOUTS) {
      for (const check of layoutChecks) expect(await check(value, context)).toBe(true);
    }
    for (const value of GALLERY_CAPTION_PLACEMENTS) {
      for (const check of captionChecks) expect(await check(value, context)).toBe(true);
    }
    for (const check of layoutChecks) {
      expect(await check("unsupported-layout", context)).not.toBe(true);
    }
    for (const check of captionChecks) {
      expect(await check("unsupported-placement", context)).not.toBe(true);
    }
    for (const value of GALLERY_CONTINUATIONS) {
      for (const check of continuationChecks) expect(await check(value, context)).toBe(true);
    }
    for (const check of continuationChecks) {
      expect(await check("unsupported-continuation", context)).not.toBe(true);
    }
  });

  it("serves all combinations through the mock content boundary in both languages", () => {
    for (const pages of Object.values(mockContentPages)) {
      const offered = new Set([...pages.values()].filter((page) => page.variant === "gallery")
        .map((page) => {
          const { layout, captionPlacement } = effectiveGalleryPresentation(page, {});
          return JSON.stringify({ layout, captionPlacement });
        }));
      for (const layout of GALLERY_LAYOUTS) for (const captionPlacement of GALLERY_CAPTION_PLACEMENTS) {
        expect(offered.has(JSON.stringify({ layout, captionPlacement }))).toBe(true);
      }
    }
  });
});
