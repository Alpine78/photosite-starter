import { afterAll, describe, expect, it, vi } from "vitest";
import { Schema } from "@sanity/schema";

afterAll(() => vi.unstubAllEnvs());

describe("actual Studio configuration composition", () => {
  it("registers readable document/reference previews and the native identity fieldset", async () => {
    for (const [name, value] of Object.entries({
      SANITY_STUDIO_PROJECT_ID: "example1", SANITY_STUDIO_DATASET: "example",
      SANITY_STUDIO_DATASET_VISIBILITY: "public", SANITY_STUDIO_TITLE: "Example Studio",
      SANITY_STUDIO_LOCALE_ROUTES: "en-GB||stories|services,fi|fi|tarinat|palvelut",
    })) vi.stubEnv(name, value);
    const { default: config } = await import("./sanity.config");
    const types = config.schema!.types;
    expect(Array.isArray(types)).toBe(true);
    const compiled = Schema.compile({ name: "configured", types });
    expect(compiled.get("category")?.preview?.prepare?.({ labels: [{ value: "Coast", language: "en" }] }).title).toBe("Coast");
    expect(compiled.get("galleryPlacement")?.preview?.prepare?.({ title: "Coast", language: "en", order: 2 }).title).toBe("Image 3 · Coast");
    expect(compiled.get("articleEndGalleryPlacement")?.preview?.prepare?.({ title: "Story", language: "fi", order: 0 }).title).toBe("Image 1 · Story");
    expect(compiled.get("media")?.preview?.prepare?.({ alternatives: [{ value: "Coastal view", language: "en" }] }).title).toBe("Coastal view");
    expect(compiled.get("category")?.fieldsets.some((group) => !group.single && group.name === "photositeTechnicalIdentifiers")).toBe(true);
  }, 30_000);
});
