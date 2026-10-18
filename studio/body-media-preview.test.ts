import { afterAll, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { Schema } from "@sanity/schema";
import { CONTENT_BLOCK_OBJECT_TYPES } from "../sanity/schemas/content-block";
import { EDITORIAL_PREVIEWS, withEditorialPreview } from "./editorial-preview";
import { localizedEditorialPreview, withLocalizedPreview } from "./localized-preview";
import { localizedSchema } from "./localized-schema";
import { FullFrameMedia, withFullFrameMedia } from "./full-frame-media";

const type = CONTENT_BLOCK_OBJECT_TYPES.media;
const image = { _type: "image", asset: { _type: "reference", _ref: "image-abc123-1600x1000-webp" } };
const captions = [{ language: "fi", value: "Järvimaisema" }, { language: "en", value: "Lake landscape" }];
const selection = { captions, alternatives: [{ language: "fi", value: "Järvi" }], media: image };

afterAll(() => vi.unstubAllEnvs());

describe("body-image authored preview names", () => {
  it.each(["fi-FI", "en-US"])("prefers the untagged placement caption in %s without inventing a language", (locale) => {
    expect(localizedEditorialPreview(type, { ...selection, placementCaption: "  Authored placement  " }, locale))
      .toEqual({ title: "Authored placement", subtitle: locale === "fi-FI" ? "Kuvakohtainen kuvateksti" : "Placement caption", media: image });
  });

  it("reuses caption preference, array-order independence and actual fallback-language tags", () => {
    for (const rows of [captions, [...captions].reverse()]) {
      expect(localizedEditorialPreview(type, { ...selection, captions: rows }, "fi-FI")).toEqual({ title: "Järvimaisema", subtitle: "FI", media: image });
      expect(localizedEditorialPreview(type, { ...selection, captions: rows }, "en-US")).toEqual({ title: "Lake landscape", subtitle: "EN", media: image });
    }
    expect(localizedEditorialPreview(type, { captions: [{ language: "en", value: "Caption" }], alternatives: [{ language: "fi", value: "Vaihtoehto" }] }, "fi-FI"))
      .toMatchObject({ title: "Caption", subtitle: "EN" });
    const regional = { captions: [{ language: "en-US", value: "American" }, { language: "en-GB", value: "British" }] };
    expect(localizedEditorialPreview(type, regional, "en-GB")).toMatchObject({ title: "British", subtitle: "EN-GB" });
    expect(localizedEditorialPreview(type, regional, "fi-FI")).toMatchObject({ title: "British", subtitle: "EN-GB" });
  });

  it("uses alternative text only without a usable caption and reports untagged authored text honestly", () => {
    expect(localizedEditorialPreview(type, { captions: [null, { value: " " }], alternatives: [{ language: "sv", value: "Vid sjön" }] }, "fi-FI"))
      .toMatchObject({ title: "Vid sjön", subtitle: "SV" });
    expect(localizedEditorialPreview(type, { alternatives: [{ value: "Authored alt" }] }, "fi-FI"))
      .toMatchObject({ title: "Authored alt", subtitle: "Kieli puuttuu" });
  });

  it.each(["Media description missing", "Language missing", "joomla-content-501-image-109"])("keeps the authored text %s opaque", (value) => {
    expect(localizedEditorialPreview(type, { placementCaption: value }, "fi-FI")?.title).toBe(value);
    expect(localizedEditorialPreview(type, { captions: [{ language: "fi", value }] }, "fi-FI"))
      .toMatchObject({ title: value, subtitle: "FI" });
  });

  it.each(["fi-FI", "en-US"])("shows an explicit missing description in %s without using an identity", (locale) => {
    expect(localizedEditorialPreview(type, { placementCaption: " ", mediaId: "joomla-image-1", originalFilename: "image.jpg" }, locale))
      .toEqual({ title: locale === "fi-FI" ? "Median kuvaus puuttuu" : "Media description missing", subtitle: "", media: undefined });
  });

  it("adapts only the exact canonical object and preserves unrelated plugin preparation/options", () => {
    expect(type).toBe("contentMediaBlock");
    expect(EDITORIAL_PREVIEWS[type]?.select).toEqual({ placementCaption: "caption", captions: "media.caption", alternatives: "media.alt", media: "media.image" });
    const prepare = vi.fn((selected, options) => ({ ...selected, options }));
    const plugin = { name: "unrelatedImageObject", type: "object", fields: [], preview: { select: { title: "title", media: "image" }, prepare } };
    expect(withEditorialPreview(plugin)).toBe(plugin);
    expect(withLocalizedPreview(plugin)).toBe(plugin);
    const adapted = withFullFrameMedia(withLocalizedPreview(withEditorialPreview(plugin)));
    const options = { ordering: { name: "fixture", title: "Fixture order", by: [{ field: "title", direction: "asc" as const }] } };
    expect(adapted.preview!.prepare!({ title: "Authored title" }, options)).toMatchObject({ title: "Authored title", options });
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ title: "Authored title" }, options);
  });

  it("projects actual composed and compiled Studio selections, including full-frame media and dangling references", async () => {
    for (const [name, value] of Object.entries({ SANITY_STUDIO_PROJECT_ID: "example1", SANITY_STUDIO_DATASET: "example", SANITY_STUDIO_DATASET_VISIBILITY: "public", SANITY_STUDIO_TITLE: "Example Studio", SANITY_STUDIO_LOCALE_ROUTES: "en-GB||stories|services,fi|fi|tarinat|palvelut" })) vi.stubEnv(name, value);
    const { default: config } = await import("./sanity.config");
    const compiled = Schema.compile({ name: "body-preview", types: config.schema!.types });
    const referencedMedia = { mediaId: "joomla-content-501-image-109", caption: captions, alt: selection.alternatives, image };
    const readPath = (value: unknown, path: string) => path.split(".").reduce<unknown>((at, key) => at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined, value);
    for (const locale of ["fi-FI", "en-US"]) {
      const schema = localizedSchema(compiled, locale);
      const preview = schema.get(type)!.preview!;
      const render = (body: Readonly<Record<string, unknown>>) => preview.prepare!(Object.fromEntries(Object.entries(preview.select!).map(([name, path]) => [name, readPath(body, path)])));
      const value = render({ media: referencedMedia, caption: "Authored body caption" });
      expect(value.title).toBe("Authored body caption");
      expect(value.subtitle).toBe(locale === "fi-FI" ? "Kuvakohtainen kuvateksti" : "Placement caption");
      expect(value).toHaveProperty("photositeEditorial.type", type);
      expect(isValidElement(value.media)).toBe(true);
      if (!isValidElement<{ assetId: string }>(value.media)) throw new Error("Missing full-frame body preview");
      expect(value.media.type).toBe(FullFrameMedia);
      expect(value.media.props).toEqual({ assetId: image.asset._ref });
      expect(render({ media: referencedMedia }).title).toBe(locale === "fi-FI" ? "Järvimaisema" : "Lake landscape");
      expect(render({ media: { _type: "reference", _ref: "missing-media" } })).toMatchObject({ title: locale === "fi-FI" ? "Median kuvaus puuttuu" : "Media description missing", subtitle: "", media: undefined });
      expect(render({})).toMatchObject({ title: locale === "fi-FI" ? "Median kuvaus puuttuu" : "Media description missing", subtitle: "", media: undefined });
    }
  }, 30_000);
});
