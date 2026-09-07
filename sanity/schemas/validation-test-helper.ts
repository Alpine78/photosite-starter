import type {
  SchemaValidation,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

type Check = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

type RuleState = {
  required: boolean;
  min?: number;
  max?: number;
  checks: Check[];
  level: "error" | "warning";
  message?: string;
};

/**
 * Sanity's builder clones on each call; only returned rules are evaluated.
 * custom() registers callbacks, warning(message?) changes the whole rule's
 * severity. Keep these semantics shared so a fake cannot conceal API misuse.
 * https://www.sanity.io/docs/studio/validation
 */
export function inspectValidationRules(validation: SchemaValidation | undefined) {
  const states = new Map<SchemaValidationRule, RuleState>();
  function make(state: RuleState): SchemaValidationRule {
    const rule: SchemaValidationRule = {
      required: () => make({ ...state, required: true }),
      min: (min) => make({ ...state, min }),
      max: (max) => make({ ...state, max }),
      custom: (check) => make({ ...state, checks: [...state.checks, check as Check] }),
      warning(message) {
        if (message !== undefined && typeof message !== "string") {
          throw new TypeError("warning accepts a message; register callbacks with custom");
        }
        return make({ ...state, level: "warning", message });
      },
    };
    states.set(rule, state);
    return rule;
  }

  const result = validation?.(make({ required: false, checks: [], level: "error" }));
  const rules = (result === undefined ? [] : Array.isArray(result) ? result : [result])
    .map((rule) => states.get(rule)!);
  const errors = rules.filter((rule) => rule.level === "error");
  const checksAt = (level: RuleState["level"]) => rules
    .filter((rule) => rule.level === level)
    .flatMap((rule) => rule.checks.map((check): Check => async (value, context) => {
      const result = await check(value, context);
      return result === true ? true : rule.message ?? result;
    }));
  return {
    rules,
    required: errors.some((rule) => rule.required),
    min: errors.find((rule) => rule.min !== undefined)?.min,
    max: errors.find((rule) => rule.max !== undefined)?.max,
    checks: checksAt("error"),
    warnings: checksAt("warning"),
  };
}
