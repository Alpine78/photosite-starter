/**
 * AB#391 / ADR-0039 decision 8: what an import has to do with one owner photograph, read
 * from its bytes. Pure and read-only. `image-import-metadata-edit.mts` makes the edits and
 * checks its results with this module.
 *
 * Presence checks are deliberately over-inclusive: a false "present" costs the owner one
 * review line, while a false "absent" could publish a location nobody reviewed.
 */
import { createHash } from "node:crypto";

import { JpegAuditError, walkSingleJpegSegments } from "./jpeg-export-audit.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "./sanity-seed-fixtures.mts";

export type GpsPresence = "present" | "absent" | "unreadable";

export type JpegImportFacts = Readonly<{
  width: number;
  height: number;
  /** The size a browser shows after the EXIF orientation it applies to an unrotated file. */
  orientedWidth: number;
  orientedHeight: number;
  orientation: number;
  gps: GpsPresence;
  keywordMetadata: boolean;
  creatorPostalAddress: boolean;
}>;

export type ImportAction = "keep-compressed-data" | "re-encode";

const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");
const XMP_HEADER = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
const EXTENDED_XMP_HEADER = Buffer.from("http://ns.adobe.com/xmp/extension/\0", "latin1");
const PHOTOSHOP_HEADER = Buffer.from("Photoshop 3.0\0", "latin1");
const RESOURCE_SIGNATURE = Buffer.from("8BIM", "latin1");
const IPTC_RESOURCE = 0x0404, IPTC_KEYWORDS_DATASET = 25;
const TAG_ORIENTATION = 0x0112, TAG_GPS_IFD = 0x8825;
const XMP_KEYWORDS = /\b(?:dc:subject|lr:hierarchicalSubject|lr:weightedFlatSubject)\b/;
/** The street address (IPTC's spelling is `CiAdrExtadr`), region and postal code. City and country stay. */
const XMP_POSTAL_ADDRESS = /\bCiAdr(?:Extadr|Region|Pcode)\b/i;
const XMP_GPS = /\bexif:GPS(?:Latitude|Longitude)\b/;
/** An import source is already in memory and may be larger than a delivered file: this tool only downscales it. */
const IMPORT_SOURCE_MAX_BYTES = Number.MAX_SAFE_INTEGER;

class Malformed extends Error {}

function readExif(tiff: Buffer): { orientation: number; gps: boolean } {
  if (tiff.length < 8) throw new Malformed();
  const mark = tiff.toString("latin1", 0, 2);
  if (mark !== "II" && mark !== "MM") throw new Malformed();
  const little = mark === "II";
  const u16 = (at: number) => { if (at + 2 > tiff.length) throw new Malformed(); return little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at); };
  const u32 = (at: number) => { if (at + 4 > tiff.length) throw new Malformed(); return little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at); };
  if (u16(2) !== 42) throw new Malformed();
  const ifd = u32(4), entries = u16(ifd);
  let orientation = 1, gps = false;
  for (let index = 0; index < entries; index++) {
    const entry = ifd + 2 + index * 12, tag = u16(entry);
    if (tag === TAG_ORIENTATION) orientation = u16(entry + 8);
    // An empty GPS directory carries no location; anything else counts as present.
    if (tag === TAG_GPS_IFD) gps = u16(u32(entry + 8)) > 0;
  }
  return { orientation: orientation >= 1 && orientation <= 8 ? orientation : 1, gps };
}

/** IPTC keywords inside a Photoshop APP13 segment: 8BIM resource 0x0404, IIM dataset 2:25. */
function hasIptcKeywords(segment: Buffer): boolean {
  let at = PHOTOSHOP_HEADER.length;
  while (at + 12 <= segment.length && segment.subarray(at, at + 4).equals(RESOURCE_SIGNATURE)) {
    const id = segment.readUInt16BE(at + 4);
    const nameLength = segment[at + 6], nameBytes = (nameLength + 2) & ~1; // Pascal string, even length.
    const sizeAt = at + 6 + nameBytes;
    if (sizeAt + 4 > segment.length) return false;
    const size = segment.readUInt32BE(sizeAt), start = sizeAt + 4;
    if (id === IPTC_RESOURCE) {
      const iim = segment.subarray(start, start + size);
      for (let cursor = 0; cursor + 5 <= iim.length && iim[cursor] === 0x1c;) {
        if (iim[cursor + 1] === 2 && iim[cursor + 2] === IPTC_KEYWORDS_DATASET) return true;
        cursor += 5 + iim.readUInt16BE(cursor + 3);
      }
    }
    at = start + size + (size & 1);
  }
  return false;
}

const EMBEDDED_IMAGE_START = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * A thumbnail or preview inside a metadata segment that has metadata of its own. Its location
 * stays unread here, so it counts as `unreadable`, which puts the photograph in front of the owner.
 */
