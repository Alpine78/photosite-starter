/** Explicit offline batches only; input names never enter the technical result. */
import { CLIENT_WEB_IMAGE_LIMITS, imageDigest, imageFailure, prepareClientWebImage, type ClientWebImageReceipt } from "./client-web-image-preparation.mts";
export const WEB_BATCH_LIMITS = Object.freeze({ count: 256, selection: 65_536, total: 1_000_000_000, chunk: 65_536 });
export function parseWebImageSelection(input: Uint8Array): readonly string[] {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > WEB_BATCH_LIMITS.selection) imageFailure("INVALID_SELECTION");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input); }
  catch { return imageFailure("INVALID_SELECTION"); }
  if (!text.endsWith("\n")) imageFailure("INVALID_SELECTION");
  const lines = text.slice(0, -1).split("\n");
  if (lines.shift() !== "processed-web-images-v1" || !lines.length || lines.length > WEB_BATCH_LIMITS.count) imageFailure("INVALID_SELECTION");
  const seen = new Set<string>();
  for (const name of lines) {
    if (Buffer.byteLength(name) > 1024 || name !== name.normalize("NFC") || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\\:*?\[\]{}!]/u.test(name) ||
      name.split("/").some(part => !part || part === "." || part === ".." || part !== part.trim() || Buffer.byteLength(part) > 255) ||
      !/\.(jpe?g|png|webp|avif)$/iu.test(name) || seen.has(name)) imageFailure("INVALID_SELECTION");
    seen.add(name);
  }
  return Object.freeze(lines);
}
export type BatchSource = Readonly<{ size: number; read(position: number, length: number): Promise<Uint8Array>; unchanged(): Promise<void> }>;
export type BatchSink = Readonly<{ write(name: string, bytes: Uint8Array): Promise<void>; check(): Promise<void> }>;
export async function prepareWebImageBatch(sources: readonly BatchSource[], selection: Uint8Array, sink: BatchSink,
  signal?: AbortSignal, verifySelection: () => Promise<void> = async () => {}) {
  const selected = parseWebImageSelection(selection), selectionSha256 = imageDigest(selection);
  if (sources.length !== selected.length) imageFailure("INVALID_SELECTION");
  let sourceBytes = 0, outputBytes = 0;
  for (const source of sources) {
    if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > CLIENT_WEB_IMAGE_LIMITS.bytes) imageFailure("INPUT_BYTE_LIMIT");
    sourceBytes += source.size;
  }
  if (sourceBytes > WEB_BATCH_LIMITS.total) imageFailure("BATCH_BYTE_LIMIT");
  const checkAbort = () => { if (signal?.aborted) imageFailure("INTERRUPTED"); };
  const images: { filename: string; preparation: ClientWebImageReceipt }[] = [];
  checkAbort(); await verifySelection();
  for (const [index, source] of sources.entries()) {
    checkAbort(); await source.unchanged();
    const bytes = Buffer.alloc(source.size);
    for (let at = 0; at < bytes.length;) {
      checkAbort(); const wanted = Math.min(WEB_BATCH_LIMITS.chunk, bytes.length - at), chunk = await source.read(at, wanted);
      if (!(chunk instanceof Uint8Array) || chunk.byteLength !== wanted) imageFailure("SOURCE_CHANGED");
      bytes.set(chunk, at); at += wanted;
    }
    await source.unchanged(); checkAbort();
    const prepared = await prepareClientWebImage(bytes, "processed-export");
    const extension = prepared.filename.slice("web-image.".length);
    const authored = /\.([^.]+)$/u.exec(selected[index])![1].toLowerCase().replace("jpeg", "jpg");
    if (authored !== extension) imageFailure("FORMAT_MISMATCH");
    checkAbort(); await source.unchanged();
    outputBytes += prepared.bytes.length;
    if (outputBytes > WEB_BATCH_LIMITS.total) imageFailure("BATCH_BYTE_LIMIT");
    const filename = `image-${String(index + 1).padStart(4, "0")}.${extension}`;
    await sink.write(filename, prepared.bytes);
    images.push({ filename, preparation: prepared.receipt });
    checkAbort();
  }
  await verifySelection();
  for (const source of sources) { checkAbort(); await source.unchanged(); }
  await sink.check(); checkAbort();
  return { version: 1, status: "prepared-web-image-batch-offline", count: images.length, sourceBytes, outputBytes,
    selectionSha256, images, uploaded: false, published: false, sourceEligibilityApproved: false, metadataSuitabilityApproved: false } as const;
}
