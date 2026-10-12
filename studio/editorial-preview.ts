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

/** Studio-only labels: stored identities and the dependency-free canonical schemas stay intact. */
export const EDITORIAL_PREVIEWS: Readonly<Partial<Record<string, EditorialPreview>>> = {
  article: pagePreview("title", "cover.image"),
  gallery: pagePreview("title", "cover.image"),
  galleryPlacement: placementPreview("gallery"),
  articleEndGalleryPlacement: placementPreview("article"),
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
  const preview = schema.type === "document" && Object.hasOwn(EDITORIAL_PREVIEWS, schema.name)
    ? EDITORIAL_PREVIEWS[schema.name] : undefined;
  return preview ? { ...schema, preview } : schema;
}
