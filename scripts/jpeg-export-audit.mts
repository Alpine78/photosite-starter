/** Technical local JPEG decoding; never determines provenance or public suitability. */
import sharp from "sharp";
import { createHash } from "node:crypto";
import { clientWebImageDimensions } from "./client-web-image-preparation.mts";
import { parseZipSelection, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
export const JPEG_AUDIT_LIMITS = Object.freeze({ bytes: 25_000_000, pixels: 100_000_000, segments: 65_536, timeoutMs: 330_000 });
export class JpegAuditError extends Error { readonly code: string; constructor(code: string) { super(`[jpeg-audit] ${code}`); this.code = code; } }
export function failJpeg(code: string): never { throw new JpegAuditError(code); }
export function jpegAbortCode(signal: AbortSignal) {
  return signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "DEADLINE_EXCEEDED" : "INTERRUPTED";
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** A narrow, single-image DCT JPEG envelope. APP contents, including thumbnails, stay opaque. */
export function assertSingleJpeg(bytes: Uint8Array): void {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 4 || b.length > JPEG_AUDIT_LIMITS.bytes || b[0] !== 255 || b[1] !== 216) failJpeg("INVALID_JPEG");
  let at = 2, frame = false, scans = 0, segments = 0;
  while (at < b.length) {
    if (++segments > JPEG_AUDIT_LIMITS.segments || b[at++] !== 255) failJpeg("INVALID_JPEG");
    while (at < b.length && b[at] === 255) at++;
    if (at >= b.length) failJpeg("INVALID_JPEG");
    const marker = b[at++];
    if (marker === 217) { if (!frame || !scans || at !== b.length) failJpeg("INVALID_JPEG"); return; }
    if (marker === 0 || marker === 216 || marker === 1 || (marker >= 208 && marker <= 215) || [220, 222, 223].includes(marker)) failJpeg("UNSUPPORTED_JPEG");
    if (at + 2 > b.length) failJpeg("INVALID_JPEG");
    const length = b.readUInt16BE(at), end = at + length;
    if (length < 2 || end > b.length) failJpeg("INVALID_JPEG");
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (![192, 193, 194].includes(marker) || frame) failJpeg("UNSUPPORTED_JPEG");
      frame = true;
    }
    if (marker === 226 && b.subarray(at + 2, at + 6).equals(Buffer.from("MPF\0"))) failJpeg("MULTIPICTURE_JPEG");
    at = end;
    if (marker === 218) {
      if (!frame) failJpeg("INVALID_JPEG"); scans++;
      while (at < b.length) {
        if (b[at] !== 255) { at++; continue; }
        const start = at; while (at < b.length && b[at] === 255) at++;
        if (at >= b.length) failJpeg("INVALID_JPEG");
        const next = b[at];
        if (next === 0 || (next >= 208 && next <= 215)) { at++; continue; }
        at = start; break;
      }
    }
  }
  failJpeg("INVALID_JPEG");
}
export async function decodeProcessedJpeg(bytes: Uint8Array) {
  assertSingleJpeg(bytes);
  try {
    const metadata = await sharp(bytes, { failOn: "warning", limitInputPixels: false }).metadata();
    if (metadata.format !== "jpeg" || (metadata.pages ?? 1) !== 1) failJpeg("INVALID_JPEG");
    const dimensions = clientWebImageDimensions(metadata.width, metadata.height, metadata.orientation);
    // Keep raw pixels out of the promise returned to the caller's abort race.
    const decoded = await sharp(bytes, { failOn: "warning", limitInputPixels: JPEG_AUDIT_LIMITS.pixels })
      .toColourspace(metadata.space).raw().timeout({ seconds: 30 }).toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => ({ width: info.width, height: info.height, channels: info.channels, bytes: data.length }));
    if (decoded.width !== metadata.width || decoded.height !== metadata.height || decoded.channels !== metadata.channels ||
      decoded.bytes !== metadata.width * metadata.height * metadata.channels) failJpeg("DECODE_CONTRACT_FAILED");
    return dimensions;
  } catch (error) {
    if (error instanceof JpegAuditError) throw error;
    if (typeof error === "object" && error && "code" in error && error.code === "PIXEL_LIMIT") failJpeg("PIXEL_LIMIT");
    if (error instanceof Error && error.message.toLowerCase().includes("timeout")) failJpeg("DECODE_TIMEOUT");
    failJpeg("JPEG_DECODE_FAILED");
  }
}
export type JpegSource = Readonly<{ size: number; read(at: number, length: number): Promise<Uint8Array>; unchanged(): Promise<void> }>;
export async function auditJpegExports(sources: readonly JpegSource[], selection: Uint8Array, options: {
  signal?: AbortSignal; timeoutMs?: number; decode?: typeof decodeProcessedJpeg;
} = {}) {
  const selectionSnapshot = Buffer.from(selection);
  const names = parseZipSelection(selectionSnapshot), timeoutMs = options.timeoutMs ?? JPEG_AUDIT_LIMITS.timeoutMs;
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
  const cancellation = () => failJpeg(jpegAbortCode(controller.signal));
  async function bounded<T>(call: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) cancellation();
    let abort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => { abort = () => reject(new JpegAuditError(jpegAbortCode(controller.signal))); controller.signal.addEventListener("abort", abort, { once: true }); });
    try { return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) cancellation(); return call(); }), stopped]); }
    finally { controller.signal.removeEventListener("abort", abort); }
  }
  const images: { name: string; bytes: number; sha256: string; width: number; height: number }[] = [], rows = ["delivery-zip-v1"];
  try {
    for (const [index, source] of sources.entries()) {
      await bounded(() => source.unchanged());
      const bytes = Buffer.alloc(source.size);
      for (let at = 0; at < bytes.length;) {
        const count = Math.min(ZIP_BUILD_LIMITS.chunk, bytes.length - at), chunk = await bounded(() => source.read(at, count));
        if (!(chunk instanceof Uint8Array) || chunk.byteLength !== count) failJpeg("SOURCE_CHANGED");
        bytes.set(chunk, at); at += count;
      }
      await bounded(() => source.unchanged());
      const dimensions = await bounded(() => (options.decode ?? decodeProcessedJpeg)(bytes));
      await bounded(() => source.unchanged());
      const name = `image-${String(index + 1).padStart(4, "0")}.jpg`, sha256 = hash(bytes);
      images.push({ name, bytes: bytes.length, sha256, ...dimensions }); rows.push(`${name}\t${bytes.length}\t${sha256}`);
    }
    for (const source of sources) await bounded(() => source.unchanged());
    if (controller.signal.aborted) cancellation();
    const manifest = rows.join("\n") + "\n";
    return { manifest, receipt: { version: 1, status: "decoded-selected-jpegs-offline", count: images.length, sourceBytes: total, selectionSha256: hash(selectionSnapshot), manifestSha256: hash(Buffer.from(manifest)), images,
      readyToUpload: false, published: false, checks: { jpegDecoding: "verified-for-contained-image-data", processedExportProvenance: "owner-asserted-not-verified", metadataSuitability: "unproven", intendedSetApproval: "not-established", provider: "not-contacted" } } } as const;
  } catch (error) { if (error instanceof JpegAuditError) throw error; failJpeg("LOCAL_INPUT_FAILED"); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", interrupt); }
}
