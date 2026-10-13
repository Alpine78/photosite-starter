import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { withFullFrameMedia, FullFrameMedia } from "./full-frame-media";
import { withEditorialPreview } from "./editorial-preview";
import { withLocalizedPreview } from "./localized-preview";
import { defineSchemaTypes } from "../sanity/schemas";
import { localizedSchema } from "./localized-schema";
import { Schema } from "@sanity/schema";

describe("document-list full-frame media", () => {
  it.each(["media", "service", "homePage"])("also covers the %s photo preview without a custom prepare", (name) => {
    const source = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] }).find(x => x.name === name)!;
    const adapted = withFullFrameMedia(source);
    const selected = { title: "Authored title", subtitle: "Authored subtitle", media: { asset: { _ref: "image-abc123-200x300-webp" } } };
    const value = adapted.preview!.prepare!(selected);
    expect(value.title).toBe(selected.title);
    expect(value.subtitle).toBe(selected.subtitle);
    expect(isValidElement(value.media)).toBe(true);
    expect(source.preview).not.toBe(adapted.preview);
  });
  it("projects supported React media through the compiled, localized preview pipeline", () => {
    const source = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] });
    const prepared = source.map(withEditorialPreview).map(withLocalizedPreview).map(withFullFrameMedia);
    const schema = localizedSchema(Schema.compile({ name: "preview", types: prepared }), "fi-FI");
    const image = { _type: "image", asset: { _type: "reference", _ref: "image-abc123-1600x200-webp" }, crop: { top: .2 }, hotspot: { x: .1 } };
    const selection = { order: 0, title: "Container title missing", language: "fi", media: image };
    const value = schema.get("galleryPlacement")!.preview!.prepare!(selection);
    expect(value.title).toBe("Kuva 1 · Container title missing");
    expect(isValidElement(value.media)).toBe(true);
    if (!isValidElement<{ assetId: string }>(value.media)) throw new Error("Missing full-frame media");
    expect(value.media.type).toBe(FullFrameMedia);
    expect(value.media.props).toEqual({ assetId: image.asset._ref });
    expect(prepared.find((x) => x.name === "galleryPlacement")!.preview!.select)
      .toEqual(withEditorialPreview(source.find((x) => x.name === "galleryPlacement")!).preview!.select);
  });
});
