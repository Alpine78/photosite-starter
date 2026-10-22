import { MAX_PUBLIC_DELIVERY_DIMENSION } from "./media";

/**
 * Closed-shape checks shared by the client delivery and proof gallery
 * validators. Editorial guards only; a runtime adapter validates independently.
 */
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function closed(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}
export function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
export function key(value: unknown): value is string {
  return text(value, 128) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value);
}
export function localized(value: unknown, required: boolean, max: number): boolean {
  if (value == null) return !required;
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  const languages = new Set<string>(), keys = new Set<string>();
  for (const entry of value) {
    if (!record(entry) || !closed(entry, ["_key", "_type", "language", "value"]) ||
      entry._type !== "localizedText" || !key(entry._key) || keys.has(entry._key) ||
      !text(entry.language, 3) || !/^[a-z]{2,3}$/u.test(entry.language) ||
      !text(entry.value, max) || languages.has(entry.language)) return false;
    languages.add(entry.language); keys.add(entry._key);
  }
  return Object.keys(value).length === value.length;
}

/** A complete, uncropped public image of at most 2048 px, or `undefined`. */
export function publicImageAssetRef(image: unknown): string | undefined {
  if (!record(image) || !closed(image, ["_type", "asset", "crop", "hotspot"]) || image._type !== "image") return undefined;
  const { asset, crop, hotspot } = image;
  if (!record(asset) || !closed(asset, ["_type", "_ref"]) || asset._type !== "reference" ||
    typeof asset._ref !== "string") return undefined;
  if (crop != null && (!record(crop) || !closed(crop, ["_type", "top", "right", "bottom", "left"]) ||
    (crop._type !== undefined && crop._type !== "sanity.imageCrop") ||
    ["top", "right", "bottom", "left"].some((key) => crop[key] !== 0))) return undefined;
  if (hotspot != null && (!record(hotspot) || !closed(hotspot, ["_type", "x", "y", "width", "height"]) ||
    (hotspot._type !== undefined && hotspot._type !== "sanity.imageHotspot") ||
    hotspot.x !== 0.5 || hotspot.y !== 0.5 || hotspot.width !== 1 || hotspot.height !== 1)) return undefined;
  const match = /^image-([a-f0-9]{40})-([1-9]\d{0,4})x([1-9]\d{0,4})-(avif|jpeg|jpg|png|webp)$/u.exec(asset._ref);
  if (!match || match[0] !== asset._ref || Math.max(Number(match[2]), Number(match[3])) > MAX_PUBLIC_DELIVERY_DIMENSION) return undefined;
  return asset._ref;
}
