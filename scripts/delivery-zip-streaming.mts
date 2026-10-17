/** Bounded offline ZIP32 audit. No extraction, JPEG approval, network or upload authority. */
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";
import { DELIVERY_ZIP_LIMITS, DeliveryZipError, parseLargeDeliveryZipManifest } from "./delivery-zip-integrity.mts";

export const LARGE_DELIVERY_ZIP_LIMITS = Object.freeze({ ...DELIVERY_ZIP_LIMITS,
  archive: 1_000_000_000, expanded: 1_000_000_000, read: 65_536, timeoutMs: 330_000 });
export type ZipReadPort = Readonly<{ size: number; read(position: number, length: number): Promise<Uint8Array> }>;
function refuse(code: string): never { throw new DeliveryZipError(code); }

/** Each archive byte is read once; held central/EOCD bytes are hashed last in file order. */
export async function inspectLargeDeliveryZip(source: ZipReadPort, manifest: Uint8Array,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  if (!(manifest instanceof Uint8Array) || manifest.byteLength < 1 || manifest.byteLength > LARGE_DELIVERY_ZIP_LIMITS.manifest) refuse("INVALID_MANIFEST");
  const manifestSnapshot = Buffer.from(manifest);
  const expected = parseLargeDeliveryZipManifest(manifestSnapshot), limits = LARGE_DELIVERY_ZIP_LIMITS;
  if (!Number.isSafeInteger(source.size) || source.size < 22 || source.size > limits.archive) refuse("ARCHIVE_SIZE");
  const timeoutMs = options.timeoutMs ?? limits.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > limits.timeoutMs) refuse("INVALID_DEADLINE");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  let abortRead!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortRead = () => reject(new DeliveryZipError("AUDIT_CANCELLED"));
    controller.signal.addEventListener("abort", abortRead, { once: true });
    if (controller.signal.aborted) abortRead();
  });
  void aborted.catch(() => {});
  let readBytes = 0;
  const archiveHash = createHash("sha256");
  async function read(at: number, length: number): Promise<Buffer> {
    if (controller.signal.aborted) refuse("AUDIT_CANCELLED");
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 1 || length > limits.read || at + length > source.size) refuse("TRUNCATED_ARCHIVE");
    readBytes += length;
    if (readBytes > source.size) refuse("READ_BUDGET");
    const data = await Promise.race([source.read(at, length), aborted]);
    if (!(data instanceof Uint8Array) || data.byteLength !== length) refuse("TRUNCATED_ARCHIVE");
    return Buffer.from(data);
  }
  try {
    const end = source.size - 22, eocd = await read(end, 22);
    if (eocd.readUInt32LE(0) !== 0x06054b50 || eocd.readUInt16LE(4) || eocd.readUInt16LE(6) || eocd.readUInt16LE(20)) refuse("UNSUPPORTED_ARCHIVE");
    const count = eocd.readUInt16LE(10), centralSize = eocd.readUInt32LE(12), centralStart = eocd.readUInt32LE(16);
    if (count !== expected.length || eocd.readUInt16LE(8) !== count) refuse("ENTRY_SET_MISMATCH");
    if (centralStart + centralSize !== end || centralStart >= end || centralSize < count * 46 || centralSize > count * 61) refuse("CENTRAL_DIRECTORY");
    const directory = await read(centralStart, centralSize);
    let central = 0, total = 0;
    const entries = expected.map((entry) => {
      if (central + 46 > directory.length || directory.readUInt32LE(central) !== 0x02014b50) refuse("CENTRAL_DIRECTORY");
      const at = central, madeBy = directory.readUInt16LE(at + 4), version = directory.readUInt16LE(at + 6);
      const flags = directory.readUInt16LE(at + 8), method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16), compressed = directory.readUInt32LE(at + 20), size = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28), attributes = directory.readUInt32LE(at + 38);
      if (![10, 20].includes(version) || ![0, 8].includes(method) || (version < 20 && (method === 8 || (flags & 8))) || (flags & ~0x080e) ||
          (method === 0 && (flags & 6)) || directory.readUInt16LE(at + 30) || directory.readUInt16LE(at + 32) || directory.readUInt16LE(at + 34) || nameLength !== entry.name.length) refuse("UNSUPPORTED_ENTRY");
      const host = madeBy >>> 8, unixType = (attributes >>> 16) & 0xf000;
      if (![0, 3].includes(host) || (attributes & 0xffff & ~0x21) || (unixType !== 0 && unixType !== 0x8000)) refuse("UNSUPPORTED_ENTRY");
      if (size !== entry.bytes || size > limits.entry || !compressed || compressed > limits.archive || (method === 0 && compressed !== size)) refuse("ENTRY_SIZE");
      total += size; if (total > limits.expanded) refuse("EXPANSION_LIMIT");
      central += 46 + nameLength;
      if (central > directory.length || !directory.subarray(at + 46, central).equals(Buffer.from(entry.name, "ascii"))) refuse("ENTRY_SET_MISMATCH");
      return { ...entry, version, flags, method, crc, compressed, size, time: directory.readUInt32LE(at + 12), local: directory.readUInt32LE(at + 42) };
    });
    if (central !== directory.length) refuse("ENTRY_LAYOUT");
    let local = 0;
    for (const [index, entry] of entries.entries()) {
      if (entry.local !== local || local + 30 + entry.name.length > centralStart) refuse("ENTRY_LAYOUT");
      const header = await read(local, 30), name = await read(local + 30, entry.name.length);
      const descriptor = Boolean(entry.flags & 8);
      if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(4) !== entry.version || header.readUInt16LE(6) !== entry.flags ||
          header.readUInt16LE(8) !== entry.method || header.readUInt32LE(10) !== entry.time || header.readUInt16LE(26) !== entry.name.length || header.readUInt16LE(28) ||
          header.readUInt32LE(14) !== (descriptor ? 0 : entry.crc) || header.readUInt32LE(18) !== (descriptor ? 0 : entry.compressed) ||
          header.readUInt32LE(22) !== (descriptor ? 0 : entry.size) || !name.equals(Buffer.from(entry.name, "ascii"))) refuse("LOCAL_HEADER");
      const start = local + 30 + entry.name.length, stop = start + entry.compressed;
      const nextLocal = index === entries.length - 1 ? centralStart : entries[index + 1].local;
      const tailLength = nextLocal - stop;
      if (stop > centralStart || nextLocal > centralStart || (descriptor ? ![12, 16].includes(tailLength) : tailLength !== 0)) refuse("ENTRY_LAYOUT");
      archiveHash.update(header).update(name);
      let length = 0, crc = 0;
      const digest = createHash("sha256");
      function consume(chunk: Buffer) {
        if (controller.signal.aborted) refuse("AUDIT_CANCELLED");
        length += chunk.length;
        if (length > entry.size) refuse("EXPANSION_LIMIT");
        crc = crc32(chunk, crc); digest.update(chunk);
      }
      async function* chunks() {
        for (let at = start; at < stop;) {
          const chunk = await read(at, Math.min(limits.read, stop - at));
          archiveHash.update(chunk); at += chunk.length; yield chunk;
        }
      }
      if (entry.method === 0) {
        for await (const chunk of chunks()) consume(chunk);
      } else {
        const inflater = createInflateRaw({ chunkSize: limits.read });
        try {
          await pipeline(Readable.from(chunks(), { objectMode: false, highWaterMark: limits.read }), inflater,
            new Writable({ highWaterMark: limits.read, write(chunk: Buffer, _encoding, done) {
              try { consume(chunk); done(); } catch (error) { done(error as Error); }
            } }), { signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted) refuse("AUDIT_CANCELLED");
          if (error instanceof DeliveryZipError) throw error;
          refuse("INVALID_DEFLATE");
        }
        // Node24 direct-runtime tests establish actual consumed input, including garbage.
        if (inflater.bytesWritten !== entry.compressed) refuse("DEFLATE_TRAILING_BYTES");
      }
      if (length !== entry.size || crc !== entry.crc) refuse("ENTRY_CRC");
      if (digest.digest("hex") !== entry.sha256) refuse("ENTRY_HASH");
      if (descriptor) {
        const tail = await read(stop, tailLength), shift = tailLength === 16 ? 4 : 0;
        if ((shift && tail.readUInt32LE(0) !== 0x08074b50) || tail.readUInt32LE(shift) !== entry.crc ||
            tail.readUInt32LE(shift + 4) !== entry.compressed || tail.readUInt32LE(shift + 8) !== entry.size) refuse("DATA_DESCRIPTOR");
        archiveHash.update(tail);
      }
      local = nextLocal;
    }
    if (local !== centralStart || readBytes !== source.size) refuse("ENTRY_LAYOUT");
    archiveHash.update(directory).update(eocd);
    return Object.freeze({ status: "verified-container-offline" as const, readyToUpload: false as const,
      entries: count, archiveBytes: source.size, expandedBytes: total, archiveSha256: archiveHash.digest("hex"),
      manifestSha256: createHash("sha256").update(manifestSnapshot).digest("hex"),
      checks: { zipEntries: "verified", crc32: "verified", intendedByteSet: "matches-supplied-manifest",
        jpegEligibility: "not-checked", metadataSuitability: "not-checked", manifestAuthority: "not-established", provider: "not-contacted" } });
  } catch (error) {
    if (error instanceof DeliveryZipError) throw error;
    refuse("LOCAL_READ_FAILED");
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", abortRead);
  }
}
