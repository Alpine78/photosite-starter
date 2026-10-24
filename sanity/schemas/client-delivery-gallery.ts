import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./media";
import type { SchemaTypeDefinition, SchemaValidationContext } from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";
import { closed, key, localized, publicImageAssetRef, record, text } from "./closed-document";

export const CLIENT_DELIVERY_MAX_ITEMS = 256;
export const CLIENT_DELIVERY_MAX_DOCUMENT_BYTES = 256 * 1024;
export const CLIENT_DELIVERY_ERRORS = {
  structure: "Check the client gallery fields, image order and alternative texts.",
  identity: "The gallery link is missing, already used or different from the published link.",
  assets: "Use complete exported web images up to 2048 pixels; check their uploaded asset metadata.",
  unavailable: "The gallery could not be validated. Try again before publishing.",
  size: "This gallery is too large. Use shorter texts or fewer images.",
} as const;

export function isClientDeliveryHandle(value: unknown): value is string {
  return typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/u.test(value);
}
export function isClientDeliveryInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 24) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const canonical = new Date(time).toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}
function assetReference(item: unknown): string | undefined {
  if (!record(item) || !closed(item, ["_key", "_type", "mediaType", "image", "alt"]) ||
    item._type !== "clientDeliveryItem" || !key(item._key) || item.mediaType !== "image" ||
    !localized(item.alt, true, 512)) return undefined;
  return publicImageAssetRef(item.image);
}

export type ClientDeliveryAsset = Readonly<{
  _id: string; _type: "sanity.imageAsset"; sha1hash: string; extension: string;
  mimeType: string; width: number; height: number; restricted: false;
}>;
/** The same technical asset boundary is used by publication and the native picker. */
export function isClientDeliveryAsset(asset: unknown): asset is ClientDeliveryAsset {
  if (!record(asset) || typeof asset._id !== "string") return false;
  const parts = /^image-([a-f0-9]{40})-([1-9]\d{0,4})x([1-9]\d{0,4})-(avif|jpeg|jpg|png|webp)$/u.exec(asset._id);
  return Boolean(parts && parts[0] === asset._id && Math.max(Number(parts[2]), Number(parts[3])) <= MAX_PUBLIC_DELIVERY_DIMENSION &&
    asset._type === "sanity.imageAsset" && asset.restricted === false && asset.sha1hash === parts[1] &&
    asset.width === Number(parts[2]) && asset.height === Number(parts[3]) && asset.extension === parts[4] &&
    PUBLIC_DELIVERY_FORMATS[parts[4]] === asset.mimeType);
}

/** Editorial guard only. The runtime must independently validate API-written data. */
export async function validateClientDeliveryGallery(value: unknown, context: SchemaValidationContext): Promise<true | string> {
  try {
    if (!record(value) || !closed(value, ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "_system", "handle", "title", "available", "availabilityMode", "expiryInstant", "items"]) ||
      value._type !== "clientDeliveryGallery" || typeof value.available !== "boolean" ||
      !localized(value.title, false, 200) || !Array.isArray(value.items) || value.items.length < 1 ||
      value.items.length > CLIENT_DELIVERY_MAX_ITEMS || Object.keys(value.items).length !== value.items.length) return CLIENT_DELIVERY_ERRORS.structure;
    if ((value.availabilityMode !== "until" && value.availabilityMode !== "indefinite") ||
      (value.availabilityMode === "until" ? !isClientDeliveryInstant(value.expiryInstant) : value.expiryInstant != null)) return CLIENT_DELIVERY_ERRORS.structure;
    const id = typeof value._id === "string" ? publishedIdOf(value._id) : "";
    if (!text(id, 128) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id) || !isClientDeliveryHandle(value.handle)) return CLIENT_DELIVERY_ERRORS.identity;
    const references: string[] = [], keys = new Set<string>();
    for (const item of value.items) {
      const reference = assetReference(item);
      if (!reference || keys.has(item._key)) return CLIENT_DELIVERY_ERRORS.structure;
      keys.add(item._key); references.push(reference);
    }
    // Native publication adds metadata; it must not invalidate an admitted draft.
    const authored = Object.fromEntries(Object.entries(value).filter(([name]) => !["_id", "_rev", "_createdAt", "_updatedAt", "_system"].includes(name)));
    if (new TextEncoder().encode(JSON.stringify(authored)).byteLength > CLIENT_DELIVERY_MAX_DOCUMENT_BYTES) return CLIENT_DELIVERY_ERRORS.size;
    const ids = [...new Set(references)];
    const client = validationClientOf(context);
    const [identity, assets] = await Promise.all([
      client.fetch<unknown>(`{
        "conflicts": *[_type in ["clientDeliveryGallery", "legacyDeliveryGallery", "clientProofGallery"] && handle == $handle &&
          !(_id in [$id, "drafts." + $id]) && !(_id match "versions.*." + $id)][0...2]{_id},
        "published": *[_id == $id][0]{_type, handle}
      }`, { id, handle: value.handle }),
      client.fetch<unknown>(`*[_id in $ids]{_id, _type, extension, mimeType, sha1hash,
        "width": metadata.dimensions.width, "height": metadata.dimensions.height,
        "restricted": count(*[_type == "media" && image.asset._ref == ^._id &&
          defined(privateOnly) && privateOnly != false]) > 0}`, { ids }),
    ]);
    if (!record(identity) || !Array.isArray(identity.conflicts) || identity.conflicts.length !== 0 ||
      (identity.published !== null && (!record(identity.published) || identity.published._type !== "clientDeliveryGallery" || identity.published.handle !== value.handle))) return CLIENT_DELIVERY_ERRORS.identity;
    if (!Array.isArray(assets) || assets.length !== ids.length) return CLIENT_DELIVERY_ERRORS.assets;
    const seen = new Set<string>();
    for (const asset of assets) {
      if (!record(asset) || typeof asset._id !== "string" || !ids.includes(asset._id) || seen.has(asset._id)) return CLIENT_DELIVERY_ERRORS.assets;
      seen.add(asset._id);
      if (!isClientDeliveryAsset(asset)) return CLIENT_DELIVERY_ERRORS.assets;
    }
    return true;
  } catch {
    return CLIENT_DELIVERY_ERRORS.unavailable;
  }
}

