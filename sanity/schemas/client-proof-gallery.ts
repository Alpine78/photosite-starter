import { isClientDeliveryAsset, isClientDeliveryHandle, isClientDeliveryInstant } from "./client-delivery-gallery";
import { closed, key, localized, publicImageAssetRef, record, text } from "./closed-document";
import { PUBLIC_DELIVERY_FORMATS } from "./media";
import {
  isProofReference,
  MAX_PROOF_REFERENCE,
  NEVER_PUBLISHED,
  proofReferenceProblem,
  type ProofReferenceItem,
  type PublishedProofState,
} from "./proof-references";
import type { SchemaTypeDefinition, SchemaValidationContext } from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

/**
 * Proof gallery (ADR-0038 decisions 1–2, AB#130): an unlisted page of public,
 * externally watermarked web proofs, each with its complete original filename
 * and a permanent reference. Nothing customer-, job- or price-specific belongs
 * here: terms, selections and the selection key live on Sanity private ID
 * paths in a later slice, and the link to the delivery gallery that replaces a
 * proof gallery (owner answer 5) arrives with the page that follows it. Until
 * those slices land, Studio does not offer this type for creation
 * (`studio/editorial-policy.ts`).
 */
export const CLIENT_PROOF_MAX_ITEMS = 256;
export const CLIENT_PROOF_MAX_DOCUMENT_BYTES = 256 * 1024;
export const CLIENT_PROOF_ERRORS = {
  structure: "Check the proof gallery fields, image order and filenames.",
  identity: "The gallery link is missing, already used or different from the published link.",
  assets: "Use complete exported web proofs up to 2048 pixels; check their uploaded asset metadata.",
  references: "Proof numbers are assigned on publishing and never change. A published proof keeps its image; add a new proof for a different image.",
  unavailable: "The gallery could not be validated. Try again before publishing.",
  size: "This gallery is too large. Use shorter texts or fewer images.",
} as const;

const GALLERY_FIELDS = ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "_system", "handle", "title",
  "available", "availabilityMode", "expiryInstant", "items", "referenceHighWater"] as const;
const ITEM_FIELDS = ["_key", "_type", "mediaType", "image", "originalFilename", "alt", "reference"] as const;

function proofItem(item: unknown): ProofReferenceItem | undefined {
  if (!record(item) || !closed(item, ITEM_FIELDS) || item._type !== "clientProofItem" || !key(item._key) ||
    item.mediaType !== "image" || !text(item.originalFilename, 255) || !localized(item.alt, false, 512) ||
    (item.reference != null && typeof item.reference !== "string")) return undefined;
  const assetRef = publicImageAssetRef(item.image);
  if (!assetRef) return undefined;
  return { _key: item._key, originalFilename: item.originalFilename, assetRef,
    ...(typeof item.reference === "string" ? { reference: item.reference } : {}) };
}

/** The published document's fixed numbers; `undefined` when it is not a usable proof gallery. */
function publishedState(published: unknown, handle: string): PublishedProofState | undefined {
  if (published === null) return NEVER_PUBLISHED;
  if (!record(published) || published._type !== "clientProofGallery" || published.handle !== handle ||
    !Number.isSafeInteger(published.referenceHighWater) || (published.referenceHighWater as number) < 0 ||
    (published.referenceHighWater as number) > MAX_PROOF_REFERENCE || !Array.isArray(published.items)) return undefined;
  const references: Record<string, { reference: string; assetRef: string }> = {};
  const numbers = new Set<string>();
  // API-written data is not trusted either: a repeated number or one above the
  // high-water mark would let the next addition reuse a number.
  for (const item of published.items) {
    if (!record(item) || !key(item._key) || !isProofReference(item.reference) || typeof item.assetRef !== "string" ||
      Object.hasOwn(references, item._key) || numbers.has(item.reference) ||
      Number(item.reference) > (published.referenceHighWater as number)) return undefined;
    references[item._key] = { reference: item.reference, assetRef: item.assetRef };
    numbers.add(item.reference);
  }
  return { highWater: published.referenceHighWater as number, references };
}

