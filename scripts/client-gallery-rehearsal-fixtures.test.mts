import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRehearsalFixtures } from "./client-gallery-rehearsal-fixtures.mts";
import { inspectDeliveryZip } from "./delivery-zip-integrity.mts";
import { decodeProcessedJpeg } from "./jpeg-export-audit.mts";
import { inventoryJpegEnvelopes, JPEG_ENVELOPE_CATEGORIES } from "./jpeg-metadata-inventory.mts";

const NONCE = "0123456789abcdef0123456789abcdef";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => { vi.unstubAllGlobals(); });

describe("generated client-gallery rehearsal fixtures", () => {
  it("decodes complete small frames with distinct corners and no embedded private metadata", async () => {
    const network = vi.fn(() => { throw new Error("Offline fixture generation"); });
    vi.stubGlobal("fetch", network);
    const fixtures = await generateRehearsalFixtures(NONCE, "source-revision");
    expect(Object.keys(fixtures).sort()).toEqual(["image", "jpeg", "zip"]);
    expect(await decodeProcessedJpeg(fixtures.jpeg)).toEqual({ width: 512, height: 384 });
    for (const [bytes, width, height, format] of [[fixtures.jpeg, 512, 384, "jpeg"], [fixtures.image, 256, 192, "webp"]] as const) {
      expect(bytes.length).toBeGreaterThan(0); expect(bytes.length).toBeLessThan(1024 * 1024);
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ format, width, height });
      for (const field of ["exif", "icc", "iptc", "xmp", "tifftagPhotoshop", "comments", "orientation"] as const) expect(metadata[field]).toBeUndefined();
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      for (const [x, y, expected] of [[4, 4, [255, 0, 0]], [width - 5, 4, [0, 255, 0]], [4, height - 5, [0, 0, 255]], [width - 5, height - 5, [255, 255, 0]]] as const) {
        const actual = data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
        expect([...actual].every((value, channel) => Math.abs(value - expected[channel]) <= (format === "jpeg" ? 4 : 0))).toBe(true);
      }
    }
    const envelopes = inventoryJpegEnvelopes(fixtures.jpeg);
    for (const [index, category] of JPEG_ENVELOPE_CATEGORIES.entries()) {
      if (category !== "jfifHeader") expect(envelopes.headerSegments[index]).toBe(0);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it("packages exactly the unchanged JPEG in one neutral whole ZIP with independently verified CRC and hashes", async () => {
    const { jpeg, zip } = await generateRehearsalFixtures(NONCE, "zip-revision");
    const manifest = Buffer.from(`delivery-zip-v1\nimage-0001.jpg\t${jpeg.length}\t${hash(jpeg)}\n`);
    expect(zip.length).toBeLessThan(1024 * 1024);
    expect(inspectDeliveryZip(zip, manifest)).toMatchObject({ entries: 1, expandedBytes: jpeg.length, archiveSha256: hash(zip),
      checks: { crc32: "verified", intendedByteSet: "matches-supplied-manifest" } });
    expect(zip.readUInt16LE(8)).toBe(0); // STORE: the sole member can be compared directly.
    const nameLength = zip.readUInt16LE(26), extraLength = zip.readUInt16LE(28), start = 30 + nameLength + extraLength;
    expect(zip.toString("ascii", 30, 30 + nameLength)).toBe("image-0001.jpg");
    expect(zip.subarray(start, start + jpeg.length)).toEqual(jpeg);
  });

  it("is reproducible while keeping different cases and nonces content-addressably distinct", async () => {
    const original = await generateRehearsalFixtures(NONCE, "source-revision");
    expect(await generateRehearsalFixtures(NONCE, "source-revision")).toEqual(original);
    const otherCase = await generateRehearsalFixtures(NONCE, "image-revision");
    const otherNonce = await generateRehearsalFixtures("f".repeat(32), "source-revision");
    for (const key of ["image", "jpeg", "zip"] as const) {
      expect(new Set([original, otherCase, otherNonce].map(fixture => hash(fixture[key]))).size).toBe(3);
    }
  });

  it.each([
    ["", "source-revision"], ["a".repeat(31), "source-revision"], ["A".repeat(32), "source-revision"],
    ["a".repeat(33), "source-revision"], [NONCE, ""], [NONCE, "../source"], [NONCE, "source_revise"],
    [NONCE, "Source"], [NONCE, "source\n"], [NONCE, "a".repeat(41)],
  ])("refuses malformed or unbounded identities without generation (%j, %j)", async (nonce, caseName) => {
    await expect(generateRehearsalFixtures(nonce, caseName)).rejects.toThrow("Invalid rehearsal fixture identity");
  });
});
