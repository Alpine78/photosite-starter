import type { SchemaFieldDefinition, SchemaTypeDefinition } from "../sanity/schemas/schema-types";

const FIELDSET = "photositeTechnicalIdentifiers";
const titles: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  article: { contentId: "Content identifier", endGalleryId: "Article gallery identifier" },
  gallery: { contentId: "Content identifier" },
  category: { categoryId: "Category identifier" },
  media: { mediaId: "Media identifier" },
  galleryPlacement: { placementId: "Image occurrence identifier" },
  articleEndGalleryPlacement: { placementId: "Image occurrence identifier" },
};
type Fieldset = { readonly name: string; readonly title?: string; readonly description?: string;
  readonly options?: { readonly collapsible?: boolean; readonly collapsed?: boolean } };
type StudioSchema = SchemaTypeDefinition & {
  readonly fields: readonly (SchemaFieldDefinition & { readonly fieldset?: string })[];
  readonly fieldsets?: readonly Fieldset[];
};

/** Studio presentation only: keep stored field names, validators and references intact. */
export function withTechnicalIdentifiers(schema: StudioSchema): StudioSchema {
  if (schema.type !== "document" || !Object.hasOwn(titles, schema.name) ||
      schema.fieldsets?.some(({ name }) => name === FIELDSET)) return schema;
  const names = titles[schema.name];
  const technical = schema.fields.filter(({ name }) => Object.hasOwn(names, name));
  if (!technical.length) return schema;
  return { ...schema,
    fields: [
      ...schema.fields.filter(({ name }) => !Object.hasOwn(names, name)),
      ...technical.map((field) => ({ ...field, title: names[field.name], fieldset: FIELDSET })),
    ],
    fieldsets: [...(schema.fieldsets ?? []), {
      name: FIELDSET,
      title: "Tekniset tunnisteet / Technical identifiers",
      description: "Uusi sisältö: määritä pysyvä tunniste. Julkaistua tunnistetta ei vaihdeta. / New content: set a permanent identifier. Keep published identifiers unchanged.",
      // These identities are entered manually on creation. Keep required inputs
      // discoverable; editors can collapse this native group after setup.
      options: { collapsible: true, collapsed: false },
    }],
  };
}
