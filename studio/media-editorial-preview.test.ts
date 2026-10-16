import { describe, expect, it } from "vitest";
import { EDITORIAL_PREVIEWS, selectMediaDescription } from "./editorial-preview";
import { localizedEditorialPreview } from "./localized-preview";

const media = { asset: { _ref: "image-synthetic-800x1200-jpg" } };
describe("shared-media authored preview names", () => {
  it("chooses the actual interface-language caption independently of array order", () => {
    const selection = { captions: [{ language: "fi", value: "Rannalla" }, { language: "en", value: "On the coast" }], media };
    for (const captions of [selection.captions, [...selection.captions].reverse()]) {
      expect(localizedEditorialPreview("media", { ...selection, captions }, "fi-FI")).toEqual({ title: "Rannalla", subtitle: "FI", media });
      expect(localizedEditorialPreview("media", { ...selection, captions }, "en-US")).toEqual({ title: "On the coast", subtitle: "EN", media });
    }
  });
  it("preserves regional language tags and identifies a real fallback language", () => {
    const captions = [{ language: "en-US", value: "American" }, { language: "en-GB", value: "British" }];
    expect(localizedEditorialPreview("media", { captions }, "en-GB")).toMatchObject({ title: "British", subtitle: "EN-GB" });
    expect(localizedEditorialPreview("media", { captions }, "fi-FI")).toMatchObject({ title: "British", subtitle: "EN-GB" });
  });
  it("uses existing alternative text without deriving a title from legacy identities or filenames", () => {
    const selection = { captions: [null, { value: " " }], alternatives: [{ language: "fi", value: "Järvimaisema" }], credit: "Fixture credit", media, mediaId: "joomla-image-1" };
    expect(localizedEditorialPreview("media", selection, "en-US")).toEqual({ title: "Järvimaisema", subtitle: "FI · Fixture credit", media });
    expect(localizedEditorialPreview("media", { mediaId: "joomla-image-1", credit: "Authored credit", media }, "fi-FI"))
      .toEqual({ title: "Median kuvaus puuttuu", subtitle: "Kieli puuttuu · Authored credit", media });
  });
  it("never translates authored values that happen to equal fallback UI text", () => {
    expect(localizedEditorialPreview("media", { captions: [{ value: "Media description missing", language: "fi" }], credit: "Language missing" }, "fi-FI"))
      .toMatchObject({ title: "Media description missing", subtitle: "FI · Language missing" });
    expect(selectMediaDescription({ captions: [{ value: "Untitled" }] }, "fi-FI")).toEqual({ value: "Untitled", language: undefined });
    expect(EDITORIAL_PREVIEWS.media?.select).toEqual({ captions: "caption", alternatives: "alt", credit: "credit", media: "image" });
  });
});
