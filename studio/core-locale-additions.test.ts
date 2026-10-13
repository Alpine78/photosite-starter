import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import { coreFinnishAdditions } from "./core-locales-fi";
import { coreEnglishSource } from "./core-locales-source";

const tokens = (value: string) => (value.match(/\{\{[^}]+\}\}|<\/?[A-Z][^>]*>/g) ?? []).sort();

describe("pinned Finnish core additions", () => {
  it("covers the 159 inventoried keys with unchanged interpolation and markup", () => {
    expect(Object.keys(coreFinnishAdditions).sort()).toEqual(Object.keys(coreEnglishSource).sort());
    let count = 0;
    for (const namespace of Object.keys(coreEnglishSource) as (keyof typeof coreEnglishSource)[]) {
      const source: Readonly<Record<string, string>> = coreEnglishSource[namespace];
      const translated: Readonly<Record<string, string>> = coreFinnishAdditions[namespace];
      expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort());
      for (const key of Object.keys(source)) {
        expect(translated[key].trim(), `${namespace}/${key}`).not.toBe("");
        expect(tokens(translated[key]), `${namespace}/${key}`).toEqual(tokens(source[key]));
        count++;
      }
    }
    expect(count).toBe(159);
  });
  it("renders added keys, plurals and unknown-key fallback through the installed translation engine", async () => {
    const engine = createInstance();
    await engine.init({
      lng: "fi-FI", fallbackLng: "en-US", interpolation: { escapeValue: false },
      resources: {
        "fi-FI": coreFinnishAdditions,
        "en-US": { ...coreEnglishSource, studio: { ...coreEnglishSource.studio, "future-message": "English fallback" } },
      },
    });
    expect(engine.t("common.error", { ns: "studio" })).toBe("Virhe");
    expect(engine.t("future-message", { ns: "studio" })).toBe("English fallback");
    const plural = engine.t("inputs.array.action.show-all-items", { ns: "studio", count: 7 });
    expect(plural).toContain("7");
    expect(plural).not.toContain("{{");
    expect(engine.t("revert-dialog.confirm-revert.summary-restore", { ns: "releases", count: 1 })).not.toContain("{{");
    await engine.changeLanguage("en-US");
    expect(engine.t("common.error", { ns: "studio" })).toBe("Error");
  });
});
