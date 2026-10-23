/**
 * Server-side proof gallery model for the publication route and the customer
 * page (ADR-0038, AB#130).
 *
 * Independent of the Studio validator (`sanity/schemas/client-proof-gallery.ts`):
 * the route validates whatever it reads with the editor's token, because Studio
 * validation runs only in the browser. Shapes mirror the schema and reuse the
 * delivery model's closed-value checks.
 */
import "server-only";
import {
  clientRecord,
  closed,
  invalidClientGallery,
  isClientDocumentId,
  isClientGalleryHandle,
  key,
  localized,
  publicImageReference,
  text,
  type ClientText,
  type PublicImageReference,
} from "@/lib/client-gallery-model";
import { isProofReference, MAX_PROOF_REFERENCE, type ProofReferenceItem, type PublishedProofState } from "@/lib/proof-references";

export const PROOF_GALLERY_MAX_ITEMS = 256;
export const PROOF_GALLERY_MAX_DOCUMENT_BYTES = 256 * 1024;
const SYSTEM_FIELDS = ["_id", "_rev", "_createdAt", "_updatedAt", "_system"] as const;
const GALLERY_FIELDS = [...SYSTEM_FIELDS, "_type", "handle", "title", "available", "availabilityMode", "expiryInstant", "items", "referenceHighWater", "replacedBy"] as const;
/** Optional authored fields a later publication may need to clear from the published document. */
export const PROOF_GALLERY_OPTIONAL_FIELDS = ["title", "expiryInstant", "referenceHighWater", "replacedBy"] as const;
const ITEM_FIELDS = ["_key", "_type", "mediaType", "image", "originalFilename", "alt", "reference"] as const;

export type ProofGalleryItem = ProofReferenceItem & Readonly<{ image: PublicImageReference }>;
export type ParsedProofGallery = Readonly<{
  revision: string;
  handle: string;
  /** The replacing delivery gallery's document ID (owner answer 5). */
  replacedBy?: string;
  items: readonly ProofGalleryItem[];
  /** The authored document without Sanity's system fields, as read. */
  authored: Readonly<Record<string, unknown>>;
}>;

function revision(value: unknown): string {
  const rev = text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/u.test(rev)) return invalidClientGallery();
  return rev;
}

function availability(row: Record<string, unknown>): void {
  if (row.availabilityMode === "indefinite") {
    if (row.expiryInstant != null) invalidClientGallery();
    return;
  }
  if (row.availabilityMode !== "until" || typeof row.expiryInstant !== "string" || row.expiryInstant.length > 24) invalidClientGallery();
  const time = Date.parse(row.expiryInstant as string);
  if (!Number.isFinite(time)) invalidClientGallery();
  const canonical = new Date(time).toISOString();
  if (row.expiryInstant !== canonical && row.expiryInstant !== canonical.replace(".000Z", "Z")) invalidClientGallery();
}

/** A published-root weak reference, exactly as Studio writes it for a published target. */
function replacement(value: unknown): string | undefined {
  if (value == null) return undefined;
  const reference = clientRecord(value); closed(reference, ["_type", "_ref", "_weak"]);
  if (reference._type !== "reference" || reference._weak !== true || !isClientDocumentId(reference._ref)) return invalidClientGallery();
  return reference._ref as string;
}

function item(value: unknown): ProofGalleryItem {
  const row = clientRecord(value); closed(row, ITEM_FIELDS);
  if (row._type !== "clientProofItem" || row.mediaType !== "image") return invalidClientGallery();
  if (row.reference != null && typeof row.reference !== "string") return invalidClientGallery();
  localized(row.alt, false, 512);
  const image = publicImageReference(row.image);
  return {
    _key: key(row._key),
    originalFilename: text(row.originalFilename, 255),
    assetRef: image.assetId,
    image,
    ...(typeof row.reference === "string" ? { reference: row.reference } : {}),
  };
}

/**
 * A proof gallery document (draft or published) read with the editor's token.
 * `projected`: a bounded GROQ projection, whose explicit nulls are not authored
 * bytes, so only the document itself is held to the size limit.
 */
