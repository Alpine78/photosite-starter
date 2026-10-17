/** Offline ZIP32 integrity only; no JPEG eligibility, extraction or upload authority. */
import { createHash } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";

export const DELIVERY_ZIP_LIMITS = Object.freeze({ archive: 100_000_000, expanded: 100_000_000, entry: 25_000_000, count: 256, manifest: 65_536 });
export class DeliveryZipError extends Error {
  constructor(code: string) { super(`[delivery-zip] ${code}`); this.name = "DeliveryZipError"; }
}
function refuse(code: string): never { throw new DeliveryZipError(code); }
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type ExpectedEntry = Readonly<{ name: string; bytes: number; sha256: string }>;

/** Closed LF/ASCII TSV avoids ambiguous duplicate JSON keys and private free text. */
export function parseDeliveryZipManifest(bytes: Uint8Array): readonly ExpectedEntry[] {
  if (bytes.byteLength < 1 || bytes.byteLength > DELIVERY_ZIP_LIMITS.manifest) refuse("INVALID_MANIFEST");
  const text = Buffer.from(bytes).toString("ascii");
  if (!Buffer.from(text, "ascii").equals(Buffer.from(bytes)) || !text.endsWith("\n")) refuse("INVALID_MANIFEST");
  const lines = text.slice(0, -1).split("\n");
  if (lines.shift() !== "delivery-zip-v1" || lines.length < 1 || lines.length > DELIVERY_ZIP_LIMITS.count) refuse("INVALID_MANIFEST");
  let total = 0;
  return lines.map((line, index) => {
    const match = /^(image-[0-9]{4}\.jpe?g)\t([1-9][0-9]{0,7})\t([a-f0-9]{64})$/.exec(line);
    if (!match || !match[1].startsWith(`image-${String(index + 1).padStart(4, "0")}.`)) refuse("INVALID_MANIFEST");
    const size = Number(match[2]); total += size;
    if (size > DELIVERY_ZIP_LIMITS.entry || total > DELIVERY_ZIP_LIMITS.expanded) refuse("EXPANSION_LIMIT");
    return Object.freeze({ name: match[1], bytes: size, sha256: match[3] });
  });
}

