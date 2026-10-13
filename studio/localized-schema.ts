import type { Schema } from "sanity";
import { studioInterfaceText } from "./interface-locales";
import { localizedEditorialPreview } from "./localized-preview";

/** Project compiled presentation metadata; never mutate schemas or stored values. */
export function localizedSchema(schema: Schema, locale: string): Schema {
  const projected = Object.create(schema) as Schema;
  const types = new Map<string, ReturnType<Schema["get"]>>();
  Object.defineProperty(projected, "get", { value: (name: string) => {
    if (types.has(name)) return types.get(name);
    const type = schema.get(name);
    if (!type) return type;
    const prepare = type.preview?.prepare;
    const adapted = {
      ...type,
      title: studioInterfaceText(type.title, locale),
      description: studioInterfaceText(type.description, locale),
      ...(prepare ? { preview: { ...type.preview, prepare(selection: Readonly<Record<string, unknown>>) {
        const original = prepare(selection);
        const localized = localizedEditorialPreview(name, selection, locale);
        return { ...original, ...(localized ? { title: localized.title, subtitle: localized.subtitle } : {}) };
      } } } : {}),
    };
    types.set(name, adapted);
    return adapted;
  } });
  return projected;
}
