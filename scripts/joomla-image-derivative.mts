/**
 * AB#137 write half: generates the one public web-delivery derivative a migrated
 * photograph may publish — resized to this deployment's own
 * `MAX_PUBLIC_DELIVERY_DIMENSION` ceiling, never cropped, never upscaled, matching the
 * hard rules in `AGENTS.md` ("Never crop images", "Public derivatives only").
 *
 * Pure with respect to IO: takes bytes in, returns derivative bytes out. It touches no
 * filesystem or network itself — `write-joomla-content.mts` is the only caller and owns
 * reading the source file and uploading the result.
 *
 * `sharp` is a devDependency for this owner-run migration tool only (recorded in
 * `docs/asset-inventory.md`), never part of the application bundle — the same
 * precedent `parse5` set for the offline conversion half.
 */

import sharp, { type Metadata, type Sharp } from "sharp";

import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";

export type PublicDerivative = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
};

export type ImageDerivativeFailureReason = "decode-failed" | "animated-source" | "encode-failed";

export class ImageDerivativeError extends Error {
  readonly reason: ImageDerivativeFailureReason;

  constructor(reason: ImageDerivativeFailureReason, detail: string) {
    super(`[joomla-image-derivative] ${detail}`);
    this.name = "ImageDerivativeError";
    this.reason = reason;
  }
}

type PreservableFormat = "jpeg" | "png" | "webp" | "avif";

/**
 * Sharp reports an AVIF-encoded buffer as `{format: "heif", mediaType: "image/avif"}`,
 * never `format: "avif"` — verified directly against the version this project pins
 * (0.35.4), not assumed. Checking `mediaType` first is what makes AVIF detection
 * actually work; a plain `format` lookup would silently misclassify every real AVIF
 * source into the static-fallback path below (found during AB#137 write-half plan
 * review, Codex round 1).
 */
function detectPreservableFormat(metadata: Metadata): PreservableFormat | undefined {
  if (metadata.mediaType === "image/avif") return "avif";
  if (metadata.format === "jpeg") return "jpeg";
  if (metadata.format === "png") return "png";
  if (metadata.format === "webp") return "webp";
  return undefined;
}

/**
 * Encoder settings are explicit, not Sharp's own defaults — an implicit,
 * version-dependent quality setting is an unstated publication policy (Codex review
 * round 1). AVIF's comparable-fidelity range sits lower than JPEG/WebP's, a widely
 * documented codec property, hence the lower number there.
 */
function encode(resized: Sharp, format: PreservableFormat): Sharp {
  if (format === "avif") return resized.avif({ quality: 65 });
  if (format === "png") return resized.png({ compressionLevel: 9 });
  if (format === "webp") return resized.webp({ quality: 90 });
  return resized.jpeg({ quality: 90 });
}

export async function generatePublicDerivative(sourceBytes: Uint8Array): Promise<PublicDerivative> {
  let base: Sharp;
  let metadata: Metadata;
  try {
    // `autoOrient()` is Sharp's own documented, purpose-named alias for `rotate()`
    // with no arguments: it orients the image based on EXIF orientation before any
    // resize, so a Joomla-era JPEG with a rotation tag does not publish sideways.
    base = sharp(sourceBytes, { failOn: "error" }).autoOrient();
    metadata = await base.metadata();
  } catch (error) {
    throw new ImageDerivativeError(
      "decode-failed",
      `could not decode the source image: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Animated/multi-page sources are refused, not silently flattened to one frame
  // (Codex review round 1): this tool publishes a single static derivative, and a
  // universal fallback would discard visual meaning the photographer never chose to
  // give up.
  if ((metadata.pages ?? 1) > 1) {
    throw new ImageDerivativeError(
      "animated-source",
      "the source is an animated or multi-page image; this tool publishes a single static derivative and refuses rather than silently flattening one frame",
    );
  }

  const preservable = detectPreservableFormat(metadata);
  // `fit: "inside"` bounds both dimensions without ever cropping;
  // `withoutEnlargement` never upscales a photograph already under the ceiling. No
  // `withMetadata()` call, so EXIF/GPS location data does not survive into the public
  // derivative (Sharp's own default already strips it on a resize/re-encode).
  const resized = base.resize({
    width: MAX_PUBLIC_DELIVERY_DIMENSION,
    height: MAX_PUBLIC_DELIVERY_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  try {
    if (preservable !== undefined) {
      const bytes = await encode(resized, preservable).toBuffer();
      return { bytes, contentType: PUBLIC_DELIVERY_FORMATS[preservable] };
    }
    // A static, otherwise-unsupported source (single-frame GIF/TIFF/BMP/…): a single
    // raster frame loses only its format on conversion, not its meaning, so this
    // falls back to JPEG — but with an explicit background, since a transparent
    // source composited onto a format with no alpha channel needs a stated choice,
    // not whichever default Sharp's own flattening happens to pick.
    const bytes = await resized.flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    return { bytes, contentType: PUBLIC_DELIVERY_FORMATS.jpeg };
  } catch (error) {
    throw new ImageDerivativeError(
      "encode-failed",
      `could not encode the derivative: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
