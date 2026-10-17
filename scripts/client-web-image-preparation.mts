/** Offline technical preparation only: no source eligibility decision or remote IO. */
import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { generatePublicDerivative } from "./joomla-image-derivative.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";

export const CLIENT_WEB_IMAGE_LIMITS = { bytes: 25_000_000, pixels: 100_000_000 } as const;
export class ClientWebImageError extends Error {
  readonly code: string;
  constructor(code: string) { super(`[client-web-image] ${code}`); this.code = code; }
}
export function imageFailure(code: string): never { throw new ClientWebImageError(code); }
export const imageDigest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
type Format = "jpeg" | "png" | "webp" | "avif";
function formatOf(metadata: Metadata): Format {
  if (metadata.mediaType === "image/avif" && metadata.format === "heif") return "avif";
  if (metadata.format === "jpeg" || metadata.format === "png" || metadata.format === "webp") return metadata.format;
  return imageFailure("UNSUPPORTED_FORMAT");
}

/** Metadata.pages alone misses APNG with the pinned libvips PNG decoder. */
function assertStaticContainer(bytes: Buffer): void {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    let offset = 8;
    while (offset < bytes.length) {
      if (bytes.length - offset < 12) imageFailure("INVALID_IMAGE");
      const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
      if (length > bytes.length - offset - 12) imageFailure("INVALID_IMAGE");
      if (["acTL", "fcTL", "fdAT"].includes(type)) imageFailure("ANIMATED_IMAGE");
      offset += length + 12;
    }
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    if (bytes.length < 12 || bytes.readUInt32LE(4) !== bytes.length - 8) imageFailure("INVALID_IMAGE");
    let offset = 12;
    while (offset < bytes.length) {
      if (bytes.length - offset < 8) imageFailure("INVALID_IMAGE");
      const type = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      if (length > bytes.length - offset - 8) imageFailure("INVALID_IMAGE");
      if (type === "ANIM" || type === "ANMF" || (type === "VP8X" && length > 0 && (bytes[offset + 8] & 2) !== 0)) imageFailure("ANIMATED_IMAGE");
      offset += 8 + length + (length % 2);
    }
    if (offset !== bytes.length) imageFailure("INVALID_IMAGE");
  }
  // ISO-BMFF ftyp major/compatible brands are four-byte values, not substrings.
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const size = bytes.readUInt32BE(0);
    if (size < 16 || size > bytes.length || size % 4 !== 0) imageFailure("INVALID_IMAGE");
    for (let offset = 8; offset < size; offset += 4) {
      if (offset !== 12 && bytes.toString("ascii", offset, offset + 4) === "avis") imageFailure("ANIMATED_IMAGE");
    }
  }
}

/** Display-oriented source dimensions, before any pixel decode. */
export function clientWebImageDimensions(width: number, height: number, orientation = 1) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      !Number.isInteger(orientation) || orientation < 1 || orientation > 8) imageFailure("INVALID_IMAGE");
  if (width > CLIENT_WEB_IMAGE_LIMITS.pixels / height) imageFailure("PIXEL_LIMIT");
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}
export type ClientWebImageReceipt = {
  version: 1;
  source: { bytes: number; sha256: string; width: number; height: number; format: Format };
  output: { bytes: number; sha256: string; width: number; height: number; format: Format };
  uploaded: false; published: false; sourceEligibilityApproved: false; metadataSuitabilityApproved: false;
};
export async function prepareClientWebImage(input: Uint8Array, classification: string) {
  if (classification !== "processed-export") imageFailure("SOURCE_CLASSIFICATION_REQUIRED");
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > CLIENT_WEB_IMAGE_LIMITS.bytes) imageFailure("INPUT_BYTE_LIMIT");
  const source = Buffer.from(input); // Freeze the bounded caller-owned bytes before awaiting.
  assertStaticContainer(source);
  let metadata: Metadata;
  try { metadata = await sharp(source, { failOn: "warning", limitInputPixels: false }).metadata(); }
  catch { return imageFailure("INVALID_IMAGE"); }
  const format = formatOf(metadata);
  if ((metadata.pages ?? 1) !== 1 || metadata.delay?.length || metadata.loop !== undefined) imageFailure("ANIMATED_IMAGE");
  const dimensions = clientWebImageDimensions(metadata.width, metadata.height, metadata.orientation);
  try {
    // Header inspection is cheap; this bounded full decode catches damaged scans.
    await sharp(source, { failOn: "warning", limitInputPixels: CLIENT_WEB_IMAGE_LIMITS.pixels }).stats();
    const derivative = await generatePublicDerivative(source);
    const bytes = Buffer.from(derivative.bytes), output = await sharp(bytes, { failOn: "warning" }).metadata();
    const scale = Math.min(1, MAX_PUBLIC_DELIVERY_DIMENSION / Math.max(dimensions.width, dimensions.height));
    if (formatOf(output) !== format || derivative.contentType !== PUBLIC_DELIVERY_FORMATS[format] ||
        output.width < 1 || output.height < 1 || Math.max(output.width, output.height) > MAX_PUBLIC_DELIVERY_DIMENSION ||
        output.width > dimensions.width || output.height > dimensions.height ||
        Math.abs(output.width - Math.max(1, Math.round(dimensions.width * scale))) > 1 ||
        Math.abs(output.height - Math.max(1, Math.round(dimensions.height * scale))) > 1 ||
        (output.orientation !== undefined && output.orientation !== 1) || (output.pages ?? 1) !== 1 ||
        output.exif || output.icc || output.iptc || output.xmp || output.xmpAsString || output.tifftagPhotoshop || output.comments?.length || output.hasProfile) imageFailure("OUTPUT_CONTRACT_FAILED");
    const receipt: ClientWebImageReceipt = {
      version: 1,
      source: { bytes: source.length, sha256: imageDigest(source), ...dimensions, format },
      output: { bytes: bytes.length, sha256: imageDigest(bytes), width: output.width, height: output.height, format },
      uploaded: false, published: false, sourceEligibilityApproved: false, metadataSuitabilityApproved: false,
    };
    return { bytes, filename: `web-image.${format === "jpeg" ? "jpg" : format}`, receipt };
  } catch (error) {
    if (error instanceof ClientWebImageError) throw error;
    return imageFailure("IMAGE_PROCESSING_FAILED");
  }
}
