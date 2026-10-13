import { describe, expect, it } from "vitest";
import { Schema } from "@sanity/schema";
import { defineSchemaTypes } from "../sanity/schemas";
import { withEditorialPreview } from "./editorial-preview";
import { localizedSchema } from "./localized-schema";

describe("compiled Studio presentation projection", () => {
  it("preserves other SDK/plugin preview functions and their view options", () => {
    const schema = Schema.compile({ name: "plugin", types: [{
      name: "pluginDocument", type: "document", fields: [{ name: "title", type: "string" }],
      preview: { select: { title: "title" }, prepare: (selection: { title: string }, options?: { ordering?: { title?: string } }) => ({ title: options?.ordering?.title ?? selection.title }) },
    }] });
    const projected = localizedSchema(schema, "fi-FI").get("pluginDocument")!;
    expect(projected.preview).toBe(schema.get("pluginDocument")!.preview);
    expect(projected.preview!.prepare!({ title: "Authored value" }, { ordering: { name: "custom", title: "Sort title", by: [] } }).title).toBe("Sort title");
  });
  it("localizes document headers and placement lists without changing the canonical schema", () => {
    const schema = Schema.compile({ name: "editorial", types: defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] }).map(withEditorialPreview) });
    const article = schema.get("article")!;
    const fi = localizedSchema(schema, "fi-FI");
    const en = localizedSchema(schema, "en-US");
    expect(fi.get("article")!.title).toBe("Artikkeli");
    expect(fi.get("article")!.description).not.toBe(article.description);
    expect(en.get("article")!.title).toBe(article.title);
    expect(fi.get("article")!.fields).toBe(article.fields);
    expect(fi.get("article")!.validation).toBe(article.validation);
    expect(fi.get("article")).toBe(fi.get("article"));
    expect(schema.get("article")).toBe(article);
    expect(schema.get("article")!.title).toBe("Article");
    const selected = { order: 3, title: "Container title missing", language: "fi" };
    expect(fi.get("galleryPlacement")!.preview!.prepare!(selected).title).toBe("Kuva 4 · Container title missing");
    expect(en.get("galleryPlacement")!.preview!.prepare!(selected).title).toBe("Image 4 · Container title missing");
    expect(fi.getTypeNames()).toEqual(schema.getTypeNames());
    expect(fi.get("unknown")).toBeUndefined();
  });
});