/** Editorial guard only. The runtime must independently validate API-written data. */
export async function validateClientProofGallery(value: unknown, context: SchemaValidationContext): Promise<true | string> {
  try {
    if (!record(value) || !closed(value, GALLERY_FIELDS) || value._type !== "clientProofGallery" ||
      typeof value.available !== "boolean" || !localized(value.title, false, 200) || !Array.isArray(value.items) ||
      value.items.length < 1 || value.items.length > CLIENT_PROOF_MAX_ITEMS ||
      Object.keys(value.items).length !== value.items.length) return CLIENT_PROOF_ERRORS.structure;
    if ((value.availabilityMode !== "until" && value.availabilityMode !== "indefinite") ||
      (value.availabilityMode === "until" ? !isClientDeliveryInstant(value.expiryInstant) : value.expiryInstant != null)) return CLIENT_PROOF_ERRORS.structure;
    const id = typeof value._id === "string" ? publishedIdOf(value._id) : "";
    if (!text(id, 128) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id) || !isClientDeliveryHandle(value.handle)) return CLIENT_PROOF_ERRORS.identity;
    const items: ProofReferenceItem[] = [], keys = new Set<string>();
    for (const raw of value.items) {
      const item = proofItem(raw);
      if (!item || keys.has(item._key)) return CLIENT_PROOF_ERRORS.structure;
      keys.add(item._key); items.push(item);
    }
    const authored = Object.fromEntries(Object.entries(value).filter(([name]) => !["_id", "_rev", "_createdAt", "_updatedAt", "_system"].includes(name)));
    if (new TextEncoder().encode(JSON.stringify(authored)).byteLength > CLIENT_PROOF_MAX_DOCUMENT_BYTES) return CLIENT_PROOF_ERRORS.size;
    const ids = [...new Set(items.map((item) => item.assetRef))];
    const client = validationClientOf(context);
    const [identity, assets] = await Promise.all([
      client.fetch<unknown>(`{
        "conflicts": *[_type in ["clientDeliveryGallery", "legacyDeliveryGallery", "clientProofGallery"] && handle == $handle &&
          !(_id in [$id, "drafts." + $id]) && !(_id match "versions.*." + $id)][0...2]{_id},
        "published": *[_id == $id][0]{_type, handle, referenceHighWater,
          "items": items[]{_key, reference, "assetRef": image.asset._ref}}
      }`, { id, handle: value.handle }),
      client.fetch<unknown>(`*[_id in $ids]{_id, _type, extension, mimeType, sha1hash,
        "width": metadata.dimensions.width, "height": metadata.dimensions.height,
        "restricted": count(*[_type == "media" && image.asset._ref == ^._id &&
          defined(privateOnly) && privateOnly != false]) > 0}`, { ids }),
    ]);
    if (!record(identity) || !Array.isArray(identity.conflicts) || identity.conflicts.length !== 0) return CLIENT_PROOF_ERRORS.identity;
    const published = publishedState(identity.published, value.handle);
    if (!published) return CLIENT_PROOF_ERRORS.identity;
    if (proofReferenceProblem(items, value.referenceHighWater, published)) return CLIENT_PROOF_ERRORS.references;
    if (!Array.isArray(assets) || assets.length !== ids.length) return CLIENT_PROOF_ERRORS.assets;
    const seen = new Set<string>();
    for (const asset of assets) {
      if (!record(asset) || typeof asset._id !== "string" || !ids.includes(asset._id) || seen.has(asset._id)) return CLIENT_PROOF_ERRORS.assets;
      seen.add(asset._id);
      if (!isClientDeliveryAsset(asset)) return CLIENT_PROOF_ERRORS.assets;
    }
    return true;
  } catch {
    return CLIENT_PROOF_ERRORS.unavailable;
  }
}

export const clientProofItemType: SchemaTypeDefinition = {
  name: "clientProofItem", title: "Proof", type: "object",
  fields: [
    { name: "mediaType", title: "Media type", type: "string", initialValue: "image", options: { list: [{ title: "Image", value: "image" }] }, validation: (rule) => rule.required() },
    { name: "image", title: "Watermarked web proof", type: "image",
      description: "Upload an externally watermarked web proof up to 2048 pixels. Uploaded files are public even before publication.",
      options: { hotspot: false, storeOriginalFilename: false, accept: [...new Set(Object.values(PUBLIC_DELIVERY_FORMATS))].join(",") }, validation: (rule) => rule.required() },
    { name: "originalFilename", title: "Complete original filename", type: "string",
      description: "The camera or Lightroom filename the customer and photographer refer to. Proof numbers follow its natural order.",
      validation: (rule) => rule.required().max(255) },
    { name: "alt", title: "Alternative text", type: "array", of: [{ type: "localizedText" }],
      description: "Optional. Without it the page describes the image by its proof number.", validation: (rule) => rule.max(20) },
    { name: "reference", title: "Proof number", type: "string", readOnly: true,
      description: "Assigned when the gallery is first published, then never changed." },
  ],
  preview: { select: { title: "reference", subtitle: "originalFilename", media: "image" } },
};

export const clientProofGalleryType: SchemaTypeDefinition = {
  name: "clientProofGallery", title: "Proof gallery", type: "document",
  description: "Unlisted proofs for a customer's selection. Do not enter customer contact details or prices here. Direct image URLs remain public.",
  fields: [
    { name: "title", title: "Title", type: "array", of: [{ type: "localizedText" }], validation: (rule) => rule.max(20) },
    { name: "available", title: "Available to link holders", type: "boolean", initialValue: false,
      description: "Pause or enable the page, then publish the change.", validation: (rule) => rule.required() },
    { name: "availabilityMode", title: "Page availability", type: "string", initialValue: "indefinite",
      options: { list: [{ title: "Explicitly indefinite", value: "indefinite" }, { title: "Until a deadline", value: "until" }] }, validation: (rule) => rule.required() },
    { name: "expiryInstant", title: "Exclusive UTC deadline", type: "datetime",
      description: "Required for a deadline; clear it for indefinite access. Closing a page does not revoke public image URLs." },
    { name: "items", title: "Proofs", type: "array", of: [{ type: "clientProofItem" }], validation: (rule) => rule.required().min(1).max(CLIENT_PROOF_MAX_ITEMS) },
    { name: "handle", title: "Permanent gallery link identifier", type: "string", readOnly: true,
      description: "Generated on creation. Keep it unchanged.", validation: (rule) => rule.required() },
    { name: "referenceHighWater", title: "Highest proof number assigned", type: "number", readOnly: true,
      description: "Never decreases, so a removed proof's number is not reused." },
  ],
  validation: (rule) => rule.custom(validateClientProofGallery),
  preview: { select: { title: "title.0.value", media: "items.0.image" } },
};
