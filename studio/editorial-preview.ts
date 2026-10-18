import type { SchemaPreview, SchemaTypeDefinition } from "../sanity/schemas/schema-types";

type Selection = Readonly<Record<string, unknown>>;
type PreviewValue = { title: string; subtitle: string; media?: unknown };
type EditorialPreview = SchemaPreview & {
  prepare(selection: Selection): PreviewValue;
};
type StudioSchema = SchemaTypeDefinition & {
  preview?: SchemaPreview & { prepare?: EditorialPreview["prepare"] };
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function language(value: unknown): string {
  const tag = text(value);
  return tag ? tag.replace(/^[a-z]{2,3}(?=-|$)/, (primary) => primary.toUpperCase()) : "Language missing";
}

function pagePreview(titleField: string, imageField: string): EditorialPreview {
  return {
    select: { title: titleField, language: "language", slug: "slug", media: imageField },
    prepare({ title, language: tag, slug, media }) {
      return {
        title: text(title) ?? "Untitled page",
        subtitle: [language(tag), text(slug)].filter(Boolean).join(" · "),
        media,
      };
    },
  };
}

function placementPreview(container: "gallery" | "article"): EditorialPreview {
  return {
    // Traverse the shared media reference to its public image, not the media document.
    select: { title: `${container}.title`, language: `${container}.language`, order: "order", media: "media.image" },
    prepare({ title, language: tag, order, media }) {
      const number = typeof order === "number" && Number.isSafeInteger(order) && order >= 0 && order < Number.MAX_SAFE_INTEGER
        ? `Image ${order + 1}` : "Position missing";
      return {
        title: `${number} · ${text(title) ?? "Container title missing"}`,
        subtitle: language(tag),
        media,
      };
    },
  };
}

/** Shared media has no document language. Prefer the interface language, then
 * FI/EN, then a stable authored-language order, always reporting the used tag. */
export function selectMediaDescription(selection: Selection, locale: string) {
  const entries = (value: unknown) => Array.isArray(value) ? value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const value = text(row.value);
    return value ? [{ value, language: text(row.language) }] : [];
  }) : [];
  const captions = entries(selection.captions);
  const rows = (captions.length ? captions : entries(selection.alternatives)).sort((a, b) => {
    const left = a.language?.toLowerCase() ?? "", right = b.language?.toLowerCase() ?? "";
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const tag = locale.toLowerCase(), primary = tag.split("-")[0];
  return rows.find((row) => row.language?.toLowerCase() === tag) ??
    rows.find((row) => row.language?.toLowerCase().split("-")[0] === primary) ??
    rows.find((row) => row.language?.toLowerCase().split("-")[0] === "fi") ??
    rows.find((row) => row.language?.toLowerCase().split("-")[0] === "en") ?? rows[0];
}

export function mediaEditorialPreview(selection: Selection, locale = "en-US"): PreviewValue {
  const selected = selectMediaDescription(selection, locale);
  return {
    title: selected?.value ?? "Media description missing",
    subtitle: [language(selected?.language), text(selection.credit)].filter(Boolean).join(" · "),
    media: selection.media,
  };
}

/** A plain placement caption has no language tag; only UI fallback text is translated. */
export function bodyMediaEditorialPreview(selection: Selection, locale = "en-US", translate = (value: string) => value): PreviewValue {
  const caption = text(selection.placementCaption);
  if (caption) return { title: caption, subtitle: translate("Placement caption"), media: selection.media };
  const selected = selectMediaDescription(selection, locale);
  return {
    title: selected?.value ?? translate("Media description missing"),
    subtitle: selected ? selected.language ? language(selected.language) : translate("Language missing") : "",
    media: selection.media,
  };
}

/** Studio-only labels: stored identities and the dependency-free canonical schemas stay intact. */
export const EDITORIAL_PREVIEWS: Readonly<Partial<Record<string, EditorialPreview>>> = {
  clientDeliveryGallery: {
    select: { titles: "title", media: "items.0.image" },
    prepare(selection) {
      const selected = selectMediaDescription({ alternatives: selection.titles }, "en-US");
      return { title: selected?.value ?? "Client gallery", subtitle: "Unlisted public delivery", media: selection.media };
    },
  },
  article: pagePreview("title", "cover.image"),
  gallery: pagePreview("title", "cover.image"),
  galleryPlacement: placementPreview("gallery"),
  articleEndGalleryPlacement: placementPreview("article"),
  media: {
    select: { captions: "caption", alternatives: "alt", credit: "credit", media: "image" },
    prepare: (selection) => mediaEditorialPreview(selection),
  },
  contentMediaBlock: {
    select: { placementCaption: "caption", captions: "media.caption", alternatives: "media.alt", media: "media.image" },
    prepare: (selection) => bodyMediaEditorialPreview(selection),
  },
  category: {
    select: { labels: "label" },
    prepare({ labels }) {
      const entries = Array.isArray(labels) ? labels.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        const value = text(record.value);
        return value ? [{ value, language: language(record.language) }] : [];
      }) : [];
      return {
        title: entries.length ? entries.map(({ value }) => value).join(" / ") : "Category label missing",
        subtitle: entries.length ? entries.map(({ language }) => language).join(" / ") : "Language missing",
      };
    },
  },
};

/** Preserve all fields, validators and non-overridden preview configurations. */
export function withEditorialPreview(schema: SchemaTypeDefinition): StudioSchema {
  const eligible = schema.type === "document" || schema.type === "object" && schema.name === "contentMediaBlock";
  const preview = eligible && Object.hasOwn(EDITORIAL_PREVIEWS, schema.name)
    ? EDITORIAL_PREVIEWS[schema.name] : undefined;
  return preview ? { ...schema, preview } : schema;
}
