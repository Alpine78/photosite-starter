import { CreateLanguageVersionAction } from "./localized-draft-action";
import { defineConfig, type SchemaTypeDefinition } from "sanity";
import { coreLocaleAdditions } from "./core-locale-additions";
import { LocaleNavbar, LocaleToolMenu } from "./locale-navbar";
import { fiFILocale } from "@sanity/locale-fi-fi";
import { structureTool } from "sanity/structure";
import { defineSchemaTypes } from "../sanity/schemas";
import { studioSettings } from "./environment";
import { allowAction, allowTemplate } from "./editorial-policy";
import { editorialStructure } from "./structure";
import { FullFramePreview } from "./full-frame-preview";
import { withLocalizedPreview } from "./localized-preview";
import { LocalizedField, LocalizedInput } from "./localized-form";
import { withLocalizedValidation } from "./localized-validation";
import { withEditorialPreview } from "./editorial-preview";
import { editorialLocaleBundles } from "./editorial-locales";
import { localizedPresentation } from "./localized-layout";
import { withFullFrameMedia } from "./full-frame-media";
import { withTechnicalIdentifiers } from "./technical-identifiers";
import { withClientGalleryDefaults } from "./client-gallery-defaults";

// The shared schemas use a readonly, dependency-free subset of Sanity's types.
// This boundary asserts that subset; `schemas validate` checks the actual objects.
const schemaTypes = defineSchemaTypes(studioSettings)
  .map(withClientGalleryDefaults)
  .map(withTechnicalIdentifiers)
  .map(withEditorialPreview)
  .map(withLocalizedPreview)
  .map(withFullFrameMedia)
  .map(withLocalizedValidation)
  .map((type) => type.type === "document" || type.type === "object"
    ? { ...type, components: { preview: FullFramePreview } }
    : type) as SchemaTypeDefinition[];

export default defineConfig({
  studio: { components: { navbar: LocaleNavbar, toolMenu: LocaleToolMenu } },
  name: "default",
  title: studioSettings.title,
  projectId: studioSettings.projectId,
  dataset: studioSettings.dataset,
  i18n: { bundles: [...editorialLocaleBundles, ...coreLocaleAdditions] },
  plugins: [structureTool({ structure: editorialStructure }), fiFILocale(), localizedPresentation()],
  form: { components: { field: LocalizedField, input: LocalizedInput } },
  schema: {
    types: schemaTypes,
    templates: (templates) => templates.filter(({ schemaType }) => allowTemplate(schemaType)),
  },
  document: {
    actions: (actions, { schemaType }) => {
      const allowed = actions.filter(({ action }) => allowAction(schemaType, action));
      return ["article", "gallery"].includes(schemaType) ? [...allowed, CreateLanguageVersionAction] : allowed;
    },
  },
});
