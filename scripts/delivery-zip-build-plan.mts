/** Offline owner-selected packaging; no image classification or publication authority. */
export const ZIP_BUILD_LIMITS = Object.freeze({ archive: 1_000_000_000, expanded: 1_000_000_000,
  entry: 25_000_000, count: 256, selection: 65_536, chunk: 65_536, timeoutMs: 330_000 });
export class ZipBuildError extends Error {
  constructor(code: string) { super(`[zip-builder] ${code}`); this.name = "ZipBuildError"; }
}
export function refuseBuild(code: string): never { throw new ZipBuildError(code); }
export function parseZipSelection(bytes: Uint8Array): readonly string[] {
  if (bytes.byteLength < 1 || bytes.byteLength > ZIP_BUILD_LIMITS.selection) refuseBuild("INVALID_SELECTION");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { refuseBuild("INVALID_SELECTION"); }
  if (!text.endsWith("\n")) refuseBuild("INVALID_SELECTION");
  const lines = text.slice(0, -1).split("\n");
  if (lines.shift() !== "processed-jpeg-selection-v1" || lines.length < 1 || lines.length > ZIP_BUILD_LIMITS.count) refuseBuild("INVALID_SELECTION");
  const seen = new Set<string>();
  for (const name of lines) {
    if (name.length > 512 || name !== name.normalize("NFC") || /[\p{Cc}\\:]/u.test(name) ||
        name.split("/").some(part => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255) ||
        !/(?:^|\/)[^/]+\.jpe?g$/iu.test(name) || seen.has(name)) refuseBuild("INVALID_SELECTION");
    seen.add(name);
  }
  return Object.freeze(lines);
}
export function planWholeZip(sizes: readonly number[]) {
  if (!sizes.length || sizes.length > ZIP_BUILD_LIMITS.count) refuseBuild("ENTRY_COUNT");
  let offset = 0, expanded = 0;
  const entries = sizes.map((size, index) => {
    if (!Number.isSafeInteger(size) || size < 4 || size > ZIP_BUILD_LIMITS.entry) refuseBuild("ENTRY_SIZE");
    const name = `image-${String(index + 1).padStart(4, "0")}.jpg`, local = offset;
    offset += 30 + name.length + size + 16; expanded += size;
    return Object.freeze({ name, size, local });
  });
  const centralStart = offset, centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0), archiveBytes = offset + centralSize + 22;
  if (expanded > ZIP_BUILD_LIMITS.expanded || archiveBytes > ZIP_BUILD_LIMITS.archive) refuseBuild("PACKAGE_LIMIT");
  return Object.freeze({ entries: Object.freeze(entries), expandedBytes: expanded, centralStart, centralSize, archiveBytes });
}
export type ZipBuildPlan = ReturnType<typeof planWholeZip>;
type Entry = ZipBuildPlan["entries"][number];
export function zipLocalHeader(entry: Entry): Buffer {
  const b = Buffer.alloc(30 + entry.name.length);
  b.writeUInt32LE(0x04034b50); b.writeUInt16LE(20, 4); b.writeUInt16LE(0x0808, 6); b.writeUInt16LE(0x0021, 12); b.writeUInt16LE(entry.name.length, 26); b.write(entry.name, 30, "ascii");
  return b;
}
export function zipDescriptor(entry: Entry, crc: number): Buffer {
  const b = Buffer.alloc(16); b.writeUInt32LE(0x08074b50); b.writeUInt32LE(crc, 4); b.writeUInt32LE(entry.size, 8); b.writeUInt32LE(entry.size, 12); return b;
}
export function zipCentralHeader(entry: Entry, crc: number): Buffer {
  const b = Buffer.alloc(46 + entry.name.length);
  // Fixed DOS host/version, STORE, no extras/comments/attributes/disk metadata.
  b.writeUInt32LE(0x02014b50); b.writeUInt16LE(20, 4); b.writeUInt16LE(20, 6); b.writeUInt16LE(0x0808, 8); b.writeUInt16LE(0x0021, 14);
  b.writeUInt32LE(crc, 16); b.writeUInt32LE(entry.size, 20); b.writeUInt32LE(entry.size, 24); b.writeUInt16LE(entry.name.length, 28); b.writeUInt32LE(entry.local, 42); b.write(entry.name, 46, "ascii"); return b;
}
export function zipEnd(plan: ZipBuildPlan): Buffer {
  const b = Buffer.alloc(22); b.writeUInt32LE(0x06054b50); b.writeUInt16LE(plan.entries.length, 8); b.writeUInt16LE(plan.entries.length, 10); b.writeUInt32LE(plan.centralSize, 12); b.writeUInt32LE(plan.centralStart, 16); return b;
}
