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

/**
 * Proof galleries (ADR-0038, AB#130) exist only when the Studio sets
 * `SANITY_STUDIO_PROOF_GALLERIES=enabled`: until the customer page is live a
 * published proof gallery would have nowhere to lead.
 */
export const PROOF_GALLERY_LIST = { type: "clientProofGallery", title: "Proof galleries" } as const;
/** Written only by the site (ADR-0038); read-only in Studio, never created, edited or resent. */
export const PROOF_RECORD_TYPES = ["clientProofSelection", "clientProofSelectionVersion", "clientProofNotice", "clientProofReminder"] as const;
/** Reminders failed, or pending longer than five minutes (decision 9). */
export const PROOF_REMINDERS_NEEDING_ACTION_FILTER =
  '_type == "clientProofReminder" && (state == "failed" || (state == "pending" && dateTime(createdAt) < dateTime(now()) - 300))';
/** Published proof galleries whose reminders are on but cannot be sent as configured; nothing is guessed. */
export const PROOF_REMINDER_SETTINGS_INCOMPLETE_FILTER =
  '_type == "clientProofGallery" && !(_id in path("drafts.**")) && count(*[_id == "proofTerms." + ^._id && reminderDelayDays != null && (!defined(customerLocale) || !defined(customerEmail) || !defined(firstPublishedAt))]) > 0';
export const PROOF_SELECTION_LIST = { type: "clientProofSelectionVersion", title: "Confirmed proof selections" } as const;
/** Working selections, where a confirmed one can be reopened (decision 5). */
export const PROOF_WORKING_SELECTION_LIST = { type: "clientProofSelection", title: "Proof selections" } as const;
/** Failed, or pending longer than five minutes: the email may not have arrived (decision 6). */
export const PROOF_NOTICES_NEEDING_ACTION_FILTER =
  '_type == "clientProofNotice" && (state == "failed" || (state == "pending" && dateTime(createdAt) < dateTime(now()) - 300))';
const isProofRecord = (type: string) => PROOF_RECORD_TYPES.some((candidate) => candidate === type);
export type EditorialPolicyOptions = Readonly<{ proofGalleries?: boolean }>;

export function allowTemplate(schemaType: string, options: EditorialPolicyOptions = {}): boolean {
  if (schemaType === PROOF_GALLERY_LIST.type) return options.proofGalleries === true;
  return !isSingleton(schemaType) && !isImporterType(schemaType) && !isProofRecord(schemaType);
}

export function allowAction(schemaType: string, action: string | undefined): boolean {
  if (isImporterType(schemaType) || isProofRecord(schemaType)) return false;
  if (schemaType === "clientDeliveryGallery") {
    return action !== undefined && ["publish", "unpublish", "discardChanges", "delete"].includes(action);
  }
  // Native publish is replaced by the proof publication action, which numbers
  // the proofs and creates the private record through the site route. No
  // unpublish (the published document holds the fixed numbers; `available`
  // pauses the page) and no native delete, which would orphan the private
  // records: the proof deletion action removes them in one transaction.
  if (schemaType === "clientProofGallery") return action === "discardChanges";
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
