/**
 * Synthetic fixtures only, built with `sharp` itself — no real photographs, no
 * `joomla-backup/` dependency, matching this feature's synthetic-fixture-only rule.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { generatePublicDerivative, ImageDerivativeError } from "./joomla-image-derivative.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";

async function solid(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp" | "avif" | "gif" | "tiff",
  background: { r: number; g: number; b: number; alpha?: number } = { r: 200, g: 60, b: 20 },
): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: background.alpha === undefined ? 3 : 4, background },
  });
  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "png") return image.png().toBuffer();
  if (format === "webp") return image.webp().toBuffer();
  if (format === "avif") return image.avif().toBuffer();
  if (format === "gif") return image.gif().toBuffer();
  return image.tiff().toBuffer();
}

async function animatedGif(): Promise<Uint8Array> {
  const frame1 = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .png()
    .toBuffer();
  const frame2 = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .png()
    .toBuffer();
  return sharp([frame1, frame2], { join: { animated: true } }).gif().toBuffer();
}

describe("generatePublicDerivative", () => {
  it("caps an oversized landscape at the public-delivery ceiling, preserving aspect ratio", async () => {
    const source = await solid(4000, 2000, "jpeg");
    const derivative = await generatePublicDerivative(source);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.width).toBe(MAX_PUBLIC_DELIVERY_DIMENSION);
    expect(metadata.height).toBe(Math.round(MAX_PUBLIC_DELIVERY_DIMENSION / 2));
  });

  it("caps an oversized portrait at the public-delivery ceiling, preserving aspect ratio", async () => {
    const source = await solid(2000, 4000, "jpeg");
    const derivative = await generatePublicDerivative(source);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.height).toBe(MAX_PUBLIC_DELIVERY_DIMENSION);
    expect(metadata.width).toBe(Math.round(MAX_PUBLIC_DELIVERY_DIMENSION / 2));
  });

  it("never upscales an already-small source", async () => {
    const source = await solid(300, 200, "jpeg");
    const derivative = await generatePublicDerivative(source);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(200);
  });

  it("never crops — the resized dimensions never exceed the source's own bounding box", async () => {
    const source = await solid(4000, 1000, "jpeg");
    const derivative = await generatePublicDerivative(source);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.width).toBeLessThanOrEqual(MAX_PUBLIC_DELIVERY_DIMENSION);
    expect(metadata.height).toBeLessThanOrEqual(MAX_PUBLIC_DELIVERY_DIMENSION);
    // fit:"inside" never crops: the full frame survives, only scaled down.
    expect(metadata.width! / metadata.height!).toBeCloseTo(4000 / 1000, 1);
  });

  it("preserves JPEG, PNG, and WebP through the re-encode", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const source = await solid(300, 200, format);
      const derivative = await generatePublicDerivative(source);
      expect(derivative.contentType).toBe(PUBLIC_DELIVERY_FORMATS[format]);
      const metadata = await sharp(derivative.bytes).metadata();
      expect(metadata.format).toBe(format);
    }
  });

  it("preserves AVIF — the exact metadata shape Codex review round 1 found Sharp reports differently", async () => {
    // Sharp reports an AVIF buffer as {format: "heif", mediaType: "image/avif"}, not
    // {format: "avif"}. A regression here would silently misclassify every real AVIF
    // source into the static-fallback path and this assertion would fail on
    // `contentType`.
    const source = await solid(300, 200, "avif");
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.format).toBe("heif");
    expect(sourceMetadata.mediaType).toBe("image/avif");

    const derivative = await generatePublicDerivative(source);
    expect(derivative.contentType).toBe(PUBLIC_DELIVERY_FORMATS.avif);
    const outputMetadata = await sharp(derivative.bytes).metadata();
    expect(outputMetadata.mediaType).toBe("image/avif");
  });

  it("converts a static, otherwise-unsupported source (GIF) to JPEG with an explicit background", async () => {
    const source = await solid(300, 200, "gif");
    const derivative = await generatePublicDerivative(source);
    expect(derivative.contentType).toBe(PUBLIC_DELIVERY_FORMATS.jpeg);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.hasAlpha).toBe(false);
  });

  it("converts a static, otherwise-unsupported source (TIFF) to JPEG", async () => {
    const source = await solid(300, 200, "tiff");
    const derivative = await generatePublicDerivative(source);
    expect(derivative.contentType).toBe(PUBLIC_DELIVERY_FORMATS.jpeg);
  });

  it("refuses an animated source rather than silently flattening it to one frame", async () => {
    const source = await animatedGif();
    await expect(generatePublicDerivative(source)).rejects.toMatchObject({
      reason: "animated-source",
    } satisfies Partial<ImageDerivativeError>);
  });

  it("throws on a corrupt or truncated buffer rather than producing empty/garbage bytes", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(generatePublicDerivative(garbage)).rejects.toMatchObject({
      reason: "decode-failed",
    } satisfies Partial<ImageDerivativeError>);
  });

  it("strips EXIF/GPS metadata from the derivative", async () => {
    const withExif = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .withExif({ IFD0: { Make: "TestCam" } })
      .jpeg()
      .toBuffer();
    const derivative = await generatePublicDerivative(withExif);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
  });
});
