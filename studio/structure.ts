import type { StructureResolver } from "sanity/structure";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { EDITORIAL_LISTS, resolveSingletonDocumentId, SINGLETON_QUERY, type SingletonType } from "./editorial-policy";
import { editorialTitle } from "./editorial-locales";

export const editorialStructure: StructureResolver = (S, context) => {
  const singleton = (type: SingletonType, title: string) => S.listItem()
    .id(type).title(title).i18n(editorialTitle(type)).child(async () => {
      const client = context.getClient({ apiVersion: STUDIO_VALIDATION_API_VERSION })
        .withConfig({ perspective: "raw", useCdn: false });
      const id = await resolveSingletonDocumentId(type, () => client.fetch(SINGLETON_QUERY, { type }));
      return S.document().schemaType(type).documentId(id).title(title).i18n(editorialTitle(type));
    });
  return S.list().title("Content").i18n(editorialTitle("content")).items([
    singleton("homePage", "Home page"),
    singleton("siteSettings", "Site settings"),
    S.divider(),
    ...EDITORIAL_LISTS.map(({ type, title }) => S.documentTypeListItem(type)
      .title(title).i18n(editorialTitle(type))
      .child(S.documentTypeList(type).title(title).i18n(editorialTitle(type)))),
  ]);
};