export const clientDeliveryItemType: SchemaTypeDefinition = {
  name: "clientDeliveryItem", title: "Client gallery image", type: "object",
  fields: [
    { name: "mediaType", title: "Media type", type: "string", initialValue: "image", options: { list: [{ title: "Image", value: "image" }] }, validation: (rule) => rule.required() },
    { name: "image", title: "Public web image", type: "image",
      description: "Upload a neutrally named web export up to 2048 pixels. Check embedded metadata: uploaded files are public even before publication.",
      options: { hotspot: false, storeOriginalFilename: false, accept: [...new Set(Object.values(PUBLIC_DELIVERY_FORMATS))].join(",") }, validation: (rule) => rule.required() },
    { name: "alt", title: "Alternative text", type: "array", of: [{ type: "localizedText" }], validation: (rule) => rule.required().min(1).max(20) },
  ],
  preview: { select: { title: "alt.0.value", media: "image" } },
};

export const clientDeliveryGalleryType: SchemaTypeDefinition = {
  name: "clientDeliveryGallery", title: "Client gallery", type: "document",
  description: "Unlisted public delivery in Sanity. Do not enter customer contact details. Direct image URLs remain public after the page closes.",
  fields: [
    { name: "title", title: "Title", type: "array", of: [{ type: "localizedText" }], validation: (rule) => rule.max(20) },
    { name: "available", title: "Available to link holders", type: "boolean", initialValue: false,
      description: "Pause or enable the page, then publish the change. Native unpublished documents are always unavailable.", validation: (rule) => rule.required() },
    { name: "availabilityMode", title: "Page availability", type: "string", options: { list: [{ title: "Until a deadline", value: "until" }, { title: "Explicitly indefinite", value: "indefinite" }] }, validation: (rule) => rule.required() },
    { name: "expiryInstant", title: "Exclusive UTC deadline", type: "datetime",
      description: "New Studio galleries suggest six calendar months from creation. Review before publishing; publication does not reset it. Clear for indefinite access. Page expiry alone does not delete files." },
    { name: "items", title: "Client gallery images", type: "array", of: [{ type: "clientDeliveryItem" }], validation: (rule) => rule.required().min(1).max(CLIENT_DELIVERY_MAX_ITEMS) },
    { name: "handle", title: "Permanent gallery link identifier", type: "string", readOnly: true,
      description: "Generated on creation. Copy this identifier for the customer link; keep it unchanged.", validation: (rule) => rule.required() },
  ],
  validation: (rule) => rule.custom(validateClientDeliveryGallery),
  preview: { select: { title: "title.0.value", media: "items.0.image" } },
};