export function parseProofGallery(value: unknown, expectedId: string, projected = false): ParsedProofGallery {
  const row = clientRecord(value); closed(row, GALLERY_FIELDS);
  if (row._id !== expectedId || row._type !== "clientProofGallery" || !isClientGalleryHandle(row.handle) ||
    typeof row.available !== "boolean") return invalidClientGallery();
  localized(row.title, false, 200);
  availability(row);
  if (row.referenceHighWater != null && (!Number.isSafeInteger(row.referenceHighWater) ||
    (row.referenceHighWater as number) < 0 || (row.referenceHighWater as number) > MAX_PROOF_REFERENCE)) return invalidClientGallery();
  if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > PROOF_GALLERY_MAX_ITEMS ||
    Object.keys(row.items).length !== row.items.length) return invalidClientGallery();
  const items: ProofGalleryItem[] = [], keys = new Set<string>();
  for (const value of row.items) {
    const parsed = item(value);
    if (keys.has(parsed._key)) return invalidClientGallery();
    keys.add(parsed._key); items.push(parsed);
  }
  const authored = Object.fromEntries(Object.entries(row).filter(([name]) => !(SYSTEM_FIELDS as readonly string[]).includes(name)));
  if (!projected && new TextEncoder().encode(JSON.stringify(authored)).byteLength > PROOF_GALLERY_MAX_DOCUMENT_BYTES) return invalidClientGallery();
  const replacedBy = replacement(row.replacedBy);
  return { revision: revision(row._rev), handle: row.handle as string, ...(replacedBy === undefined ? {} : { replacedBy }), items, authored };
}

/**
 * The numbers publication has already fixed. A repeated number or one above the
 * high-water mark would let the next addition reuse a number, so such a
 * document is refused rather than numbered from.
 */
export function publishedProofState(gallery: ParsedProofGallery): PublishedProofState {
  const highWater = gallery.authored.referenceHighWater;
  if (!Number.isSafeInteger(highWater) || (highWater as number) < 0) return invalidClientGallery();
  const references: Record<string, { reference: string; assetRef: string }> = {};
  const numbers = new Set<string>();
  for (const entry of gallery.items) {
    if (!isProofReference(entry.reference) || numbers.has(entry.reference) || Number(entry.reference) > (highWater as number)) return invalidClientGallery();
    references[entry._key] = { reference: entry.reference, assetRef: entry.assetRef };
    numbers.add(entry.reference);
  }
  return { highWater: highWater as number, references };
}

export type PublishedProofItem = Readonly<{
  key: string; reference: string; assetId: string; hash: string; width: number; height: number; extension: string;
  alt: readonly ClientText[];
}>;
/** The customer page's normalized view of a published proof gallery; comparable across reads. */
export type PublishedProofGallery = Readonly<{
  id: string; revision: string; handle: string; title: readonly ClientText[]; available: boolean;
  expiryInstant?: string; deadline?: number; replacedBy?: string; items: readonly PublishedProofItem[];
}>;

/**
 * A published proof gallery for the customer page: the same closed shape as a
 * publication reads, with every proof numbered as publication fixed it.
 * Normalized so a projected discovery snapshot and the fresh document compare
 * equal when, and only when, they present the same gallery.
 */
export function parsePublishedProofGallery(value: unknown, id: string, handle: string, projected = false): PublishedProofGallery {
  try {
    if (!isClientGalleryHandle(handle)) return invalidClientGallery();
    const gallery = parseProofGallery(value, id, projected);
    if (gallery.handle !== handle) return invalidClientGallery();
    const numbers = publishedProofState(gallery).references;
    const authored = gallery.authored;
    const raw = authored.items as readonly Record<string, unknown>[];
    const expiryInstant = authored.availabilityMode === "until" ? authored.expiryInstant as string : undefined;
    return {
      id, revision: gallery.revision, handle, title: localized(authored.title, false, 200), available: authored.available as boolean,
      ...(expiryInstant === undefined ? {} : { expiryInstant, deadline: Date.parse(expiryInstant) }),
      ...(gallery.replacedBy === undefined ? {} : { replacedBy: gallery.replacedBy }),
      items: gallery.items.map((entry, index) => ({
        key: entry._key, reference: numbers[entry._key].reference, ...entry.image, alt: localized(raw[index].alt, false, 512),
      })),
    };
  } catch { return invalidClientGallery(); }
}

export type ProofAvailability = Readonly<{ available: boolean; deadline?: number }>;
export function proofGalleryAvailable(gallery: ProofAvailability, now: number): boolean {
  if (!Number.isFinite(now)) return invalidClientGallery();
  return gallery.available && (gallery.deadline === undefined || now < gallery.deadline);
}