function embedsImageWithMetadata(segment: Buffer): boolean {
  for (let start = segment.indexOf(EMBEDDED_IMAGE_START); start !== -1; start = segment.indexOf(EMBEDDED_IMAGE_START, start + EMBEDDED_IMAGE_START.length)) {
    let cursor = start + 2;
    // Every segment up to the scan, because a comment or table may come before the metadata.
    while (cursor + 4 <= segment.length && segment[cursor] === 0xff && segment[cursor + 1] !== 0xda && segment[cursor + 1] !== 0xd9) {
      const body = cursor + 4;
      if (segment[cursor + 1] === 0xe1 && [EXIF_HEADER, XMP_HEADER].some((header) => segment.subarray(body, body + header.length).equals(header))) return true;
      cursor += 2 + segment.readUInt16BE(cursor + 2);
    }
  }
  return false;
}

/** Throws `JpegAuditError` when the file is outside the shared strict JPEG envelope. */
export function inspectJpegImportFacts(bytes: Uint8Array): JpegImportFacts {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, orientation = 1, gps: GpsPresence = "absent", keywordMetadata = false, creatorPostalAddress = false;
  const markGps = (next: GpsPresence) => { if (gps !== "present") gps = next; };
  walkSingleJpegSegments(bytes, (marker, start, length) => {
    const segment = data.subarray(start, start + length);
    if (marker >= 0xe0 && marker <= 0xef && embedsImageWithMetadata(segment)) markGps("unreadable");
    if (marker >= 192 && marker <= 194 && length >= 5) {
      height = segment.readUInt16BE(1); width = segment.readUInt16BE(3);
    } else if (marker === 0xe1 && segment.subarray(0, EXIF_HEADER.length).equals(EXIF_HEADER)) {
      try {
        const exif = readExif(segment.subarray(EXIF_HEADER.length));
        orientation = exif.orientation;
        if (exif.gps) markGps("present");
      } catch (error) {
        if (!(error instanceof Malformed)) throw error;
        markGps("unreadable");
      }
    } else if (marker === 0xe1 && (segment.subarray(0, XMP_HEADER.length).equals(XMP_HEADER) ||
      segment.subarray(0, EXTENDED_XMP_HEADER.length).equals(EXTENDED_XMP_HEADER))) {
      const text = segment.toString("utf8");
      if (XMP_KEYWORDS.test(text)) keywordMetadata = true;
      if (XMP_POSTAL_ADDRESS.test(text)) creatorPostalAddress = true;
      if (XMP_GPS.test(text)) markGps("present");
      // A base64 image in XMP may carry metadata as well, and is not decoded here.
      if (text.includes("xmpGImg:image")) markGps("unreadable");
    } else if (marker === 0xed && segment.subarray(0, PHOTOSHOP_HEADER.length).equals(PHOTOSHOP_HEADER)) {
      if (hasIptcKeywords(segment)) keywordMetadata = true;
    }
  }, IMPORT_SOURCE_MAX_BYTES);
  const swapped = orientation >= 5;
  return {
    width, height, orientation, gps, keywordMetadata, creatorPostalAddress,
    orientedWidth: swapped ? height : width, orientedHeight: swapped ? width : height,
  };
}

/**
 * Decision 8: at most 2048 px on the longest edge keeps its compressed data byte for byte.
 * A file that needs rotating is the exception: recorded dimensions and the no-crop layout
 * rely on upright pixels, and whether Sanity follows the tag is unverified. No legacy
 * source needs this (AB#391's report found orientation 1 in every readable JPEG).
 */
export function importActionFor(facts: Pick<JpegImportFacts, "width" | "height" | "orientation">): ImportAction {
  return facts.orientation === 1 && Math.max(facts.width, facts.height) <= MAX_PUBLIC_DELIVERY_DIMENSION ? "keep-compressed-data" : "re-encode";
}

/**
 * SHA-256 of everything a decoder needs: all segments except APPn and COM, then the
 * entropy-coded scans. A metadata-only edit leaves it unchanged, which is the proof the
 * "unchanged compressed image data" criterion asks for.
 */
export function compressedImageDataSha256(bytes: Uint8Array): string {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hash = createHash("sha256");
  let firstScan = -1;
  walkSingleJpegSegments(bytes, (marker, start, length) => {
    if (firstScan >= 0) return;
    if (marker === 218) { firstScan = start - 4; return; }
    if (marker === 0xfe || (marker >= 0xe0 && marker <= 0xef)) return;
    hash.update(data.subarray(start - 4, start + length));
  }, IMPORT_SOURCE_MAX_BYTES);
  if (firstScan < 0) throw new JpegAuditError("INVALID_JPEG");
  return hash.update(data.subarray(firstScan)).digest("hex");
}
