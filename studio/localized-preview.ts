import { EDITORIAL_PREVIEWS, mediaEditorialPreview, selectMediaDescription } from "./editorial-preview";
import { studioInterfaceText } from "./interface-locales";
import type { SchemaTypeDefinition } from "../sanity/schemas/schema-types";

type Selection = Readonly<Record<string, unknown>>;
type Preview = { title: string; subtitle: string; media?: unknown };
type EditorialSchema = SchemaTypeDefinition & { preview?: { select: Readonly<Record<string, string>>; prepare?: (selection: Selection) => Preview } };

/** Preserve actual authored titles, labels and slugs even if they resemble UI copy. */
export function localizedEditorialPreview(type: string, selection: Selection, locale: string): Preview | undefined {
  const prepare = EDITORIAL_PREVIEWS[type]?.prepare;
  if (!prepare) return undefined;
  const original = type === "media" ? mediaEditorialPreview(selection, locale) : prepare(selection);
  if (!/^fi(?:-|$)/.test(locale)) return original;
  const translate = (value: string) => studioInterfaceText(value, locale) ?? value;
  const missing = (value: unknown) => typeof value !== "string" || !value.trim();
  if (type === "clientDeliveryGallery") {
    const selected = selectMediaDescription({ alternatives: selection.titles }, locale);
    return { title: selected?.value ?? translate("Client gallery"), subtitle: translate("Unlisted public delivery"), media: selection.media };
  }
  if (type === "media") {
    const selected = selectMediaDescription(selection, locale);
    const preview = mediaEditorialPreview(selection, locale);
    const tag = selected?.language;
    const credit = typeof selection.credit === "string" ? selection.credit.trim() : undefined;
    return { ...preview,
      title: selected ? selected.value : translate("Media description missing"),
      subtitle: [tag ? tag.replace(/^[a-z]{2,3}(?=-|$)/, (primary) => primary.toUpperCase()) : translate("Language missing"), credit].filter(Boolean).join(" · "),
    };
  }
  if (type === "article" || type === "gallery") {
    return {
      ...original,
      title: missing(selection.title) ? translate("Untitled page") : original.title,
      subtitle: missing(selection.language)
        ? [translate("Language missing"), typeof selection.slug === "string" ? selection.slug.trim() : ""].filter(Boolean).join(" · ")
        : original.subtitle,
    };
  }
  if (type === "category") {
    const entries = Array.isArray(selection.labels) ? selection.labels.filter((entry) =>
      entry && typeof entry === "object" && "value" in entry && !missing(entry.value)) : [];
    return {
      ...original,
      title: entries.length ? original.title : translate("Category label missing"),
      subtitle: entries.length ? entries.map((entry) => missing(entry.language)
        ? translate("Language missing") : String(entry.language).trim().replace(/^[a-z]{2,3}(?=-|$)/, (primary) => primary.toUpperCase())).join(" / ")
        : translate("Language missing"),
    };
  }
  const order = selection.order;
  const position = typeof order === "number" && Number.isSafeInteger(order) && order >= 0 && order < Number.MAX_SAFE_INTEGER
    ? translate(`Image ${order + 1}`) : translate("Position missing");
  return {
    ...original,
    title: `${position} · ${missing(selection.title) ? translate("Container title missing") : String(selection.title).trim()}`,
    subtitle: missing(selection.language) ? translate("Language missing") : original.subtitle,
  };
}

/** The installed Sanity preview pipeline preserves additional prepared metadata. */
export function withLocalizedPreview(schema: EditorialSchema): EditorialSchema {
  const prepare = schema.preview?.prepare;
  if (!prepare || !Object.hasOwn(EDITORIAL_PREVIEWS, schema.name)) return schema;
  return { ...schema, preview: { ...schema.preview!, prepare(selection) {
    return { ...prepare(selection), photositeEditorial: { type: schema.name, selection } };
  } } };
}
