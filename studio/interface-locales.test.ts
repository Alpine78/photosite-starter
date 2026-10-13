import { describe, expect, it } from "vitest";
import { defineSchemaTypes } from "../sanity/schemas";
import { schemaFinnish } from "./schema-locales-fi";
import { validationFinnish } from "./validation-locales-fi";
import { studioInterfaceText, studioValidationMessage } from "./interface-locales";
import { localizedEditorialPreview } from "./localized-preview";

function textOf(node: unknown, found = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return found;
  const record = node as Record<string, unknown>;
  for (const key of ["title", "description"]) if (typeof record[key] === "string") found.add(record[key]);
  for (const key of ["fields", "of", "list"]) if (Array.isArray(record[key])) record[key].forEach((entry) => textOf(entry, found));
  if (record.options) textOf(record.options, found);
  return found;
}

describe("Studio-owned interface translations", () => {
  it.each(["public", "private"] as const)("covers every rendered %s schema label/help string", (datasetVisibility) => {
    const schemas = defineSchemaTypes({ datasetVisibility, storyRootPaths: ["/stories", "/fi/tarinat"] });
    for (const type of schemas) for (const text of textOf(type)) {
      expect(Object.hasOwn(schemaFinnish, text), text).toBe(true);
      expect(studioInterfaceText(text, "fi-FI")).toBeTruthy();
      expect(studioInterfaceText(text, "en-US")).toBe(text);
    }
  });
  it("preserves unknown messages and English wording", () => {
    expect(studioInterfaceText("An unknown future validator", "fi-FI")).toBe("An unknown future validator");
    expect(studioInterfaceText(undefined, "fi-FI")).toBeUndefined();
    expect(studioValidationMessage("Enter a non-empty value")).toMatchObject({ "en-US": "Enter a non-empty value", "fi-FI": "Anna muu kuin tyhjä arvo" });
  });
  it("preserves every dynamic validation parameter without evaluating its value", () => {
    for (const [source, finnish] of Object.entries(validationFinnish)) {
      const params = [...source.matchAll(/\{\{p(\d+)\}\}/g)].map((m) => Number(m[1]));
      if (!params.length) continue;
      const values = params.map((i) => `VALUE-${i}-\"<>&$\\{code}`);
      const message = source.replace(/\{\{p(\d+)\}\}/g, (_, i: string) => values[Number(i)]);
      const expected = finnish.replace(/\{\{p(\d+)\}\}/g, (_, i: string) => values[Number(i)]);
      expect(studioInterfaceText(message, "fi-FI"), source).toBe(expected);
    }
  });
  it("localizes fallback previews without translating authored titles or slugs", () => {
    expect(localizedEditorialPreview("article", { title: "Untitled page", slug: "Language missing", language: "en" }, "fi-FI"))
      .toEqual({ title: "Untitled page", subtitle: "EN · Language missing", media: undefined });
    expect(localizedEditorialPreview("article", {}, "fi-FI")).toEqual({ title: "Nimetön sivu", subtitle: "Kieli puuttuu", media: undefined });
    expect(localizedEditorialPreview("galleryPlacement", { order: 4, title: "Container title missing", language: "fi" }, "fi-FI"))
      .toEqual({ title: "Kuva 5 · Container title missing", subtitle: "FI", media: undefined });
    expect(localizedEditorialPreview("category", { labels: [{ value: "Category label missing", language: "fi" }] }, "fi-FI"))
      .toEqual({ title: "Category label missing", subtitle: "FI" });
  });
});
