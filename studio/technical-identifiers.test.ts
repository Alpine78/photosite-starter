import { describe, expect, it } from "vitest";
import { Schema } from "@sanity/schema";
import { defineSchemaTypes } from "../sanity/schemas";
import { withTechnicalIdentifiers } from "./technical-identifiers";
import { studioInterfaceText } from "./interface-locales";

describe("Studio technical identity presentation", () => {
  it.each(["public", "private"] as const)("preserves every %s value/validation/reference contract", (datasetVisibility) => {
    const types = defineSchemaTypes({ datasetVisibility, storyRootPaths: ["/stories"] });
    const adapted = types.map(withTechnicalIdentifiers);
    for (let index = 0; index < types.length; index++) {
      const original = types[index], view = adapted[index];
      expect(view.validation).toBe(original.validation);
      expect(view.preview).toBe(original.preview);
      expect(view.fields).toHaveLength(original.fields.length);
      for (const field of original.fields) {
        const rendered = view.fields.find(({ name }) => name === field.name)!;
        expect({ ...rendered, title: field.title, fieldset: undefined }).toEqual({ ...field, fieldset: undefined });
        expect(rendered.validation).toBe(field.validation);
        expect(rendered.to).toBe(field.to);
        if (rendered !== field) {
          expect(rendered.fieldset).toBe("photositeTechnicalIdentifiers");
          expect(studioInterfaceText(rendered.title, "fi-FI")).not.toBe(rendered.title);
        }
      }
      if (view.fieldsets) {
        expect(view.fieldsets.at(-1)?.options).toEqual({ collapsible: true, collapsed: false });
        expect(view.fields.at(-1)?.fieldset).toBe("photositeTechnicalIdentifiers");
        expect(withTechnicalIdentifiers(view)).toBe(view);
      } else expect(view).toBe(original);
    }
    const compiled = Schema.compile({ name: "technical", types: adapted });
    expect(compiled.get("category")?.fieldsets.some((group) => !group.single && group.name === "photositeTechnicalIdentifiers")).toBe(true);
    // Reordering the Studio form never changes the dependency-free definitions.
    expect(types.find(({ name }) => name === "category")?.fields[0].name).toBe("categoryId");
  });
});
