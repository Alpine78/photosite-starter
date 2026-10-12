import { defineConfig, type SchemaTypeDefinition } from "sanity";
import { fiFILocale } from "@sanity/locale-fi-fi";
import { structureTool } from "sanity/structure";
import { defineSchemaTypes } from "../sanity/schemas";
import { studioSettings } from "./environment";
import { allowAction, allowTemplate } from "./editorial-policy";
import { editorialStructure } from "./structure";
import { FullFramePreview } from "./full-frame-preview";
import { withEditorialPreview } from "./editorial-preview";

// The shared schemas use a readonly, dependency-free subset of Sanity's types.
// This boundary asserts that subset; `schemas validate` checks the actual objects.
const schemaTypes = defineSchemaTypes(studioSettings)
  .map(withEditorialPreview)
  .map((type) => type.type === "document" || type.type === "object"
    ? { ...type, components: { preview: FullFramePreview } }
    : type) as SchemaTypeDefinition[];

export default defineConfig({
  name: "default",
  title: studioSettings.title,
  projectId: studioSettings.projectId,
  dataset: studioSettings.dataset,
  plugins: [structureTool({ structure: editorialStructure }), fiFILocale()],
  schema: {
    types: schemaTypes,
    templates: (templates) => templates.filter(({ schemaType }) => allowTemplate(schemaType)),
  },
  document: {
    actions: (actions, { schemaType }) => actions.filter(({ action }) => allowAction(schemaType, action)),
  },
});
