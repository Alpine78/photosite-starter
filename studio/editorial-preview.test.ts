import { describe, expect, it } from "vitest";
import { defineSchemaTypes } from "../sanity/schemas";
import type { SchemaFieldDefinition } from "../sanity/schemas/schema-types";
import { EDITORIAL_PREVIEWS, withEditorialPreview } from "./editorial-preview";
import { previewImageId } from "./preview-image";

const image = { asset: { _ref: "image-synthetic-400x1600-jpg" } };
const schemas = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] });

function prepare(type: string, selection: Record<string, unknown>) {
  const schema = schemas.find(({ name }) => name === type)!;
  return withEditorialPreview(schema).preview!.prepare!(selection);
}

describe("readable editorial previews", () => {
  it.each(["article", "gallery"])("distinguishes %s siblings with equal titles and slugs", (type) => {
    const selection = { title: "Coastal visit", slug: "coastal-visit", media: image };
    const fi = prepare(type, { ...selection, language: "fi" });
    const en = prepare(type, { ...selection, language: "en" });
    expect(fi).toEqual({ title: "Coastal visit", subtitle: "FI · coastal-visit", media: image });
    expect(en).toEqual({ title: "Coastal visit", subtitle: "EN · coastal-visit", media: image });
  });

  it("supports other locales without changing regional tag spelling", () => {
    expect(prepare("article", { title: "Walk", language: "sv" }).subtitle).toBe("SV");
    expect(prepare("gallery", { title: "Walk", language: "en-GB" }).subtitle).toBe("EN-GB");
  });

  it("does not infer draft titles or languages from technical IDs", () => {
    expect(prepare("article", { title: " ", contentId: "legacy-content-42-en" })).toEqual({
      title: "Untitled page", subtitle: "Language missing", media: undefined,
    });
  });

  it("uses authored category labels and distinguishes equal translated labels", () => {
    expect(prepare("category", { labels: [
      { language: "sv", value: "Kust" }, { language: "en", value: "Coast" },
    ] })).toEqual({ title: "Kust / Coast", subtitle: "SV / EN" });
    expect(prepare("category", { labels: [
      { language: "fi", value: "Portfolio" }, { language: "en", value: "Portfolio" },
    ] })).toEqual({ title: "Portfolio / Portfolio", subtitle: "FI / EN" });
  });

  it.each([undefined, null, {}, [], [null, 3, [], { value: " " }]])("handles missing or malformed category labels %#", (labels) => {
    expect(prepare("category", { labels })).toEqual({ title: "Category label missing", subtitle: "Language missing" });
  });

  it("keeps a draft label with missing language visibly incomplete", () => {
    expect(prepare("category", { labels: [null, { value: "Coast" }, { language: "sv", value: "Kust" }] })).toEqual({
      title: "Coast / Kust", subtitle: "Language missing / SV",
    });
  });

  it.each(["galleryPlacement", "articleEndGalleryPlacement"])("distinguishes %s occurrences and their language siblings", (type) => {
    const selection = { title: "Coastal visit", language: "fi", media: image };
    expect(prepare(type, { ...selection, order: 0 })).toEqual({
      title: "Image 1 · Coastal visit", subtitle: "FI", media: image,
    });
    expect(prepare(type, { ...selection, order: 30, language: "en" })).toEqual({
      title: "Image 31 · Coastal visit", subtitle: "EN", media: image,
    });
    expect(previewImageId(prepare(type, { ...selection, order: 1 }).media)).toBe(image.asset._ref);
  });

  it.each([undefined, null, "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("does not invent a position for an invalid order: %s", (order) => {
    for (const type of ["galleryPlacement", "articleEndGalleryPlacement"]) {
      expect(prepare(type, { order })).toEqual({
        title: "Position missing · Container title missing", subtitle: "Language missing", media: undefined,
      });
    }
  });

  it("shows authored order rather than computing rank for a sparse sequence", () => {
    const selection = { title: "Coastal visit", language: "en", order: 100 };
    expect(prepare("galleryPlacement", selection).title).toBe("Image 101 · Coastal visit");
  });
});

describe("Studio adapter and selection boundary", () => {
  it("changes only preview metadata and leaves canonical schemas intact", () => {
    for (const canonical of schemas) {
      const originalPreview = canonical.preview;
      const adapted = withEditorialPreview(canonical);
      expect({ ...adapted, preview: originalPreview }).toEqual(canonical);
      expect(adapted.fields).toBe(canonical.fields);
      expect(adapted.validation).toBe(canonical.validation);
      expect(canonical.preview).toBe(originalPreview);
      if (!EDITORIAL_PREVIEWS[canonical.name]) expect(adapted).toBe(canonical);
    }
    const object = { ...schemas.find(({ name }) => name === "article")!, type: "object" as const };
    expect(withEditorialPreview(object)).toBe(object);
  });

  it.each(["otherPage", "constructor", "toString"])("passes through an unknown document type named %s", (name) => {
    const schema = { ...schemas.find(({ name }) => name === "article")!, name };
    expect(withEditorialPreview(schema)).toBe(schema);
  });

  it("resolves every overridden name and selected field path against canonical fields and references", () => {
    for (const [name, preview] of Object.entries(EDITORIAL_PREVIEWS)) {
      const schema = schemas.find((schema) => schema.name === name);
      expect(schema?.type).toBe("document");
      for (const path of Object.values(preview!.select)) {
        let fields: readonly SchemaFieldDefinition[] = schema!.fields;
        for (const part of path.split(".")) {
          const field = fields.find(({ name }) => name === part);
          expect(field, `${name}: ${path}`).toBeDefined();
          fields = field!.type === "reference"
            ? schemas.find(({ name }) => name === field!.to?.[0].type)!.fields
            : field!.fields ?? [];
        }
      }
    }
  });

  it("selects only the existing public image for every new photographic preview", () => {
    expect(EDITORIAL_PREVIEWS.galleryPlacement!.select).toEqual({
      title: "gallery.title", language: "gallery.language", order: "order", media: "media.image",
    });
    expect(EDITORIAL_PREVIEWS.articleEndGalleryPlacement!.select).toEqual({
      title: "article.title", language: "article.language", order: "order", media: "media.image",
    });
    for (const type of ["article", "gallery"]) expect(EDITORIAL_PREVIEWS[type]!.select.media).toBe("cover.image");
  });
});
