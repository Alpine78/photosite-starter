import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { clientWebImageDimensions, CLIENT_WEB_IMAGE_LIMITS, imageDigest, prepareClientWebImage } from "./client-web-image-preparation.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "../sanity/schemas/media";

async function image(width = 120, height = 80, format: "jpeg" | "png" | "webp" | "avif" | "tiff" | "gif" = "jpeg") {
  return sharp({ create: { width, height, channels: 3, background: "red" } }).toFormat(format).toBuffer();
}
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type); let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return result;
}
async function apng() {
  const source = await image(2, 2, "png"), ihdr = source.subarray(16, 29);
  let offset = 8, idat = Buffer.alloc(0);
  while (offset < source.length) {
    const size = source.readUInt32BE(offset); if (source.toString("ascii", offset + 4, offset + 8) === "IDAT") idat = Buffer.concat([idat, source.subarray(offset + 8, offset + 8 + size)]);
    offset += size + 12;
  }
  const control = (seq: number) => { const b = Buffer.alloc(26); b.writeUInt32BE(seq); b.writeUInt32BE(2, 4); b.writeUInt32BE(2, 8); b.writeUInt16BE(1, 20); b.writeUInt16BE(10, 22); return b; };
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  return Buffer.concat([source.subarray(0, 8), chunk("IHDR", ihdr), chunk("acTL", animation), chunk("fcTL", control(0)), chunk("IDAT", idat), chunk("fcTL", control(1)), chunk("fdAT", Buffer.concat([Buffer.from([0, 0, 0, 2]), idat])), chunk("IEND", Buffer.alloc(0))]);
}

