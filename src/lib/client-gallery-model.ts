import "server-only";
import { parseClientGalleryZipReference, type ClientGalleryZipReference } from "./client-gallery-zip-contract";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "@/lib/image-delivery";

export const CLIENT_GALLERY_MAX_ITEMS = 256;
export const CLIENT_GALLERY_MAX_DOCUMENT_BYTES = 256 * 1024;
export const CLIENT_GALLERY_FORMATS: Readonly<Record<string, string>> = {
  avif: "image/avif", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp",
};
export class ClientGalleryDataError extends Error {
  constructor() { super("Malformed client gallery content"); this.name = "ClientGalleryDataError"; }
}
export class ClientGalleryChangedError extends Error {
  constructor() { super("Client gallery changed during reading"); this.name = "ClientGalleryChangedError"; }
}
export class ClientGalleryBudgetError extends Error {
  constructor() { super("Client gallery read timed out"); this.name = "ClientGalleryBudgetError"; }
}
export function invalidClientGallery(): never { throw new ClientGalleryDataError(); }
export function clientRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidClientGallery();
  return value as Record<string, unknown>;
}
export function closed(value: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(value).some((key) => !fields.includes(key))) invalidClientGallery();
}
export function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) return invalidClientGallery();
  return value;
}
export function isClientGalleryHandle(value: unknown): value is string {
  return typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/u.test(value);
}
export function isClientDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value) && value.trim() === value;
}
export function key(value: unknown): string {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(result)) return invalidClientGallery();
  return result;
}
export type ClientText = Readonly<{ key: string; language: string; value: string }>;
export function localized(value: unknown, required: boolean, max: number): readonly ClientText[] {
  if (value == null && !required) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || Object.keys(value).length !== value.length) return invalidClientGallery();
  const result: ClientText[] = [], keys = new Set<string>(), languages = new Set<string>();
  for (const item of value) {
    const row = clientRecord(item); closed(row, ["_key", "_type", "language", "value"]);
    const id = key(row._key), language = text(row.language, 3), content = text(row.value, max);
    if (row._type !== "localizedText" || !/^[a-z]{2,3}$/u.test(language) || keys.has(id) || languages.has(language)) return invalidClientGallery();
    keys.add(id); languages.add(language); result.push({ key: id, language, value: content });
  }
  return result;
}
export type ClientGalleryItem = Readonly<{
  key: string; assetId: string; hash: string; width: number; height: number; extension: string;
  alt: readonly ClientText[];
}>;
export type PublicImageReference = Readonly<{ assetId: string; hash: string; width: number; height: number; extension: string }>;
/** A complete, uncropped public image of at most 2048 px; shared with the proof gallery model. */
export function publicImageReference(value: unknown): PublicImageReference {
  const image = clientRecord(value); closed(image, ["_type", "asset", "crop", "hotspot"]);
  const reference = clientRecord(image.asset); closed(reference, ["_type", "_ref"]);
  if (image._type !== "image" || reference._type !== "reference" || typeof reference._ref !== "string") return invalidClientGallery();
  if (image.crop != null) {
    const crop = clientRecord(image.crop); closed(crop, ["_type", "top", "right", "bottom", "left"]);
    if ((crop._type !== undefined && crop._type !== "sanity.imageCrop") || ["top", "right", "bottom", "left"].some((name) => crop[name] !== 0)) return invalidClientGallery();
  }
  if (image.hotspot != null) {
    const hotspot = clientRecord(image.hotspot); closed(hotspot, ["_type", "x", "y", "width", "height"]);
    if ((hotspot._type !== undefined && hotspot._type !== "sanity.imageHotspot") || hotspot.x !== 0.5 || hotspot.y !== 0.5 || hotspot.width !== 1 || hotspot.height !== 1) return invalidClientGallery();
  }
  const match = /^image-([a-f0-9]{40})-([1-9]\d{0,4})x([1-9]\d{0,4})-(avif|jpeg|jpg|png|webp)$/u.exec(reference._ref);
  if (!match || match[0] !== reference._ref) return invalidClientGallery();
  const width = Number(match[2]), height = Number(match[3]);
  if (Math.max(width, height) > MAX_PUBLIC_DELIVERY_DIMENSION) return invalidClientGallery();
  return { assetId: reference._ref, hash: match[1], width, height, extension: match[4] };
}
function imageItem(value: unknown): ClientGalleryItem {
  const row = clientRecord(value); closed(row, ["_key", "_type", "mediaType", "image", "alt"]);
  if (row._type !== "clientDeliveryItem" || row.mediaType !== "image") return invalidClientGallery();
  const image = publicImageReference(row.image);
  return { key: key(row._key), ...image, alt: localized(row.alt, true, 512) };
}
export type ParsedClientGallery = Readonly<{
  id: string; revision: string; handle: string; title: readonly ClientText[]; available: boolean;
  availabilityMode: "until" | "indefinite"; expiryInstant?: string; deadline?: number; items: readonly ClientGalleryItem[]; deliveryZip?: ClientGalleryZipReference;
}>;
export function parseClientGallery(value: unknown, id: string, handle: string, projected = false): ParsedClientGallery {
  try {
    const row = clientRecord(value);
    closed(row, ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "_system", "handle", "title", "available", "availabilityMode", "expiryInstant", "items", "deliveryZip"]);
    if (row._id !== id || !isClientDocumentId(id) || row._type !== "clientDeliveryGallery" || !isClientGalleryHandle(handle) || row.handle !== handle || typeof row.available !== "boolean") return invalidClientGallery();
    const revision = text(row._rev, 128), title = localized(row.title, false, 200);
    if (!/^[A-Za-z0-9_-]+$/u.test(revision)) return invalidClientGallery();
    if (row.availabilityMode !== "until" && row.availabilityMode !== "indefinite") return invalidClientGallery();
    let expiryInstant: string | undefined, deadline: number | undefined;
    if (row.availabilityMode === "until") {
      if (typeof row.expiryInstant !== "string" || row.expiryInstant.length > 24) return invalidClientGallery();
      deadline = Date.parse(row.expiryInstant);
      if (!Number.isFinite(deadline)) return invalidClientGallery();
      const canonical = new Date(deadline).toISOString();
      if (row.expiryInstant !== canonical && row.expiryInstant !== canonical.replace(".000Z", "Z")) return invalidClientGallery();
      expiryInstant = row.expiryInstant;
    } else if (row.expiryInstant != null) return invalidClientGallery();
    if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > CLIENT_GALLERY_MAX_ITEMS || Object.keys(row.items).length !== row.items.length) return invalidClientGallery();
    const items: ClientGalleryItem[] = [], keys = new Set<string>();
    for (const value of row.items) {
      const item = imageItem(value);
      if (keys.has(item.key)) return invalidClientGallery();
      keys.add(item.key); items.push(item);
    }
    if (!projected) {
      const authored = Object.fromEntries(Object.entries(row).filter(([name]) => !["_id", "_rev", "_createdAt", "_updatedAt", "_system"].includes(name)));
      if (new TextEncoder().encode(JSON.stringify(authored)).byteLength > CLIENT_GALLERY_MAX_DOCUMENT_BYTES) return invalidClientGallery();
    }
    const deliveryZip = parseClientGalleryZipReference(row.deliveryZip);
    return { ...(deliveryZip === undefined ? {} : { deliveryZip }), id, revision, handle, title, available: row.available, availabilityMode: row.availabilityMode, ...(expiryInstant === undefined ? {} : { expiryInstant, deadline }), items };
  } catch { return invalidClientGallery(); }
}
export function clientGalleryAvailable(gallery: ParsedClientGallery, now: number): boolean {
  if (!Number.isFinite(now)) return invalidClientGallery();
  return gallery.available && (gallery.deadline === undefined || now < gallery.deadline);
}
export function clientGalleryText(rows: readonly ClientText[], language: string, fallback?: string): string | undefined {
  const primary = language.toLowerCase().split("-")[0];
  return rows.find((row) => row.language === primary)?.value ??
    (fallback === undefined ? undefined : rows.find((row) => row.language === fallback.toLowerCase().split("-")[0])?.value ?? rows[0]?.value);
}
