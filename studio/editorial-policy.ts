import { publishedIdOf } from "../sanity/schemas/validation";

export const SINGLETON_TYPES = ["homePage", "siteSettings"] as const;
export type SingletonType = (typeof SINGLETON_TYPES)[number];
export const IMPORTER_TYPES = ["legacyDeliveryGallery", "legacyDeliveryImage"] as const;
export const EDITORIAL_LISTS = [
  { type: "clientDeliveryGallery", title: "Client galleries" },
  { type: "service", title: "Services" },
  { type: "article", title: "Articles" },
  { type: "gallery", title: "Galleries" },
  { type: "galleryPlacement", title: "Gallery images" },
  { type: "media", title: "Shared media" },
  { type: "category", title: "Categories" },
  { type: "articleEndGalleryPlacement", title: "Article end galleries" },
  { type: "poll", title: "Polls" },
] as const;
export const SINGLETON_QUERY_LIMIT = 20;
export const SINGLETON_QUERY = `*[_type == $type][0...${SINGLETON_QUERY_LIMIT}]{_id}`;

export function isSingleton(type: string): type is SingletonType {
  return SINGLETON_TYPES.some((candidate) => candidate === type);
}

export function isImporterType(type: string): boolean {
  return IMPORTER_TYPES.some((candidate) => candidate === type);
}

export function allowTemplate(schemaType: string): boolean {
  return !isSingleton(schemaType) && !isImporterType(schemaType);
}

export function allowAction(schemaType: string, action: string | undefined): boolean {
  if (isImporterType(schemaType)) return false;
  if (schemaType === "clientDeliveryGallery") {
    return action !== undefined && ["publish", "unpublish", "discardChanges", "delete"].includes(action);
  }
  if (!isSingleton(schemaType)) return true;
  return action !== undefined && ["publish", "discardChanges", "restore"].includes(action);
}

/** Reuse the imported identity; only a successful empty query permits initial setup. */
export function singletonDocumentId(type: SingletonType, response: unknown): string {
  if (!Array.isArray(response) || response.length >= SINGLETON_QUERY_LIMIT) {
    throw new Error("Cannot resolve singleton: invalid or excessive document results");
  }
  const ids = new Set<string>();
  for (const document of response) {
    if (
      !document || typeof document !== "object" ||
      typeof document._id !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(document._id) ||
      (document._id.startsWith("versions.") && document._id.split(".").length < 3)
    ) throw new Error("Cannot resolve singleton: invalid document identity");
    const id = publishedIdOf(document._id);
    if (!id || id.startsWith("drafts.") || id.startsWith("versions.")) {
      throw new Error("Cannot resolve singleton: invalid document identity");
    }
    ids.add(id);
  }
  if (ids.size > 1) throw new Error("Multiple singleton documents exist. Resolve them before editing.");
  return [...ids][0] ?? type;
}

export async function resolveSingletonDocumentId(
  type: SingletonType,
  fetchIds: () => Promise<unknown>,
): Promise<string> {
  // A rejected fetch propagates; it must never become an empty successful result.
  return singletonDocumentId(type, await fetchIds());
}