describe("offline client web image preparation", () => {
  it.each(["jpeg", "png", "webp", "avif"] as const)("prepares actual %s bytes compatible with the native Studio contract", async format => {
    const source = await image(120, 80, format), original = Buffer.from(source);
    const output = await prepareClientWebImage(source, "processed-export");
    const metadata = await sharp(output.bytes).metadata();
    expect(source).toEqual(original); expect(output.bytes).not.toBe(source);
    expect(output.receipt).toEqual({ version: 1,
      source: { bytes: source.length, sha256: imageDigest(source), width: 120, height: 80, format },
      output: { bytes: output.bytes.length, sha256: imageDigest(output.bytes), width: 120, height: 80, format },
      uploaded: false, published: false, sourceEligibilityApproved: false, metadataSuitabilityApproved: false });
    expect(output.filename).toBe(`web-image.${format === "jpeg" ? "jpg" : format}`);
    expect(PUBLIC_DELIVERY_FORMATS[format]).toBe(metadata.mediaType);
    expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(MAX_PUBLIC_DELIVERY_DIMENSION);
    for (const field of ["exif", "icc", "iptc", "xmp", "tifftagPhotoshop", "comments"] as const) expect(metadata[field]).toBeUndefined();
  });
  it.each([[4000, 2000, 2048, 1024], [2000, 4000, 1024, 2048], [80, 120, 80, 120]])("preserves %i×%i native ratio without enlargement", async (w, h, outW, outH) => {
    const output = await prepareClientWebImage(await image(w, h), "processed-export");
    expect(output.receipt.output).toMatchObject({ width: outW, height: outH });
  });
  it("preserves the coloured edges of the complete frame", async () => {
    const width = 3000, height = 1000, pixels = Buffer.alloc(width * height * 3, 255);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const edge = x < 200 || x >= width - 200 || y < 200 || y >= height - 200;
      if (edge) { const offset = (y * width + x) * 3; pixels[offset] = 255; pixels[offset + 1] = 0; pixels[offset + 2] = 0; }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const output = await prepareClientWebImage(source, "processed-export");
    const { data, info } = await sharp(output.bytes).raw().toBuffer({ resolveWithObject: true });
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
      expect([...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]).toEqual([255, 0, 0]);
    }
  });
  it("normalizes EXIF orientation while stripping source metadata and converting P3 to sRGB", async () => {
    const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 140, g: 80, b: 40 } } })
      .withMetadata({ orientation: 6 }).withExif({ IFD0: { Make: "Synthetic private label" } }).withXmp("<x:xmpmeta xmlns:x='adobe:ns:meta/'>Synthetic</x:xmpmeta>")
      .withIccProfile("p3").jpeg().toBuffer();
    expect((await sharp(source).metadata()).icc).toBeDefined();
    const output = await prepareClientWebImage(source, "processed-export"), metadata = await sharp(output.bytes).metadata();
    expect(output.receipt.source).toMatchObject({ width: 80, height: 120 });
    expect(output.receipt.output).toMatchObject({ width: 80, height: 120 });
    expect(metadata.orientation).toBeUndefined(); expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
    const expected = await sharp(source).autoOrient().toColourspace("srgb").raw().toBuffer();
    const actual = await sharp(output.bytes).raw().toBuffer();
    expect(actual.length).toBe(expected.length);
    expect(Math.max(...actual.subarray(0, 3).map((value, index) => Math.abs(value - expected[index])))).toBeLessThanOrEqual(3);
    expect(JSON.stringify(output.receipt)).not.toMatch(/Synthetic|orientation|Make|xmp|icc/);
  });
  it.each(["tiff", "gif"] as const)("rejects static unsupported %s rather than legacy fallback", async format => {
    await expect(prepareClientWebImage(await image(8, 8, format), "processed-export")).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });
  it("rejects SVG, malformed and truncated scans with static diagnostics", async () => {
    for (const source of [Buffer.from("<svg width='8' height='8' xmlns='http://www.w3.org/2000/svg'></svg>"), Buffer.from("private-source-name"), (await image(800, 600)).subarray(0, 400)]) {
      await expect(prepareClientWebImage(source, "processed-export")).rejects.toThrow(/\[client-web-image\] (UNSUPPORTED_FORMAT|INVALID_IMAGE|IMAGE_PROCESSING_FAILED)$/);
    }
  });
  it("rejects genuine APNG even though the current decoder calls it one static page", async () => {
    const source = await apng(); expect((await sharp(source).metadata()).pages ?? 1).toBe(1);
    await expect(prepareClientWebImage(source, "processed-export")).rejects.toMatchObject({ code: "ANIMATED_IMAGE" });
  });
  it("rejects actual animated WebP and the AVIF sequence brand", async () => {
    const webp = await sharp([await image(8, 8, "png"), await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer()], { join: { animated: true } }).webp().toBuffer();
    await expect(prepareClientWebImage(webp, "processed-export")).rejects.toMatchObject({ code: "ANIMATED_IMAGE" });
    const avif = Buffer.alloc(24); avif.writeUInt32BE(24); avif.write("ftyp", 4); avif.write("avif", 8); avif.write("avis", 16);
    await expect(prepareClientWebImage(avif, "processed-export")).rejects.toMatchObject({ code: "ANIMATED_IMAGE" });
  });
  it("enforces byte/pixel bounds before a full decode and accepts the exact pixel ceiling", async () => {
    await expect(prepareClientWebImage(Buffer.alloc(CLIENT_WEB_IMAGE_LIMITS.bytes + 1), "processed-export")).rejects.toMatchObject({ code: "INPUT_BYTE_LIMIT" });
    expect(clientWebImageDimensions(10_000, 10_000)).toEqual({ width: 10_000, height: 10_000 });
    expect(() => clientWebImageDimensions(10_001, 10_000)).toThrow("PIXEL_LIMIT");
    expect(() => clientWebImageDimensions(Number.MAX_SAFE_INTEGER, 2)).toThrow("PIXEL_LIMIT");
    const source = await image(8, 8, "png"), header = Buffer.from(source.subarray(16, 29)); header.writeUInt32BE(20_000); header.writeUInt32BE(20_000, 4);
    const huge = Buffer.concat([source.subarray(0, 8), chunk("IHDR", header), source.subarray(33)]);
    await expect(prepareClientWebImage(huge, "processed-export")).rejects.toMatchObject({ code: "PIXEL_LIMIT" });
  });
  it("requires the explicit processed-export classification without approving eligibility", async () => {
    await expect(prepareClientWebImage(await image(), "camera-master")).rejects.toMatchObject({ code: "SOURCE_CLASSIFICATION_REQUIRED" });
  });
  it("accepts the exact compressed-byte ceiling and strips PNG text payloads", async () => {
    const jpeg = await image(), bounded = Buffer.alloc(CLIENT_WEB_IMAGE_LIMITS.bytes); jpeg.copy(bounded);
    expect((await prepareClientWebImage(bounded, "processed-export")).receipt.source.bytes).toBe(CLIENT_WEB_IMAGE_LIMITS.bytes);
    const png = await image(8, 8, "png");
    const withText = Buffer.concat([png.subarray(0, 33), chunk("tEXt", Buffer.from("Comment\0Synthetic private description")), png.subarray(33)]);
    expect((await sharp(withText).metadata()).comments?.length).toBe(1);
    const output = await prepareClientWebImage(withText, "processed-export");
    expect((await sharp(output.bytes).metadata()).comments).toBeUndefined();
    expect(JSON.stringify(output.receipt)).not.toContain("Synthetic private description");
  });
  it("takes a private snapshot before the first asynchronous operation", async () => {
    const source = await image(), hash = imageDigest(source), pending = prepareClientWebImage(source, "processed-export"); source.fill(0);
    expect((await pending).receipt.source.sha256).toBe(hash);
  });
});