export function inspectDeliveryZip(archive: Buffer, manifest: Uint8Array) {
  const expected = parseDeliveryZipManifest(manifest);
  if (archive.length < 22 || archive.length > DELIVERY_ZIP_LIMITS.archive) refuse("ARCHIVE_SIZE");
  // Narrow profile: EOCD is the final 22 bytes; archive/file comments and extras unsupported.
  const end = archive.length - 22;
  function range(at: number, length: number) {
    if (!Number.isSafeInteger(at) || at < 0 || length < 0 || at + length > archive.length) refuse("TRUNCATED_ARCHIVE");
  }
  const u16 = (at: number) => { range(at, 2); return archive.readUInt16LE(at); };
  const u32 = (at: number) => { range(at, 4); return archive.readUInt32LE(at); };
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20)) refuse("UNSUPPORTED_ARCHIVE");
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  if (count !== expected.length || u16(end + 8) !== count) refuse("ENTRY_SET_MISMATCH");
  if (centralStart + centralSize !== end || centralStart >= end) refuse("CENTRAL_DIRECTORY");
  let central = centralStart, local = 0, total = 0;
  for (const [index, entry] of expected.entries()) {
    range(central, 46);
    if (central + 46 > end || u32(central) !== 0x02014b50) refuse("CENTRAL_DIRECTORY");
    const madeBy = u16(central + 4), version = u16(central + 6), flags = u16(central + 8), method = u16(central + 10);
    const crc = u32(central + 16), compressed = u32(central + 20), size = u32(central + 24), nameLength = u16(central + 28);
    const extra = u16(central + 30), comment = u16(central + 32), disk = u16(central + 34), attributes = u32(central + 38);
    // ZIP 1.0/2.0, no encryption or patched data. DEFLATE level bits are harmless.
    if (![10, 20].includes(version) || ![0, 8].includes(method) || (version < 20 && (method === 8 || (flags & 8))) || (flags & ~0x080e) ||
        (method === 0 && (flags & 6)) || extra || comment || disk || nameLength !== entry.name.length) refuse("UNSUPPORTED_ENTRY");
    const host = madeBy >>> 8, unixType = (attributes >>> 16) & 0xf000;
    if (![0, 3].includes(host) || (attributes & 0xffff & ~0x21) || (unixType !== 0 && unixType !== 0x8000)) refuse("UNSUPPORTED_ENTRY");
    if (u32(central + 42) !== local) refuse("ENTRY_LAYOUT");
    if (size !== entry.bytes || size > DELIVERY_ZIP_LIMITS.entry || !compressed || compressed > DELIVERY_ZIP_LIMITS.archive) refuse("ENTRY_SIZE");
    total += size; if (total > DELIVERY_ZIP_LIMITS.expanded) refuse("EXPANSION_LIMIT");
    const name = Buffer.from(entry.name, "ascii");
    range(central + 46, nameLength);
    if (central + 46 + nameLength > end || !archive.subarray(central + 46, central + 46 + nameLength).equals(name)) refuse("ENTRY_SET_MISMATCH");
    range(local, 30);
    if (u32(local) !== 0x04034b50 || u16(local + 4) !== version || u16(local + 6) !== flags || u16(local + 8) !== method ||
        u32(local + 10) !== u32(central + 12) || u16(local + 26) !== nameLength || u16(local + 28)) refuse("LOCAL_HEADER");
    const descriptor = Boolean(flags & 8);
    if (u32(local + 14) !== (descriptor ? 0 : crc) || u32(local + 18) !== (descriptor ? 0 : compressed) ||
        u32(local + 22) !== (descriptor ? 0 : size)) refuse("LOCAL_HEADER");
    const start = local + 30 + nameLength, stop = start + compressed;
    if (stop > centralStart || !archive.subarray(local + 30, start).equals(name)) refuse("ENTRY_LAYOUT");
    const compressedBytes = archive.subarray(start, stop);
    let data: Buffer;
    if (method === 0) {
      if (compressed !== size) refuse("ENTRY_SIZE");
      data = compressedBytes;
    } else {
      try {
        // @types/node declares Buffer even with info:true; the documented Node24
        // result shape is verified by direct-runtime and corruption tests.
        const decoded = inflateRawSync(compressedBytes, { maxOutputLength: size, info: true }) as unknown as
          { buffer: Buffer; engine: { bytesWritten: number } };
        // Node24 does not have rejectGarbageAfterEnd; check consumed bytes explicitly.
        if (decoded.engine.bytesWritten !== compressedBytes.length) refuse("DEFLATE_TRAILING_BYTES");
        data = decoded.buffer;
      } catch (error) {
        if (error instanceof DeliveryZipError) throw error;
        refuse("INVALID_DEFLATE");
      }
    }
    if (data.length !== size || crc32(data) !== crc) refuse("ENTRY_CRC");
    if (hash(data) !== entry.sha256) refuse("ENTRY_HASH");
    local = stop;
    const nextCentral = central + 46 + nameLength;
    const nextLocal = index === expected.length - 1 ? centralStart : u32(nextCentral + 42);
    if (descriptor) {
      // The next indexed local offset disambiguates an unsigned CRC equal to the signature.
      const length = nextLocal - local;
      if (length !== 12 && length !== 16) refuse("DATA_DESCRIPTOR");
      const signed = length === 16;
      if (signed && u32(local) !== 0x08074b50) refuse("DATA_DESCRIPTOR");
      const offset = signed ? local + 4 : local;
      if (u32(offset) !== crc || u32(offset + 4) !== compressed || u32(offset + 8) !== size) refuse("DATA_DESCRIPTOR");
      local = offset + 12;
      if (local > centralStart) refuse("ENTRY_LAYOUT");
    }
    if (local !== nextLocal) refuse("ENTRY_LAYOUT");
    central = nextCentral;
  }
  if (local !== centralStart || central !== end) refuse("ENTRY_LAYOUT");
  return Object.freeze({ status: "verified-container-offline" as const, readyToUpload: false as const,
    entries: count, archiveBytes: archive.length, expandedBytes: total, archiveSha256: hash(archive), manifestSha256: hash(manifest),
    checks: { zipEntries: "verified", crc32: "verified", intendedByteSet: "matches-supplied-manifest",
      jpegEligibility: "not-checked", metadataSuitability: "not-checked", manifestAuthority: "not-established", provider: "not-contacted" } });
}
