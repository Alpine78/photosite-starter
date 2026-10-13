import { describe, expect, it } from "vitest";
import { Rule } from "@sanity/schema";
import { localizedValidation, withLocalizedValidation } from "./localized-validation";
import { defineSchemaTypes } from "../sanity/schemas";
import type { SchemaValidationContext } from "../sanity/schemas/schema-types";

const context = { document: { _id: "drafts.synthetic" }, getClient: () => { throw new Error("Unexpected CMS access"); } } satisfies SchemaValidationContext;

describe("localized immutable validation rules", () => {
  it("preserves required/min/max, async context, result, warning severity and order", async () => {
    let seen: SchemaValidationContext | undefined;
    const validation = localizedValidation((rule) => [
      rule.required().min(2).max(7).custom<string>(async (value, supplied) => {
        seen = supplied;
        return value === "valid" ? true : "Enter a non-empty value";
      }),
      rule.custom(() => "Enter non-empty text").warning("Enter a non-empty value"),
    ]);
    const original = new Rule();
    const result = validation(original) as Rule[];
    expect(result[0].isRequired()).toBe(true);
    expect(result[0]._rules.map((entry) => entry.flag)).toEqual(["presence", "min", "max", "custom"]);
    expect(result[1]._level).toBe("warning");
    expect(result[1]._message).toMatchObject({ "en-US": "Enter a non-empty value", "fi-FI": "Anna muu kuin tyhjä arvo" });
    const check = result[0]._rules.find((entry) => entry.flag === "custom");
    if (!check || check.flag !== "custom") throw new Error("Missing actual custom rule");
    expect(await check.constraint("valid", context as never)).toBe(true);
    expect(await check.constraint("", context as never)).toMatchObject({ "en-US": "Enter a non-empty value", "fi-FI": "Anna muu kuin tyhjä arvo" });
    expect(seen).toBe(context);
    expect(original._rules).toEqual([]);
  });
  it("preserves rejection when the original async validator throws", async () => {
    const adapted = localizedValidation((rule) => rule.custom(async () => { throw new Error("Provider failure"); }))(new Rule()) as Rule;
    const custom = adapted._rules.find((entry) => entry.flag === "custom");
    if (!custom || custom.flag !== "custom") throw new Error("Missing custom rule");
    await expect(custom.constraint(undefined, context as never)).rejects.toThrow("Provider failure");
  });
  it("keeps canonical schema objects, options, initial values and preview selections unchanged", () => {
    const schemas = defineSchemaTypes({ datasetVisibility: "private", storyRootPaths: ["/stories"] });
    function withoutValidation(node: unknown): unknown {
      if (Array.isArray(node)) return node.map(withoutValidation);
      if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "validation").map(([key, value]) => [key, withoutValidation(value)]));
      return node;
    }
    for (const schema of schemas) {
      const adapted = withLocalizedValidation(schema);
      expect(withoutValidation(adapted)).toEqual(withoutValidation(schema));
      expect(adapted).not.toBe(schema);
    }
  });
});
