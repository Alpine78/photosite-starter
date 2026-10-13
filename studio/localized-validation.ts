import type { Rule } from "sanity";
import type { SchemaValidation, SchemaValidationRule, SchemaTypeDefinition, SchemaValidationContext, SchemaValidationResult } from "../sanity/schemas/schema-types";
import { studioValidationMessage } from "./interface-locales";

/** Adapt only message results. Sanity retains its actual immutable Rule chain. */
export function localizedValidation(validation: SchemaValidation): (rule: Rule) => Rule | Rule[] {
  return (rule) => {
    const actual = new WeakMap<SchemaValidationRule, Rule>();
    function wrap(current: Rule): SchemaValidationRule {
      const wrapper: SchemaValidationRule = {
        required: () => wrap(current.required()),
        min: (value) => wrap(current.min(value)),
        max: (value) => wrap(current.max(value)),
        custom<TValue>(check: (value: TValue | undefined, context: SchemaValidationContext) => SchemaValidationResult | Promise<SchemaValidationResult>) {
          return wrap(current.custom((value, context) => {
            // This is the same dependency-free subset assertion as the schema
            // boundary. Pass the original context and retain sync/async behavior.
            const result = check(value as TValue | undefined, context as unknown as SchemaValidationContext);
            const localize = (message: SchemaValidationResult) => message === true ? true : studioValidationMessage(message);
            return result === true || typeof result === "string" ? localize(result) : result.then(localize);
          }));
        },
        warning: (message) => wrap(current.warning(message === undefined ? undefined : studioValidationMessage(message))),
      };
      actual.set(wrapper, current);
      return wrapper;
    }
    function unwrap(wrapper: SchemaValidationRule): Rule {
      const current = actual.get(wrapper);
      if (!current) throw new TypeError("Validation returned an unrelated rule");
      return current;
    }
    const result = validation(wrap(rule));
    return Array.isArray(result) ? result.map(unwrap) : unwrap(result);
  };
}

/** Preserve fields, options, previews and identity contracts; wrap all validators. */
export function withLocalizedValidation(type: SchemaTypeDefinition): SchemaTypeDefinition {
  function visit<T extends object>(value: T): T {
    const node = value as T & { validation?: SchemaValidation; fields?: object[]; of?: object[] };
    return {
      ...node,
      ...(node.validation ? { validation: localizedValidation(node.validation) } : {}),
      ...(node.fields ? { fields: node.fields.map(visit) } : {}),
      ...(node.of ? { of: node.of.map(visit) } : {}),
    } as T;
  }
  // The Studio asserts the full schema contract and validates the actual result.
  return visit(type);
}
