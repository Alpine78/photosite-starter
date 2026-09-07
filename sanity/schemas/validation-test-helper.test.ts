import { describe, expect, it } from "vitest";

import { inspectValidationRules } from "./validation-test-helper";

describe("Sanity validation rule semantics", () => {
  it("rejects a callback passed to warning at both type and runtime boundaries", () => {
    expect(() => inspectValidationRules((rule) =>
      // @ts-expect-error Sanity warning accepts a message, never a callback.
      rule.warning(() => "not registered"),
    )).toThrow("register callbacks with custom");
  });

  it("changes the severity of the entire chain without mutating a sibling rule", () => {
    const { rules, required } = inspectValidationRules((rule) => [
      rule.required(),
      rule.required().custom(() => "advisory").warning(),
    ]);
    expect(required).toBe(true);
    expect(rules.map(({ required, level }) => ({ required, level }))).toEqual([
      { required: true, level: "error" },
      { required: true, level: "warning" },
    ]);
    expect(inspectValidationRules((rule) => rule.required().warning()).required).toBe(false);
  });

  it("does not evaluate a discarded chain", () => {
    const { checks, warnings, required } = inspectValidationRules((rule) => {
      rule.required().custom(() => "discarded");
      return rule.warning();
    });
    expect({ checks, warnings, required }).toEqual({ checks: [], warnings: [], required: false });
  });
});
