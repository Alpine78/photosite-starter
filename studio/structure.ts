import type { StructureResolver } from "sanity/structure";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import {
  EDITORIAL_LISTS, PROOF_GALLERY_LIST, PROOF_NOTICES_NEEDING_ACTION_FILTER, PROOF_SELECTION_LIST, PROOF_WORKING_SELECTION_LIST, resolveSingletonDocumentId, SINGLETON_QUERY,
  type EditorialPolicyOptions, type SingletonType,
} from "./editorial-policy";
import { editorialTitle } from "./editorial-locales";

export const editorialStructureFor = (options: EditorialPolicyOptions = {}): StructureResolver => (S, context) => {
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
    // Proof galleries appear only when the Studio enables them (ADR-0038).
    ...[...EDITORIAL_LISTS.slice(0, 1), ...(options.proofGalleries ? [PROOF_GALLERY_LIST] : []), ...EDITORIAL_LISTS.slice(1)].map(({ type, title }) => S.documentTypeListItem(type)
      .title(title).i18n(editorialTitle(type))
      .child(S.documentTypeList(type).title(title).i18n(editorialTitle(type)))),
    // The site's private proof records, read-only (ADR-0038 decisions 5 and 6). A list
    // reflects the five-minute threshold when it is opened or refreshed.
    ...(options.proofGalleries ? [
      S.divider(),
      S.listItem().id("proofNoticesNeedingAction").title("Proof notices needing action").i18n(editorialTitle("proofNoticesNeedingAction"))
        .child(S.documentList().id("proofNoticesNeedingAction").title("Proof notices needing action").i18n(editorialTitle("proofNoticesNeedingAction"))
          .schemaType("clientProofNotice").apiVersion(STUDIO_VALIDATION_API_VERSION).filter(PROOF_NOTICES_NEEDING_ACTION_FILTER)
          .defaultOrdering([{ field: "createdAt", direction: "desc" }])),
      S.documentTypeListItem(PROOF_WORKING_SELECTION_LIST.type).title(PROOF_WORKING_SELECTION_LIST.title).i18n(editorialTitle(PROOF_WORKING_SELECTION_LIST.type))
        .child(S.documentTypeList(PROOF_WORKING_SELECTION_LIST.type).title(PROOF_WORKING_SELECTION_LIST.title).i18n(editorialTitle(PROOF_WORKING_SELECTION_LIST.type))),
      S.documentTypeListItem(PROOF_SELECTION_LIST.type).title(PROOF_SELECTION_LIST.title).i18n(editorialTitle(PROOF_SELECTION_LIST.type))
        .child(S.documentTypeList(PROOF_SELECTION_LIST.type).title(PROOF_SELECTION_LIST.title).i18n(editorialTitle(PROOF_SELECTION_LIST.type))),
    ] : []),
  ]);
};

export const editorialStructure = editorialStructureFor();
