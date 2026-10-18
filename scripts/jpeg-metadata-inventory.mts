/** Opaque JPEG envelope prefix inventory. No metadata values or privacy approval. */
import { createHash } from "node:crypto";
import { parseZipSelection, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
import { failJpeg, jpegAbortCode, JPEG_AUDIT_LIMITS, JpegAuditError, jpegAuditManifest, walkSingleJpegSegments, type JpegSource } from "./jpeg-export-audit.mts";
export const JPEG_ENVELOPE_CATEGORIES = ["exifHeader", "xmpHeader", "extendedXmpHeader", "iccHeader", "photoshopHeader", "jfifHeader", "jfxxHeader", "adobeHeader", "comment", "otherApp"] as const;
const signatures = [
  [0xe1, "Exif\0\0"], [0xe1, "http://ns.adobe.com/xap/1.0/\0"],
  [0xe1, "http://ns.adobe.com/xmp/extension/\0"], [0xe2, "ICC_PROFILE\0"],
  [0xed, "Photoshop 3.0\0"], [0xe0, "JFIF\0"], [0xe0, "JFXX\0"], [0xee, "Adobe"],
] as const;
const prefixes = signatures.map(([marker, signature]) => ({ marker, bytes: Buffer.from(signature, "ascii") }));
export function inventoryJpegEnvelopes(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSegments = JPEG_ENVELOPE_CATEGORIES.map(() => 0), payloadBytes = JPEG_ENVELOPE_CATEGORIES.map(() => 0);
  // Only marker/length boundaries from the shared strict walker are inspected.
  // A matching prefix is not a parsed/validated Exif, XML, ICC or Photoshop payload.
  walkSingleJpegSegments(bytes, (marker, start, length) => {
    if (marker !== 0xfe && (marker < 0xe0 || marker > 0xef)) return;
    let bucket = marker === 0xfe ? 8 : 9;
    if (bucket === 9) {
      const found = prefixes.findIndex(prefix => marker === prefix.marker && length >= prefix.bytes.length &&
        data.subarray(start, start + prefix.bytes.length).equals(prefix.bytes));
      if (found >= 0) bucket = found;
    }
    headerSegments[bucket]++; payloadBytes[bucket] += length;
  });
  return { headerSegments, payloadBytes };
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function auditJpegMetadata(sources: readonly JpegSource[], selection: Uint8Array, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const selected = Buffer.from(selection), names = parseZipSelection(selected), timeoutMs = options.timeoutMs ?? JPEG_AUDIT_LIMITS.timeoutMs;
  if (sources.length !== names.length || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > JPEG_AUDIT_LIMITS.timeoutMs) failJpeg("INVALID_INPUT");
  let total = 0;
  for (const source of sources) {
    if (!Number.isSafeInteger(source.size) || source.size < 4 || source.size > JPEG_AUDIT_LIMITS.bytes) failJpeg("INPUT_LIMIT");
    total += source.size;
  }
  if (total > ZIP_BUILD_LIMITS.expanded) failJpeg("INPUT_LIMIT");
  const controller = new AbortController(), interrupt = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", interrupt, { once: true }); if (options.signal?.aborted) interrupt();
  const timer = setTimeout(() => controller.abort(new DOMException("", "TimeoutError")), timeoutMs);
  async function bounded<T>(call: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) failJpeg(jpegAbortCode(controller.signal));
    let abort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new JpegAuditError(jpegAbortCode(controller.signal))); controller.signal.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) failJpeg(jpegAbortCode(controller.signal)); return call();
    }), stopped]); }
    finally { controller.signal.removeEventListener("abort", abort); }
  }
  const images: { name: string; bytes: number; sha256: string; headerSegments: number[]; payloadBytes: number[] }[] = [];
  try {
    for (const [index, source] of sources.entries()) {
      await bounded(() => source.unchanged()); const bytes = Buffer.alloc(source.size);
      for (let at = 0; at < bytes.length;) {
        const count = Math.min(ZIP_BUILD_LIMITS.chunk, bytes.length - at), part = await bounded(() => source.read(at, count));
        if (!(part instanceof Uint8Array) || part.byteLength !== count) failJpeg("SOURCE_CHANGED");
        bytes.set(part, at); at += count;
      }
      const eof = await bounded(() => source.read(source.size, 1));
      if (!(eof instanceof Uint8Array) || eof.length !== 0) failJpeg("SOURCE_CHANGED");
      await bounded(() => source.unchanged()); const envelopes = inventoryJpegEnvelopes(bytes);
      await bounded(() => source.unchanged());
      images.push({ name: `image-${String(index + 1).padStart(4, "0")}.jpg`, bytes: bytes.length, sha256: hash(bytes), ...envelopes });
    }
    for (const source of sources) await bounded(() => source.unchanged());
    if (controller.signal.aborted) failJpeg(jpegAbortCode(controller.signal));
    const manifest = jpegAuditManifest(images);
    const receipt = { version: 1, status: "metadata-envelope-inventory-offline", count: images.length, sourceBytes: total,
      selectionSha256: hash(selected), manifestSha256: hash(Buffer.from(manifest)), categories: JPEG_ENVELOPE_CATEGORIES,
      counterUnits: "segments-and-whole-payload-bytes-in-category-order", images, readyToUpload: false, published: false,
      checks: { jpegEnvelope: "single-dct-envelope-checked", jpegDecoding: "not-performed", metadataPayloads: "opaque-not-parsed-or-validated",
        metadataSuitability: "unproven-even-with-zero-counts", processedExportProvenance: "owner-asserted-not-verified", intendedSetApproval: "not-established",
        publicationPermission: "not-established", provider: "not-contacted", zipBuildability: "not-established-source-total-excludes-zip-overhead" } } as const;
    if (Buffer.byteLength(manifest) > 256_000 || Buffer.byteLength(JSON.stringify(receipt, null, 2) + "\n") > 256_000) failJpeg("REPORT_LIMIT");
    return { manifest, receipt };
  } catch (error) { if (error instanceof JpegAuditError) throw error; failJpeg("LOCAL_INPUT_FAILED"); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", interrupt); }
}
