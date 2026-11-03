/** Synthetic fixtures only: generated pixels and made-up metadata, no real photograph. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compressedImageDataSha256, importActionFor, inspectJpegImportFacts } from "./image-import-metadata.mts";
import { JpegAuditError } from "./jpeg-export-audit.mts";

async function jpeg(width = 16, height = 8, quality = 80): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg({ quality }).toBuffer();
}

function withSegment(file: Uint8Array, marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([file.subarray(0, 2), Buffer.from([0xff, marker]), length, payload, file.subarray(2)]);
}

function xmp(body: string): Buffer {
  return Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(body, "utf8")]);
}

function photoshop(datasets: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(datasets.length);
  return Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), Buffer.from("8BIM", "latin1"), Buffer.from([0x04, 0x04, 0, 0]), size, datasets]);
}

function iim(dataset: number, value: string): Buffer {
  const text = Buffer.from(value, "utf8"), length = Buffer.alloc(2);
  length.writeUInt16BE(text.length);
  return Buffer.concat([Buffer.from([0x1c, 2, dataset]), length, text]);
}

/** A little-endian TIFF with the given IFD0 tags; a GPS pointer gets `gpsEntries` empty entries. */
function exif(orientation: number | null, gpsEntries: number | null): Buffer {
  const entries: Buffer[] = [];
  const entry = (tag: number, type: number, value: number) => {
    const row = Buffer.alloc(12);
    row.writeUInt16LE(tag, 0); row.writeUInt16LE(type, 2); row.writeUInt32LE(1, 4);
    if (type === 3) row.writeUInt16LE(value, 8); else row.writeUInt32LE(value, 8);
    entries.push(row);
  };
  if (orientation !== null) entry(0x0112, 3, orientation);
  const count = (orientation !== null ? 1 : 0) + (gpsEntries !== null ? 1 : 0);
  const gpsAt = 8 + 2 + count * 12 + 4;
  if (gpsEntries !== null) entry(0x8825, 4, gpsAt);
  const head = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  const size = Buffer.alloc(2);
  size.writeUInt16LE(count);
  const gps = Buffer.alloc(gpsEntries === null ? 0 : 2 + gpsEntries * 12);
  if (gpsEntries !== null) gps.writeUInt16LE(gpsEntries);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), head, size, ...entries, Buffer.alloc(4), gps]);
}

describe("importActionFor", () => {
  it("keeps the compressed data up to the 2048 px bound and re-encodes above it", () => {
    expect(importActionFor({ width: 2048, height: 1365 })).toBe("keep-compressed-data");
    expect(importActionFor({ width: 1365, height: 2048 })).toBe("keep-compressed-data");
    expect(importActionFor({ width: 2049, height: 10 })).toBe("re-encode");
    expect(importActionFor({ width: 10, height: 2049 })).toBe("re-encode");
  });
});

describe("compressedImageDataSha256", () => {
  it("does not change when only metadata segments change", async () => {
    const plain = await jpeg();
    const edited = withSegment(withSegment(plain, 0xe1, xmp("<x:xmpmeta/>")), 0xfe, Buffer.from("note"));
    expect(Buffer.compare(edited, plain)).not.toBe(0);
    expect(compressedImageDataSha256(edited)).toBe(compressedImageDataSha256(plain));
  });

  it("changes when the image is re-encoded", async () => {
    expect(compressedImageDataSha256(await jpeg(16, 8, 80))).not.toBe(compressedImageDataSha256(await jpeg(16, 8, 40)));
  });

  it("refuses a file that is not a JPEG", () => {
    expect(() => compressedImageDataSha256(Buffer.from("not a jpeg"))).toThrow(JpegAuditError);
  });
});

describe("inspectJpegImportFacts", () => {
  it("reads a file with no metadata as having none", async () => {
    expect(inspectJpegImportFacts(await jpeg(16, 8))).toEqual({
      width: 16, height: 8, orientedWidth: 16, orientedHeight: 8, orientation: 1,
      gps: "absent", keywordMetadata: false, creatorPostalAddress: false,
    });
  });

  it("swaps the shown size for a rotating EXIF orientation only", async () => {
    const plain = await jpeg(16, 8);
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, exif(6, null)))).toMatchObject({ orientation: 6, orientedWidth: 8, orientedHeight: 16, width: 16 });
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, exif(3, null)))).toMatchObject({ orientation: 3, orientedWidth: 16, orientedHeight: 8 });
  });

  it("reports EXIF GPS, ignores an empty GPS directory and flags a malformed block for review", async () => {
    const plain = await jpeg();
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, exif(null, 2))).gps).toBe("present");
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, exif(null, 0))).gps).toBe("absent");
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, Buffer.from("Exif\0\0XXXX", "latin1"))).gps).toBe("unreadable");
  });

  it("reads EXIF as another encoder wrote it", async () => {
    const base = sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 90, g: 120, b: 150 } } });
    const located = await base.clone().withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 1/1 0/1" } }).jpeg().toBuffer();
    expect((await sharp(located).metadata()).exif).toBeDefined();
    expect(inspectJpegImportFacts(located).gps).toBe("present");
    const rotated = await base.clone().withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    expect(inspectJpegImportFacts(rotated)).toMatchObject({ orientation: 6, orientedWidth: 8, orientedHeight: 16 });
  });

  it("counts a location that exists only in XMP, and a later location beats an unreadable block", async () => {
    const plain = await jpeg();
    const inXmp = withSegment(plain, 0xe1, xmp('<rdf:Description exif:GPSLatitude="10,1.0N"/>'));
    expect(inspectJpegImportFacts(inXmp).gps).toBe("present");
    expect(inspectJpegImportFacts(withSegment(inXmp, 0xe1, Buffer.from("Exif\0\0XXXX", "latin1"))).gps).toBe("present");
  });

  it("finds keywords in XMP flat, XMP hierarchical and IPTC form", async () => {
    const plain = await jpeg();
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, xmp("<dc:subject><rdf:Bag/></dc:subject>"))).keywordMetadata).toBe(true);
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, xmp("<lr:hierarchicalSubject/>"))).keywordMetadata).toBe(true);
    expect(inspectJpegImportFacts(withSegment(plain, 0xed, photoshop(Buffer.concat([iim(5, "title"), iim(25, "term")])))).keywordMetadata).toBe(true);
    expect(inspectJpegImportFacts(withSegment(plain, 0xed, photoshop(iim(5, "title")))).keywordMetadata).toBe(false);
  });

  it("finds the creator's postal address but not the kept contact fields", async () => {
    const plain = await jpeg();
    expect(inspectJpegImportFacts(withSegment(plain, 0xe1, xmp('<x Iptc4xmpCore:CiAdrCity="Town"/>'))).creatorPostalAddress).toBe(true);
    const kept = withSegment(plain, 0xe1, xmp('<x Iptc4xmpCore:CiEmailWork="a@example.test" Iptc4xmpCore:CiTelWork="1" Iptc4xmpCore:CiUrlWork="x" dc:creator="c"/>'));
    expect(inspectJpegImportFacts(kept)).toMatchObject({ creatorPostalAddress: false, keywordMetadata: false });
  });
});
